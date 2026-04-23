import logging
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

from api import documents
from services.graph.neo4j_client import check_neo4j_health, close_neo4j_driver

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize the document store on startup
    documents.document_store.initialize()
    try:
        yield
    finally:
        close_neo4j_driver()

app = FastAPI(lifespan=lifespan)

origins = [
    "http://localhost:5173", 
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router, prefix="/api/v1")

@app.get("/")
def home():
    return {"message": "Hola desde FastAPI"}

@app.get("/health")
def health():
    neo4j = check_neo4j_health()
    payload = {
        "status": "ok" if neo4j.get("status") in {"ok", "skipped"} else "degraded",
        "services": {
            "api": {"status": "ok"},
            "neo4j": neo4j,
        },
    }
    if neo4j.get("status") == "error":
        return JSONResponse(status_code=503, content=payload)
    return payload


@app.get("/health/neo4j")
def health_neo4j():
    neo4j = check_neo4j_health()
    status_code = 200 if neo4j.get("status") in {"ok", "skipped"} else 503
    return JSONResponse(status_code=status_code, content=neo4j)

@app.get("/documents/init")
def home():
    return {"message": "Document initialization endpoint"}
