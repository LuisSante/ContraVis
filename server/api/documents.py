from fastapi import APIRouter, HTTPException, Form
from fastapi.responses import FileResponse
from schemas.document import DatasetDocument, Paragraph
from schemas.graph import Graph
from utils.relations import generate_graph_data
from utils.document_store import DocumentStore
from schemas.contradiction import Contradiction
from utils.contradictions import classify_contradiction, postfilter_and_rank
from pdf2docx import Converter
import logging
import os

router = APIRouter()
logger = logging.getLogger(__name__)

document_store = DocumentStore()

@router.get("/list_documents", response_model=list[DatasetDocument])
def list_documents():
    if not document_store._initialized:
        document_store.initialize()

    return document_store.get_documents()


@router.get("/{document_id}/pdf")
def get_document_pdf(document_id: str):
    logger.info(f"Fetching PDF for document ID: {document_id}")

    pdf_path = document_store.get_path(document_id)

    if pdf_path and pdf_path.exists():
        return FileResponse(
            path=pdf_path,
            media_type="application/pdf",
            filename=pdf_path.name
        )

    raise HTTPException(status_code=404, detail="Document not found")

# @router.post("/process", response_model=Graph)
@router.post("/process")
async def process_document(data: dict):    
    doc_id = data.get("documentId")
    pages = data.get("pages", [])

    all_paragraphs = []
    for page in pages:
        for el in page.get("elements", []):
            text_content = el.get("text", "").strip()
            if text_content:  # Solo si el texto no es vacío
                all_paragraphs.append({
                    "id": el.get("id"),
                    "text": text_content,
                    "page": page.get("pageNumber"),
                    "x": el.get("x"),
                    "y": el.get("y")
                })
    
    with open(f"{doc_id}.json", "w") as f:
        import json
        json.dump(all_paragraphs, f, indent=2)

    graph_result = generate_graph_data(all_paragraphs)
    
    return {
        "status": "success",
        "documentId": doc_id,
        "graph": graph_result
    }

@router.get("/")
def document_init():
    return {"message": "Document initialization endpoint"}
