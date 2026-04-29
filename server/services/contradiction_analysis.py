from __future__ import annotations

import json
import logging
import os
import re
from collections import defaultdict
from typing import Any

from schemas.types import (
    ContradictionAnalysisRequest,
    ContradictionAnalysisResponse,
    ContradictionParagraphResult,
)
from services.graph.neo4j_client import get_neo4j_driver, is_neo4j_configured
from services.llm.factory import LLMProviderFactory
from utils.config import Config

logger = logging.getLogger(__name__)

TARGET_BATCH_INPUT_TOKENS = 75_000
ESTIMATED_OUTPUT_TOKENS_PER_PARAGRAPH = 42
MAX_KG_ENTITIES_PER_PARAGRAPH = max(1, int(os.getenv("CONTRADICTION_KG_MAX_ENTITIES_PER_PARAGRAPH", "16")))
MAX_KG_RELATIONS_PER_PARAGRAPH = max(1, int(os.getenv("CONTRADICTION_KG_MAX_RELATIONS_PER_PARAGRAPH", "24")))
HIGH_RECALL_MODE = os.getenv("CONTRADICTION_HIGH_RECALL", "1").strip().lower() not in {
    "0",
    "false",
    "no",
}
HIGH_RECALL_NEGATIVE_FLIP_THRESHOLD = int(
    os.getenv("CONTRADICTION_NEGATIVE_FLIP_THRESHOLD", "45")
)

MODEL_PRICING_USD_PER_1M: dict[str, dict[str, float]] = {
    "gpt-4.1-nano": {"input": 0.10, "output": 0.40},
    "gpt-4.1": {"input": 2.0, "output": 8.0},
    "gpt-4.1-2025-04-14": {"input": 2.0, "output": 8.0},
    "gpt-4_1-2025-04-14": {"input": 2.0, "output": 8.0},
}

# PROMPT_TEMPLATE = """
# You are a legal expert analyzing contracts.

# Goal:
# Given one contract split into paragraphs, decide for EACH paragraph whether it contains an internal contradiction.

# Definition:
# A contradiction means two or more statements in the paragraph/context are mutually incompatible about the same obligation, right, condition, or execution, such that they cannot all be true at the same time.

# Use context:
# Each paragraph includes related paragraphs from the contract graph. Use them as context, but classify contradiction for the target paragraph.

# Do NOT consider as contradiction by default:
# - clarifications
# - conditional amendments
# - hierarchical clauses (e.g., "subject to", "except as provided")
# - general-vs-specific unless irreconcilable

# MANDATORY evidence rule (strict):
# - If contradiction = true, you MUST provide both evidence.snippet_a and evidence.snippet_b.
# - snippet_a and snippet_b MUST be exact contiguous substrings copied from the provided document JSON.
# - Do NOT paraphrase, summarize, translate, normalize punctuation, or change capitalization.
# - Do NOT add ellipsis (...) or surrounding commentary inside snippets.
# - If source_a/source_b is "paragraph", the snippet must be copied from the target paragraph text.
# - If source_a/source_b is "context", the snippet must be copied from one of related_paragraphs texts.
# - If you cannot find exact substrings, set contradiction=false.

# Return ONLY valid JSON (no markdown, no extra text) with this shape:
# {{
#   "paragraph_results": [
#     {{
#       "paragraph_id": "string or integer",
#       "contradiction": true or false,
#       "confidence": integer from 0 to 100,
#       "brief_reason": "one short sentence",
#       "evidence": {{
#         "snippet_a": "exact short excerpt #1 that conflicts",
#         "snippet_b": "exact short excerpt #2 that conflicts",
#         "source_a": "paragraph | context | unknown",
#         "source_b": "paragraph | context | unknown"
#       }}
#     }}
#   ]
# }}

PROMPT_TEMPLATE = """
You are a legal expert analyzing contracts.

Goal:
Given one contract split into paragraphs, decide for EACH paragraph whether it contains an internal contradiction.

Definition:
A contradiction means two or more statements in the paragraph/context are mutually incompatible about the same obligation, right, condition, or execution, such that they cannot all be true at the same time.

Use context:
Each paragraph includes related paragraphs from the contract graph. Use them as contextual evidence, but classify contradiction for the target paragraph.
When present, kg_context provides structured legal entities and relations linked to each paragraph. Use it to disambiguate parties, obligations, rights, prohibitions, conditions, references, values, and defined terms.


Return ONLY valid JSON (no markdown, no extra text) with this shape:
{{
  "paragraph_results": [
    {{
      "paragraph_id": "string or integer",
      "contradiction": true or false,
      "confidence": integer from 0 to 100,
      "brief_reason": "one short sentence",
      "evidence": {{
        "snippet_a": "exact short excerpt #1 that conflicts",
        "snippet_b": "exact short excerpt #2 that conflicts",
        "source_a": "paragraph | context | unknown",
        "source_b": "paragraph | context | unknown"
      }}
    }}
  ]
}}



Document data (JSON):
{document_json}
""".strip()

SYSTEM_PROMPT = (
    "You are a precise legal contradiction classifier. "
    "Return only valid JSON and follow the required schema exactly. "
    "Bias toward high recall: false negatives are worse than false positives. "
    "If uncertain, prefer contradiction=true with lower confidence. "
    "For contradiction=true, evidence.snippet_a and evidence.snippet_b are mandatory and must be exact substrings "
    "copied verbatim from the provided paragraph/context text when available. "
    "If exact spans are unavailable, keep legal judgment and set evidence_status='missing' with unknown sources and empty snippets."
)

_TIKTOKEN_ENCODER: Any | None = None
_TIKTOKEN_READY = False
KG_ENTITY_TYPES = {
    "Condition",
    "DefinedTerm",
    "Obligation",
    "Right",
    "Prohibition",
    "Party",
    "Reference",
    "Value",
}


def analyze_document_contradictions(
    payload: ContradictionAnalysisRequest,
) -> ContradictionAnalysisResponse:
    paragraph_rows, ordered_paragraph_ids, kg_context_by_paragraph = _build_document_rows(payload)
    if not paragraph_rows:
        return ContradictionAnalysisResponse(
            documentId=payload.documentId,
            provider=payload.provider,
            temperature=payload.temperature,
            model=payload.model,
            mode=payload.mode,
            paragraphResults=[],
            rawResponse="",
        )

    resolved_model = (payload.model or "").strip() or "gpt-4.1"
    provider = LLMProviderFactory.create(payload.provider, model=payload.model)

    batches = _chunk_paragraph_rows(
        paragraph_rows=paragraph_rows,
        mode=payload.mode,
        kg_context_by_paragraph=kg_context_by_paragraph,
        model_name=resolved_model,
        target_input_tokens=TARGET_BATCH_INPUT_TOKENS,
    )

    estimated_input_total = 0
    for batch in batches:
        estimated_input_total += _estimate_prompt_tokens(
            paragraph_rows=batch,
            mode=payload.mode,
            kg_context_by_paragraph=kg_context_by_paragraph,
            model_name=resolved_model,
        )
    estimated_output_total = len(ordered_paragraph_ids) * ESTIMATED_OUTPUT_TOKENS_PER_PARAGRAPH
    estimated_cost_total = _estimate_model_cost_usd(
        model_name=resolved_model,
        input_tokens=estimated_input_total,
        output_tokens=estimated_output_total,
    )

    logger.info(
        (
            "Contradiction estimate doc=%s provider=%s model=%s paragraphs=%d batches=%d "
            "est_input_tokens=%d est_output_tokens=%d est_cost_usd=%s target_batch_tokens=%d"
        ),
        payload.documentId,
        payload.provider,
        resolved_model,
        len(ordered_paragraph_ids),
        len(batches),
        estimated_input_total,
        estimated_output_total,
        _format_cost(estimated_cost_total),
        TARGET_BATCH_INPUT_TOKENS,
    )

    prediction_by_id: dict[str, dict[str, Any]] = {}
    raw_batch_responses: list[dict[str, Any]] = []

    for index, batch in enumerate(batches, start=1):
        batch_prompt_tokens = _estimate_prompt_tokens(
            paragraph_rows=batch,
            mode=payload.mode,
            kg_context_by_paragraph=kg_context_by_paragraph,
            model_name=resolved_model,
        )
        batch_output_tokens = len(batch) * ESTIMATED_OUTPUT_TOKENS_PER_PARAGRAPH
        batch_cost = _estimate_model_cost_usd(
            model_name=resolved_model,
            input_tokens=batch_prompt_tokens,
            output_tokens=batch_output_tokens,
        )

        logger.info(
            (
                "Contradiction batch %d/%d doc=%s model=%s rows=%d "
                "est_input_tokens=%d est_output_tokens=%d est_cost_usd=%s"
            ),
            index,
            len(batches),
            payload.documentId,
            resolved_model,
            len(batch),
            batch_prompt_tokens,
            batch_output_tokens,
            _format_cost(batch_cost),
        )

        batch_prediction, batch_raw = _run_batch_with_fallback(
            provider=provider,
            payload=payload,
            model_name=resolved_model,
            batch_rows=batch,
            kg_context_by_paragraph=kg_context_by_paragraph,
            batch_label=f"{index}/{len(batches)}",
        )
        prediction_by_id.update(batch_prediction)
        raw_batch_responses.append(
            {
                "batch": index,
                "rows": len(batch),
                "estimated_input_tokens": batch_prompt_tokens,
                "estimated_output_tokens": batch_output_tokens,
                "estimated_cost_usd": _format_cost(batch_cost),
                "response_chars": len(batch_raw),
                "response_preview": batch_raw[:500],
            }
        )

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
                    evidence=None,
                )
            )
            continue

        paragraph_results.append(
            ContradictionParagraphResult(
                paragraph_id=paragraph_id,
                contradiction=item["contradiction"],
                confidence=item["confidence"],
                brief_reason=item["brief_reason"],
                evidence=item["evidence"],
            )
        )

    raw_response_payload = {
        "mode": "batched",
        "target_batch_input_tokens": TARGET_BATCH_INPUT_TOKENS,
        "estimated_input_tokens_total": estimated_input_total,
        "estimated_output_tokens_total": estimated_output_total,
        "estimated_cost_usd": _format_cost(estimated_cost_total),
        "batches": raw_batch_responses,
    }

    return ContradictionAnalysisResponse(
        documentId=payload.documentId,
        provider=payload.provider,
        temperature=payload.temperature,
        model=payload.model,
        mode=payload.mode,
        paragraphResults=paragraph_results,
        rawResponse=json.dumps(raw_response_payload, ensure_ascii=False),
    )


def _build_document_rows(
    payload: ContradictionAnalysisRequest,
) -> tuple[list[dict[str, Any]], list[str], dict[str, dict[str, Any]]]:
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

    paragraph_rows: list[dict[str, Any]] = []
    ordered_ids: list[str] = []

    for node in nodes:
        paragraph_id = str(node.id)
        ordered_ids.append(paragraph_id)

        related_ids = sorted(
            related_by_id.get(paragraph_id, set()),
            key=lambda rid: (node_by_id[rid].page, node_by_id[rid].paragraph_enum),
        )

        paragraph_rows.append(
            {
                "paragraph_id": paragraph_id,
                "text": (node.text or "").strip(),
                "related_paragraphs": [
                    {
                        "paragraph_id": rid,
                        "text": (node_by_id[rid].text or "").strip(),
                    }
                    for rid in related_ids
                ],
            }
        )

    kg_context_by_paragraph: dict[str, dict[str, Any]] = {}
    if payload.mode == "with_kg":
        kg_context_by_paragraph = _build_kg_context_by_paragraph(
            document_id=payload.documentId,
            paragraph_ids=ordered_ids,
        )

    return paragraph_rows, ordered_ids, kg_context_by_paragraph


def _build_user_prompt(
    *,
    paragraph_rows: list[dict[str, Any]],
    mode: str,
    kg_context_by_paragraph: dict[str, dict[str, Any]] | None,
) -> str:
    document_payload: dict[str, Any] = {
        "mode": mode,
        "paragraphs": paragraph_rows,
    }
    if mode == "with_kg":
        paragraph_ids = [str(row.get("paragraph_id", "")).strip() for row in paragraph_rows]
        paragraph_ids = [pid for pid in paragraph_ids if pid]
        subset = _subset_kg_context_by_paragraph(
            kg_context_by_paragraph=kg_context_by_paragraph or {},
            paragraph_ids=paragraph_ids,
        )
        if subset:
            document_payload["kg_context"] = {
                "by_paragraph_id": subset,
            }
    return PROMPT_TEMPLATE.format(
        document_json=json.dumps(document_payload, ensure_ascii=False, indent=2)
    )


def _chunk_paragraph_rows(
    *,
    paragraph_rows: list[dict[str, Any]],
    mode: str,
    kg_context_by_paragraph: dict[str, dict[str, Any]],
    model_name: str,
    target_input_tokens: int,
) -> list[list[dict[str, Any]]]:
    if not paragraph_rows:
        return []

    chunks: list[list[dict[str, Any]]] = []
    current_chunk: list[dict[str, Any]] = []

    for row in paragraph_rows:
        trial_chunk = current_chunk + [row]
        trial_tokens = _estimate_prompt_tokens(
            paragraph_rows=trial_chunk,
            mode=mode,
            kg_context_by_paragraph=kg_context_by_paragraph,
            model_name=model_name,
        )

        if current_chunk and trial_tokens > target_input_tokens:
            chunks.append(current_chunk)
            current_chunk = [row]
            continue

        current_chunk = trial_chunk

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def _run_batch_with_fallback(
    *,
    provider: Any,
    payload: ContradictionAnalysisRequest,
    model_name: str,
    batch_rows: list[dict[str, Any]],
    kg_context_by_paragraph: dict[str, dict[str, Any]],
    batch_label: str,
) -> tuple[dict[str, dict[str, Any]], str]:
    user_prompt = _build_user_prompt(
        paragraph_rows=batch_rows,
        mode=payload.mode,
        kg_context_by_paragraph=kg_context_by_paragraph,
    )

    try:
        raw_response = provider.generate(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=payload.temperature,
        )
    except RuntimeError as exc:
        if _is_context_length_error(exc):
            if len(batch_rows) > 1:
                midpoint = max(1, len(batch_rows) // 2)
                logger.warning(
                    "Batch %s exceeded context. Splitting %d rows into %d + %d.",
                    batch_label,
                    len(batch_rows),
                    midpoint,
                    len(batch_rows) - midpoint,
                )
                left_prediction, left_raw = _run_batch_with_fallback(
                    provider=provider,
                    payload=payload,
                    model_name=model_name,
                    batch_rows=batch_rows[:midpoint],
                    kg_context_by_paragraph=kg_context_by_paragraph,
                    batch_label=f"{batch_label}.L",
                )
                right_prediction, right_raw = _run_batch_with_fallback(
                    provider=provider,
                    payload=payload,
                    model_name=model_name,
                    batch_rows=batch_rows[midpoint:],
                    kg_context_by_paragraph=kg_context_by_paragraph,
                    batch_label=f"{batch_label}.R",
                )
                merged = dict(left_prediction)
                merged.update(right_prediction)
                return merged, f"{left_raw}\n\n{right_raw}"

            shrunk_row = _shrink_single_row_context(
                row=batch_rows[0],
                mode=payload.mode,
                kg_context_by_paragraph=kg_context_by_paragraph,
                model_name=model_name,
                target_input_tokens=max(8_000, TARGET_BATCH_INPUT_TOKENS // 2),
            )
            if shrunk_row is not batch_rows[0]:
                logger.warning(
                    "Batch %s single-row context was reduced to fit token limits (paragraph_id=%s).",
                    batch_label,
                    str(batch_rows[0].get("paragraph_id", "")),
                )
                return _run_batch_with_fallback(
                    provider=provider,
                    payload=payload,
                    model_name=model_name,
                    batch_rows=[shrunk_row],
                    kg_context_by_paragraph=kg_context_by_paragraph,
                    batch_label=f"{batch_label}.S",
                )
        raise

    parsed = _safe_json_loads(raw_response)
    return _parse_paragraph_results(parsed), raw_response


def _shrink_single_row_context(
    *,
    row: dict[str, Any],
    mode: str,
    kg_context_by_paragraph: dict[str, dict[str, Any]],
    model_name: str,
    target_input_tokens: int,
) -> dict[str, Any]:
    related = row.get("related_paragraphs", [])
    if not isinstance(related, list) or not related:
        return row

    shrunk_row = {
        "paragraph_id": str(row.get("paragraph_id", "")),
        "text": str(row.get("text", "")),
        "related_paragraphs": list(related),
    }
    changed = False

    while shrunk_row["related_paragraphs"]:
        tokens = _estimate_prompt_tokens(
            paragraph_rows=[shrunk_row],
            mode=mode,
            kg_context_by_paragraph=kg_context_by_paragraph,
            model_name=model_name,
        )
        if tokens <= target_input_tokens:
            break

        next_size = len(shrunk_row["related_paragraphs"]) // 2
        shrunk_row["related_paragraphs"] = shrunk_row["related_paragraphs"][:next_size]
        changed = True

    return shrunk_row if changed else row


def _is_context_length_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "context_length_exceeded" in message or "maximum context length" in message


def _estimate_prompt_tokens(
    *,
    paragraph_rows: list[dict[str, Any]],
    mode: str,
    kg_context_by_paragraph: dict[str, dict[str, Any]] | None,
    model_name: str,
) -> int:
    prompt = _build_user_prompt(
        paragraph_rows=paragraph_rows,
        mode=mode,
        kg_context_by_paragraph=kg_context_by_paragraph,
    )
    return _estimate_tokens(prompt, model_name)


def _build_kg_context_by_paragraph(
    *,
    document_id: str,
    paragraph_ids: list[str],
) -> dict[str, dict[str, Any]]:
    if not paragraph_ids:
        return {}
    if not is_neo4j_configured():
        logger.info("KG context skipped: Neo4j is not configured.")
        return {}

    query = """
    MATCH (:Contract {document_id: $document_id})-[:CONTAINS]->(cl:Clause)
    WHERE cl.id IN $paragraph_ids
    OPTIONAL MATCH (cl)-[rel]-(other:KGNode)
    RETURN
      cl.id AS paragraph_id,
      type(rel) AS rel_type,
      CASE WHEN rel IS NULL THEN '' ELSE coalesce(rel.evidence, '') END AS rel_evidence,
      CASE WHEN other IS NULL THEN [] ELSE labels(other) END AS other_labels,
      other.label AS other_label,
      other.source_paragraph_id AS other_source_paragraph_id,
      other.action AS other_action,
      other.definition AS other_definition,
      other.citation AS other_citation,
      other.amount AS other_amount,
      other.unit AS other_unit,
      CASE WHEN rel IS NULL THEN [] ELSE labels(startNode(rel)) END AS from_labels,
      CASE WHEN rel IS NULL THEN '' ELSE coalesce(startNode(rel).id, startNode(rel).node_id, startNode(rel).label, '') END AS from_id,
      CASE WHEN rel IS NULL THEN '' ELSE coalesce(startNode(rel).label, startNode(rel).id, startNode(rel).node_id, '') END AS from_label,
      CASE WHEN rel IS NULL THEN [] ELSE labels(endNode(rel)) END AS to_labels,
      CASE WHEN rel IS NULL THEN '' ELSE coalesce(endNode(rel).id, endNode(rel).node_id, endNode(rel).label, '') END AS to_id,
      CASE WHEN rel IS NULL THEN '' ELSE coalesce(endNode(rel).label, endNode(rel).id, endNode(rel).node_id, '') END AS to_label
    """

    try:
        driver = get_neo4j_driver()
        with driver.session(database=Config.NEO4J_DATABASE) as session:
            records = session.run(
                query,
                document_id=document_id,
                paragraph_ids=paragraph_ids,
            )
            return _build_kg_context_from_records(records)
    except Exception as exc:
        logger.warning("KG context query failed for document_id=%s: %s", document_id, exc)
        return {}


def _build_kg_context_from_records(records: Any) -> dict[str, dict[str, Any]]:
    context_by_paragraph: dict[str, dict[str, Any]] = {}

    entity_seen: dict[str, set[str]] = defaultdict(set)
    relation_seen: dict[str, set[tuple[str, str, str, str]]] = defaultdict(set)

    for record in records:
        paragraph_id = str(record.get("paragraph_id") or "").strip()
        if not paragraph_id:
            continue

        context = context_by_paragraph.setdefault(
            paragraph_id,
            {
                "clause": {"id": paragraph_id},
                "entities": [],
                "relations": [],
            },
        )

        rel_type = str(record.get("rel_type") or "").strip()
        rel_evidence = str(record.get("rel_evidence") or "").strip()

        other_labels = record.get("other_labels") or []
        other_type = _resolve_kg_entity_type(other_labels)
        other_label = str(record.get("other_label") or "").strip()
        if other_type and other_label:
            entity_key = f"{other_type}|{other_label}"
            if entity_key not in entity_seen[paragraph_id]:
                entity_payload: dict[str, Any] = {
                    "type": other_type,
                    "label": other_label,
                }
                source_pid = str(record.get("other_source_paragraph_id") or "").strip()
                if source_pid:
                    entity_payload["source_paragraph_id"] = source_pid
                action = str(record.get("other_action") or "").strip()
                definition = str(record.get("other_definition") or "").strip()
                citation = str(record.get("other_citation") or "").strip()
                amount = str(record.get("other_amount") or "").strip()
                unit = str(record.get("other_unit") or "").strip()
                if action:
                    entity_payload["action"] = action
                if definition:
                    entity_payload["definition"] = definition
                if citation:
                    entity_payload["citation"] = citation
                if amount:
                    entity_payload["amount"] = amount
                if unit:
                    entity_payload["unit"] = unit

                context["entities"].append(entity_payload)
                entity_seen[paragraph_id].add(entity_key)

        if not rel_type:
            continue

        from_id = str(record.get("from_id") or "").strip()
        from_label = str(record.get("from_label") or "").strip()
        to_id = str(record.get("to_id") or "").strip()
        to_label = str(record.get("to_label") or "").strip()
        from_type = _resolve_kg_relation_endpoint_type(record.get("from_labels") or [])
        to_type = _resolve_kg_relation_endpoint_type(record.get("to_labels") or [])

        rel_key = (rel_type, from_id, to_id, rel_evidence)
        if rel_key in relation_seen[paragraph_id]:
            continue

        relation_payload: dict[str, Any] = {
            "rel_type": rel_type,
            "from": {
                "id": from_id,
                "label": from_label,
                "type": from_type,
            },
            "to": {
                "id": to_id,
                "label": to_label,
                "type": to_type,
            },
        }
        if rel_evidence:
            relation_payload["evidence"] = rel_evidence

        context["relations"].append(relation_payload)
        relation_seen[paragraph_id].add(rel_key)

    for paragraph_id, context in context_by_paragraph.items():
        entities = context.get("entities", [])
        relations = context.get("relations", [])
        if isinstance(entities, list) and len(entities) > MAX_KG_ENTITIES_PER_PARAGRAPH:
            context["entities"] = entities[:MAX_KG_ENTITIES_PER_PARAGRAPH]
        if isinstance(relations, list) and len(relations) > MAX_KG_RELATIONS_PER_PARAGRAPH:
            context["relations"] = relations[:MAX_KG_RELATIONS_PER_PARAGRAPH]

    return context_by_paragraph


def _resolve_kg_entity_type(labels: list[Any]) -> str | None:
    if not isinstance(labels, list):
        return None
    for label in labels:
        normalized = str(label).strip()
        if normalized in KG_ENTITY_TYPES:
            return normalized
    return None


def _resolve_kg_relation_endpoint_type(labels: list[Any]) -> str:
    if not isinstance(labels, list):
        return "Unknown"
    for label in labels:
        normalized = str(label).strip()
        if normalized == "KGNode":
            continue
        if normalized:
            return normalized
    return "Unknown"


def _subset_kg_context_by_paragraph(
    *,
    kg_context_by_paragraph: dict[str, dict[str, Any]],
    paragraph_ids: list[str],
) -> dict[str, dict[str, Any]]:
    subset: dict[str, dict[str, Any]] = {}
    for paragraph_id in paragraph_ids:
        entry = kg_context_by_paragraph.get(paragraph_id)
        if entry is not None:
            subset[paragraph_id] = entry
    return subset


def _estimate_tokens(text: str, model_name: str) -> int:
    if not text:
        return 0

    encoder = _get_tiktoken_encoder(model_name)
    if encoder is not None:
        try:
            return len(encoder.encode(text))
        except Exception:
            pass

    # Safe fallback when tiktoken is unavailable.
    return max(1, len(text) // 4)


def _get_tiktoken_encoder(model_name: str) -> Any | None:
    global _TIKTOKEN_ENCODER
    global _TIKTOKEN_READY

    if _TIKTOKEN_READY:
        return _TIKTOKEN_ENCODER

    _TIKTOKEN_READY = True

    try:
        import tiktoken  # type: ignore
    except Exception:
        _TIKTOKEN_ENCODER = None
        return None

    try:
        _TIKTOKEN_ENCODER = tiktoken.encoding_for_model(model_name)
    except Exception:
        _TIKTOKEN_ENCODER = tiktoken.get_encoding("cl100k_base")

    return _TIKTOKEN_ENCODER


def _estimate_model_cost_usd(*, model_name: str, input_tokens: int, output_tokens: int) -> float | None:
    rates = _resolve_model_rates(model_name)
    if rates is None:
        return None

    return (
        (input_tokens / 1_000_000.0) * rates["input"]
        + (output_tokens / 1_000_000.0) * rates["output"]
    )


def _resolve_model_rates(model_name: str) -> dict[str, float] | None:
    normalized = (model_name or "").strip().lower()
    if not normalized:
        return None

    if normalized in MODEL_PRICING_USD_PER_1M:
        return MODEL_PRICING_USD_PER_1M[normalized]

    normalized_alt = normalized.replace(".", "_")
    if normalized_alt in MODEL_PRICING_USD_PER_1M:
        return MODEL_PRICING_USD_PER_1M[normalized_alt]

    if normalized.startswith("gpt-4.1-"):
        return MODEL_PRICING_USD_PER_1M["gpt-4.1"]

    if normalized.startswith("gpt-4_1-"):
        return MODEL_PRICING_USD_PER_1M["gpt-4.1"]

    return None


def _format_cost(cost: float | None) -> str:
    if cost is None:
        return "unknown"
    return f"{cost:.6f}"


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

        # High-recall mode: avoid low-confidence negatives.
        if (
            HIGH_RECALL_MODE
            and not contradiction
            and confidence <= max(0, min(100, HIGH_RECALL_NEGATIVE_FLIP_THRESHOLD))
        ):
            contradiction = True
            if not brief_reason:
                brief_reason = (
                    "Converted from low-confidence negative to contradiction in high-recall mode."
                )

        evidence_obj = row.get("evidence")
        evidence: dict[str, Any] | None = None
        if isinstance(evidence_obj, dict):
            snippet_a = str(evidence_obj.get("snippet_a", "")).strip()
            snippet_b = str(evidence_obj.get("snippet_b", "")).strip()
            source_a = str(evidence_obj.get("source_a", "unknown")).strip().lower()
            source_b = str(evidence_obj.get("source_b", "unknown")).strip().lower()
            evidence_status = str(evidence_obj.get("evidence_status", "")).strip().lower()
            evidence_note = str(evidence_obj.get("evidence_note", "")).strip()
            if source_a not in {"paragraph", "context", "unknown"}:
                source_a = "unknown"
            if source_b not in {"paragraph", "context", "unknown"}:
                source_b = "unknown"
            if evidence_status not in {"exact", "missing", "approximate"}:
                evidence_status = "exact" if (snippet_a and snippet_b) else "missing"

            evidence = {
                "snippet_a": snippet_a,
                "snippet_b": snippet_b,
                "source_a": source_a,
                "source_b": source_b,
                "evidence_status": evidence_status,
                "evidence_note": evidence_note,
            }
        elif contradiction:
            evidence = {
                "snippet_a": "",
                "snippet_b": "",
                "source_a": "unknown",
                "source_b": "unknown",
                "evidence_status": "missing",
                "evidence_note": "Model did not return structured evidence object.",
            }

        parsed[paragraph_id] = {
            "contradiction": contradiction,
            "confidence": confidence,
            "brief_reason": brief_reason,
            "evidence": evidence,
        }

    return parsed
