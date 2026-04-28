from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field

try:
    from llama_cloud_services.extract import (
        ExtractConfig,
        ExtractMode,
        LlamaExtract,
        SourceText,
    )
except ImportError:  # pragma: no cover - depends on runtime environment
    ExtractConfig = None
    ExtractMode = None
    LlamaExtract = None
    SourceText = None

from neo4j import GraphDatabase


ALLOWED_EDGE_TYPES = {
    "IS_PART_OF",
    "CONTAINS",
    "REFERENCES",
    "DEFINES",
    "USES",
    "ASSIGNS_OBLIGATION_TO",
    "GRANTS_RIGHT_TO",
    "DEPENDS_ON",
    "MODIFIES_AMENDS",
    "SUPERSEDES",
    "CONTRADICTS",
}

CONSTRAINTS_QUERY = [
    "CREATE CONSTRAINT contract_hash_unique IF NOT EXISTS FOR (c:Contract) REQUIRE c.content_hash IS UNIQUE",
    "CREATE CONSTRAINT kg_node_id_unique IF NOT EXISTS FOR (n:KGNode) REQUIRE n.node_id IS UNIQUE",
    "CREATE INDEX kg_node_type_idx IF NOT EXISTS FOR (n:KGNode) ON (n.node_type)",
    "CREATE INDEX kg_clause_source_paragraph_idx IF NOT EXISTS FOR (n:Clause) ON (n.source_paragraph_id)",
    "CREATE INDEX kg_clause_paragraph_uid_idx IF NOT EXISTS FOR (n:Clause) ON (n.paragraph_uid)",
]

EXISTS_QUERY = """
MATCH (c:Contract {content_hash: $content_hash})
RETURN c.path AS path
LIMIT 1
"""

CLEAR_CONTRACT_QUERY = """
MATCH (c:Contract {content_hash: $content_hash})
DETACH DELETE c
"""

CLEAR_NODES_QUERY = """
MATCH (n:KGNode {contract_hash: $content_hash})
DETACH DELETE n
"""

IMPORT_CONTRACT_QUERY = """
MERGE (c:Contract {content_hash: $content_hash})
SET c.path = $path,
    c.document_id = $document_id,
    c.processed_at = datetime()
"""

IMPORT_NODES_QUERY = """
UNWIND $rows AS row
MERGE (n:KGNode {node_id: row.node_id})
SET n.contract_hash = $content_hash,
    n.node_type = row.node_type,
    n.label = row.label,
    n += row.props
WITH n, row
FOREACH (_ IN CASE WHEN row.node_type = 'Clause' THEN [1] ELSE [] END | SET n:Clause)
FOREACH (_ IN CASE WHEN row.node_type = 'DefinedTerm' THEN [1] ELSE [] END | SET n:DefinedTerm)
FOREACH (_ IN CASE WHEN row.node_type = 'Party' THEN [1] ELSE [] END | SET n:Party)
FOREACH (_ IN CASE WHEN row.node_type = 'Obligation' THEN [1] ELSE [] END | SET n:Obligation)
FOREACH (_ IN CASE WHEN row.node_type = 'Right' THEN [1] ELSE [] END | SET n:Right)
FOREACH (_ IN CASE WHEN row.node_type = 'Prohibition' THEN [1] ELSE [] END | SET n:Prohibition)
FOREACH (_ IN CASE WHEN row.node_type = 'Condition' THEN [1] ELSE [] END | SET n:Condition)
FOREACH (_ IN CASE WHEN row.node_type = 'Reference' THEN [1] ELSE [] END | SET n:Reference)
FOREACH (_ IN CASE WHEN row.node_type = 'Value' THEN [1] ELSE [] END | SET n:Value)
WITH n
MATCH (c:Contract {content_hash: $content_hash})
MERGE (c)-[:CONTAINS]->(n)
"""

IMPORT_EDGES_QUERY = """
UNWIND $rows AS row
MATCH (s:KGNode {node_id: row.source_id})
MATCH (t:KGNode {node_id: row.target_id})
WITH s, t, row
FOREACH (_ IN CASE WHEN row.rel_type = 'IS_PART_OF' THEN [1] ELSE [] END |
  MERGE (s)-[r:IS_PART_OF]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
FOREACH (_ IN CASE WHEN row.rel_type = 'CONTAINS' THEN [1] ELSE [] END |
  MERGE (s)-[r:CONTAINS]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
FOREACH (_ IN CASE WHEN row.rel_type = 'REFERENCES' THEN [1] ELSE [] END |
  MERGE (s)-[r:REFERENCES]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
FOREACH (_ IN CASE WHEN row.rel_type = 'DEFINES' THEN [1] ELSE [] END |
  MERGE (s)-[r:DEFINES]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
FOREACH (_ IN CASE WHEN row.rel_type = 'USES' THEN [1] ELSE [] END |
  MERGE (s)-[r:USES]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
FOREACH (_ IN CASE WHEN row.rel_type = 'ASSIGNS_OBLIGATION_TO' THEN [1] ELSE [] END |
  MERGE (s)-[r:ASSIGNS_OBLIGATION_TO]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
FOREACH (_ IN CASE WHEN row.rel_type = 'GRANTS_RIGHT_TO' THEN [1] ELSE [] END |
  MERGE (s)-[r:GRANTS_RIGHT_TO]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
FOREACH (_ IN CASE WHEN row.rel_type = 'DEPENDS_ON' THEN [1] ELSE [] END |
  MERGE (s)-[r:DEPENDS_ON]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
FOREACH (_ IN CASE WHEN row.rel_type = 'MODIFIES_AMENDS' THEN [1] ELSE [] END |
  MERGE (s)-[r:MODIFIES_AMENDS]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
FOREACH (_ IN CASE WHEN row.rel_type = 'SUPERSEDES' THEN [1] ELSE [] END |
  MERGE (s)-[r:SUPERSEDES]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
FOREACH (_ IN CASE WHEN row.rel_type = 'CONTRADICTS' THEN [1] ELSE [] END |
  MERGE (s)-[r:CONTRADICTS]->(t)
  SET r.evidence = row.evidence, r.confidence = row.confidence)
"""


@dataclass
class NodeRecord:
    node_id: str
    node_type: str
    label: str
    props: dict[str, Any]


@dataclass
class EdgeRecord:
    source_id: str
    target_id: str
    rel_type: str
    evidence: str = ""
    confidence: float | None = None


SUPPORTED_EXTRACTED_NODE_TYPES = {
    "DefinedTerm",
    "Party",
    "Obligation",
    "Right",
    "Prohibition",
    "Condition",
    "Reference",
    "Value",
}


class ExtractedEntity(BaseModel):
    entity_type: Literal[
        "DefinedTerm",
        "Party",
        "Obligation",
        "Right",
        "Prohibition",
        "Condition",
        "Reference",
        "Value",
    ] = Field(description="Entity category to create as a graph node.")
    label: str = Field(description="Human-readable entity label.")
    source_paragraph_id: str | None = Field(
        default=None,
        description="Paragraph id from the input tag [PARAGRAPH_ID: ...].",
    )
    source_clause_id: str | None = Field(
        default=None,
        description="Clause id if explicitly present in text (e.g., 1.2, 7.3(a)).",
    )
    role: str | None = Field(default=None, description="Party role/title if available.")
    term: str | None = Field(default=None, description="Defined term literal if entity_type=DefinedTerm.")
    definition: str | None = Field(
        default=None, description="Definition text for entity_type=DefinedTerm."
    )
    action: str | None = Field(
        default=None,
        description="Action text for obligation/right/prohibition entities.",
    )
    citation: str | None = Field(default=None, description="Reference citation (section, regulation, etc.).")
    value_type: str | None = Field(
        default=None, description="Value category (Currency, Percentage, Time, Other)."
    )
    amount: str | None = Field(default=None, description="Raw value text if entity_type=Value.")
    unit: str | None = Field(default=None, description="Unit symbol/name when available.")
    operator: str | None = Field(default=None, description="Condition operator (IF_THEN, UNLESS, etc.).")


class ExtractedRelation(BaseModel):
    source_label: str = Field(description="Source entity label.")
    source_type: Literal[
        "Clause",
        "DefinedTerm",
        "Party",
        "Obligation",
        "Right",
        "Prohibition",
        "Condition",
        "Reference",
        "Value",
    ] = Field(description="Source entity type.")
    target_label: str = Field(description="Target entity label.")
    target_type: Literal[
        "Clause",
        "DefinedTerm",
        "Party",
        "Obligation",
        "Right",
        "Prohibition",
        "Condition",
        "Reference",
        "Value",
    ] = Field(description="Target entity type.")
    rel_type: Literal[
        "IS_PART_OF",
        "CONTAINS",
        "REFERENCES",
        "DEFINES",
        "USES",
        "ASSIGNS_OBLIGATION_TO",
        "GRANTS_RIGHT_TO",
        "DEPENDS_ON",
        "MODIFIES_AMENDS",
        "SUPERSEDES",
        "CONTRADICTS",
    ] = Field(description="Relationship type compatible with graph ontology.")
    evidence: str | None = Field(default=None, description="Short evidence snippet.")
    confidence: float | None = Field(default=None, description="Confidence between 0 and 1.")


class ExtractedKGPayload(BaseModel):
    entities: list[ExtractedEntity] = Field(default_factory=list)
    relations: list[ExtractedRelation] = Field(default_factory=list)


def _normalize_text_for_uid(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text or "")
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"\s+", " ", normalized).strip().lower()
    return normalized


def _paragraph_uid_from_text(text: str) -> str:
    normalized = _normalize_text_for_uid(text)
    if not normalized:
        return ""
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()


def _safe_token(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_.:-]+", "_", (value or "").strip())
    return value.strip("_") or "unknown"


def _hash16(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def _clean_name(raw: str) -> str:
    out = re.sub(r"\s+", " ", (raw or "")).strip(" \t,;:.()[]{}\"'")
    out = re.sub(r"\s+\([^)]*\)$", "", out).strip()
    return out


def _props_without_none(props: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in props.items() if v is not None}


def _as_float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _ordered_base_nodes(base_graph: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = [n for n in base_graph.get("nodes", []) if isinstance(n, dict)]
    return sorted(nodes, key=lambda n: (int(n.get("paragraph_enum", 0)), str(n.get("id", ""))))


def load_base_graph_json(json_path: Path) -> dict[str, Any]:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"Invalid JSON root type in {json_path}")

    base_graph = payload.get("graph") if isinstance(payload.get("graph"), dict) else payload
    if not isinstance(base_graph.get("nodes"), list) or not isinstance(base_graph.get("edges"), list):
        raise ValueError(f"Expected keys 'nodes' and 'edges' as lists in {json_path}")

    document_id = str(payload.get("documentId") or base_graph.get("documentId") or json_path.stem)
    base_graph["_document_id"] = document_id
    return base_graph


def _extract_clause_header(text: str) -> tuple[str | None, str | None, int | None]:
    if not text:
        return None, None, None
    pattern = re.compile(
        r"^\s*(?:section|clause|article)?\s*(\d+(?:\.\d+)*(?:\([a-z0-9]+\))?)\s*[:.)-]?\s*(.{0,140})$",
        flags=re.IGNORECASE,
    )
    first_line = text.strip().splitlines()[0].strip()
    match = pattern.match(first_line)
    if not match:
        return None, None, None

    clause_id = match.group(1).strip()
    title_raw = match.group(2).strip()
    title = None
    if title_raw:
        title = re.split(r"[.;]", title_raw, maxsplit=1)[0].strip()
        if len(title.split()) > 18:
            title = " ".join(title.split()[:18]).strip()
    level = clause_id.count(".") + 1
    return clause_id, title or None, level


def _clause_parent_keys(clause_id: str) -> list[str]:
    cid = clause_id.strip()
    out: list[str] = []
    no_paren = re.sub(r"\([a-z0-9]+\)$", "", cid, flags=re.IGNORECASE).strip()
    if no_paren != cid and no_paren:
        out.append(no_paren)
    parts = no_paren.split(".")
    for i in range(len(parts) - 1, 0, -1):
        out.append(".".join(parts[:i]))
    return out


def _build_clause_nodes_from_base_graph(
    base_graph: dict[str, Any], content_hash: str
) -> tuple[list[NodeRecord], dict[str, str], dict[str, str], dict[str, str]]:
    clause_nodes: list[NodeRecord] = []
    base_to_clause: dict[str, str] = {}
    uid_to_clause: dict[str, str] = {}
    section_to_clause: dict[str, str] = {}

    for base_node in _ordered_base_nodes(base_graph):
        base_id = str(base_node.get("id", "")).strip()
        if not base_id:
            continue
        text = str(base_node.get("text") or "").strip()
        paragraph_uid = str(base_node.get("paragraph_uid") or "").strip() or _paragraph_uid_from_text(text)
        paragraph_enum = int(base_node.get("paragraph_enum", 0) or 0)
        relations_count = int(base_node.get("relationsCount", 0) or 0)
        clause_id, title, level = _extract_clause_header(text)

        node_id = f"{content_hash}:Clause:{_safe_token(base_id)}"
        label = clause_id or base_id
        props = _props_without_none(
            {
                "id": base_id,
                "node_id": node_id,
                "source_paragraph_id": base_id,
                "paragraph_uid": paragraph_uid,
                "paragraph_enum": paragraph_enum,
                "text": text,
                "clause_id": clause_id,
                "title": title,
                "clause_level": level,
                "base_relationsCount": relations_count,
            }
        )
        clause_nodes.append(NodeRecord(node_id=node_id, node_type="Clause", label=label, props=props))
        base_to_clause[base_id] = node_id
        if paragraph_uid and paragraph_uid not in uid_to_clause:
            uid_to_clause[paragraph_uid] = node_id
        if clause_id and clause_id not in section_to_clause:
            section_to_clause[clause_id] = node_id

    return clause_nodes, base_to_clause, uid_to_clause, section_to_clause


def _build_extract_source_text(clause_nodes: list[NodeRecord]) -> str:
    chunks: list[str] = []
    for clause in clause_nodes:
        paragraph_id = str(clause.props.get("source_paragraph_id") or "").strip()
        text = str(clause.props.get("text") or "").strip()
        if not paragraph_id or not text:
            continue
        chunks.append(f"[PARAGRAPH_ID: {paragraph_id}]\n{text}")
    return "\n\n".join(chunks)


def _create_llama_extract_agent() -> Any:
    if LlamaExtract is None or ExtractConfig is None or ExtractMode is None or SourceText is None:
        raise RuntimeError(
            "Missing llama-cloud dependencies. Install them first (e.g. `pip install llama-cloud llama-parse`)."
        )
    llama_api_key = os.getenv("LLAMA_CLOUD_API_KEY")
    if not llama_api_key:
        raise RuntimeError("LLAMA_CLOUD_API_KEY is required to run KG extraction with LlamaExtract.")

    extractor = LlamaExtract(api_key=llama_api_key)
    return extractor.create_agent(
        name=f"kg_extraction_{uuid.uuid4()}",
        data_schema=ExtractedKGPayload,
        config=ExtractConfig(extraction_mode=ExtractMode.BALANCED),
    )


def _extract_payload_with_llama(
    *,
    extract_agent: Any,
    document_id: str,
    clause_nodes: list[NodeRecord],
) -> ExtractedKGPayload:
    extract_text = _build_extract_source_text(clause_nodes)
    if not extract_text:
        return ExtractedKGPayload()

    instruction = (
        "Extract legal KG entities and relations from the tagged text. "
        "Use the exact PARAGRAPH_ID tag for source_paragraph_id when possible."
    )
    result = extract_agent.extract(
        files=SourceText(
            text_content=f"{instruction}\n\n{extract_text}",
            filename=f"{document_id}.txt",
        ),
    )
    data = result.data
    if isinstance(data, ExtractedKGPayload):
        return data
    if hasattr(data, "model_dump"):
        data = data.model_dump()
    if isinstance(data, dict):
        return ExtractedKGPayload.model_validate(data)
    return ExtractedKGPayload()


def _entity_node_id(content_hash: str, entity_type: str, label: str) -> str:
    return f"{content_hash}:{entity_type}:{_hash16(entity_type.lower() + '|' + label.lower())}"


def _clean_label(value: str | None) -> str:
    return _clean_name(value or "")


def _extract_entities_and_edges(
    *,
    base_graph: dict[str, Any],
    document_id: str,
    content_hash: str,
    clause_nodes: list[NodeRecord],
    base_to_clause: dict[str, str],
    section_to_clause: dict[str, str],
    extract_agent: Any | None,
) -> tuple[list[NodeRecord], list[EdgeRecord]]:
    nodes_out: dict[str, NodeRecord] = {n.node_id: n for n in clause_nodes}
    edges_out: dict[tuple[str, str, str], EdgeRecord] = {}

    def add_node(node: NodeRecord) -> None:
        if node.node_type not in {
            "Clause",
            "DefinedTerm",
            "Party",
            "Obligation",
            "Right",
            "Prohibition",
            "Condition",
            "Reference",
            "Value",
        }:
            return
        nodes_out[node.node_id] = node

    def add_edge(edge: EdgeRecord) -> None:
        if edge.rel_type not in ALLOWED_EDGE_TYPES:
            return
        if edge.source_id == edge.target_id:
            return
        key = (edge.source_id, edge.target_id, edge.rel_type)
        if key not in edges_out:
            edges_out[key] = edge

    clause_by_paragraph_id = {
        str(clause.props.get("source_paragraph_id") or "").strip(): clause for clause in clause_nodes
    }
    clause_by_clause_id = {
        str(clause.props.get("clause_id") or "").strip(): clause
        for clause in clause_nodes
        if str(clause.props.get("clause_id") or "").strip()
    }
    clause_by_label = {str(clause.label).strip().lower(): clause for clause in clause_nodes}

    # Hierarchy between clauses (IS_PART_OF / CONTAINS)
    for clause in clause_nodes:
        clause_id = str(clause.props.get("clause_id") or "").strip()
        if not clause_id:
            continue
        for parent_key in _clause_parent_keys(clause_id):
            parent = section_to_clause.get(parent_key)
            if parent and parent != clause.node_id:
                add_edge(EdgeRecord(clause.node_id, parent, "IS_PART_OF", "Derived from clause numbering", 0.9))
                add_edge(EdgeRecord(parent, clause.node_id, "CONTAINS", "Derived from clause numbering", 0.9))
                break

    # Base graph references -> REFERENCES between clauses
    for edge in base_graph.get("edges", []):
        if not isinstance(edge, dict):
            continue
        if str(edge.get("type", "")).strip().lower() != "reference":
            continue
        src = base_to_clause.get(str(edge.get("source", "")).strip())
        tgt = base_to_clause.get(str(edge.get("target", "")).strip())
        if not src or not tgt:
            continue
        ref_label = str(edge.get("ref_label") or "").strip()
        ref_value = str(edge.get("ref_value") or "").strip()
        evidence = f"base_reference:{ref_label} {ref_value}".strip()
        conf = _as_float_or_none(edge.get("score"))
        if conf is None:
            conf = 1.0
        add_edge(EdgeRecord(src, tgt, "REFERENCES", evidence, conf))

    entity_key_to_node_id: dict[tuple[str, str], str] = {}

    if extract_agent is not None:
        payload = _extract_payload_with_llama(
            extract_agent=extract_agent,
            document_id=document_id,
            clause_nodes=clause_nodes,
        )

        for entity in payload.entities:
            entity_type = entity.entity_type
            if entity_type not in SUPPORTED_EXTRACTED_NODE_TYPES:
                continue
            label = _clean_label(entity.label)
            if not label:
                continue
            entity_key = (entity_type.lower(), label.lower())
            node_id = entity_key_to_node_id.get(entity_key)
            if node_id is None:
                node_id = _entity_node_id(content_hash, entity_type, label)
                entity_key_to_node_id[entity_key] = node_id

                source_clause = None
                source_paragraph_id = (entity.source_paragraph_id or "").strip()
                source_clause_id = (entity.source_clause_id or "").strip()
                if source_paragraph_id:
                    source_clause = clause_by_paragraph_id.get(source_paragraph_id)
                if source_clause is None and source_clause_id:
                    source_clause = clause_by_clause_id.get(source_clause_id)

                props = {
                    "source_paragraph_id": source_paragraph_id or None,
                    "source_clause_id": source_clause_id or None,
                    "role": _clean_label(entity.role) or None,
                    "term": _clean_label(entity.term) or None,
                    "definition": _clean_label(entity.definition) or None,
                    "action": _clean_label(entity.action) or None,
                    "citation": _clean_label(entity.citation) or None,
                    "value_type": _clean_label(entity.value_type) or None,
                    "amount": _clean_label(entity.amount) or None,
                    "unit": _clean_label(entity.unit) or None,
                    "operator": _clean_label(entity.operator) or None,
                }
                if source_clause is not None:
                    props["paragraph_uid"] = source_clause.props.get("paragraph_uid")
                    if not props.get("source_paragraph_id"):
                        props["source_paragraph_id"] = source_clause.props.get("source_paragraph_id")

                add_node(
                    NodeRecord(
                        node_id=node_id,
                        node_type=entity_type,
                        label=label,
                        props=_props_without_none(props),
                    )
                )

                if source_clause is not None:
                    add_edge(EdgeRecord(node_id, source_clause.node_id, "IS_PART_OF", "Extracted from clause text", 0.8))
                    add_edge(EdgeRecord(source_clause.node_id, node_id, "CONTAINS", "Extracted from clause text", 0.8))

        for relation in payload.relations:
            source_label = _clean_label(relation.source_label)
            target_label = _clean_label(relation.target_label)
            if not source_label or not target_label:
                continue
            rel_type = relation.rel_type
            if rel_type not in ALLOWED_EDGE_TYPES:
                continue

            source_id = None
            target_id = None

            if relation.source_type == "Clause":
                source_id = section_to_clause.get(source_label) or section_to_clause.get(source_label.replace("Section ", ""))
                if source_id is None:
                    source_clause = clause_by_label.get(source_label.lower())
                    source_id = source_clause.node_id if source_clause else None
            else:
                source_id = entity_key_to_node_id.get((relation.source_type.lower(), source_label.lower()))

            if relation.target_type == "Clause":
                target_id = section_to_clause.get(target_label) or section_to_clause.get(target_label.replace("Section ", ""))
                if target_id is None:
                    target_clause = clause_by_label.get(target_label.lower())
                    target_id = target_clause.node_id if target_clause else None
            else:
                target_id = entity_key_to_node_id.get((relation.target_type.lower(), target_label.lower()))

            if not source_id or not target_id:
                continue
            add_edge(
                EdgeRecord(
                    source_id=source_id,
                    target_id=target_id,
                    rel_type=rel_type,
                    evidence=_clean_label(relation.evidence) or "Extracted relation",
                    confidence=_as_float_or_none(relation.confidence),
                )
            )

    # Remove edges with missing endpoints
    valid_nodes = set(nodes_out.keys())
    filtered_edges = [
        e
        for e in edges_out.values()
        if e.source_id in valid_nodes and e.target_id in valid_nodes and e.rel_type in ALLOWED_EDGE_TYPES
    ]

    return list(nodes_out.values()), filtered_edges


def _build_rows(
    *,
    nodes: list[NodeRecord],
    edges: list[EdgeRecord],
    content_hash: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    node_rows: list[dict[str, Any]] = []
    for node in nodes:
        node_rows.append(
            {
                "node_id": node.node_id,
                "node_type": node.node_type,
                "label": node.label,
                "props": _props_without_none(node.props | {"contract_hash": content_hash}),
            }
        )

    edge_rows: list[dict[str, Any]] = []
    seen = set()
    for edge in edges:
        k = (edge.source_id, edge.target_id, edge.rel_type)
        if k in seen:
            continue
        seen.add(k)
        edge_rows.append(
            {
                "source_id": edge.source_id,
                "target_id": edge.target_id,
                "rel_type": edge.rel_type,
                "evidence": edge.evidence or "",
                "confidence": edge.confidence,
            }
        )
    return node_rows, edge_rows


def process_graph_json_to_neo4j(
    *,
    graph_json_path: Path,
    neo4j_driver: Any | None,
    neo4j_database: str,
    dry_run: bool,
    force_reprocess: bool,
    extract_agent: Any | None,
) -> dict[str, Any]:
    base_graph = load_base_graph_json(graph_json_path)
    document_id = str(base_graph.get("_document_id") or graph_json_path.stem)
    content_hash = hashlib.sha1(document_id.encode("utf-8")).hexdigest()

    clauses, base_to_clause, _, section_to_clause = _build_clause_nodes_from_base_graph(base_graph, content_hash)
    nodes, edges = _extract_entities_and_edges(
        base_graph=base_graph,
        document_id=document_id,
        content_hash=content_hash,
        clause_nodes=clauses,
        base_to_clause=base_to_clause,
        section_to_clause=section_to_clause,
        extract_agent=extract_agent,
    )
    node_rows, edge_rows = _build_rows(nodes=nodes, edges=edges, content_hash=content_hash)

    result = {
        "path": str(graph_json_path),
        "document_id": document_id,
        "content_hash": content_hash,
        "status": "ok",
        "nodes": len(node_rows),
        "edges": len(edge_rows),
        "clauses": sum(1 for n in nodes if n.node_type == "Clause"),
    }

    if dry_run:
        result["status"] = "dry_run"
        return result

    if neo4j_driver is None:
        raise RuntimeError("neo4j_driver is required when dry_run=False")

    existing = neo4j_driver.execute_query(
        EXISTS_QUERY,
        content_hash=content_hash,
        database_=neo4j_database,
    )
    if existing.records and not force_reprocess:
        result["status"] = "skipped"
        result["detail"] = "Contract already exists in Neo4j. Set KG_FORCE_REPROCESS=true to overwrite."
        return result

    neo4j_driver.execute_query(CLEAR_CONTRACT_QUERY, content_hash=content_hash, database_=neo4j_database)
    neo4j_driver.execute_query(CLEAR_NODES_QUERY, content_hash=content_hash, database_=neo4j_database)
    neo4j_driver.execute_query(
        IMPORT_CONTRACT_QUERY,
        content_hash=content_hash,
        path=str(graph_json_path.resolve()),
        document_id=document_id,
        database_=neo4j_database,
    )
    n_res = neo4j_driver.execute_query(
        IMPORT_NODES_QUERY,
        content_hash=content_hash,
        rows=node_rows,
        database_=neo4j_database,
    )
    e_res = neo4j_driver.execute_query(
        IMPORT_EDGES_QUERY,
        rows=edge_rows,
        database_=neo4j_database,
    )

    result["node_counters"] = _counters_to_dict(n_res.summary.counters)
    result["edge_counters"] = _counters_to_dict(e_res.summary.counters)
    return result


def _counters_to_dict(counters: Any) -> dict[str, Any]:
    fields = [
        "nodes_created",
        "nodes_deleted",
        "relationships_created",
        "relationships_deleted",
        "properties_set",
        "labels_added",
        "labels_removed",
        "indexes_added",
        "indexes_removed",
        "constraints_added",
        "constraints_removed",
        "contains_updates",
        "contains_system_updates",
        "system_updates",
    ]
    return {name: getattr(counters, name, None) for name in fields}


def get_graph_json_files(graph_root: Path) -> list[Path]:
    return sorted([p for p in graph_root.glob("*.json") if p.is_file()])


def get_selected_json_paths(json_files: list[Path], selected_json: list[str]) -> list[Path]:
    selected_set = {s.strip().lower() for s in selected_json if s and s.strip()}
    if not selected_set:
        return json_files
    selected = []
    for path in json_files:
        if path.name.lower() in selected_set or path.stem.lower() in selected_set:
            selected.append(path)
    return selected


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "t", "yes", "y", "on"}


def _env_int(name: str) -> int | None:
    value = os.getenv(name)
    if value is None or not value.strip():
        return None
    parsed = int(value)
    return parsed if parsed >= 0 else None


def _env_csv(name: str) -> list[str]:
    value = os.getenv(name, "")
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> None:
    project_root = Path(__file__).resolve().parents[2]
    env_candidates = [project_root / "server/.env", project_root / ".env"]
    for env_path in env_candidates:
        if env_path.exists():
            load_dotenv(dotenv_path=env_path, override=False)

    graph_root = Path(
        os.getenv("KG_GRAPH_ROOT", str((project_root / "infra/json/graph").resolve()))
    ).resolve()
    if not graph_root.exists():
        raise FileNotFoundError(f"Graph JSON root not found: {graph_root}")

    selected_files = _env_csv("KG_FILES")
    max_docs = _env_int("KG_MAX_DOCS")
    dry_run = _env_bool("KG_DRY_RUN", False)
    force_reprocess = _env_bool("KG_FORCE_REPROCESS", False)
    enable_llama_extract = _env_bool("KG_ENABLE_LLAMA_EXTRACT", True)

    json_files = get_graph_json_files(graph_root)
    selected = get_selected_json_paths(json_files, selected_files)
    if max_docs is not None:
        selected = selected[:max_docs]

    if not selected:
        print("No JSON files selected.")
        return

    neo4j_uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    neo4j_username = os.getenv("NEO4J_USERNAME", "neo4j")
    neo4j_password = os.getenv("NEO4J_PASSWORD", "neo4j_password")
    neo4j_database = os.getenv("NEO4J_DATABASE", "neo4j")

    extract_agent = None
    if enable_llama_extract:
        extract_agent = _create_llama_extract_agent()

    driver = None
    if not dry_run:
        driver = GraphDatabase.driver(
            neo4j_uri,
            auth=(neo4j_username, neo4j_password),
        )
        for query in CONSTRAINTS_QUERY:
            driver.execute_query(query, database_=neo4j_database)

    results = []
    try:
        for graph_path in selected:
            try:
                res = process_graph_json_to_neo4j(
                    graph_json_path=graph_path,
                    neo4j_driver=driver,
                    neo4j_database=neo4j_database,
                    dry_run=dry_run,
                    force_reprocess=force_reprocess,
                    extract_agent=extract_agent,
                )
            except Exception as exc:
                res = {
                    "path": str(graph_path),
                    "status": "error",
                    "detail": str(exc),
                }
            results.append(res)
            status = res.get("status")
            nodes = res.get("nodes", 0)
            edges = res.get("edges", 0)
            print(f"[{status}] {graph_path.name} | nodes={nodes} edges={edges}")
            if res.get("detail"):
                print(f"  detail: {res['detail']}")
    finally:
        if driver is not None:
            driver.close()

    ok = sum(1 for r in results if r.get("status") in {"ok", "dry_run"})
    skipped = sum(1 for r in results if r.get("status") == "skipped")
    errors = sum(1 for r in results if r.get("status") == "error")
    print(f"Summary | ok={ok} skipped={skipped} error={errors} total={len(results)}")


if __name__ == "__main__":
    main()
