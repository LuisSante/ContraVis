from pathlib import Path
import re

class Config:
  CUAD_PDF_DIR = Path("../infra/CUAD_v1/full_contract_pdf")
  CUAD_DOC_DIR = Path("../infra/CUAD_v1/full_contract_docx")
  EDITED_PDF_DIR = Path("../infra/edited_pdfs")
  EDITED_DOC_DIR = Path("../infra/edited_docs")
  REFERENCE_PATTERNS = [
    # Section 1.4.2 / section 3 / Section 10.1
    ("section", re.compile(r'\b[Ss]ection\s+(\d+(?:\.\d+)*)\b')),
    # Article 16 / article 2.1 / Article IV
    ("article", re.compile(r'\b[Aa]rticle\s+(\d+(?:\.\d+)*)\b')),
    # Exhibit A / exhibit 10.1
    # ("exhibit", re.compile(r'\b[Ee]xhibit\s+([A-Za-z]|\d+(?:\.\d+)*)\b')),
    # Schedule 1 / Annex B / Appendix C
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

  # Hierarchical pattern: captures sections with sublevels
  # ref_match = re.search(r'[Ss]ection\s+(\d+(\.\d+)*)', nodes[i]["text"])        
  # ref_match.group(1) -> "3.2.1"

  # Simple pattern: only captures the main number
  # ref_match = re.search(r'[Ss]ection\s+(\d+)', nodes[i]["text"])
  # ref_match.group(1) -> "3"
