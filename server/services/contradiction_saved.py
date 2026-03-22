from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from schemas.types import ContradictionAnalysisResponse, ContradictionParagraphResult
from utils.config import Config


def load_saved_contradictions_for_document(
    document_id: str,
) -> tuple[list[ContradictionParagraphResult], str]:
    base_dir = Config.SAVED_CONTRADICTIONS_DIR
    if not base_dir.exists() or not base_dir.is_dir():
        raise RuntimeError(
            f"Pasta de resultados salvos nao encontrada: {base_dir}"
        )

    json_files = sorted(
        base_dir.glob("*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )

    for json_path in json_files:
        with json_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)

        raw_rows = _extract_rows_for_document(payload, document_id)
        if not raw_rows:
            continue

        normalized = _normalize_rows(raw_rows)
        if normalized:
            return normalized, str(json_path)

    raise RuntimeError(
        f"Ainda nao ha contradicoes salvas para este documento: {document_id}"
    )


def save_analyzed_contradictions(response: ContradictionAnalysisResponse) -> str:
    base_dir = Config.SAVED_CONTRADICTIONS_DIR
    base_dir.mkdir(parents=True, exist_ok=True)

    safe_document_id = _sanitize_filename(response.documentId)
    safe_provider = _sanitize_filename(response.provider)
    output_path = base_dir / f"{safe_document_id}__{safe_provider}_latest.json"

    payload = {
        "documentId": response.documentId,
        "provider": response.provider,
        "temperature": response.temperature,
        "savedAt": datetime.now(timezone.utc).isoformat(),
        "paragraphResults": [
            item.model_dump()
            for item in response.paragraphResults
        ],
        "rawResponse": response.rawResponse,
    }

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return str(output_path)


def _extract_rows_for_document(payload: Any, document_id: str) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        if not _payload_matches_document(payload, document_id):
            return []

        if isinstance(payload.get("paragraph_results"), list):
            return payload["paragraph_results"]

        if isinstance(payload.get("paragraphResults"), list):
            return payload["paragraphResults"]

        if document_id in payload and isinstance(payload[document_id], list):
            return payload[document_id]

        if isinstance(payload.get("results"), list):
            return _filter_rows_by_document_id(payload["results"], document_id)

        if isinstance(payload.get("data"), list):
            return _filter_rows_by_document_id(payload["data"], document_id)

    if isinstance(payload, list):
        return _filter_rows_by_document_id(payload, document_id)

    return []


def _payload_matches_document(payload: dict[str, Any], document_id: str) -> bool:
    target = str(document_id).strip().lower()

    explicit_doc_id = payload.get("documentId") or payload.get("document_id") or payload.get("doc_id")
    if explicit_doc_id is not None:
        return str(explicit_doc_id).strip().lower() == target

    # Legacy shape: {"<documentId>": [...]}.
    if document_id in payload:
        return True

    # No explicit doc identifier -> require row-level filtering keys.
    has_rows = isinstance(payload.get("results"), list) or isinstance(payload.get("data"), list)
    return has_rows


def _filter_rows_by_document_id(rows: list[Any], document_id: str) -> list[dict[str, Any]]:
    dict_rows = [row for row in rows if isinstance(row, dict)]
    if not dict_rows:
        return []

    has_doc_field = any(
        ("doc_id" in row) or ("documentId" in row) or ("document_id" in row)
        for row in dict_rows
    )

    if not has_doc_field:
        has_paragraph = any(("paragraph_id" in row) or ("paragraphId" in row) for row in dict_rows)
        return dict_rows if has_paragraph else []

    normalized_target = str(document_id).strip().lower()
    filtered: list[dict[str, Any]] = []
    for row in dict_rows:
        candidate = (
            row.get("doc_id")
            or row.get("documentId")
            or row.get("document_id")
            or ""
        )
        if str(candidate).strip().lower() == normalized_target:
            filtered.append(row)

    return filtered


def _normalize_rows(rows: list[dict[str, Any]]) -> list[ContradictionParagraphResult]:
    normalized: list[ContradictionParagraphResult] = []

    for row in rows:
        paragraph_id = str(row.get("paragraph_id") or row.get("paragraphId") or "").strip()
        if not paragraph_id:
            continue

        if "contradiction" in row:
            contradiction = bool(row.get("contradiction"))
        else:
            contradiction = int(row.get("label_pred", 0) or 0) == 1

        confidence_raw = row.get("confidence", 0)
        try:
            confidence = int(float(confidence_raw))
        except (TypeError, ValueError):
            confidence = 0
        confidence = max(0, min(100, confidence))

        brief_reason = str(row.get("brief_reason") or row.get("briefReason") or "").strip()

        normalized.append(
            ContradictionParagraphResult(
                paragraph_id=paragraph_id,
                contradiction=contradiction,
                confidence=confidence,
                brief_reason=brief_reason,
            )
        )

    normalized.sort(
        key=lambda item: (
            int(item.paragraph_id) if item.paragraph_id.isdigit() else 10**9,
            item.paragraph_id,
        )
    )
    return normalized


def _sanitize_filename(value: str) -> str:
    normalized = re.sub(r'[<>:"/\\|?*\x00-\x1F]+', "_", value or "").strip()
    return normalized or "document"
