from __future__ import annotations

from hashlib import sha1
import re
from typing import Any, Optional

from schemas.types import Graph, KGEdge, KGNode, KGTriple, KnowledgeGraph


CLAUSE_HEADER_PATTERN = re.compile(
    r"^(?:(?P<prefix>section|clause|article)\s+)?"
    r"(?P<clause_id>(?:\d+(?:\.\d+){0,4}|[IVXLC]{1,8}(?:\.[IVXLC]{1,8}){0,2}))"
    r"(?:(?:\)|\.|:|-)\s*|\s+)"
    r"(?P<title>[^.;\n]{0,160})",
    re.IGNORECASE,
)
DEFINITION_PATTERN = re.compile(
    r'(?:"(?P<term_q1>[^"]{2,80})"|\'(?P<term_q2>[^\']{2,80})\'|(?P<term_caps>[A-Z][A-Za-z0-9&/\- ]{1,80}))\s+'
    r"(?:(?i:means|shall mean|refers to))\s+(?P<definition>[^.;]{3,260})"
)
QUOTED_TERM_PATTERN = re.compile(r'"([^"]{2,80})"')
PARTY_KEYWORD_PATTERN = re.compile(
    r"\b("
    r"Party\s+[A-Z]|Supplier|Buyer|Seller|Licensee|Licensor|Client|Customer|"
    r"Disclosing Party|Receiving Party|Employer|Employee|Contractor|Consultant"
    r")\b"
)
ORG_PARTY_PATTERN = re.compile(
    r"\b([A-Z][A-Za-z0-9,&.\-]*(?:\s+[A-Z][A-Za-z0-9,&.\-]*){0,6}\s+"
    r"(?:Inc\.?|LLC|Ltd\.?|Corporation|Corp\.?|Company|Co\.?))\b"
)
PARTY_ROLE_PATTERN = re.compile(
    r"\b(Buyer|Seller|Supplier|Licensee|Licensor|Client|Customer|Distributor|Contractor|Consultant)\b",
    re.IGNORECASE,
)
ADDRESS_PATTERN = re.compile(
    r"\b(?:located at|address(?:ed)? at|principal place of business at)\s+([^.;]{8,140})",
    re.IGNORECASE,
)
CONDITION_PATTERN = re.compile(r"\b(if|unless|provided that|subject to)\b", re.IGNORECASE)
OBLIGATION_PATTERN = re.compile(r"\b(shall|must|will)\b", re.IGNORECASE)
RIGHT_PATTERN = re.compile(r"\b(may|is entitled to|has the right to)\b", re.IGNORECASE)
PROHIBITION_PATTERN = re.compile(r"\b(shall not|must not|may not|is prohibited from)\b", re.IGNORECASE)
AMENDS_PATTERN = re.compile(
    r"\b(amend(?:s|ed|ment)?|modif(?:y|ies|ied|ication)|revis(?:e|es|ed|ion))\b",
    re.IGNORECASE,
)
SUPERSEDES_PATTERN = re.compile(
    r"\b(supersed(?:e|es|ed|ing)|overrid(?:e|es|den)|prevail(?:s)? over|order of precedence)\b",
    re.IGNORECASE,
)

ISO_REFERENCE_PATTERN = re.compile(r"\bISO\s+\d{3,5}(?::\d{4})?\b", re.IGNORECASE)
LAW_REFERENCE_PATTERN = re.compile(
    r"\b(?:Section|Article)\s+\d+(?:\.\d+)*\s+of\s+the\s+([A-Z][A-Za-z ]{2,70}(?:Act|Code|Law|Regulation))\b"
)

CURRENCY_VALUE_PATTERN = re.compile(
    r"(?:(?P<symbol>\$)\s?(?P<amount_a>\d[\d,]*(?:\.\d+)?)|"
    r"(?P<amount_b>\d[\d,]*(?:\.\d+)?)\s*(?P<currency_b>USD|EUR|GBP))",
    re.IGNORECASE,
)
PERCENT_VALUE_PATTERN = re.compile(r"\b(?P<amount>\d+(?:\.\d+)?)\s*%\b")
TIME_VALUE_PATTERN = re.compile(
    r"\b(?P<amount>\d+)\s*(?P<unit>day|days|month|months|year|years|business days?)\b",
    re.IGNORECASE,
)
DATE_VALUE_PATTERN = re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b")


STOPWORDS = {
    "shall",
    "must",
    "may",
    "will",
    "not",
    "be",
    "to",
    "the",
    "a",
    "an",
    "is",
    "are",
    "of",
    "and",
    "or",
    "for",
    "with",
    "by",
    "within",
}


def _safe_token(value: str) -> str:
    token = re.sub(r"[^a-zA-Z0-9_-]+", "_", (value or "").strip())
    token = re.sub(r"_+", "_", token).strip("_")
    return token or "unknown"


def _normalize_label(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _compact_text(value: str, max_len: int = 120) -> str:
    normalized = _normalize_label(value)
    if len(normalized) <= max_len:
        return normalized
    return f"{normalized[: max_len - 3].rstrip()}..."


def _entity_id(contract_id: str, node_type: str, label: str, scope_key: Optional[str] = None) -> str:
    base = f"{node_type.lower()}::{_normalize_label(label).lower()}"
    if scope_key:
        base = f"{base}::{scope_key}"
    digest = sha1(base.encode("utf-8")).hexdigest()[:12]
    return f"{_safe_token(contract_id)}:{node_type.lower()}:{digest}"


def _split_sentences(text: str) -> list[str]:
    chunks = re.split(r"(?<=[.;])\s+|\n+", text)
    return [_normalize_label(chunk) for chunk in chunks if _normalize_label(chunk)]


def _sentence_with_pattern(text: str, pattern: re.Pattern[str]) -> str:
    for sentence in _split_sentences(text):
        if pattern.search(sentence):
            return sentence
    return _compact_text(text, max_len=140)


def _action_signature(text: str) -> str:
    tokens = [token for token in re.findall(r"[a-z]+", text.lower()) if token not in STOPWORDS]
    if not tokens:
        return ""
    return " ".join(tokens[:8])


def _token_set(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z]+", text.lower()) if token not in STOPWORDS}


def _signatures_overlap(left: str, right: str) -> bool:
    if not left or not right:
        return False
    if left == right:
        return True
    left_tokens = _token_set(left)
    right_tokens = _token_set(right)
    if not left_tokens or not right_tokens:
        return False
    overlap = len(left_tokens.intersection(right_tokens))
    return overlap >= 2


def _extract_clause_metadata(text: str) -> dict[str, Any]:
    normalized = _normalize_label(text)
    if not normalized:
        return {"identifier": "", "title": "", "level": 1, "section_id": ""}

    match = CLAUSE_HEADER_PATTERN.match(normalized)
    if not match:
        return {"identifier": "", "title": "", "level": 1, "section_id": ""}

    prefix = (match.group("prefix") or "").lower()
    identifier = _normalize_label(match.group("clause_id") or "")
    title = _normalize_label(match.group("title") or "")
    if not identifier:
        return {"identifier": "", "title": "", "level": 1, "section_id": ""}

    if not prefix and "." not in identifier and identifier.isdigit() and int(identifier) > 50:
        return {"identifier": "", "title": "", "level": 1, "section_id": ""}

    level = max(1, identifier.count(".") + 1)
    section_id = identifier.split(".")[0] if identifier else ""
    return {
        "identifier": identifier,
        "title": _compact_text(title, max_len=100),
        "level": level,
        "section_id": section_id,
    }


def _extract_defined_terms(text: str) -> list[dict[str, str]]:
    terms: list[dict[str, str]] = []
    for match in DEFINITION_PATTERN.finditer(text):
        term = _normalize_label(
            match.group("term_q1") or match.group("term_q2") or match.group("term_caps") or ""
        )
        definition = _normalize_label(match.group("definition") or "")
        if not term:
            continue
        terms.append({"term": term, "definition": definition})
    return terms


def _extract_party_mentions(text: str) -> list[dict[str, str]]:
    candidates = set(match.group(1) for match in PARTY_KEYWORD_PATTERN.finditer(text))
    candidates.update(match.group(1) for match in ORG_PARTY_PATTERN.finditer(text))
    global_roles = [match.group(1).title() for match in PARTY_ROLE_PATTERN.finditer(text)]
    address_match = ADDRESS_PATTERN.search(text)
    shared_address = _normalize_label(address_match.group(1)) if address_match else ""

    parties: list[dict[str, str]] = []
    seen_names: set[str] = set()
    for raw_name in sorted(candidates):
        name = _normalize_label(raw_name)
        if not name:
            continue
        lowered = name.lower()
        if lowered in seen_names:
            continue
        seen_names.add(lowered)

        role = ""
        if PARTY_ROLE_PATTERN.fullmatch(name):
            role = name.title()
        else:
            nearby_role_match = re.search(
                re.escape(name) + r"[^.;:\n]{0,90}\(([^)]{2,40})\)",
                text,
                re.IGNORECASE,
            )
            if nearby_role_match:
                maybe_role = _normalize_label(nearby_role_match.group(1)).title()
                if PARTY_ROLE_PATTERN.search(maybe_role):
                    role = maybe_role
            if not role and global_roles:
                role = global_roles[0]

        parties.append({"name": name, "role": role, "address": shared_address})
    return parties


def _extract_values(text: str) -> list[dict[str, str]]:
    values: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str]] = set()

    def push(item: dict[str, str]) -> None:
        key = (
            item.get("type", ""),
            item.get("amount", ""),
            item.get("unit", ""),
            item.get("label", ""),
        )
        if key in seen:
            return
        seen.add(key)
        values.append(item)

    for match in CURRENCY_VALUE_PATTERN.finditer(text):
        amount = _normalize_label(match.group("amount_a") or match.group("amount_b") or "")
        if not amount:
            continue
        unit = _normalize_label(match.group("currency_b") or ("USD" if match.group("symbol") else ""))
        label = f"${amount}" if match.group("symbol") else f"{amount} {unit}".strip()
        push({"type": "Currency", "amount": amount, "unit": unit, "label": label})

    for match in PERCENT_VALUE_PATTERN.finditer(text):
        amount = _normalize_label(match.group("amount") or "")
        if not amount:
            continue
        push({"type": "Percentage", "amount": amount, "unit": "%", "label": f"{amount}%"})

    for match in TIME_VALUE_PATTERN.finditer(text):
        amount = _normalize_label(match.group("amount") or "")
        unit = _normalize_label(match.group("unit") or "").lower()
        if not amount or not unit:
            continue
        push({"type": "Time", "amount": amount, "unit": unit, "label": f"{amount} {unit}"})

    for match in DATE_VALUE_PATTERN.finditer(text):
        label = _normalize_label(match.group(0))
        if not label:
            continue
        push({"type": "Date", "amount": label, "unit": "date", "label": label})

    return values


def _extract_external_references(text: str) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    seen: set[str] = set()

    for match in ISO_REFERENCE_PATTERN.finditer(text):
        label = _normalize_label(match.group(0))
        key = f"iso::{label.lower()}"
        if key in seen:
            continue
        seen.add(key)
        refs.append({"name": label, "citation": label})

    for match in LAW_REFERENCE_PATTERN.finditer(text):
        name = _normalize_label(match.group(1))
        citation = _normalize_label(match.group(0))
        key = f"law::{name.lower()}::{citation.lower()}"
        if key in seen:
            continue
        seen.add(key)
        refs.append({"name": name, "citation": citation})

    return refs


def _operator_from_condition(text: str) -> str:
    match = CONDITION_PATTERN.search(text)
    if not match:
        return ""
    value = match.group(1).lower()
    if value == "if":
        return "IF_THEN"
    if value == "unless":
        return "UNLESS"
    if value == "provided that":
        return "PROVIDED_THAT"
    if value == "subject to":
        return "SUBJECT_TO"
    return value.upper()


def build_knowledge_graph(
    *,
    document_id: str,
    paragraph_graph: Graph,
    schema_version: str,
) -> KnowledgeGraph:
    contract_id = _safe_token(document_id)
    contract_node_id = f"{contract_id}:contract"

    nodes_by_id: dict[str, KGNode] = {}
    edges: list[KGEdge] = []
    edge_keys: set[tuple[str, str, str]] = set()

    clause_id_by_paragraph_id: dict[str, str] = {}
    clause_record_by_id: dict[str, dict[str, Any]] = {}
    defined_terms_by_key: dict[str, str] = {}
    clause_action_facts: dict[str, list[dict[str, Any]]] = {}

    contradiction_candidate_pairs: set[tuple[str, str]] = set()

    def add_node(node: KGNode) -> KGNode:
        existing = nodes_by_id.get(node.id)
        if existing is None:
            nodes_by_id[node.id] = node
            return node

        if node.source_paragraph_id and not existing.source_paragraph_id:
            existing.source_paragraph_id = node.source_paragraph_id
        for key, value in node.properties.items():
            if key not in existing.properties:
                existing.properties[key] = value
            elif existing.properties.get(key) in {"", None} and value not in {"", None}:
                existing.properties[key] = value
        return existing

    def add_edge(edge: KGEdge) -> None:
        key = (edge.source, edge.target, edge.type)
        if key in edge_keys:
            return
        edge_keys.add(key)
        edges.append(edge)

    add_node(
        KGNode(
            id=contract_node_id,
            contract_id=contract_id,
            type="Contract",
            label=document_id,
            properties={"document_id": document_id},
        )
    )

    paragraph_nodes = sorted(
        paragraph_graph.nodes,
        key=lambda node: (int(node.page or 0), int(node.paragraph_enum or 0)),
    )

    # Pass 1: create structural nodes and hierarchy.
    for paragraph_node in paragraph_nodes:
        paragraph_id = str(paragraph_node.id)
        text = _normalize_label(paragraph_node.text)
        meta = _extract_clause_metadata(text)

        clause_identifier = meta.get("identifier") or str(paragraph_node.paragraph_enum)
        clause_title = meta.get("title") or ""
        clause_level = int(meta.get("level") or 1)
        section_identifier = meta.get("section_id") or ""

        clause_id = f"{contract_id}:clause:{_safe_token(paragraph_id)}"
        clause_id_by_paragraph_id[paragraph_id] = clause_id
        clause_record_by_id[clause_id] = {
            "paragraph_id": paragraph_id,
            "text": text,
            "clause_identifier": clause_identifier,
            "clause_title": clause_title,
            "clause_level": clause_level,
            "section_identifier": section_identifier,
        }

        add_node(
            KGNode(
                id=clause_id,
                contract_id=contract_id,
                type="Clause",
                label=f"Clause {clause_identifier}",
                source_paragraph_id=paragraph_id,
                properties={
                    "id": clause_identifier,
                    "title": clause_title,
                    "text": text,
                    "clause_level": clause_level,
                    "paragraph_id": paragraph_id,
                    "paragraph_enum": paragraph_node.paragraph_enum,
                    "page": paragraph_node.page,
                },
            )
        )

        if section_identifier:
            section_id = _entity_id(contract_id, "Section", section_identifier)
            add_node(
                KGNode(
                    id=section_id,
                    contract_id=contract_id,
                    type="Section",
                    label=f"Section {section_identifier}",
                    source_paragraph_id=paragraph_id,
                    properties={
                        "id": section_identifier,
                        "title": clause_title,
                    },
                )
            )
            add_edge(
                KGEdge(
                    source=contract_node_id,
                    target=section_id,
                    type="CONTAINS",
                    confidence=1.0,
                    evidence_paragraph_id=paragraph_id,
                )
            )
            add_edge(
                KGEdge(
                    source=section_id,
                    target=contract_node_id,
                    type="IS_PART_OF",
                    confidence=1.0,
                    evidence_paragraph_id=paragraph_id,
                )
            )
            add_edge(
                KGEdge(
                    source=section_id,
                    target=clause_id,
                    type="CONTAINS",
                    confidence=1.0,
                    evidence_paragraph_id=paragraph_id,
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=section_id,
                    type="IS_PART_OF",
                    confidence=1.0,
                    evidence_paragraph_id=paragraph_id,
                )
            )
        else:
            add_edge(
                KGEdge(
                    source=contract_node_id,
                    target=clause_id,
                    type="CONTAINS",
                    confidence=1.0,
                    evidence_paragraph_id=paragraph_id,
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=contract_node_id,
                    type="IS_PART_OF",
                    confidence=1.0,
                    evidence_paragraph_id=paragraph_id,
                )
            )

    # Pass 2: define terms first (so USES can resolve globally).
    for clause_id, record in clause_record_by_id.items():
        text = record["text"]
        paragraph_id = record["paragraph_id"]

        for item in _extract_defined_terms(text):
            term = item["term"]
            definition = item["definition"]
            term_id = defined_terms_by_key.get(term.lower()) or _entity_id(contract_id, "DefinedTerm", term)
            defined_terms_by_key[term.lower()] = term_id

            add_node(
                KGNode(
                    id=term_id,
                    contract_id=contract_id,
                    type="DefinedTerm",
                    label=term,
                    source_paragraph_id=paragraph_id,
                    properties={
                        "term": term,
                        "definition": definition,
                        "definition_clause": clause_id,
                    },
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=term_id,
                    type="CONTAINS",
                    confidence=0.95,
                    evidence_paragraph_id=paragraph_id,
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=term_id,
                    type="DEFINES",
                    confidence=0.95,
                    evidence_paragraph_id=paragraph_id,
                )
            )

    # Pass 3: semantic entities, actions, and local relationships.
    for clause_id, record in clause_record_by_id.items():
        paragraph_id = record["paragraph_id"]
        text = record["text"]
        if not text:
            clause_action_facts[clause_id] = []
            continue

        clause_action_ids: list[str] = []
        clause_condition_ids: list[str] = []
        clause_value_ids: list[str] = []
        clause_party_ids: list[str] = []
        action_facts: list[dict[str, Any]] = []

        # USES terms from quoted mentions and known dictionary terms.
        for match in QUOTED_TERM_PATTERN.finditer(text):
            term = _normalize_label(match.group(1))
            if not term:
                continue
            term_id = defined_terms_by_key.get(term.lower())
            if not term_id:
                continue
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=term_id,
                    type="USES",
                    confidence=0.8,
                    evidence_paragraph_id=paragraph_id,
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=term_id,
                    type="CONTAINS",
                    confidence=0.7,
                    evidence_paragraph_id=paragraph_id,
                )
            )

        for term_key, term_id in defined_terms_by_key.items():
            term = nodes_by_id.get(term_id).label if nodes_by_id.get(term_id) else term_key
            if not term:
                continue
            if re.search(rf"\b{re.escape(term)}\b", text, re.IGNORECASE):
                add_edge(
                    KGEdge(
                        source=clause_id,
                        target=term_id,
                        type="USES",
                        confidence=0.75,
                        evidence_paragraph_id=paragraph_id,
                    )
                )

        for party in _extract_party_mentions(text):
            party_name = party["name"]
            party_id = _entity_id(contract_id, "Party", party_name)
            clause_party_ids.append(party_id)
            add_node(
                KGNode(
                    id=party_id,
                    contract_id=contract_id,
                    type="Party",
                    label=party_name,
                    source_paragraph_id=paragraph_id,
                    properties={
                        "name": party_name,
                        "role": party.get("role", ""),
                        "address": party.get("address", ""),
                    },
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=party_id,
                    type="CONTAINS",
                    confidence=0.85,
                    evidence_paragraph_id=paragraph_id,
                )
            )

        values = _extract_values(text)
        for value in values:
            value_id = _entity_id(
                contract_id,
                "Value",
                f"{value['type']}::{value['amount']}::{value['unit']}::{value['label']}",
            )
            clause_value_ids.append(value_id)
            add_node(
                KGNode(
                    id=value_id,
                    contract_id=contract_id,
                    type="Value",
                    label=value["label"],
                    source_paragraph_id=paragraph_id,
                    properties={
                        "type": value["type"],
                        "amount": value["amount"],
                        "unit": value["unit"],
                    },
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=value_id,
                    type="CONTAINS",
                    confidence=0.85,
                    evidence_paragraph_id=paragraph_id,
                )
            )

        for external_ref in _extract_external_references(text):
            ref_label = _normalize_label(external_ref.get("name") or external_ref.get("citation") or "")
            if not ref_label:
                continue
            ref_id = _entity_id(contract_id, "Reference", ref_label)
            add_node(
                KGNode(
                    id=ref_id,
                    contract_id=contract_id,
                    type="Reference",
                    label=ref_label,
                    source_paragraph_id=paragraph_id,
                    properties={
                        "name": external_ref.get("name", ""),
                        "citation": external_ref.get("citation", ""),
                    },
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=ref_id,
                    type="REFERENCES",
                    confidence=0.8,
                    evidence_paragraph_id=paragraph_id,
                )
            )

        if CONDITION_PATTERN.search(text):
            trigger = _sentence_with_pattern(text, CONDITION_PATTERN)
            condition_id = _entity_id(contract_id, "Condition", trigger, scope_key=clause_id)
            clause_condition_ids.append(condition_id)
            add_node(
                KGNode(
                    id=condition_id,
                    contract_id=contract_id,
                    type="Condition",
                    label=_compact_text(trigger),
                    source_paragraph_id=paragraph_id,
                    properties={
                        "trigger": trigger,
                        "operator": _operator_from_condition(text),
                    },
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=condition_id,
                    type="CONTAINS",
                    confidence=0.8,
                    evidence_paragraph_id=paragraph_id,
                )
            )

        first_party = clause_party_ids[0] if clause_party_ids else ""
        time_values = [value for value in values if value["type"] in {"Time", "Date"}]

        if PROHIBITION_PATTERN.search(text):
            snippet = _sentence_with_pattern(text, PROHIBITION_PATTERN)
            action = _compact_text(snippet, max_len=140)
            prohibition_id = _entity_id(contract_id, "Prohibition", action, scope_key=clause_id)
            clause_action_ids.append(prohibition_id)
            add_node(
                KGNode(
                    id=prohibition_id,
                    contract_id=contract_id,
                    type="Prohibition",
                    label=action,
                    source_paragraph_id=paragraph_id,
                    properties={
                        "action": action,
                        "subject": first_party,
                    },
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=prohibition_id,
                    type="CONTAINS",
                    confidence=0.9,
                    evidence_paragraph_id=paragraph_id,
                )
            )
            for party_id in clause_party_ids:
                add_edge(
                    KGEdge(
                        source=prohibition_id,
                        target=party_id,
                        type="PROHIBITS",
                        confidence=0.85,
                        evidence_paragraph_id=paragraph_id,
                    )
                )
            action_facts.append(
                {
                    "kind": "Prohibition",
                    "polarity": -1,
                    "signature": _action_signature(snippet),
                    "snippet": snippet,
                    "party_ids": set(clause_party_ids),
                    "time_values": time_values,
                }
            )

        if RIGHT_PATTERN.search(text):
            snippet = _sentence_with_pattern(text, RIGHT_PATTERN)
            action = _compact_text(snippet, max_len=140)
            right_id = _entity_id(contract_id, "Right", action, scope_key=clause_id)
            clause_action_ids.append(right_id)
            add_node(
                KGNode(
                    id=right_id,
                    contract_id=contract_id,
                    type="Right",
                    label=action,
                    source_paragraph_id=paragraph_id,
                    properties={
                        "action": action,
                        "holder": first_party,
                        "frequency": time_values[0]["label"] if time_values else "",
                    },
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=right_id,
                    type="CONTAINS",
                    confidence=0.88,
                    evidence_paragraph_id=paragraph_id,
                )
            )
            for party_id in clause_party_ids:
                add_edge(
                    KGEdge(
                        source=right_id,
                        target=party_id,
                        type="GRANTS_RIGHT_TO",
                        confidence=0.8,
                        evidence_paragraph_id=paragraph_id,
                    )
                )
            action_facts.append(
                {
                    "kind": "Right",
                    "polarity": 1,
                    "signature": _action_signature(snippet),
                    "snippet": snippet,
                    "party_ids": set(clause_party_ids),
                    "time_values": time_values,
                }
            )

        if OBLIGATION_PATTERN.search(text):
            snippet = _sentence_with_pattern(text, OBLIGATION_PATTERN)
            action = _compact_text(snippet, max_len=140)
            obligation_id = _entity_id(contract_id, "Obligation", action, scope_key=clause_id)
            clause_action_ids.append(obligation_id)
            add_node(
                KGNode(
                    id=obligation_id,
                    contract_id=contract_id,
                    type="Obligation",
                    label=action,
                    source_paragraph_id=paragraph_id,
                    properties={
                        "action": action,
                        "actor": first_party,
                        "deadline": time_values[0]["label"] if time_values else "",
                    },
                )
            )
            add_edge(
                KGEdge(
                    source=clause_id,
                    target=obligation_id,
                    type="CONTAINS",
                    confidence=0.88,
                    evidence_paragraph_id=paragraph_id,
                )
            )
            for party_id in clause_party_ids:
                add_edge(
                    KGEdge(
                        source=obligation_id,
                        target=party_id,
                        type="ASSIGNS_OBLIGATION_TO",
                        confidence=0.82,
                        evidence_paragraph_id=paragraph_id,
                    )
                )
            action_facts.append(
                {
                    "kind": "Obligation",
                    "polarity": 1,
                    "signature": _action_signature(snippet),
                    "snippet": snippet,
                    "party_ids": set(clause_party_ids),
                    "time_values": time_values,
                }
            )

        for action_id in clause_action_ids:
            for condition_id in clause_condition_ids:
                add_edge(
                    KGEdge(
                        source=action_id,
                        target=condition_id,
                        type="DEPENDS_ON",
                        confidence=0.75,
                        evidence_paragraph_id=paragraph_id,
                    )
                )
            for value_id in clause_value_ids:
                add_edge(
                    KGEdge(
                        source=action_id,
                        target=value_id,
                        type="DEPENDS_ON",
                        confidence=0.7,
                        evidence_paragraph_id=paragraph_id,
                    )
                )

        clause_action_facts[clause_id] = action_facts

    # Bridge current paragraph graph edges and derive amendment/precedence semantics.
    for paragraph_edge in paragraph_graph.edges:
        source_paragraph = str(paragraph_edge.source)
        target_paragraph = str(paragraph_edge.target)
        source_clause = clause_id_by_paragraph_id.get(source_paragraph)
        target_clause = clause_id_by_paragraph_id.get(target_paragraph)
        if not source_clause or not target_clause:
            continue

        source_text = clause_record_by_id.get(source_clause, {}).get("text", "")

        if paragraph_edge.type == "reference":
            ref_label = _normalize_label(
                f"{paragraph_edge.ref_label or 'reference'} {paragraph_edge.ref_value or ''}"
            ).strip()
            ref_node_id = _entity_id(contract_id, "Reference", ref_label or "reference")
            add_node(
                KGNode(
                    id=ref_node_id,
                    contract_id=contract_id,
                    type="Reference",
                    label=ref_label or "Reference",
                    source_paragraph_id=source_paragraph,
                    properties={
                        "name": paragraph_edge.ref_label or "reference",
                        "citation": paragraph_edge.ref_value or "",
                    },
                )
            )
            add_edge(
                KGEdge(
                    source=source_clause,
                    target=ref_node_id,
                    type="CONTAINS",
                    confidence=1.0,
                    evidence_paragraph_id=source_paragraph,
                )
            )
            add_edge(
                KGEdge(
                    source=source_clause,
                    target=target_clause,
                    type="REFERENCES",
                    confidence=1.0,
                    evidence_paragraph_id=source_paragraph,
                )
            )
            if AMENDS_PATTERN.search(source_text):
                add_edge(
                    KGEdge(
                        source=source_clause,
                        target=target_clause,
                        type="MODIFIES_AMENDS",
                        confidence=0.8,
                        evidence_paragraph_id=source_paragraph,
                    )
                )
            if SUPERSEDES_PATTERN.search(source_text):
                add_edge(
                    KGEdge(
                        source=source_clause,
                        target=target_clause,
                        type="SUPERSEDES",
                        confidence=0.82,
                        evidence_paragraph_id=source_paragraph,
                    )
                )
            if CONDITION_PATTERN.search(source_text):
                add_edge(
                    KGEdge(
                        source=source_clause,
                        target=target_clause,
                        type="DEPENDS_ON",
                        confidence=0.72,
                        evidence_paragraph_id=source_paragraph,
                    )
                )

        elif paragraph_edge.type == "semantic_similarity":
            add_edge(
                KGEdge(
                    source=source_clause,
                    target=target_clause,
                    type="SEMANTIC_SIMILARITY",
                    confidence=paragraph_edge.score,
                    evidence_paragraph_id=source_paragraph,
                )
            )
            if (paragraph_edge.score or 0) >= 0.82:
                left, right = sorted([source_clause, target_clause])
                contradiction_candidate_pairs.add((left, right))

    # Add CONTRADICTS edges from action-level logical conflicts.
    for left_clause, right_clause in sorted(contradiction_candidate_pairs):
        left_actions = clause_action_facts.get(left_clause, [])
        right_actions = clause_action_facts.get(right_clause, [])
        if not left_actions or not right_actions:
            continue

        contradiction_reason = ""
        evidence_a = ""
        evidence_b = ""
        confidence = 0.0

        for left_action in left_actions:
            for right_action in right_actions:
                if not _signatures_overlap(left_action.get("signature", ""), right_action.get("signature", "")):
                    continue

                left_parties = set(left_action.get("party_ids", set()))
                right_parties = set(right_action.get("party_ids", set()))
                if left_parties and right_parties and not left_parties.intersection(right_parties):
                    continue

                left_polarity = int(left_action.get("polarity", 0))
                right_polarity = int(right_action.get("polarity", 0))

                if left_polarity * right_polarity < 0:
                    contradiction_reason = "Opposite deontic polarity on a similar action."
                    evidence_a = left_action.get("snippet", "")
                    evidence_b = right_action.get("snippet", "")
                    confidence = 0.8
                    break

                left_times = [
                    (value.get("amount", ""), value.get("unit", ""))
                    for value in left_action.get("time_values", [])
                    if value.get("type") in {"Time", "Date"}
                ]
                right_times = [
                    (value.get("amount", ""), value.get("unit", ""))
                    for value in right_action.get("time_values", [])
                    if value.get("type") in {"Time", "Date"}
                ]
                for left_time in left_times:
                    for right_time in right_times:
                        if left_time[1] and left_time[1] == right_time[1] and left_time[0] != right_time[0]:
                            contradiction_reason = "Conflicting time value for a similar action."
                            evidence_a = left_action.get("snippet", "")
                            evidence_b = right_action.get("snippet", "")
                            confidence = 0.74
                            break
                    if contradiction_reason:
                        break

                if contradiction_reason:
                    break
            if contradiction_reason:
                break

        if not contradiction_reason:
            continue

        left_paragraph = clause_record_by_id.get(left_clause, {}).get("paragraph_id", "")
        right_paragraph = clause_record_by_id.get(right_clause, {}).get("paragraph_id", "")
        add_edge(
            KGEdge(
                source=left_clause,
                target=right_clause,
                type="CONTRADICTS",
                confidence=confidence or 0.7,
                evidence_paragraph_id=f"{left_paragraph}|{right_paragraph}".strip("|"),
                evidence={
                    "reason": contradiction_reason,
                    "paragraph_left": left_paragraph,
                    "paragraph_right": right_paragraph,
                    "snippet_left": evidence_a,
                    "snippet_right": evidence_b,
                },
            )
        )

    sorted_nodes = sorted(nodes_by_id.values(), key=lambda item: (item.type, item.id))
    sorted_edges = sorted(
        edges,
        key=lambda item: (item.type, item.source, item.target, item.evidence_paragraph_id or ""),
    )
    triples = [KGTriple(head=edge.source, relation=edge.type, tail=edge.target) for edge in sorted_edges]

    return KnowledgeGraph(
        schema_version=schema_version,
        contract_id=contract_id,
        nodes=sorted_nodes,
        edges=sorted_edges,
        triples=triples,
    )
