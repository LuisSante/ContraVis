from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from schemas.types import (
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantCitation,
    AssistantParagraphNode,
)
from services.llm.factory import LLMProviderFactory
import logging

logger = logging.getLogger(__name__)

MAX_CONTEXT_CHAR_BUDGET = 32000
MAX_HISTORY_MESSAGES = 8
MAX_HISTORY_CHAR = 600
MAX_SUGGESTED_QUESTIONS = 5
MAX_CITATION_EXCERPT = 220


@dataclass
class ContextEntry:
    node: AssistantParagraphNode
    tag: str
    relation_summary: str


def generate_assistant_response(payload: AssistantChatRequest) -> AssistantChatResponse:
    node_map = {node.id: node for node in payload.paragraphNodes}
    logger.info("======================")
    logger.info("\t\t NODE MAP")
    logger.info(node_map)
    logger.info("======================")

    if not node_map:
        raise RuntimeError("No paragraph nodes were provided")

    context_entries = _build_context_entries(payload, node_map)
    if not context_entries:
        raise RuntimeError("No usable paragraph context was found")

    allowed_ids = [entry.node.id for entry in context_entries]

    provider = LLMProviderFactory.create(payload.provider)
    system_prompt = _build_system_prompt(payload.mode)
    user_prompt = _build_user_prompt(payload, context_entries, allowed_ids)

    raw_text = provider.generate(system_prompt=system_prompt, user_prompt=user_prompt, temperature=0.2)
    parsed = _parse_json_from_model(raw_text)

    answer = _sanitize_answer(parsed.get("answer"), fallback=raw_text)
    citation_ids = _normalize_citation_ids(
        parsed.get("citations"),
        allowed_ids=allowed_ids,
        selected_id=payload.selectedParagraphId,
    )
    suggested_questions = _normalize_suggested_questions(parsed.get("suggested_questions"))

    citations = [_build_citation(citation_id, node_map) for citation_id in citation_ids]

    return AssistantChatResponse(
        answer=answer,
        citations=citations,
        suggestedQuestions=suggested_questions,
        mode=payload.mode,
        scope=payload.scope,
        provider=payload.provider,
    )


def _build_context_entries(
    payload: AssistantChatRequest,
    node_map: dict[str, AssistantParagraphNode],
) -> list[ContextEntry]:
    if payload.scope == "selected":
        if not payload.selectedParagraphId:
            raise RuntimeError("Select a paragraph before using selected-paragraph mode")

        selected_node = node_map.get(payload.selectedParagraphId)
        if not selected_node:
            raise RuntimeError("Selected paragraph is not available in the current context")

        entries: list[ContextEntry] = [
            ContextEntry(
                node=selected_node,
                tag="selected",
                relation_summary="",
            )
        ]
        seen_ids = {selected_node.id}

        for related in payload.relatedParagraphs:
            if related.id in seen_ids:
                continue
            node = node_map.get(related.id)
            if node is None:
                continue

            relation_bits: list[str] = []
            if related.relationTypes:
                relation_bits.append("types=" + ",".join(sorted(set(related.relationTypes))))
            if related.semanticScore is not None:
                relation_bits.append(f"semantic={related.semanticScore:.3f}")
            if related.references:
                relation_bits.append("refs=" + "; ".join(related.references[:3]))

            entries.append(
                ContextEntry(
                    node=node,
                    tag="related",
                    relation_summary=" | ".join(relation_bits),
                )
            )
            seen_ids.add(node.id)

        selected = entries[:1]
        related_sorted = sorted(
            entries[1:],
            key=lambda entry: (entry.node.page, entry.node.paragraph_enum),
        )
        return _apply_context_budget(selected + related_sorted)

    full_entries = [
        ContextEntry(node=node, tag="contract", relation_summary="")
        for node in sorted(payload.paragraphNodes, key=lambda item: (item.page, item.paragraph_enum))
    ]

    return _apply_context_budget(full_entries)


def _apply_context_budget(entries: list[ContextEntry]) -> list[ContextEntry]:
    total_chars = 0
    selected_entries: list[ContextEntry] = []

    for entry in entries:
        cost = len(entry.node.text or "")
        if selected_entries and total_chars + cost > MAX_CONTEXT_CHAR_BUDGET:
            break

        selected_entries.append(entry)
        total_chars += cost

    return selected_entries


def _build_system_prompt(mode: str) -> str:
    mode_instruction = {
        "explain": "Explain in plain language and avoid legal jargon when possible.",
        "quote": "Quote the exact clause text from context where relevant before explaining.",
        "suggest_questions": "Focus on generating concise follow-up questions grounded in the contract.",
    }.get(mode, "Explain in plain language.")

    logger.info("\t\t SYSTEM PROMPT")
    logger.info ((
        f"\n\n\n"
        "You are a What-if Contract Assistant. "
        "Use only the provided contract paragraph context. "
        "Never invent paragraph IDs or facts. "
        "Always return valid JSON with this shape: "
        '{"answer": string, "citations": [string], "suggested_questions": [string]}. '
        "Citations must include one or more exact paragraph IDs from ALLOWED_PARAGRAPH_IDS. "
        "If information is incomplete, state that clearly but still cite the best supporting paragraphs. "
        f"{mode_instruction}"
        f"\n\n\n"
    ))
    logger.info("======================")

    return (
        "You are a What-if Contract Assistant. "
        "Use only the provided contract paragraph context. "
        "Never invent paragraph IDs or facts. "
        "Always return valid JSON with this shape: "
        '{"answer": string, "citations": [string], "suggested_questions": [string]}. '
        "Citations must include one or more exact paragraph IDs from ALLOWED_PARAGRAPH_IDS. "
        "If information is incomplete, state that clearly but still cite the best supporting paragraphs. "
        f"{mode_instruction}"
    )


def _build_user_prompt(
    payload: AssistantChatRequest,
    context_entries: list[ContextEntry],
    allowed_ids: list[str],
) -> str:
    history_lines: list[str] = []
    for message in payload.history[-MAX_HISTORY_MESSAGES:]:
        content = (message.content or "").strip()
        if not content:
            continue
        clipped = content[:MAX_HISTORY_CHAR]
        history_lines.append(f"{message.role.upper()}: {clipped}")

    context_lines: list[str] = []
    for entry in context_entries:
        relation = f" | {entry.relation_summary}" if entry.relation_summary else ""
        context_lines.append(
            f"[{entry.node.id}] tag={entry.tag} page={entry.node.page} "
            f"paragraph={entry.node.paragraph_enum}{relation}\n{entry.node.text.strip()}"
        )

    history_block = "\n".join(history_lines) if history_lines else "(none)"
    context_block = "\n\n".join(context_lines)
    allowed_block = ", ".join(allowed_ids)

    logger.info("\t\t USER PROMPT")
    logger.info(
        f"\n\n\n"
        f"Document ID: {payload.documentId}\n"
        f"Mode: {payload.mode}\n"
        f"Scope: {payload.scope}\n"
        f"Question: {payload.question.strip()}\n\n"
        f"ALLOWED_PARAGRAPH_IDS: [{allowed_block}]\n\n"
        f"Conversation History:\n{history_block}\n\n"
        f"Contract Context:\n{context_block}\n\n"
        "Output JSON only. "
        "For citations, include only IDs from ALLOWED_PARAGRAPH_IDS."
        f"\n\n\n"
    )
    logger.info("======================")
    logger.info("\t\t NODE MAP")

    return (
        f"Document ID: {payload.documentId}\n"
        f"Mode: {payload.mode}\n"
        f"Scope: {payload.scope}\n"
        f"Question: {payload.question.strip()}\n\n"
        f"ALLOWED_PARAGRAPH_IDS: [{allowed_block}]\n\n"
        f"Conversation History:\n{history_block}\n\n"
        f"Contract Context:\n{context_block}\n\n"
        "Output JSON only. "
        "For citations, include only IDs from ALLOWED_PARAGRAPH_IDS."
    )


def _parse_json_from_model(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if not cleaned:
        return {}

    fenced = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE | re.DOTALL)

    for candidate in (cleaned, fenced):
        parsed = _try_parse_json(candidate)
        if parsed is not None:
            return parsed

    match = re.search(r"\{[\s\S]*\}", fenced)
    if match:
        parsed = _try_parse_json(match.group(0))
        if parsed is not None:
            return parsed

    return {"answer": cleaned}


def _try_parse_json(candidate: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return None

    if isinstance(parsed, dict):
        return parsed
    return None


def _sanitize_answer(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(fallback, str) and fallback.strip():
        return fallback.strip()
    return "I could not produce a grounded answer from the current context."


def _normalize_citation_ids(
    raw: Any,
    *,
    allowed_ids: list[str],
    selected_id: str | None,
) -> list[str]:
    allowed_set = set(allowed_ids)
    ordered: list[str] = []

    if isinstance(raw, list):
        for item in raw:
            candidate = ""
            if isinstance(item, str):
                candidate = item
            elif isinstance(item, dict):
                id_value = item.get("id")
                candidate = id_value if isinstance(id_value, str) else ""

            normalized = candidate.strip()
            if normalized and normalized in allowed_set and normalized not in ordered:
                ordered.append(normalized)

    if not ordered and selected_id and selected_id in allowed_set:
        ordered.append(selected_id)

    if not ordered and allowed_ids:
        ordered.append(allowed_ids[0])

    return ordered


def _normalize_suggested_questions(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []

    suggestions: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        cleaned = item.strip()
        if not cleaned:
            continue
        if cleaned in suggestions:
            continue
        suggestions.append(cleaned)
        if len(suggestions) >= MAX_SUGGESTED_QUESTIONS:
            break

    return suggestions


def _build_citation(citation_id: str, node_map: dict[str, AssistantParagraphNode]) -> AssistantCitation:
    node = node_map.get(citation_id)
    if node is None:
        return AssistantCitation(id=citation_id, excerpt="(Paragraph not available)")

    raw_excerpt = (node.text or "").strip().replace("\n", " ")
    excerpt = raw_excerpt[:MAX_CITATION_EXCERPT]
    if len(raw_excerpt) > MAX_CITATION_EXCERPT:
        excerpt = f"{excerpt.rstrip()}..."

    return AssistantCitation(
        id=node.id,
        excerpt=excerpt,
        page=node.page,
        paragraph_enum=node.paragraph_enum,
    )
