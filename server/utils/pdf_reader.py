import fitz
import re
from typing import Dict, List, Any

def _join_spans_with_spacing(spans):
    """Join spans preserving spacing"""
    out = []
    for s in spans:
        t = (s.get("text") or "")
        if not t:
            continue
        if out and not out[-1].endswith((" ", "\n")) and not t.startswith((" ", "\n", ".", ",", ":", ";", ")", "]")):
            out.append(" ")
        out.append(t)
    return "".join(out)

def _rgb_to_hex(color_int: int) -> str:
    """Convert PyMuPDF color int to hex string"""
    if color_int == 0:
        return "#000000"
    
    r = (color_int >> 16) & 0xFF
    g = (color_int >> 8) & 0xFF
    b = color_int & 0xFF
    
    return f"#{r:02x}{g:02x}{b:02x}"

def _detect_alignment(bbox, page_rect) -> str:
    """Detect text alignment based on bounding box position"""
    x0 = bbox[0]
    x1 = bbox[2]
    page_width = page_rect.width
    
    left_margin = x0
    right_margin = page_width - x1
    
    center = page_width / 2
    text_center = (x0 + x1) / 2
    
    if abs(text_center - center) < page_width * 0.1:
        return "center"
    elif left_margin < page_width * 0.15:
        return "left"
    elif right_margin < page_width * 0.15:
        return "right"
    
    return "left"

def _calculate_line_height(size: float) -> float:
    """Calculate appropriate line height based on font size"""
    return round(size * 1.4, 2)

def _detect_heading_level(font_size: float, is_bold: bool, avg_size: float) -> int | None:
    """Detect if paragraph is a heading and return level (1-6)"""
    if font_size <= avg_size:
        return None
    
    size_ratio = font_size / avg_size
    
    if size_ratio >= 2.0 or (size_ratio >= 1.8 and is_bold):
        return 1
    elif size_ratio >= 1.6 or (size_ratio >= 1.4 and is_bold):
        return 2
    elif size_ratio >= 1.3 or (size_ratio >= 1.2 and is_bold):
        return 3
    elif size_ratio >= 1.15 and is_bold:
        return 4
    
    return None

class PDFReader:
    def pdf_to_structured_json(self, pdf_path: str) -> Dict[str, Any]:
        """
        Extract structured content from PDF with enhanced style preservation
        
        Returns:
            {
                "pages": [{"page": int, "width": float, "height": float}],
                "paragraphs": [{
                    "id": str,
                    "page": int,
                    "bbox": [x0, y0, x1, y1],
                    "text": str,
                    "runs": [{"text": str, "style": {...}}],
                    "style": {
                        "fontSize": float,
                        "fontFamily": str,
                        "fontWeight": str,
                        "fontStyle": str,
                        "color": str,
                        "textAlign": str,
                        "lineHeight": float,
                        "marginBottom": float,
                        "headingLevel": int | null
                    }
                }],
                "metadata": {
                    "avgFontSize": float,
                    "dominantFont": str
                }
            }
        """
        doc = fitz.open(str(pdf_path))

        paragraphs = []
        pages = []
        all_font_sizes = []
        font_usage = {}

        pid = 0
        
        for page_index in range(len(doc)):
            page = doc[page_index]
            data = page.get_text("dict")
            
            for block in data["blocks"]:
                if block.get("type") != 0:
                    continue
                    
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        size = span.get("size", 12)
                        font = span.get("font", "")
                        
                        all_font_sizes.append(size)
                        font_usage[font] = font_usage.get(font, 0) + 1

        avg_font_size = sum(all_font_sizes) / len(all_font_sizes) if all_font_sizes else 12
        dominant_font = max(font_usage.items(), key=lambda x: x[1])[0] if font_usage else "Unknown"

        for page_index in range(len(doc)):
            page = doc[page_index]
            rect = page.rect
            pages.append({
                "page": page_index,
                "width": rect.width,
                "height": rect.height
            })

            data = page.get_text("dict")
            for block in data["blocks"]:
                if block.get("type") != 0:
                    continue

                runs = []
                full_text_lines = []
                
                block_fonts = []
                block_sizes = []
                block_colors = []

                for line in block.get("lines", []):
                    line_spans = line.get("spans", [])
                    line_text = _join_spans_with_spacing(line_spans).strip()
                    if line_text:
                        full_text_lines.append(line_text)

                    for span in line_spans:
                        text = (span.get("text") or "")
                        if not text.strip():
                            continue
                        
                        font = span.get("font", "")
                        size = span.get("size", 12)
                        color = span.get("color", 0)
                        
                        block_fonts.append(font)
                        block_sizes.append(size)
                        block_colors.append(color)
                        
                        is_bold = "Bold" in font or "bold" in font.lower()
                        is_italic = "Italic" in font or "italic" in font.lower()
                        
                        runs.append({
                            "text": text,
                            "style": {
                                "fontSize": round(size, 2),
                                "fontFamily": font,
                                "fontWeight": "bold" if is_bold else "normal",
                                "fontStyle": "italic" if is_italic else "normal",
                                "color": _rgb_to_hex(color)
                            }
                        })

                full_text = "\n".join(full_text_lines).strip()
                if not full_text:
                    continue

                dominant_size = max(set(block_sizes), key=block_sizes.count) if block_sizes else avg_font_size
                dominant_font = max(set(block_fonts), key=block_fonts.count) if block_fonts else "Arial"
                dominant_color = max(set(block_colors), key=block_colors.count) if block_colors else 0
                
                is_bold = any("Bold" in f or "bold" in f.lower() for f in block_fonts)
                is_italic = any("Italic" in f or "italic" in f.lower() for f in block_fonts)
                
                bbox = block.get("bbox")
                alignment = _detect_alignment(bbox, rect)
                heading_level = _detect_heading_level(dominant_size, is_bold, avg_font_size)
                
                line_height = _calculate_line_height(dominant_size)
                margin_bottom = dominant_size * 0.8 if heading_level else dominant_size * 0.5

                paragraphs.append({
                    "id": f"p{pid}",
                    "page": page_index,
                    "bbox": bbox,
                    "text": full_text,
                    "runs": runs,
                    "style": {
                        "fontSize": round(dominant_size, 2),
                        "fontFamily": dominant_font,
                        "fontWeight": "bold" if is_bold else "normal",
                        "fontStyle": "italic" if is_italic else "normal",
                        "color": _rgb_to_hex(dominant_color),
                        "textAlign": alignment,
                        "lineHeight": line_height,
                        "marginBottom": margin_bottom,
                        "headingLevel": heading_level
                    }
                })
                pid += 1

        return {
            "pages": pages,
            "paragraphs": paragraphs,
            "metadata": {
                "avgFontSize": round(avg_font_size, 2),
                "dominantFont": dominant_font
            }
        }