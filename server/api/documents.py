from collections import Counter
import json
import logging
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from schemas.types import DatasetDocument
from services.graph.relations import generate_graph_data
from utils.config import Config
from api.deps import document_store

router = APIRouter()
logger = logging.getLogger(__name__)

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


def safe_graph_filename(value: str) -> str:
    token = re.sub(r"[^a-zA-Z0-9._-]+", "_", (value or "").strip())
    token = re.sub(r"_+", "_", token).strip("._")
    return token or "unknown_document"


def save_graph_output_snapshot(*, document_id: str | None, graph_payload: dict) -> None:
    output_dir = Config.GRAPH_OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    file_stem = str(document_id or "unknown_document")
    doc_path = document_store.get_path(file_stem)
    if doc_path is not None:
        try:
            relative = doc_path.relative_to(Config.CUAD_DOC_DIR).as_posix()
            file_stem = relative.rsplit(".", 1)[0].replace("/", "__")
        except Exception:
            file_stem = doc_path.stem

    output_path = output_dir / f"{safe_graph_filename(file_stem)}.json"
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(graph_payload, handle, ensure_ascii=False, indent=2)


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
    raw_doc_id = data.get("documentId")
    doc_id = document_store.get_canonical_id(raw_doc_id) or raw_doc_id
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
                }
            )

    graph_obj = generate_graph_data(all_paragraphs_input)

    cache_meta = {
        "enabled": False,
        "hit": False,
        "key": None,
    }
    response = {
        "status": "success",
        "documentId": doc_id,
        "graph": graph_obj.model_dump(),
        "cache": cache_meta,
    }

    # try:
    #     save_graph_output_snapshot(document_id=doc_id, graph_payload=response["graph"])
    # except Exception:
    #     logger.exception("Failed to save graph output snapshot for document_id=%s", doc_id)

    return response


@router.get("/")
def document_init():
    return {"message": "Document initialization endpoint"}
