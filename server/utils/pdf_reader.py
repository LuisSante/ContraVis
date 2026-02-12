import fitz
import re

def _join_spans_with_spacing(spans):
    out = []
    for s in spans:
        t = (s.get("text") or "")
        if not t:
            continue
        if out and not out[-1].endswith((" ", "\n")) and not t.startswith((" ", "\n", ".", ",", ":", ";", ")", "]")):
            out.append(" ")
        out.append(t)
    return "".join(out)

class PDFReader:
    def pdf_to_structured_json(self, pdf_path: str):
        doc = fitz.open(str(pdf_path))

        paragraphs = []
        pages = []

        pid = 0
        for page_index in range(len(doc)):
            page = doc[page_index]
            rect = page.rect  # tamaño de página en puntos PDF
            pages.append({"page": page_index, "width": rect.width, "height": rect.height})

            data = page.get_text("dict")
            for block in data["blocks"]:
                if block.get("type") != 0:
                    continue

                runs = []
                full_text_lines = []

                for line in block.get("lines", []):
                    line_spans = line.get("spans", [])
                    line_text = _join_spans_with_spacing(line_spans).strip()
                    if line_text:
                        full_text_lines.append(line_text)

                    for span in line_spans:
                        text = (span.get("text") or "")
                        if not text.strip():
                            continue
                        runs.append({
                            "text": text,
                            "size": span.get("size"),
                            "font": span.get("font", ""),
                            "bold": "Bold" in (span.get("font","")),
                            "italic": "Italic" in (span.get("font","")),
                            "color": span.get("color", 0)
                        })

                full_text = "\n".join(full_text_lines).strip()
                if not full_text:
                    continue

                paragraphs.append({
                    "id": f"p{pid}",
                    "page": page_index,
                    "bbox": block.get("bbox"),
                    "text": full_text,
                    "runs": runs
                })
                pid += 1

        return {"pages": pages, "paragraphs": paragraphs}

