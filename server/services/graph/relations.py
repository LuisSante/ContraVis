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

SEMANTIC_SIMILARITY_THRESHOLD = 0.8
MIN_SEMANTIC_WORDS = 8
MIN_SEMANTIC_CHARS = 45
MAX_BOILERPLATE_WORDS = 24
BOILERPLATE_REPEAT_THRESHOLD = 3
UPPERCASE_HEADING_WORDS = 10

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

    for i in range(len(nodes)):
        current_text = nodes[i].text
        for ref_type, pattern in Config.REFERENCE_PATTERNS:
            matches = pattern.finditer(current_text)
            for match in matches:
                ref_id = match.group(1)
                for target_node in nodes:
                    if target_node.id != nodes[i].id and target_node.text.startswith(ref_id):
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

        for left_local_idx in range(len(semantic_candidate_indices)):
            for right_local_idx in range(left_local_idx + 1, len(semantic_candidate_indices)):
                score = float(cosine_scores[left_local_idx][right_local_idx])
                if score <= SEMANTIC_SIMILARITY_THRESHOLD:
                    continue

                left_idx = semantic_candidate_indices[left_local_idx]
                right_idx = semantic_candidate_indices[right_local_idx]

                if (
                    normalized_text_keys[left_idx]
                    and normalized_text_keys[left_idx] == normalized_text_keys[right_idx]
                ):
                    continue

                edges.append(Edge(
                    source=nodes[left_idx].id,
                    target=nodes[right_idx].id,
                    type="semantic_similarity",
                    score=score
                ))

    relations_map = {}
    for edge in edges:
        relations_map[edge.source] = relations_map.get(edge.source, 0) + 1
        relations_map[edge.target] = relations_map.get(edge.target, 0) + 1
    
    for node in nodes:
        node.relationsCount = relations_map.get(node.id, 0)

    return Graph(nodes=nodes, edges=edges)
