from pathlib import Path
import os
import re

def _env_int(name: str, default: int) -> int:
  raw = os.getenv(name)
  if raw is None:
    return default
  try:
    return int(raw.strip())
  except Exception:
    return default


def _env_float(name: str, default: float) -> float:
  raw = os.getenv(name)
  if raw is None:
    return default
  try:
    return float(raw.strip())
  except Exception:
    return default


class Config:
  # CUAD_PDF_DIR = Path("../infra/CUAD_v1/full_contract_pdf")
  # CUAD_DOC_DIR = Path("../infra/CUAD_v1/full_contract_docx")
  CUAD_PDF_DIR = Path("../infra/CUAD_v1/full_contract_pdf_contradictions")
  CUAD_DOC_DIR = Path("../infra/CUAD_v1/full_contract_docx_contradictions")

  EDITED_PDF_DIR = Path("../infra/edited_pdfs")
  EDITED_DOC_DIR = Path("../infra/edited_docs")

  SAVED_CONTRADICTIONS_DIR = Path(
    os.getenv("SAVED_CONTRADICTIONS_DIR", "../infra/contradiction_results")
  )
  GRAPH_CACHE_DIR = Path(
    os.getenv("GRAPH_CACHE_DIR", "../infra/json/graph_cache")
  )

  GRAPH_CACHE_ENABLED = os.getenv("GRAPH_CACHE_ENABLED", "1").strip() != "0"
  NEO4J_URI = os.getenv("NEO4J_URI", "").strip()
  NEO4J_USERNAME = os.getenv("NEO4J_USERNAME", "").strip()
  NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "").strip()
  NEO4J_DATABASE = os.getenv("NEO4J_DATABASE", "neo4j").strip() or "neo4j"
  
  semantic_mode_raw = os.getenv("SEMANTIC_RELATED_MODE", "top_k").strip().lower()
  SEMANTIC_RELATED_MODE = semantic_mode_raw if semantic_mode_raw in {"top_k", "all"} else "top_k"
  
  SEMANTIC_TOP_K = max(1, _env_int("SEMANTIC_TOP_K", 5))
  SEMANTIC_SIMILARITY_THRESHOLD = max(0.0, min(1.0, _env_float("SEMANTIC_SIMILARITY_THRESHOLD", 0.8)))
  
  REFERENCE_PATTERNS = [
    ("section", re.compile(r'\b[Ss]ection\s+(\d+(?:\.\d+)*)\b')),
    ("article", re.compile(r'\b[Aa]rticle\s+(\d+(?:\.\d+)*)\b')),
    ("exhibit", re.compile(r'\b[Ee]xhibit\s+([A-Za-z]|\d+(?:\.\d+)*)\b')),
    ("schedule", re.compile(r'\b[Ss]chedule\s+([A-Za-z]|\d+(?:\.\d+)*)\b')),
    ("annex",    re.compile(r'\b[Aa]nnex\s+([A-Za-z]|\d+(?:\.\d+)*)\b')),
    ("appendix", re.compile(r'\b[Aa]ppendix\s+([A-Za-z]|\d+(?:\.\d+)*)\b')),
  ]
    
  TYPE_PRIORITY = {
    "precedence": 5,
    "scope": 4,
    "deontic": 3,
    "numeric": 2,
    "definition": 2,
    "other": 1
  }
