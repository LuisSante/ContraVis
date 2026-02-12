import re
import fitz  # PyMuPDF
import pandas as pd
import numpy as np

from fuzzywuzzy import fuzz

class PDFReader:
    def pdf_to_structured_json(self, pdf_path):
        doc = fitz.open(pdf_path)
        output = []
        pid = 0

        for page_index, page in enumerate(doc):
            data = page.get_text("dict")

            for block in data["blocks"]:
                if block["type"] != 0:
                    continue

                paragraph = {
                    "id": f"p{pid}",
                    "page": page_index,
                    "bbox": block["bbox"],
                    "runs": []
                }

                for line in block["lines"]:
                    for span in line["spans"]:
                        paragraph["runs"].append({
                            "text": span["text"],
                            "size": span["size"],
                            "font": span["font"],
                            "bold": "Bold" in span["font"],
                            "italic": "Italic" in span["font"],
                            "color": span["color"]
                        })

                output.append(paragraph)
                pid += 1

        return output