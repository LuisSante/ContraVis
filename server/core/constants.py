import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CUAD_DOC_DIR = REPO_ROOT / "infra" / "CUAD_v1" / "full_contract_docx_contradictions"

REFERENCE_PATTERNS = [
    ("section", re.compile(r"\b[Ss]ection\s+(\d+(?:\.\d+)*)\b")),
    ("article", re.compile(r"\b[Aa]rticle\s+(\d+(?:\.\d+)*)\b")),
    # ("exhibit", re.compile(r"\b[Ee]xhibit\s+([A-Za-z]|\d+(?:\.\d+)*)\b")),
    ("schedule", re.compile(r"\b[Ss]chedule\s+([A-Za-z]|\d+(?:\.\d+)*)\b")),
    ("annex", re.compile(r"\b[Aa]nnex\s+([A-Za-z]|\d+(?:\.\d+)*)\b")),
    ("appendix", re.compile(r"\b[Aa]ppendix\s+([A-Za-z]|\d+(?:\.\d+)*)\b")),
]
