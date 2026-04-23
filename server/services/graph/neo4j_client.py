from __future__ import annotations

import time
from typing import Any

from utils.config import Config

try:
    from neo4j import GraphDatabase
except Exception:  # pragma: no cover - handled via health response
    GraphDatabase = None

_neo4j_driver = None

def is_neo4j_configured() -> bool:
    return bool(Config.NEO4J_URI and Config.NEO4J_USERNAME and Config.NEO4J_PASSWORD)

def get_neo4j_driver():
    global _neo4j_driver
    if GraphDatabase is None:
        raise RuntimeError("neo4j package is not installed")

    if _neo4j_driver is None:
        _neo4j_driver = GraphDatabase.driver(
            Config.NEO4J_URI,
            auth=(Config.NEO4J_USERNAME, Config.NEO4J_PASSWORD),
        )
    return _neo4j_driver

def close_neo4j_driver() -> None:
    global _neo4j_driver
    if _neo4j_driver is None:
        return
    _neo4j_driver.close()
    _neo4j_driver = None

def check_neo4j_health() -> dict[str, Any]:
    if not is_neo4j_configured():
        return {
            "status": "skipped",
            "configured": False,
            "detail": "NEO4J_URI, NEO4J_USERNAME, or NEO4J_PASSWORD is missing.",
        }

    started = time.perf_counter()
    try:
        driver = get_neo4j_driver()
        driver.verify_connectivity()
        with driver.session(database=Config.NEO4J_DATABASE) as session:
            row = session.run("RETURN 1 AS ok").single()
            ok_value = int(row["ok"]) if row is not None else 0

        latency_ms = round((time.perf_counter() - started) * 1000.0, 2)
        return {
            "status": "ok",
            "configured": True,
            "database": Config.NEO4J_DATABASE,
            "latency_ms": latency_ms,
            "query_ok": ok_value == 1,
        }
    except Exception as exc:
        latency_ms = round((time.perf_counter() - started) * 1000.0, 2)
        return {
            "status": "error",
            "configured": True,
            "database": Config.NEO4J_DATABASE,
            "latency_ms": latency_ms,
            "error": str(exc),
        }
