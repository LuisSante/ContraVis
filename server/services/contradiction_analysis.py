from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from typing import Any

from schemas.types import (
    ContradictionAnalysisRequest,
    ContradictionAnalysisResponse,
    ContradictionParagraphResult,
)
from services.llm.factory import LLMProviderFactory

logger = logging.getLogger(__name__)

PROMPT_TEMPLATE = """
You are a legal expert analyzing contracts.

Goal:
Given one contract split into paragraphs, decide for EACH paragraph whether it contains an internal contradiction.

Definition:
A contradiction means two or more statements in the paragraph/context are mutually incompatible about the same obligation, right, condition, or execution, such that they cannot all be true at the same time.

Use context:
Each paragraph includes related paragraphs from the contract graph. Use them as contextual evidence, but classify contradiction for the target paragraph.

Do NOT consider as contradiction by default:
- clarifications
- conditional amendments
- hierarchical clauses (e.g., "subject to", "except as provided")
- general-vs-specific unless irreconcilable

Return ONLY valid JSON (no markdown, no extra text) with this shape:
{{
  "paragraph_results": [
    {{
      "paragraph_id": "string or integer",
      "contradiction": true or false,
      "confidence": integer from 0 to 100,
      "brief_reason": "one short sentence"
    }}
  ]
}}

Document data (JSON):
{document_json}
""".strip()

SYSTEM_PROMPT = (
    "You are a precise legal contradiction classifier. "
    "Return only valid JSON and follow the required schema exactly."
)


def analyze_document_contradictions(
    payload: ContradictionAnalysisRequest,
) -> ContradictionAnalysisResponse:
    paragraph_payload, ordered_paragraph_ids = _build_document_payload(payload)
    user_prompt = PROMPT_TEMPLATE.format(
        document_json=json.dumps(paragraph_payload, ensure_ascii=False, indent=2)
    )

    provider = LLMProviderFactory.create(payload.provider, model=payload.model)
    raw_response = provider.generate(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        temperature=payload.temperature,
    )

    parsed = _safe_json_loads(raw_response)
    prediction_by_id = _parse_paragraph_results(parsed)

    paragraph_results: list[ContradictionParagraphResult] = []
    for paragraph_id in ordered_paragraph_ids:
        item = prediction_by_id.get(paragraph_id)
        if item is None:
            paragraph_results.append(
                ContradictionParagraphResult(
                    paragraph_id=paragraph_id,
                    contradiction=False,
                    confidence=0,
                    brief_reason="",
                )
            )
            continue

        paragraph_results.append(
            ContradictionParagraphResult(
                paragraph_id=paragraph_id,
                contradiction=item["contradiction"],
                confidence=item["confidence"],
                brief_reason=item["brief_reason"],
            )
        )

    return ContradictionAnalysisResponse(
        documentId=payload.documentId,
        provider=payload.provider,
        temperature=payload.temperature,
        model=payload.model,
        paragraphResults=paragraph_results,
        rawResponse=raw_response,
    )


def _build_document_payload(payload: ContradictionAnalysisRequest) -> tuple[dict[str, Any], list[str]]:
    nodes = sorted(
        payload.graph.nodes,
        key=lambda node: (node.page, node.paragraph_enum),
    )

    node_by_id = {str(node.id): node for node in nodes}
    related_by_id: dict[str, set[str]] = defaultdict(set)

    for edge in payload.graph.edges:
        source_id = str(edge.source)
        target_id = str(edge.target)
        if source_id not in node_by_id or target_id not in node_by_id:
            continue

        # Include both directions to maximize contextual evidence per paragraph.
        related_by_id[source_id].add(target_id)
        related_by_id[target_id].add(source_id)

    paragraphs: list[dict[str, Any]] = []
    ordered_ids: list[str] = []

    for node in nodes:
        paragraph_id = str(node.id)
        ordered_ids.append(paragraph_id)

        related_ids = sorted(
            related_by_id.get(paragraph_id, set()),
            key=lambda rid: (node_by_id[rid].page, node_by_id[rid].paragraph_enum),
        )

        related_paragraphs = [
            {
                "paragraph_id": rid,
                "text": (node_by_id[rid].text or "").strip(),
            }
            for rid in related_ids
        ]

        paragraphs.append(
            {
                "paragraph_id": paragraph_id,
                "text": (node.text or "").strip(),
                "related_paragraphs": related_paragraphs,
            }
        )

    return {"paragraphs": paragraphs}, ordered_ids


def _safe_json_loads(text: str) -> dict[str, Any] | list[Any]:
    cleaned = (text or "").strip()
    if not cleaned:
        return {}

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    json_match = re.search(r"\{[\s\S]*\}", cleaned)
    if json_match:
        return json.loads(json_match.group(0))

    raise RuntimeError("LLM did not return a valid JSON payload")


def _parse_paragraph_results(raw_json: dict[str, Any] | list[Any]) -> dict[str, dict[str, Any]]:
    if isinstance(raw_json, dict):
        rows = raw_json.get("paragraph_results", [])
    elif isinstance(raw_json, list):
        rows = raw_json
    else:
        rows = []

    parsed: dict[str, dict[str, Any]] = {}

    for row in rows:
        if not isinstance(row, dict):
            continue

        paragraph_id = str(row.get("paragraph_id", "")).strip()
        if not paragraph_id:
            continue

        contradiction = bool(row.get("contradiction", False))

        confidence_raw = row.get("confidence", 0)
        try:
            confidence = int(float(confidence_raw))
        except (TypeError, ValueError):
            confidence = 0
        confidence = max(0, min(100, confidence))

        brief_reason = str(row.get("brief_reason", "")).strip()

        parsed[paragraph_id] = {
            "contradiction": contradiction,
            "confidence": confidence,
            "brief_reason": brief_reason,
        }

    return parsed
