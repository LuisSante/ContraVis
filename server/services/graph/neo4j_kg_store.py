from __future__ import annotations

import json
from typing import Any

from schemas.types import KnowledgeGraph
from services.graph.neo4j_client import get_neo4j_driver, is_neo4j_configured
from utils.config import Config


def _to_neo4j_compatible(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        out: list[Any] = []
        for item in value:
            if item is None or isinstance(item, (str, int, float, bool)):
                out.append(item)
            else:
                out.append(json.dumps(item, ensure_ascii=False))
        return out
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _build_node_rows(kg: KnowledgeGraph, document_id: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for node in kg.nodes:
        properties: dict[str, Any] = {
            "id": node.id,
            "contract_id": node.contract_id,
            "document_id": document_id,
            "node_type": node.type,
            "label": node.label,
            "source_paragraph_id": node.source_paragraph_id,
            "schema_version": kg.schema_version,
        }
        for key, value in (node.properties or {}).items():
            properties[key] = _to_neo4j_compatible(value)
        rows.append(properties)
    return rows


def _build_edge_rows(kg: KnowledgeGraph) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for edge in kg.edges:
        row = {
            "source": edge.source,
            "target": edge.target,
            "edge_key": f"{edge.source}|{edge.type}|{edge.target}",
            "edge_type": edge.type,
            "confidence": edge.confidence,
            "evidence_paragraph_id": edge.evidence_paragraph_id,
            "evidence_json": json.dumps(edge.evidence or {}, ensure_ascii=False),
        }
        rows.append(row)
    return rows


def upsert_knowledge_graph_to_neo4j(*, document_id: str, kg: KnowledgeGraph) -> dict[str, Any]:
    if not is_neo4j_configured():
        return {
            "enabled": True,
            "status": "skipped",
            "detail": "Neo4j is not configured.",
        }

    driver = get_neo4j_driver()
    node_rows = _build_node_rows(kg, document_id=document_id)
    edge_rows = _build_edge_rows(kg)

    with driver.session(database=Config.NEO4J_DATABASE) as session:
        session.run(
            "CREATE CONSTRAINT kg_node_id_unique IF NOT EXISTS "
            "FOR (n:KGNode) REQUIRE n.id IS UNIQUE"
        )
        session.run(
            "CREATE INDEX kg_node_contract_id_idx IF NOT EXISTS "
            "FOR (n:KGNode) ON (n.contract_id)"
        )
        session.run(
            "MATCH (n:KGNode {contract_id: $contract_id}) DETACH DELETE n",
            contract_id=kg.contract_id,
        )
        session.run(
            """
            UNWIND $rows AS row
            MERGE (n:KGNode {id: row.id})
            SET n = row
            """,
            rows=node_rows,
        )
        session.run(
            """
            UNWIND $rows AS row
            MATCH (s:KGNode {id: row.source})
            MATCH (t:KGNode {id: row.target})
            MERGE (s)-[r:KG_EDGE {edge_key: row.edge_key}]->(t)
            SET r.type = row.edge_type,
                r.confidence = row.confidence,
                r.evidence_paragraph_id = row.evidence_paragraph_id,
                r.evidence_json = row.evidence_json
            """,
            rows=edge_rows,
        )

    return {
        "enabled": True,
        "status": "ok",
        "database": Config.NEO4J_DATABASE,
        "contract_id": kg.contract_id,
        "nodes_written": len(node_rows),
        "edges_written": len(edge_rows),
    }
