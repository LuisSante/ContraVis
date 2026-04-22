#!/usr/bin/env python3
"""
Independent preprocessing script for CUAD_v1 documents.

What it does:
1) Reads CUAD_v1.json
2) Filters the document(s) you want
3) Splits contract context into paragraphs
4) Reuses backend graph logic (server/services/graph/relations.py)
5) Writes JSON artifacts for experimentation

Outputs (by default):
- infra/json/rerank/context.json
- infra/json/rerank/paragraphs.json
- infra/json/rerank/graph.json
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SERVER_DIR = ROOT / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

# ---------------------------
# User configuration (no CLI)
# ---------------------------
INFRA_PATH = ROOT / "infra"
JSON_PATH = INFRA_PATH / "json" / "rerank"
CUAD_JSON_PATH = INFRA_PATH / "CUAD_v1" / "CUAD_v1.json"

# Use exact title from CUAD_v1.json, or set None to process first MAX_DOCS.
MAIN_DOCUMENT: str | None = None
TITLE_MATCH: str = "exact"  # "exact" | "contains"
MAX_DOCS: int = 1

MODEL_NAME = "gpt-4.1-mini"
INPUT_COST_PER_MILLION = 0.40
OUTPUT_COST_PER_MILLION = 1.60

CONTEXT_FILE = "context.json"
PARAGRAPHS_FILE = "paragraphs.json"
GRAPH_FILE = "graph.json"


@dataclass
class CostConfig:
    input_per_million: float = 0.40
    output_per_million: float = 1.60
    model_name: str = "gpt-4.1-mini"


def split_into_paragraphs(text: str) -> list[str]:
    text = (text or "").replace("\r\n", "\n").strip()
    parts = re.split(r"\n\s*\n+", text)

    out: list[str] = []
    for part in parts:
        clean = " ".join(part.split())
        if clean:
            out.append(clean)

    if out:
        return out

    clean = " ".join(text.split())
    return [clean] if clean else []


def safe_token_count(text: str, *, model_name: str) -> int:
    try:
        import tiktoken  # type: ignore

        enc = tiktoken.encoding_for_model(model_name)
        return len(enc.encode(text or ""))
    except Exception:
        # Fallback when tiktoken/model is unavailable.
        return len((text or "").split())


def extract_context_rows(cuad_data: dict[str, Any], cost: CostConfig) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(cuad_data.get("data", []), start=1):
        title = str(item.get("title", "")).strip()
        paragraphs = item.get("paragraphs", [])
        context = ""
        if isinstance(paragraphs, list) and paragraphs:
            context = str((paragraphs[0] or {}).get("context", "")).strip()

        total_tokens = safe_token_count(context, model_name=cost.model_name)
        rows.append(
            {
                "id": f"CUAD_{index}",
                "title": title,
                "context": context,
                "total_number_tokens": total_tokens,
                "cost_document_input": (total_tokens / 1_000_000) * cost.input_per_million,
                "cost_document_output": (total_tokens / 1_000_000) * cost.output_per_million,
            }
        )
    return rows


def select_documents(
    context_rows: list[dict[str, Any]],
    *,
    document_title: str | None,
    title_match: str,
    max_docs: int,
    sort_by_tokens_asc: bool,
):
    candidates = context_rows
    if document_title:
        needle = document_title.strip().lower()
        if title_match == "exact":
            candidates = [row for row in context_rows if str(row.get("title", "")).strip().lower() == needle]
        else:
            candidates = [row for row in context_rows if needle in str(row.get("title", "")).strip().lower()]

    candidates = sorted(
        candidates,
        key=lambda row: int(row.get("total_number_tokens", 0)),
        reverse=not sort_by_tokens_asc,
    )

    return candidates[: max(1, max_docs)]


def build_paragraph_payload(
    selected_docs: list[dict[str, Any]],
    *,
    cost: CostConfig,
) -> list[dict[str, Any]]:
    stage1: list[dict[str, Any]] = []
    for doc in selected_docs:
        context = str(doc.get("context", ""))
        paragraphs: list[dict[str, Any]] = []

        for index, paragraph_text in enumerate(split_into_paragraphs(context), start=1):
            num_tokens = safe_token_count(paragraph_text, model_name=cost.model_name)
            paragraphs.append(
                {
                    "idx": f"IDX{index}",
                    "text": paragraph_text,
                    "number_tokens": num_tokens,
                    "cost_document_input": (num_tokens / 1_000_000) * cost.input_per_million,
                    "cost_document_output": (num_tokens / 1_000_000) * cost.output_per_million,
                }
            )

        stage1.append(
            {
                "doc_id": doc.get("id"),
                "title": doc.get("title"),
                "num_paragraphs": len(paragraphs),
                "total_number_tokens": sum(int(p["number_tokens"]) for p in paragraphs),
                "cost_document_input": sum(float(p["cost_document_input"]) for p in paragraphs),
                "cost_document_output": sum(float(p["cost_document_output"]) for p in paragraphs),
                "paragraphs": paragraphs,
            }
        )

    return stage1


def graph_input_from_paragraphs(doc_id: str, paragraphs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, row in enumerate(paragraphs, start=1):
        rows.append(
            {
                "id": str(row.get("idx", f"IDX{index}")),
                "documentId": str(doc_id),
                "text": str(row.get("text", "")),
                "page": 1,
                "paragraph_enum": index,
                "x": 0.0,
                "y": 0.0,
                "fontSize": 0.0,
            }
        )
    return rows


def dump_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)


def main() -> int:
    cuad_json_path = Path(CUAD_JSON_PATH).resolve()
    output_dir = Path(JSON_PATH).resolve()

    if not cuad_json_path.exists():
        print(f"ERROR: CUAD JSON not found: {cuad_json_path}")
        return 1

    cost = CostConfig(
        input_per_million=INPUT_COST_PER_MILLION,
        output_per_million=OUTPUT_COST_PER_MILLION,
        model_name=MODEL_NAME,
    )

    with cuad_json_path.open("r", encoding="utf-8") as handle:
        cuad_data = json.load(handle)

    context_rows = extract_context_rows(cuad_data, cost)
    selected_docs = select_documents(
        context_rows,
        document_title=MAIN_DOCUMENT,
        title_match=TITLE_MATCH,
        max_docs=MAX_DOCS,
        sort_by_tokens_asc=True,
    )
    stage1 = build_paragraph_payload(selected_docs, cost=cost)

    context_out = output_dir / CONTEXT_FILE
    paragraphs_out = output_dir / PARAGRAPHS_FILE
    graph_out = output_dir / GRAPH_FILE

    dump_json(context_out, context_rows)
    dump_json(paragraphs_out, stage1)

    try:
        from services.graph.relations import generate_graph_data  # type: ignore
    except Exception as exc:
        print(
            "ERROR: could not import backend graph generator "
            "(services.graph.relations.generate_graph_data)."
        )
        print(f"Cause: {exc}")
        print("Install backend dependencies first (e.g., cd server && pip install -r requirements.txt).")
        return 1

    graph_payloads: list[dict[str, Any]] = []
    for doc in stage1:
        paragraph_rows = graph_input_from_paragraphs(str(doc.get("doc_id", "unknown")), doc.get("paragraphs", []))
        graph = generate_graph_data(paragraph_rows)
        graph_payloads.append(
            {
                "doc_id": doc.get("doc_id"),
                "title": doc.get("title"),
                "graph": graph.model_dump(),
            }
        )

    dump_json(graph_out, graph_payloads)

    print("Done.")
    print(f"- context:   {context_out}")
    print(f"- paragraphs:{paragraphs_out}")
    print(f"- graph:     {graph_out}")
    print(f"- selected_docs: {len(stage1)}")
    if MAIN_DOCUMENT:
        print(f"- filter: {TITLE_MATCH} '{MAIN_DOCUMENT}'")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
