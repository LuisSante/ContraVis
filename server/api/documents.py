from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from schemas.document import DatasetDocument, Paragraph
from schemas.graph import Graph
from utils.pdf_reader import PDFReader
from utils.relations import generate_graph_data
from utils.document_store import DocumentStore
from schemas.contradiction import Contradiction
from utils.contradictions import classify_contradiction, postfilter_and_rank
from pdf2docx import Converter
import logging
import os

router = APIRouter()
logger = logging.getLogger(__name__)

pdf_reader = PDFReader()

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
async def process_document(
    document_id: str = Form(...)
):
    pdf_path = document_store.get_path(document_id)
    output = pdf_reader.pdf_to_structured_json(pdf_path)

    return output


@router.get("/")
def document_init():
    return {"message": "Document initialization endpoint"}
