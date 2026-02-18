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
