from sentence_transformers import SentenceTransformer, util
from collections import Counter
# from ...utils.config import Config
from utils.config import Config
from schemas.types import Graph, Node, Edge
from typing import List

import json
import os
import re
import logging

logger = logging.getLogger(__name__)

MIN_SEMANTIC_WORDS = 8
MIN_SEMANTIC_CHARS = 45
MAX_BOILERPLATE_WORDS = 24
BOILERPLATE_REPEAT_THRESHOLD = 3
UPPERCASE_HEADING_WORDS = 10

REFERENCE_PREFIX_BY_TYPE = {
    "section": "section",
    "article": "article",
    "exhibit": "exhibit",
    "schedule": "schedule",
    "annex": "annex",
    "appendix": "appendix",
}
ARTICLE_HEADING_PATTERN = re.compile(r"^(?:article)\s+(\d+(?:\.\d+)*)\b", re.IGNORECASE)
SECTION_HEADING_WITH_KEYWORD_PATTERN = re.compile(
    r"^(?:section|clause)\s+(\d+(?:\.\d+)*)\b",
    re.IGNORECASE,
)
SECTION_HEADING_NUMERIC_PATTERN = re.compile(r"^(\d+(?:\.\d+)*)\b")

def create_folder(folder):
    if not os.path.exists(folder):
        os.makedirs(folder)

def read_txt(path_txt):
    with open(path_txt, 'r', encoding='utf-8') as f:
        txt = f.read()
    return txt

def write_json(path_struct_graph, final_json):
    with open(path_struct_graph, 'w', encoding='utf-8') as f:
        json.dump(final_json, f, indent=4)

    return final_json

def is_lower(sentences):
    char = sentences[0]
    if char.islower():
        return True
    return False

def is_number_page(ssentences):
    if len(ssentences) <= 2:
        if ssentences.isdigit():
            return True
    return False

def isHeader_or_isFooter(text):
    paragraphs = [p for p in text.split('\n') if p.strip() != '']
    paragraphs = [p for p in paragraphs if is_number_page(p) == False]

    paragraph_counts = Counter(paragraphs)
    
    repeated_paragraphs = [
        paragraph 
        for paragraph, count in paragraph_counts.items() 
        if count > 2
    ]
    
    return repeated_paragraphs

def isInit_paragraph_page(header_footer, sentences, text):
    for i in range(len(text)):
        if (sentences in text[i]) and (text[i-1] in header_footer) and (is_number_page(text[i-2]) == True):
            return True
    return False

def isParagraph_curt(header_footer, sentences, text):
    for i in range(len(text)):
        if (isInit_paragraph_page(header_footer, sentences, text) and (text[i-3][0] != text[i])):
            return True
    return False

def create_nodes(text):
    header_footer = isHeader_or_isFooter(text)
    paragraphs = [p for p in text.split('\n') if p.strip() != '']

    for p in range(len(paragraphs)):
        if p >= 3:
            if isParagraph_curt(header_footer, paragraphs[p], paragraphs):
                paragraphs[p-3] = paragraphs[p-3] + ' ' + paragraphs[p]
                paragraphs[p] = ''
            elif is_lower(paragraphs[p]):
                paragraphs[p-3] = paragraphs[p-3] + ' ' + paragraphs[p]
                paragraphs[p] = ''

    paragraphs = [p for p in paragraphs if is_number_page(p) == False]
    paragraphs = [p for p in paragraphs if p != '']

    return paragraphs


def normalize_for_match(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def has_reference_prefix(candidate_text: str, ref_id: str) -> bool:
    if not candidate_text.startswith(ref_id):
        return False

    if len(candidate_text) == len(ref_id):
        return True

    next_char = candidate_text[len(ref_id)]
    last_ref_char = ref_id[-1]

    if last_ref_char.isdigit():
        return not next_char.isdigit()
    if last_ref_char.isalpha():
        return not next_char.isalpha()

    return True


def target_starts_with_reference(target_text: str, ref_type: str, ref_id: str) -> bool:
    normalized_target = normalize_for_match(target_text)
    normalized_ref = normalize_for_match(ref_id)
    if not normalized_target or not normalized_ref:
        return False

    keyword = REFERENCE_PREFIX_BY_TYPE.get(ref_type)
    lowered_target = normalized_target.lower()
    if keyword:
        keyword_prefix = f"{keyword} "
        if lowered_target.startswith(keyword_prefix):
            ref_candidate = normalized_target[len(keyword_prefix):].lstrip()
            if has_reference_prefix(ref_candidate, normalized_ref):
                return True

    return has_reference_prefix(normalized_target, normalized_ref)


def extract_heading_meta(text: str) -> dict | None:
    normalized = normalize_for_match(text)
    if not normalized:
        return None

    article_match = ARTICLE_HEADING_PATTERN.match(normalized)
    if article_match:
        ref_id = article_match.group(1)
        return {
            "type": "article",
            "ref_id": ref_id,
            "level": ref_id.count(".") + 1,
            "root": ref_id.split(".")[0],
        }

    section_match = SECTION_HEADING_WITH_KEYWORD_PATTERN.match(normalized)
    if section_match:
        ref_id = section_match.group(1)
        return {
            "type": "section",
            "ref_id": ref_id,
            "level": ref_id.count(".") + 1,
            "root": ref_id.split(".")[0],
        }

    section_numeric_match = SECTION_HEADING_NUMERIC_PATTERN.match(normalized)
    if section_numeric_match:
        ref_id = section_numeric_match.group(1)
        return {
            "type": "section",
            "ref_id": ref_id,
            "level": ref_id.count(".") + 1,
            "root": ref_id.split(".")[0],
        }

    return None


def is_self_heading_reference(
    *,
    heading_meta: dict | None,
    ref_type: str,
    ref_id: str,
    match_start: int,
) -> bool:
    if heading_meta is None:
        return False

    # Match is very close to the start and equals the heading identifier.
    # Example: "Article 1 DEFINITIONS..." should not create outgoing references
    # to every 1.x paragraph just because of its own title.
    if match_start > 24:
        return False

    heading_type = str(heading_meta.get("type", ""))
    heading_ref_id = str(heading_meta.get("ref_id", ""))
    if not heading_type or not heading_ref_id:
        return False

    return heading_type == ref_type and heading_ref_id == ref_id


def expand_reference_scope_indices(
    *,
    nodes: list[Node],
    heading_by_index: dict[int, dict],
    ref_type: str,
    ref_id: str,
    heading_index: int,
) -> set[int]:
    scoped_indices: set[int] = {heading_index}
    heading = heading_by_index.get(heading_index)
    if heading is None:
        return scoped_indices

    # For Section references, include the heading and its content block until the next sibling/parent.
    if ref_type == "section":
        ref_level = ref_id.count(".") + 1
        for idx in range(heading_index + 1, len(nodes)):
            candidate_heading = heading_by_index.get(idx)
            if candidate_heading is None:
                scoped_indices.add(idx)
                continue

            if candidate_heading["type"] == "article":
                break

            candidate_ref_id = candidate_heading["ref_id"]
            candidate_level = candidate_heading["level"]
            if candidate_ref_id == ref_id or candidate_ref_id.startswith(f"{ref_id}."):
                scoped_indices.add(idx)
                continue

            if candidate_level <= ref_level:
                break

            scoped_indices.add(idx)

        return scoped_indices

    # For Article references, include headings/paragraphs under the same article root.
    if ref_type == "article":
        article_root = ref_id.split(".")[0]
        for idx in range(heading_index + 1, len(nodes)):
            candidate_heading = heading_by_index.get(idx)
            if candidate_heading is None:
                scoped_indices.add(idx)
                continue

            if candidate_heading["type"] == "article":
                if candidate_heading["root"] != article_root:
                    break
                scoped_indices.add(idx)
                continue

            # section-like heading
            if candidate_heading["root"] != article_root and candidate_heading["level"] <= 2:
                break

            scoped_indices.add(idx)

        return scoped_indices

    return scoped_indices


def should_skip_semantic_similarity(text: str, repeat_count: int) -> bool:
    normalized = normalize_for_match(text)
    if not normalized:
        return True

    words = [token for token in normalized.split(" ") if token]
    if len(words) < MIN_SEMANTIC_WORDS:
        return True
    if len(normalized) < MIN_SEMANTIC_CHARS:
        return True

    alpha_only = re.sub(r"[^A-Za-z]+", "", normalized)
    if alpha_only and alpha_only.isupper() and len(words) <= UPPERCASE_HEADING_WORDS:
        return True

    if repeat_count >= BOILERPLATE_REPEAT_THRESHOLD and len(words) <= MAX_BOILERPLATE_WORDS:
        return True

    return False


def generate_graph_data(paragraphs_data: list) -> Graph:
    model = SentenceTransformer('all-MiniLM-L6-v2')
    nodes: List[Node] = []
    edges: List[Edge] = []
    
    for p in paragraphs_data:
        node = Node(
            id=str(p.get("id")),
            documentId=str(p.get("documentId")),
            text=p.get("text", "").strip(),
            paragraph_enum=p.get("paragraph_enum", 0),
            page=p.get("page", 0),
            relationsCount=0,
            x=p.get("x", 0.0),
            y=p.get("y", 0.0),
            fontSize=p.get("fontSize", 0.0)
        )
        nodes.append(node)

    normalized_text_keys = [normalize_for_match(node.text).lower() for node in nodes]
    normalized_counts = Counter([key for key in normalized_text_keys if key])
    
    logger.info(f"TOTAL NODES {len(nodes)}")

    seen_reference_edges: set[tuple[str, str, str, str]] = set()
    heading_by_index: dict[int, dict] = {}
    for idx, node in enumerate(nodes):
        heading_meta = extract_heading_meta(node.text)
        if heading_meta is not None:
            heading_by_index[idx] = heading_meta

    for i in range(len(nodes)):
        current_text = nodes[i].text
        current_heading_meta = heading_by_index.get(i)
        for ref_type, pattern in Config.REFERENCE_PATTERNS:
            matches = pattern.finditer(current_text)
            for match in matches:
                ref_id = match.group(1)
                if is_self_heading_reference(
                    heading_meta=current_heading_meta,
                    ref_type=ref_type,
                    ref_id=ref_id,
                    match_start=match.start(),
                ):
                    continue
                direct_target_indices: set[int] = set()
                for target_idx, target_node in enumerate(nodes):
                    if target_node.id == nodes[i].id:
                        continue
                    if not target_starts_with_reference(target_node.text, ref_type, ref_id):
                        continue
                    direct_target_indices.add(target_idx)

                expanded_target_indices: set[int] = set(direct_target_indices)
                if ref_type in {"section", "article"}:
                    for target_idx in direct_target_indices:
                        if target_idx not in heading_by_index:
                            continue
                        expanded_target_indices.update(
                            expand_reference_scope_indices(
                                nodes=nodes,
                                heading_by_index=heading_by_index,
                                ref_type=ref_type,
                                ref_id=ref_id,
                                heading_index=target_idx,
                            )
                        )

                for target_idx in sorted(expanded_target_indices):
                    target_node = nodes[target_idx]
                    if target_node.id == nodes[i].id:
                        continue

                    edge_key = (nodes[i].id, target_node.id, ref_type, ref_id)
                    if edge_key in seen_reference_edges:
                        continue
                    seen_reference_edges.add(edge_key)

                    edges.append(Edge(
                        source=nodes[i].id,
                        target=target_node.id,
                        type="reference",
                        ref_label=ref_type,
                        ref_value=ref_id
                    ))

    semantic_candidate_indices = []
    for idx, node in enumerate(nodes):
        text_key = normalized_text_keys[idx]
        repeat_count = normalized_counts.get(text_key, 0)
        if should_skip_semantic_similarity(node.text, repeat_count):
            continue
        semantic_candidate_indices.append(idx)

    if semantic_candidate_indices:
        semantic_texts = [nodes[idx].text for idx in semantic_candidate_indices]
        embeddings = model.encode(semantic_texts, convert_to_tensor=True)
        cosine_scores = util.cos_sim(embeddings, embeddings)
        semantic_threshold = float(Config.SEMANTIC_SIMILARITY_THRESHOLD)
        semantic_mode = str(Config.SEMANTIC_RELATED_MODE).strip().lower()

        pair_score_by_indices: dict[tuple[int, int], float] = {}

        if semantic_mode == "all":
            for left_local_idx in range(len(semantic_candidate_indices)):
                for right_local_idx in range(left_local_idx + 1, len(semantic_candidate_indices)):
                    score = float(cosine_scores[left_local_idx][right_local_idx])
                    if score <= semantic_threshold:
                        continue

                    left_idx = semantic_candidate_indices[left_local_idx]
                    right_idx = semantic_candidate_indices[right_local_idx]

                    if (
                        normalized_text_keys[left_idx]
                        and normalized_text_keys[left_idx] == normalized_text_keys[right_idx]
                    ):
                        continue

                    pair = (left_idx, right_idx) if left_idx < right_idx else (right_idx, left_idx)
                    previous = pair_score_by_indices.get(pair)
                    if previous is None or score > previous:
                        pair_score_by_indices[pair] = score
        else:
            semantic_top_k = max(1, int(Config.SEMANTIC_TOP_K))
            for left_local_idx in range(len(semantic_candidate_indices)):
                candidates: list[tuple[int, float]] = []
                for right_local_idx in range(len(semantic_candidate_indices)):
                    if right_local_idx == left_local_idx:
                        continue

                    score = float(cosine_scores[left_local_idx][right_local_idx])
                    if score <= semantic_threshold:
                        continue

                    left_idx = semantic_candidate_indices[left_local_idx]
                    right_idx = semantic_candidate_indices[right_local_idx]
                    if (
                        normalized_text_keys[left_idx]
                        and normalized_text_keys[left_idx] == normalized_text_keys[right_idx]
                    ):
                        continue

                    candidates.append((right_local_idx, score))

                candidates.sort(key=lambda item: item[1], reverse=True)
                for right_local_idx, score in candidates[:semantic_top_k]:
                    left_idx = semantic_candidate_indices[left_local_idx]
                    right_idx = semantic_candidate_indices[right_local_idx]
                    pair = (left_idx, right_idx) if left_idx < right_idx else (right_idx, left_idx)
                    previous = pair_score_by_indices.get(pair)
                    if previous is None or score > previous:
                        pair_score_by_indices[pair] = score

        for (left_idx, right_idx), score in sorted(pair_score_by_indices.items()):
            edges.append(Edge(
                source=nodes[left_idx].id,
                target=nodes[right_idx].id,
                type="semantic_similarity",
                score=score
            ))

    relations_map: dict[str, set[str]] = {}
    for edge in edges:
        source_neighbors = relations_map.setdefault(edge.source, set())
        source_neighbors.add(edge.target)

        target_neighbors = relations_map.setdefault(edge.target, set())
        target_neighbors.add(edge.source)
    
    for node in nodes:
        node.relationsCount = len(relations_map.get(node.id, set()))

    return Graph(nodes=nodes, edges=edges)
