from typing import Literal

from pydantic import BaseModel


class DatasetDocument(BaseModel):
    id: str
    name: str
    full_path: str
    relative_path: str = ""
    group_label: str = "root"
    display_name: str = ""
    origin: Literal['dataset', 'upload']
    processed: bool


class Node(BaseModel):
    id: str
    documentId: str
    text: str
    paragraph_enum: int
    page: int
    relationsCount: int = 0


class Edge(BaseModel):
    source: str
    target: str
    type: str
    score: float | None = None
    ref_label: str | None = None
    ref_value: str | None = None


class Graph(BaseModel):
    nodes: list[Node]
    edges: list[Edge]
