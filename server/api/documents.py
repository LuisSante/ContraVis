from collections import Counter
import logging
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from schemas.types import (
    AssistantChatRequest,
    AssistantChatResponse,
    ContradictionAnalysisRequest,
    ContradictionAnalysisResponse,
    DatasetDocument,
    SavedContradictionsResponse,
    SimplifySelectionRequest,
    SimplifySelectionResponse,
)
from services.contradiction_analysis import analyze_document_contradictions
from services.contradiction_saved import (
    load_saved_contradictions_for_document,
    save_analyzed_contradictions,
)
from services.contract_assistant import (
    fix_contradiction_selection,
    generate_assistant_response,
    simplify_paragraph_selection,
)
from services.graph.cache import build_graph_cache_key, load_graph_cache, save_graph_cache
from services.graph.knowledge_graph import build_knowledge_graph
from services.graph.relations import generate_graph_data
from utils.config import Config
from utils.document_store import DocumentStore

router = APIRouter()
logger = logging.getLogger(__name__)

document_store = DocumentStore()

PAGE_NUMBER_ONLY_RE = re.compile(r"^(?:\d+|[ivxlcdm]{1,8})$", re.IGNORECASE)
PAGE_LABEL_RE = re.compile(r"^(?:page|pagina|p[aÃ¡]g\.?)\s*\d+(?:\s*(?:\/|of|de)\s*\d+)?$", re.IGNORECASE)
BOUNDARY_SCAN_LINES = 3


def normalize_text(raw: str) -> str:
    return re.sub(r"\s+", " ", raw or "").strip()


def is_page_marker(text: str) -> bool:
    if not text:
        return False
    return bool(PAGE_NUMBER_ONLY_RE.match(text) or PAGE_LABEL_RE.match(text))


def is_repeated_boundary_candidate(text: str) -> bool:
    if is_page_marker(text):
        return True
    if len(text) > 180:
        return False
    words = [token for token in text.split(" ") if token]
    return 0 < len(words) <= 22


def detect_repeated_boundary_texts(
    pages: list[dict],
) -> tuple[dict[int, dict[str, list[tuple[int, str]]]], set[str], set[str]]:
    boundaries_by_page: dict[int, dict[str, list[tuple[int, str]]]] = {}
    top_counts: Counter[str] = Counter()
    bottom_counts: Counter[str] = Counter()

    for page_idx, page in enumerate(pages):
        non_empty_entries: list[tuple[int, str]] = []
        for element_idx, element in enumerate(page.get("elements", [])):
            text = normalize_text(str(element.get("text", "")))
            if text:
                non_empty_entries.append((element_idx, text))

        if not non_empty_entries:
            continue

        top_entries = non_empty_entries[:BOUNDARY_SCAN_LINES]
        bottom_entries = non_empty_entries[max(len(non_empty_entries) - BOUNDARY_SCAN_LINES, 0):]
        top_entries_keyed = [(idx, text.lower()) for idx, text in top_entries]
        bottom_entries_keyed = [(idx, text.lower()) for idx, text in bottom_entries]
        boundaries_by_page[page_idx] = {
            "top": top_entries_keyed,
            "bottom": bottom_entries_keyed,
        }
        for _, text_key in top_entries_keyed:
            top_counts[text_key] += 1
        for _, text_key in bottom_entries_keyed:
            bottom_counts[text_key] += 1

    repeated_top = {
        text for text, count in top_counts.items() if count >= 2 and is_repeated_boundary_candidate(text)
    }
    repeated_bottom = {
        text for text, count in bottom_counts.items() if count >= 2 and is_repeated_boundary_candidate(text)
    }

    return boundaries_by_page, repeated_top, repeated_bottom


@router.get("/list_documents", response_model=list[DatasetDocument])
def list_documents():
    if not document_store._initialized:
        document_store.initialize()

    return document_store.get_documents()


@router.get("/document_file/{doc_id}")
def get_document_file(doc_id: str):
    if not document_store._initialized:
        document_store.initialize()

    path = document_store.get_path(doc_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Document not found")

    if path.suffix.lower() != ".docx":
        raise HTTPException(status_code=400, detail="Only DOCX documents are supported")

    return FileResponse(
        path=path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=path.name,
    )


@router.post("/process")
async def process_document(data: dict):
    doc_id = data.get("documentId")
    pages = data.get("pages", [])
    boundaries_by_page, repeated_top_texts, repeated_bottom_texts = detect_repeated_boundary_texts(pages)

    all_paragraphs_input = []

    for page_idx, page in enumerate(pages):
        boundary = boundaries_by_page.get(page_idx, {})
        top_boundary = boundary.get("top", [])
        bottom_boundary = boundary.get("bottom", [])

        for idx, el in enumerate(page.get("elements", [])):
            text_content = normalize_text(str(el.get("text", "")))
            if not text_content:
                continue

            if is_page_marker(text_content):
                continue

            text_key = text_content.lower()
            if text_key in repeated_top_texts and any(
                idx == boundary_idx and text_key == boundary_text
                for boundary_idx, boundary_text in top_boundary
            ):
                continue

            if text_key in repeated_bottom_texts and any(
                idx == boundary_idx and text_key == boundary_text
                for boundary_idx, boundary_text in bottom_boundary
            ):
                continue

            all_paragraphs_input.append(
                {
                    "id": el.get("id"),
                    "documentId": doc_id,
                    "text": text_content,
                    "page": page.get("pageNumber"),
                    "paragraph_enum": idx,
                    "x": el.get("x", 0.0),
                    "y": el.get("y", 0.0),
                    "fontSize": el.get("fontSize", 0.0),
                }
            )

    cache_key = build_graph_cache_key(
        document_id=str(doc_id or "unknown"),
        paragraphs_data=all_paragraphs_input,
        schema_version=Config.KG_SCHEMA_VERSION,
    )
    if Config.GRAPH_CACHE_ENABLED:
        cached_payload = load_graph_cache(
            cache_dir=Config.GRAPH_CACHE_DIR,
            cache_key=cache_key,
        )
        if cached_payload and isinstance(cached_payload.get("graph"), dict):
            cache_meta = {
                "enabled": True,
                "hit": True,
                "key": cache_key,
            }
            response = dict(cached_payload)
            response["cache"] = cache_meta
            return response

    graph_obj = generate_graph_data(all_paragraphs_input)
    knowledge_graph = build_knowledge_graph(
        document_id=str(doc_id or "unknown"),
        paragraph_graph=graph_obj,
        schema_version=Config.KG_SCHEMA_VERSION,
    )

    cache_meta = {
        "enabled": Config.GRAPH_CACHE_ENABLED,
        "hit": False,
        "key": cache_key,
    }
    response = {
        "status": "success",
        "documentId": doc_id,
        "graph": graph_obj.model_dump(),
        "knowledgeGraph": knowledge_graph.model_dump(),
        "cache": cache_meta,
    }

    if Config.GRAPH_CACHE_ENABLED:
        try:
            save_graph_cache(
                cache_dir=Config.GRAPH_CACHE_DIR,
                cache_key=cache_key,
                payload=response,
            )
        except Exception:
            logger.exception("Failed to save graph cache for document_id=%s", doc_id)

    return response


@router.post("/assistant/chat", response_model=AssistantChatResponse)
def assistant_chat(payload: AssistantChatRequest):
    try:
        return generate_assistant_response(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected assistant error")
        raise HTTPException(status_code=500, detail="Failed to generate assistant response") from exc


@router.post("/assistant/simplify", response_model=SimplifySelectionResponse)
def assistant_simplify(payload: SimplifySelectionRequest):
    try:
        return simplify_paragraph_selection(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected simplify error")
        raise HTTPException(status_code=500, detail="Failed to simplify selection") from exc


@router.post("/assistant/fix_contradiction", response_model=SimplifySelectionResponse)
def assistant_fix_contradiction(payload: SimplifySelectionRequest):
    try:
        return fix_contradiction_selection(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected fix-contradiction error")
        raise HTTPException(status_code=500, detail="Failed to fix contradiction") from exc


@router.post("/contradictions/analyze", response_model=ContradictionAnalysisResponse)
def analyze_document_contradictions_endpoint(payload: ContradictionAnalysisRequest):
    try:
        response = analyze_document_contradictions(payload)
        try:
            saved_path = save_analyzed_contradictions(response)
            logger.info("Saved contradiction analysis: %s", saved_path)
        except Exception:
            logger.exception("Failed to persist contradiction analysis result")
        return response
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected contradiction-analysis error")
        raise HTTPException(status_code=500, detail="Failed to analyze contradictions") from exc


@router.get("/contradictions/saved/{document_id}", response_model=SavedContradictionsResponse)
def get_saved_contradictions(document_id: str):
    try:
        rows, source_file = load_saved_contradictions_for_document(document_id)
        return SavedContradictionsResponse(
            documentId=document_id,
            sourceFile=source_file,
            paragraphResults=rows,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected saved-contradictions error")
        raise HTTPException(status_code=500, detail="Failed to load saved contradictions") from exc


@router.get("/")
def document_init():
    return {"message": "Document initialization endpoint"}
