from typing import Dict, List, Any
from pdf2docx import Converter
from docx import Document
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pdf_test")

class PDFReader:
    def pdf_to_structured_json(self, pdf_path: str) -> Dict[str, Any]:
        """
        {
            "id": "p_0",
            "text": "",
            "style": {
                "font_name": null,
                "font_size": null,
                "bold": false,
                "italic": false,
                "alignment": "None"
            },
            "original": ""
        }
        """

        docx_path = "temp.docx"
        cv = Converter(pdf_path)
        cv.convert(docx_path)
        cv.close()
        
        doc = Document(docx_path)
        
        paragraphs = []
        for i, para in enumerate(doc.paragraphs):
            paragraphs.append({
                "id": f"p_{i}",
                "text": para.text,
                "style": {
                    "font_name": para.runs[0].font.name if para.runs else None,
                    "font_size": para.runs[0].font.size if para.runs else None,
                    "bold": para.runs[0].bold if para.runs else False,
                    "italic": para.runs[0].italic if para.runs else False,
                    "alignment": str(para.alignment)
                },
                "original": para.text  # Para tracking
        })

        return {
            "paragraphs": paragraphs,
        }