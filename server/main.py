import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

from api import deps, documents, assistant, contradictions, llm

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize the document store on startup
    deps.document_store.initialize()
    yield

app = FastAPI(lifespan=lifespan)

origins = [
    "http://localhost:5173",  # legacy SvelteKit client
    "http://127.0.0.1:5173",
    "http://localhost:3000",  # Next.js frontend (web/)
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router, prefix="/api/v1")
app.include_router(assistant.router, prefix="/api/v1")
app.include_router(contradictions.router, prefix="/api/v1")
app.include_router(llm.router, prefix="/api/v1")

@app.get("/")
def home():
    return {"message": "Hola desde FastAPI"}

@app.get("/health")
def health():
    return {
        "status": "ok",
        "services": {
            "api": {"status": "ok"},
        },
    }

@app.get("/documents/init")
def home():
    return {"message": "Document initialization endpoint"}
