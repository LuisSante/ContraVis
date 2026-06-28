from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.logging import setup_logging

load_dotenv()
setup_logging()

from api import api_router  # noqa: E402  (tras load_dotenv/setup_logging, a propósito)
from api.deps import document_store  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize the document store on startup
    document_store.initialize()
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

app.include_router(api_router, prefix="/api/v1")

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
