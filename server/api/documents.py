from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from schemas.types import DatasetDocument
from utils.relations import generate_graph_data
from utils.document_store import DocumentStore
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

document_store = DocumentStore()

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

    all_paragraphs_input = []
    
    for page in pages:
        for idx, el in enumerate(page.get("elements", [])):
            text_content = el.get("text", "").strip()
            if text_content:
                all_paragraphs_input.append({
                    "id": el.get("id"),
                    "documentId": doc_id,
                    "text": text_content,
                    "page": page.get("pageNumber"),
                    "paragraph_enum": idx,
                    "x": el.get("x", 0.0),
                    "y": el.get("y", 0.0),
                    "fontSize": el.get("fontSize", 0.0),
                })

    graph_obj = generate_graph_data(all_paragraphs_input)

    payload = {
        "status": "success",
        "documentId": doc_id,
        "graph": graph_obj.model_dump()
    }
    
    return payload

@router.get("/")
def document_init():
    return {"message": "Document initialization endpoint"}
