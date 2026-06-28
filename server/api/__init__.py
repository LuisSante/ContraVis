"""Agrega los routers de la API en un único `api_router` que monta `main.py`."""

from fastapi import APIRouter

from api.routes import assistant, contradictions, documents, llm

api_router = APIRouter()
api_router.include_router(documents.router)
api_router.include_router(assistant.router)
api_router.include_router(contradictions.router)
api_router.include_router(llm.router)
