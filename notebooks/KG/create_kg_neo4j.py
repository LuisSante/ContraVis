from __future__ import annotations

import asyncio
import json
import os
import re
import unicodedata
import uuid
from hashlib import sha1
from pathlib import Path
from typing import Any, Literal, Optional

from dotenv import load_dotenv
from neo4j import AsyncGraphDatabase
from pydantic import BaseModel, Field

from llama_cloud_services.extract import (
    ExtractConfig,
    ExtractMode,
    LlamaExtract,
    SourceText,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = PROJECT_ROOT / "server" / ".env"
GRAPH_JSON_ROOT = PROJECT_ROOT / "infra" / "json" / "graph"

ONTOLOGY_VERSION = "legal_ontology_v1"
EXTRACTION_VERSION = "base_graph_json_clause_1to1_llamaextract_ontology_v2"
FORCE_REPROCESS = True
MAX_DOCS: int | None = None
RELATION_CONFIDENCE_THRESHOLD = 0.6
RELATION_EVIDENCE_REQUIRED = True

SELECTED_GRAPH_JSON: list[str] = []


class ClauseNode(BaseModel):
    id: str = Field(description="Clause identifier (e.g., 3.1, 2.2(a), C1)")
    title: Optional[str] = Field(None, description="Clause title/header")
    text: str = Field(description="Full clause text")
    clause_level: Optional[int] = Field(None, description="Depth level in contract structure")
    source_paragraph_id: Optional[str] = Field(
        None,
        description="Original base-graph node id when this clause comes from one paragraph",
    )
    paragraph_uid: Optional[str] = Field(
        None,
        description="Stable paragraph uid from base graph when available",
    )


class DefinedTermNode(BaseModel):
    id: str = Field(description="Unique term node id")
    term: str = Field(description="Defined term string")
    definition: Optional[str] = Field(None, description="Definition text")
    definition_clause_id: Optional[str] = Field(None, description="Clause id where term is defined")
    source_paragraph_id: Optional[str] = Field(
        None,
        description="Original base-graph clause id where this term was extracted",
    )
    paragraph_uid: Optional[str] = Field(
        None,
        description="Stable paragraph uid of the source base-graph clause",
    )


class PartyNode(BaseModel):
    id: str = Field(description="Unique party node id")
    name: str = Field(description="Party legal name")
    role: Optional[str] = Field(None, description="Role such as Buyer, Supplier, Licensee")
    address: Optional[str] = Field(None, description="Party address/location")
    source_paragraph_id: Optional[str] = Field(
        None,
        description="Original base-graph clause id where this party mention was extracted",
    )
    paragraph_uid: Optional[str] = Field(
        None,
        description="Stable paragraph uid of the source base-graph clause",
    )


class ObligationNode(BaseModel):
    id: str = Field(description="Unique obligation node id")
    action: str = Field(description="Obligation action")
    actor_party_id: Optional[str] = Field(None, description="Party id responsible for the obligation")
    deadline: Optional[str] = Field(None, description="Deadline expression")
    source_paragraph_id: Optional[str] = Field(
        None,
        description="Original base-graph clause id where this obligation was extracted",
    )
    paragraph_uid: Optional[str] = Field(
        None,
        description="Stable paragraph uid of the source base-graph clause",
    )


class RightNode(BaseModel):
    id: str = Field(description="Unique right/permission node id")
    action: str = Field(description="Right/permission action")
    holder_party_id: Optional[str] = Field(None, description="Party id holding the right")
    frequency: Optional[str] = Field(None, description="Frequency/usage constraint")
    source_paragraph_id: Optional[str] = Field(
        None,
        description="Original base-graph clause id where this right was extracted",
    )
    paragraph_uid: Optional[str] = Field(
        None,
        description="Stable paragraph uid of the source base-graph clause",
    )


class ProhibitionNode(BaseModel):
    id: str = Field(description="Unique prohibition node id")
    action: str = Field(description="Prohibited action")
    subject_party_id: Optional[str] = Field(None, description="Party id subject to prohibition")
    source_paragraph_id: Optional[str] = Field(
        None,
        description="Original base-graph clause id where this prohibition was extracted",
    )
    paragraph_uid: Optional[str] = Field(
        None,
        description="Stable paragraph uid of the source base-graph clause",
    )


class ConditionNode(BaseModel):
    id: str = Field(description="Unique condition node id")
    trigger: str = Field(description="Condition trigger text")
    operator: Optional[str] = Field(None, description="Operator such as IF_THEN, UNLESS")
    source_paragraph_id: Optional[str] = Field(
        None,
        description="Original base-graph clause id where this condition was extracted",
    )
    paragraph_uid: Optional[str] = Field(
        None,
        description="Stable paragraph uid of the source base-graph clause",
    )


class ReferenceNode(BaseModel):
    id: str = Field(description="Unique reference node id")
    name: str = Field(description="Reference name, law, standard, or document")
    citation: Optional[str] = Field(None, description="Citation string")
    source_paragraph_id: Optional[str] = Field(
        None,
        description="Original base-graph clause id where this reference was extracted",
    )
    paragraph_uid: Optional[str] = Field(
        None,
        description="Stable paragraph uid of the source base-graph clause",
    )


class ValueNode(BaseModel):
    id: str = Field(description="Unique value node id")
    value_type: str = Field(description="Value type: Currency, Percentage, Time, Date, etc.")
    amount: str = Field(description="Value amount")
    unit: Optional[str] = Field(None, description="Unit such as USD, %, days")
    source_paragraph_id: Optional[str] = Field(
        None,
        description="Original base-graph clause id where this value was extracted",
    )
    paragraph_uid: Optional[str] = Field(
        None,
        description="Stable paragraph uid of the source base-graph clause",
    )


AllowedEdgeType = Literal[
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
]

ALLOWED_EDGE_TYPES: set[str] = {
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

EDGE_TYPE_ALIASES: dict[str, str] = {
    "ASSIGNS_OBLIGATION": "ASSIGNS_OBLIGATION_TO",
    "GRANTS_RIGHT": "GRANTS_RIGHT_TO",
    "MODIFIES_AMENDS": "MODIFIES_AMENDS",
    "MODIFIES_OR_AMENDS": "MODIFIES_AMENDS",
}


class KGEdge(BaseModel):
    source_id: str = Field(description="Source node id")
    target_id: str = Field(description="Target node id")
    type: AllowedEdgeType = Field(description="Edge type from allowed ontology set")
    evidence: Optional[str] = Field(None, description="Text evidence for this relation")
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0, description="Optional confidence")


class ContractOntologyKG(BaseModel):
    clauses: list[ClauseNode] = Field(default_factory=list)
    defined_terms: list[DefinedTermNode] = Field(default_factory=list)
    parties: list[PartyNode] = Field(default_factory=list)
    obligations: list[ObligationNode] = Field(default_factory=list)
    rights: list[RightNode] = Field(default_factory=list)
    prohibitions: list[ProhibitionNode] = Field(default_factory=list)
    conditions: list[ConditionNode] = Field(default_factory=list)
    references: list[ReferenceNode] = Field(default_factory=list)
    values: list[ValueNode] = Field(default_factory=list)
    edges: list[KGEdge] = Field(default_factory=list)


ONTOLOGY_EXTRACTION_PROMPT = """You extract a legal-contract knowledge graph using the provided schema only.

Rules:
1) Create nodes and edges only from contract content, never from this instruction text.
2) Node IDs must be stable and unique within a contract.
3) Every edge source_id and target_id must exactly match an existing node id.
4) ID conventions:
   - Party ids should be deterministic (prefer party-1, party-2, ...).
   - Do not invent a new edge endpoint id if no node uses that id.
5) Input paragraphs can include tags like [BASE_NODE_ID=...] and [PARAGRAPH_UID=...].
   - Clause nodes are already fixed externally as one-per-paragraph (1:1). Do not invent extra clause segmentation.
   - For every non-Clause node, always set:
     - source_paragraph_id = BASE_NODE_ID
     - paragraph_uid = PARAGRAPH_UID
6) Evaluate all relation types when present in text:
IS_PART_OF, CONTAINS, REFERENCES, DEFINES, USES, ASSIGNS_OBLIGATION_TO,
GRANTS_RIGHT_TO, DEPENDS_ON, MODIFIES_AMENDS, SUPERSEDES, CONTRADICTS.
7) Every non-Clause node must be linked to its source Clause by IS_PART_OF.
8) Prefer recall for valid relations; do not omit obvious explicit references.
9) For every edge, provide textual evidence and numeric confidence in [0,1].
"""

CONSTRAINTS_QUERY = [
    "CREATE CONSTRAINT contract_hash_unique IF NOT EXISTS FOR (c:Contract) REQUIRE c.content_hash IS UNIQUE",
    "CREATE CONSTRAINT kg_node_id_unique IF NOT EXISTS FOR (n:KGNode) REQUIRE n.node_id IS UNIQUE",
    "CREATE INDEX kg_node_type_idx IF NOT EXISTS FOR (n:KGNode) ON (n.node_type)",
    "CREATE INDEX kg_clause_source_paragraph_idx IF NOT EXISTS FOR (n:Clause) ON (n.source_paragraph_id)",
    "CREATE INDEX kg_clause_paragraph_uid_idx IF NOT EXISTS FOR (n:Clause) ON (n.paragraph_uid)",
]

EXISTS_QUERY = """
MATCH (c:Contract {
  content_hash: $content_hash,
  ontology_version: $ontology_version,
  extraction_version: $extraction_version
})
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
    c.ontology_version = $ontology_version,
    c.extraction_version = $extraction_version,
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


def get_graph_json_files(graph_root: Path) -> list[Path]:
    return sorted(p for p in graph_root.glob("*.json") if p.is_file())


def get_selected_json_paths(json_files: list[Path], selected_json: list[str]) -> list[Path]:
    if not selected_json:
        return json_files
    selected_set = {x.strip() for x in selected_json if x.strip()}
    return [p for p in json_files if p.stem in selected_set]


def load_base_graph_json(json_path: Path) -> dict[str, Any]:
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"Invalid JSON root type in {json_path.name}: {type(payload)!r}")
    if isinstance(payload.get("graph"), dict):
        payload = payload["graph"]
    nodes = payload.get("nodes")
    edges = payload.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise ValueError(f"Expected keys 'nodes' and 'edges' as lists in {json_path.name}")
    return payload


def _normalize_text_for_uid(text: Any) -> str:
    if text is None:
        return ""
    s = unicodedata.normalize("NFKC", str(text))
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def _paragraph_uid_from_text(text: Any) -> str:
    normalized = _normalize_text_for_uid(text)
    if not normalized:
        return ""
    return sha1(normalized.encode("utf-8")).hexdigest()


def _ordered_base_nodes(base_graph: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = [n for n in base_graph.get("nodes", []) if isinstance(n, dict)]
    return sorted(
        nodes,
        key=lambda n: (
            int(n.get("page", 0) or 0),
            int(n.get("paragraph_enum", 0) or 0),
            str(n.get("id", "")),
        ),
    )


def _build_extraction_input_from_base_graph(base_graph: dict[str, Any]) -> tuple[str, dict[str, dict[str, str]]]:
    ordered_nodes = _ordered_base_nodes(base_graph)
    lines: list[str] = []
    index_by_id: dict[str, dict[str, str]] = {}
    for node in ordered_nodes:
        base_id = str(node.get("id", "")).strip()
        if not base_id:
            continue
        text = str(node.get("text", "")).strip()
        if not text:
            continue
        paragraph_uid = str(node.get("paragraph_uid") or "").strip()
        if not paragraph_uid:
            paragraph_uid = _paragraph_uid_from_text(text)
        index_by_id[base_id] = {
            "paragraph_uid": paragraph_uid,
            "text_normalized": _normalize_text_for_uid(text),
        }
        lines.append(f"[BASE_NODE_ID={base_id}] [PARAGRAPH_UID={paragraph_uid}] {text}")

    return "\n\n".join(lines).strip(), index_by_id


def _safe_token(value: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9_.:-]+", "_", (value or "").strip())
    out = re.sub(r"_+", "_", out).strip("_")
    return out or "unknown"


def _normalize_id(contract_hash: str, node_type: str, raw_id: Optional[str], fallback: str) -> str:
    base = _safe_token(raw_id or fallback)
    return f"{contract_hash}:{node_type}:{base}"


def _props_without_none(d: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in d.items():
        if value is None:
            continue
        if isinstance(value, (str, int, float, bool)):
            out[key] = value
        elif isinstance(value, list):
            out[key] = [x for x in value if isinstance(x, (str, int, float, bool))]
        else:
            out[key] = str(value)
    return out


def _as_dict(x: Any) -> dict[str, Any]:
    return x if isinstance(x, dict) else x.model_dump()


def _payload_to_dict(raw_payload: Any) -> dict[str, Any]:
    if isinstance(raw_payload, dict):
        return raw_payload
    if isinstance(raw_payload, list):
        for item in raw_payload:
            if item is None:
                continue
            if isinstance(item, dict):
                return item
            if hasattr(item, "model_dump"):
                return item.model_dump()
            if hasattr(item, "dict"):
                return item.dict()
        return {}
    if hasattr(raw_payload, "model_dump"):
        return raw_payload.model_dump()
    if hasattr(raw_payload, "dict"):
        return raw_payload.dict()
    raise TypeError(f"Unsupported extraction payload type: {type(raw_payload)!r}")


def _normalize_edge_type(raw_type: Any) -> Optional[str]:
    if raw_type is None:
        return None
    norm = re.sub(r"[^A-Z0-9]+", "_", str(raw_type).upper()).strip("_")
    if not norm:
        return None
    mapped = EDGE_TYPE_ALIASES.get(norm, norm)
    if mapped in ALLOWED_EDGE_TYPES:
        return mapped
    if "IS_PART_OF" in mapped and "CONTAINS" in mapped:
        return "REFERENCES"
    return None


def _normalize_payload_dict(payload_dict: dict[str, Any]) -> tuple[dict[str, Any], dict[str, int]]:
    cleaned: dict[str, Any] = {
        "clauses": [],
        "defined_terms": [],
        "parties": [],
        "obligations": [],
        "rights": [],
        "prohibitions": [],
        "conditions": [],
        "references": [],
        "values": [],
        "edges": [],
    }
    stats = {
        "raw_edges": 0,
        "normalized_edges": 0,
        "dropped_edges_invalid_type": 0,
        "dropped_edges_invalid_endpoint": 0,
        "dropped_edges_missing_evidence": 0,
        "dropped_edges_low_confidence": 0,
    }

    node_defaults: dict[str, dict[str, Any]] = {
        "clauses": {
            "title": "",
            "text": "",
            "clause_level": None,
            "source_paragraph_id": None,
            "paragraph_uid": None,
        },
        "defined_terms": {
            "term": "",
            "definition": None,
            "definition_clause_id": None,
            "source_paragraph_id": None,
            "paragraph_uid": None,
        },
        "parties": {
            "name": "",
            "role": None,
            "address": None,
            "source_paragraph_id": None,
            "paragraph_uid": None,
        },
        "obligations": {
            "action": "",
            "actor_party_id": None,
            "deadline": None,
            "source_paragraph_id": None,
            "paragraph_uid": None,
        },
        "rights": {
            "action": "",
            "holder_party_id": None,
            "frequency": None,
            "source_paragraph_id": None,
            "paragraph_uid": None,
        },
        "prohibitions": {
            "action": "",
            "subject_party_id": None,
            "source_paragraph_id": None,
            "paragraph_uid": None,
        },
        "conditions": {
            "trigger": "",
            "operator": None,
            "source_paragraph_id": None,
            "paragraph_uid": None,
        },
        "references": {
            "name": "",
            "citation": None,
            "source_paragraph_id": None,
            "paragraph_uid": None,
        },
        "values": {
            "value_type": "",
            "amount": "",
            "unit": None,
            "source_paragraph_id": None,
            "paragraph_uid": None,
        },
    }

    for key, defaults in node_defaults.items():
        raw_items = payload_dict.get(key, [])
        if raw_items is None:
            continue
        if not isinstance(raw_items, list):
            raw_items = [raw_items]
        for idx, item in enumerate(raw_items, start=1):
            if item is None:
                continue
            item_dict = _payload_to_dict(item) if not isinstance(item, dict) else dict(item)
            node_id = str(item_dict.get("id") or "").strip() or f"{key}_{idx}"
            row = {"id": node_id}
            for field, default in defaults.items():
                val = item_dict.get(field, default)
                if val is None:
                    row[field] = None
                else:
                    row[field] = str(val) if isinstance(val, (int, float, bool)) else val
            if key == "clauses":
                paragraph_uid = str(row.get("paragraph_uid") or "").strip()
                if not paragraph_uid:
                    paragraph_uid = _paragraph_uid_from_text(row.get("text"))
                row["paragraph_uid"] = paragraph_uid or None
            cleaned[key].append(row)

    raw_edges = payload_dict.get("edges", [])
    if raw_edges is None:
        raw_edges = []
    if not isinstance(raw_edges, list):
        raw_edges = [raw_edges]

    stats["raw_edges"] = len(raw_edges)
    for edge in raw_edges:
        if edge is None:
            continue
        edge_dict = _payload_to_dict(edge) if not isinstance(edge, dict) else dict(edge)
        src = str(edge_dict.get("source_id") or "").strip()
        tgt = str(edge_dict.get("target_id") or "").strip()
        if not src or not tgt:
            stats["dropped_edges_invalid_endpoint"] += 1
            continue
        edge_type = _normalize_edge_type(edge_dict.get("type"))
        if not edge_type:
            stats["dropped_edges_invalid_type"] += 1
            continue
        evidence = str(edge_dict.get("evidence") or "").strip()
        confidence_raw = edge_dict.get("confidence")
        confidence: Optional[float] = None
        if confidence_raw is not None:
            try:
                confidence = float(confidence_raw)
            except Exception:
                confidence = None
        if RELATION_EVIDENCE_REQUIRED and not evidence:
            stats["dropped_edges_missing_evidence"] += 1
            continue
        if confidence is None or confidence < RELATION_CONFIDENCE_THRESHOLD:
            stats["dropped_edges_low_confidence"] += 1
            continue
        cleaned["edges"].append(
            {
                "source_id": src,
                "target_id": tgt,
                "type": edge_type,
                "evidence": evidence,
                "confidence": confidence,
            }
        )
    stats["normalized_edges"] = len(cleaned["edges"])
    return cleaned, stats


def _build_clause_nodes_from_base_graph(
    base_graph: dict[str, Any],
) -> list[dict[str, Any]]:
    clauses: list[dict[str, Any]] = []
    for node in _ordered_base_nodes(base_graph):
        base_id = str(node.get("id", "")).strip()
        text = str(node.get("text", "")).strip()
        if not base_id or not text:
            continue
        paragraph_uid = str(node.get("paragraph_uid") or "").strip() or _paragraph_uid_from_text(text)
        clauses.append(
            {
                "id": base_id,
                "title": base_id,
                "text": text,
                "clause_level": None,
                "source_paragraph_id": base_id,
                "paragraph_uid": paragraph_uid or None,
            }
        )
    return clauses


def _normalize_entity_key(value: Any) -> str:
    text = _normalize_text_for_uid(value)
    return re.sub(r"\s+", " ", text).strip()


def _dedupe_entities_by_canonical_key(
    payload_dict: dict[str, Any],
    *,
    keys: list[tuple[str, str]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    stats = {
        "id_remaps": 0,
        "parties_merged": 0,
        "defined_terms_merged": 0,
    }
    id_remap: dict[str, str] = {}

    for collection, text_field in keys:
        items = payload_dict.get(collection, [])
        if not isinstance(items, list) or not items:
            continue
        merged: list[dict[str, Any]] = []
        index: dict[str, dict[str, Any]] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            raw_id = str(item.get("id") or "").strip()
            canon = _normalize_entity_key(item.get(text_field))
            if not canon:
                payload_fingerprint = sha1(
                    json.dumps(item, sort_keys=True, ensure_ascii=False).encode("utf-8")
                ).hexdigest()[:12]
                canon = f"__id__:{raw_id or payload_fingerprint}"
            if canon not in index:
                index[canon] = item
                merged.append(item)
                continue
            keeper = index[canon]
            keeper_id = str(keeper.get("id") or "").strip()
            if raw_id and keeper_id and raw_id != keeper_id:
                id_remap[raw_id] = keeper_id
                stats["id_remaps"] += 1
            for k, v in item.items():
                if k == "id":
                    continue
                if keeper.get(k) in (None, "", []):
                    keeper[k] = v
            if collection == "parties":
                stats["parties_merged"] += 1
            elif collection == "defined_terms":
                stats["defined_terms_merged"] += 1
        payload_dict[collection] = merged

    if id_remap:
        edges = payload_dict.get("edges", [])
        for edge in edges if isinstance(edges, list) else []:
            if not isinstance(edge, dict):
                continue
            src = str(edge.get("source_id") or "").strip()
            tgt = str(edge.get("target_id") or "").strip()
            if src in id_remap:
                edge["source_id"] = id_remap[src]
            if tgt in id_remap:
                edge["target_id"] = id_remap[tgt]

    stats["id_remap_examples"] = dict(list(id_remap.items())[:10])
    return payload_dict, stats


def _anchor_entities_to_clauses(
    payload_dict: dict[str, Any],
    base_node_index: dict[str, dict[str, str]],
) -> tuple[dict[str, Any], dict[str, int]]:
    stats = {
        "entity_anchor_resolved": 0,
        "entity_anchor_missing": 0,
        "entity_is_part_of_edges_added": 0,
    }
    if not base_node_index:
        return payload_dict, stats

    uid_to_base_ids: dict[str, list[str]] = {}
    for base_id, meta in base_node_index.items():
        uid = str(meta.get("paragraph_uid") or "")
        if uid:
            uid_to_base_ids.setdefault(uid, []).append(base_id)

    clause_ids = {
        str(clause.get("id") or "").strip()
        for clause in payload_dict.get("clauses", [])
        if isinstance(clause, dict) and str(clause.get("id") or "").strip()
    }
    edges = payload_dict.get("edges", [])
    if not isinstance(edges, list):
        edges = []
        payload_dict["edges"] = edges

    existing_edge_keys = {
        (
            str(edge.get("source_id") or "").strip(),
            str(edge.get("type") or "").strip().upper(),
            str(edge.get("target_id") or "").strip(),
        )
        for edge in edges
        if isinstance(edge, dict)
    }

    entity_collections = [
        "defined_terms",
        "parties",
        "obligations",
        "rights",
        "prohibitions",
        "conditions",
        "references",
        "values",
    ]
    for collection in entity_collections:
        for entity in payload_dict.get(collection, []) if isinstance(payload_dict.get(collection), list) else []:
            if not isinstance(entity, dict):
                continue
            entity_id = str(entity.get("id") or "").strip()
            if not entity_id:
                continue
            source_paragraph_id = str(entity.get("source_paragraph_id") or "").strip()
            paragraph_uid = str(entity.get("paragraph_uid") or "").strip()
            if collection == "defined_terms" and not source_paragraph_id:
                source_paragraph_id = str(entity.get("definition_clause_id") or "").strip()

            resolved_clause_id = ""
            if source_paragraph_id and source_paragraph_id in base_node_index:
                resolved_clause_id = source_paragraph_id
            elif paragraph_uid:
                matched_ids = uid_to_base_ids.get(paragraph_uid, [])
                if len(matched_ids) == 1:
                    resolved_clause_id = matched_ids[0]

            if resolved_clause_id:
                resolved_uid = str(base_node_index.get(resolved_clause_id, {}).get("paragraph_uid") or "").strip()
                entity["source_paragraph_id"] = resolved_clause_id
                entity["paragraph_uid"] = resolved_uid or paragraph_uid or None
                stats["entity_anchor_resolved"] += 1
                if resolved_clause_id in clause_ids:
                    key = (entity_id, "IS_PART_OF", resolved_clause_id)
                    if key not in existing_edge_keys:
                        edges.append(
                            {
                                "source_id": entity_id,
                                "target_id": resolved_clause_id,
                                "type": "IS_PART_OF",
                                "evidence": f"Anchored from source paragraph {resolved_clause_id}",
                                "confidence": 1.0,
                            }
                        )
                        existing_edge_keys.add(key)
                        stats["entity_is_part_of_edges_added"] += 1
            else:
                stats["entity_anchor_missing"] += 1

    return payload_dict, stats


def _canonicalize_ref(value: Any) -> str:
    if value is None:
        return ""
    s = str(value).strip().lower()
    if not s:
        return ""
    s = s.replace("§", " ")
    s = re.sub(r"^[\s\"'`“”]*(section|sec\.?|article|art\.?|clause|cl\.?|paragraph|para\.?)\s+", "", s)
    s = re.sub(r"[\"'`“”]", "", s)
    s = re.sub(r"\b(section|sec\.?|article|art\.?|clause|cl\.?|paragraph|para\.?)\b", " ", s)
    s = re.sub(r"\s*([().:/-])\s*", r"\1", s)
    s = re.sub(r"\s+", "", s).strip(" .;,:-_")
    return s


def _extract_clause_tokens(text: str) -> list[str]:
    if not text:
        return []
    pattern = re.compile(r"\b\d+(?:\.\d+)*(?:\([a-z0-9]+\))?\b", re.IGNORECASE)
    return pattern.findall(text)


def _compact_alias(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"[^a-z0-9]+", "", str(value).lower())


def _clause_parent_keys(token: str) -> list[str]:
    token = (token or "").strip()
    if not token:
        return []
    keys: list[str] = [token]
    no_paren = re.sub(r"\([a-z0-9]+\)$", "", token, flags=re.IGNORECASE)
    if no_paren and no_paren not in keys:
        keys.append(no_paren)
    parts = no_paren.split(".")
    while len(parts) > 1:
        parts = parts[:-1]
        parent = ".".join(parts)
        if parent and parent not in keys:
            keys.append(parent)
    return keys


def _resolve_node_ref(
    raw_ref: str,
    raw_to_node: dict[str, str],
    alias_to_nodes: dict[str, set[str]],
    clause_parent_to_nodes: dict[str, set[str]],
) -> tuple[Optional[str], str]:
    if raw_ref in raw_to_node:
        return raw_to_node[raw_ref], "raw_exact"

    exact_ids = alias_to_nodes.get(raw_ref, set())
    if len(exact_ids) == 1:
        return next(iter(exact_ids)), "alias_exact"
    if len(exact_ids) > 1:
        return None, "ambiguous_exact"

    canon = _canonicalize_ref(raw_ref)
    if canon:
        canon_ids = alias_to_nodes.get(canon, set())
        if len(canon_ids) == 1:
            return next(iter(canon_ids)), "alias_canonical"
        if len(canon_ids) > 1:
            return None, "ambiguous_canonical"

    compact = _compact_alias(raw_ref)
    if compact:
        compact_ids = alias_to_nodes.get(compact, set())
        if len(compact_ids) == 1:
            return next(iter(compact_ids)), "alias_compact"
        if len(compact_ids) > 1:
            return None, "ambiguous_compact"

    if canon:
        parent_ids = clause_parent_to_nodes.get(canon, set())
        if len(parent_ids) == 1:
            return next(iter(parent_ids)), "clause_parent"
        if len(parent_ids) > 1:
            return None, "ambiguous_clause_parent"

    return None, "missing"


def _build_rows(
    payload: ContractOntologyKG, content_hash: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    node_rows: list[dict[str, Any]] = []

    def add_node(node_type: str, item: Any, label_key: str) -> None:
        d = _as_dict(item)
        raw_id = d.get("id")
        raw_label = d.get(label_key)
        if raw_label is None or (isinstance(raw_label, str) and not raw_label.strip()):
            raw_label = raw_id or node_type
        label = str(raw_label).strip() or node_type
        fallback = sha1(f"{node_type}:{label}".encode("utf-8")).hexdigest()[:12]
        node_id = _normalize_id(content_hash, node_type, raw_id, fallback)
        props = _props_without_none(d)
        props["id_raw"] = raw_id
        node_rows.append(
            {
                "node_id": node_id,
                "node_type": node_type,
                "label": label,
                "props": props,
            }
        )

    for item in payload.clauses:
        add_node("Clause", item, "title")
    for item in payload.defined_terms:
        add_node("DefinedTerm", item, "term")
    for item in payload.parties:
        add_node("Party", item, "name")
    for item in payload.obligations:
        add_node("Obligation", item, "action")
    for item in payload.rights:
        add_node("Right", item, "action")
    for item in payload.prohibitions:
        add_node("Prohibition", item, "action")
    for item in payload.conditions:
        add_node("Condition", item, "trigger")
    for item in payload.references:
        add_node("Reference", item, "name")
    for item in payload.values:
        add_node("Value", item, "amount")

    raw_to_node: dict[str, str] = {}
    for row in node_rows:
        raw = str(row["props"].get("id_raw") or "")
        if raw and raw not in raw_to_node:
            raw_to_node[raw] = row["node_id"]

    alias_to_nodes: dict[str, set[str]] = {}
    clause_parent_to_nodes: dict[str, set[str]] = {}
    party_rank = 0
    for row in node_rows:
        node_id = row["node_id"]
        node_type = row["node_type"]
        props = row["props"]
        label = row["label"]

        aliases: set[str] = set()
        for candidate in [
            props.get("id_raw"),
            props.get("source_paragraph_id"),
            props.get("paragraph_uid"),
            label,
            props.get("name"),
            props.get("term"),
            props.get("action"),
            props.get("trigger"),
            props.get("citation"),
            props.get("amount"),
        ]:
            if candidate is None:
                continue
            raw_candidate = str(candidate).strip()
            if raw_candidate:
                aliases.add(raw_candidate)
                canon_candidate = _canonicalize_ref(raw_candidate)
                if canon_candidate:
                    aliases.add(canon_candidate)
                    compact_candidate = _compact_alias(canon_candidate)
                    if compact_candidate:
                        aliases.add(compact_candidate)

        if node_type == "Clause":
            for source_text in [str(props.get("id_raw") or ""), str(label), str(props.get("text") or "")]:
                for token in _extract_clause_tokens(source_text):
                    aliases.add(token)
                    canon_token = _canonicalize_ref(token)
                    if canon_token:
                        aliases.add(canon_token)
                        compact_token = _compact_alias(canon_token)
                        if compact_token:
                            aliases.add(compact_token)
                        for parent in _clause_parent_keys(canon_token):
                            clause_parent_to_nodes.setdefault(parent, set()).add(node_id)

        if node_type == "Party":
            party_rank += 1
            party_aliases = {
                f"party-{party_rank}",
                f"party_{party_rank}",
                f"party{party_rank}",
                f"p{party_rank}",
            }
            aliases.update(party_aliases)
            for palias in party_aliases:
                compact = _compact_alias(palias)
                if compact:
                    aliases.add(compact)

        for alias in aliases:
            if not alias:
                continue
            alias_to_nodes.setdefault(alias, set()).add(node_id)

    edge_rows: list[dict[str, Any]] = []
    seen_edges: set[tuple[str, str, str]] = set()
    edge_stats = {
        "edges_input": len(payload.edges),
        "edges_missing_endpoint": 0,
        "edges_id_not_found": 0,
        "edges_ambiguous_alias": 0,
        "edges_duplicate": 0,
        "edges_output": 0,
        "unresolved_examples": [],
    }
    for e in payload.edges:
        ed = _as_dict(e)
        src_raw = str(ed.get("source_id", "")).strip()
        tgt_raw = str(ed.get("target_id", "")).strip()
        if not src_raw or not tgt_raw:
            edge_stats["edges_missing_endpoint"] += 1
            continue
        src_id, src_status = _resolve_node_ref(src_raw, raw_to_node, alias_to_nodes, clause_parent_to_nodes)
        tgt_id, tgt_status = _resolve_node_ref(tgt_raw, raw_to_node, alias_to_nodes, clause_parent_to_nodes)
        if not src_id or not tgt_id:
            edge_stats["edges_id_not_found"] += 1
            if src_status.startswith("ambiguous") or tgt_status.startswith("ambiguous"):
                edge_stats["edges_ambiguous_alias"] += 1
            unresolved_examples = edge_stats["unresolved_examples"]
            if len(unresolved_examples) < 10:
                unresolved_examples.append(
                    {
                        "source_id": src_raw,
                        "target_id": tgt_raw,
                        "source_status": src_status,
                        "target_status": tgt_status,
                        "source_canonical": _canonicalize_ref(src_raw),
                        "target_canonical": _canonicalize_ref(tgt_raw),
                        "type": str(ed.get("type", "")),
                    }
                )
            continue
        rel_type = str(ed.get("type", "")).strip().upper()
        key = (src_id, rel_type, tgt_id)
        if key in seen_edges:
            edge_stats["edges_duplicate"] += 1
            continue
        seen_edges.add(key)
        edge_rows.append(
            {
                "source_id": src_id,
                "target_id": tgt_id,
                "rel_type": rel_type,
                "evidence": ed.get("evidence"),
                "confidence": ed.get("confidence"),
            }
        )

    edge_stats["edges_output"] = len(edge_rows)
    return node_rows, edge_rows, edge_stats


def counters_to_dict(counters: Any) -> dict[str, Any]:
    keys = [
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
    return {k: getattr(counters, k) for k in keys if hasattr(counters, k)}


async def process_graph_json_to_neo4j(
    *,
    graph_json_path: Path,
    ontology_agent: Any,
    neo4j_driver: Any,
    neo4j_database: str,
    force_reprocess: bool = False,
) -> dict[str, Any]:
    base_graph = load_base_graph_json(graph_json_path)
    all_text, base_node_index = _build_extraction_input_from_base_graph(base_graph)

    if not all_text:
        return {"path": str(graph_json_path), "status": "error", "detail": "Empty text built from base graph nodes"}

    content_hash = sha1(all_text.encode("utf-8")).hexdigest()

    if not force_reprocess:
        existing = await neo4j_driver.execute_query(
            EXISTS_QUERY,
            content_hash=content_hash,
            ontology_version=ONTOLOGY_VERSION,
            extraction_version=EXTRACTION_VERSION,
            database_=neo4j_database,
        )
        if existing.records:
            return {
                "path": str(graph_json_path),
                "status": "skipped",
                "reason": "already_processed",
                "content_hash": content_hash,
            }

    extraction_result = await ontology_agent.aextract(
        files=SourceText(
            text_content=all_text,
            filename=graph_json_path.name,
        )
    )

    payload_dict_raw = _payload_to_dict(extraction_result.data)
    payload_dict, payload_stats = _normalize_payload_dict(payload_dict_raw)
    payload_dict["clauses"] = _build_clause_nodes_from_base_graph(base_graph)
    payload_dict, dedupe_stats = _dedupe_entities_by_canonical_key(
        payload_dict,
        keys=[("parties", "name"), ("defined_terms", "term")],
    )
    payload_dict, anchor_stats = _anchor_entities_to_clauses(payload_dict, base_node_index)
    payload = ContractOntologyKG.model_validate(payload_dict)
    node_rows, edge_rows, edge_stats = _build_rows(payload, content_hash=content_hash)

    if force_reprocess:
        await neo4j_driver.execute_query(
            CLEAR_CONTRACT_QUERY,
            content_hash=content_hash,
            database_=neo4j_database,
        )
        await neo4j_driver.execute_query(
            CLEAR_NODES_QUERY,
            content_hash=content_hash,
            database_=neo4j_database,
        )

    c_res = await neo4j_driver.execute_query(
        IMPORT_CONTRACT_QUERY,
        content_hash=content_hash,
        path=str(graph_json_path),
        ontology_version=ONTOLOGY_VERSION,
        extraction_version=EXTRACTION_VERSION,
        database_=neo4j_database,
    )
    n_res = await neo4j_driver.execute_query(
        IMPORT_NODES_QUERY,
        rows=node_rows,
        content_hash=content_hash,
        database_=neo4j_database,
    )
    e_res = await neo4j_driver.execute_query(
        IMPORT_EDGES_QUERY,
        rows=edge_rows,
        database_=neo4j_database,
    )

    return {
        "path": str(graph_json_path),
        "status": "ok",
        "content_hash": content_hash,
        "base_nodes": len(base_graph.get("nodes", [])),
        "base_edges": len(base_graph.get("edges", [])),
        "nodes_extracted": len(node_rows),
        "edges_extracted": len(edge_rows),
        "payload_stats": payload_stats,
        "dedupe_stats": dedupe_stats,
        "anchor_stats": anchor_stats,
        "edge_stats": edge_stats,
        "contract_counters": counters_to_dict(c_res.summary.counters),
        "node_counters": counters_to_dict(n_res.summary.counters),
        "edge_counters": counters_to_dict(e_res.summary.counters),
    }


async def main() -> None:
    load_dotenv(dotenv_path=ENV_PATH)

    llama_api_key = os.environ["LLAMA_CLOUD_API_KEY"]

    neo4j_uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    neo4j_username = os.getenv("NEO4J_USERNAME", "neo4j")
    neo4j_password = os.getenv("NEO4J_PASSWORD", "neo4j_password")
    neo4j_database = os.getenv("NEO4J_DATABASE", "neo4j")

    if not GRAPH_JSON_ROOT.exists():
        raise FileNotFoundError(f"Graph JSON root not found: {GRAPH_JSON_ROOT}")

    json_files = get_graph_json_files(GRAPH_JSON_ROOT)
    selected_paths = get_selected_json_paths(json_files, SELECTED_GRAPH_JSON)
    if MAX_DOCS is not None:
        selected_paths = selected_paths[:MAX_DOCS]

    print(f"Found {len(json_files)} graph JSON files")
    print(f"Selected {len(selected_paths)} graph JSON files")
    for p in selected_paths:
        print("-", p.relative_to(GRAPH_JSON_ROOT))

    extractor = LlamaExtract(api_key=llama_api_key)
    ontology_agent = extractor.create_agent(
        name=f"contract_ontology_kg_{uuid.uuid4()}",
        data_schema=ContractOntologyKG,
        config=ExtractConfig(
            extraction_mode=ExtractMode.BALANCED,
            system_prompt=ONTOLOGY_EXTRACTION_PROMPT,
        ),
    )
    neo4j_driver = AsyncGraphDatabase.driver(neo4j_uri, auth=(neo4j_username, neo4j_password))

    try:
        for query in CONSTRAINTS_QUERY:
            await neo4j_driver.execute_query(query, database_=neo4j_database)

        results_log: list[dict[str, Any]] = []
        for graph_json_path in selected_paths:
            try:
                out = await process_graph_json_to_neo4j(
                    graph_json_path=graph_json_path,
                    ontology_agent=ontology_agent,
                    neo4j_driver=neo4j_driver,
                    neo4j_database=neo4j_database,
                    force_reprocess=FORCE_REPROCESS,
                )
            except Exception as exc:
                out = {"path": str(graph_json_path), "status": "error", "detail": str(exc)}

            results_log.append(out)
            print(
                out.get("status"),
                "|",
                Path(out.get("path", "unknown")).name,
                "| base_nodes:",
                out.get("base_nodes", 0),
                "| base_edges:",
                out.get("base_edges", 0),
                "| nodes:",
                out.get("nodes_extracted", 0),
                "| edges:",
                out.get("edges_extracted", 0),
                "| payload_stats:",
                out.get("payload_stats", {}),
                "| dedupe_stats:",
                out.get("dedupe_stats", {}),
                "| anchor_stats:",
                out.get("anchor_stats", {}),
                "| edge_stats:",
                out.get("edge_stats", {}),
            )
            if out.get("status") == "error":
                print("  detail:", out.get("detail", "unknown"))

        print("\nSummary")
        print("ok:", sum(1 for x in results_log if x.get("status") == "ok"))
        print("skipped:", sum(1 for x in results_log if x.get("status") == "skipped"))
        print("error:", sum(1 for x in results_log if x.get("status") == "error"))
    finally:
        await neo4j_driver.close()


if __name__ == "__main__":
    asyncio.run(main())
