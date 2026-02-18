from pydantic import BaseModel
from typing import Literal, List, Optional

class DatasetDocument(BaseModel):
    id: str
    name: str
    full_path: str
    origin: Literal['dataset', 'upload']
    processed: bool

class Node(BaseModel):
    id: str
    documentId: str
    text: str
    paragraph_enum: int
    page: int
    relationsCount: int = 0
    x: Optional[float] = None
    y: Optional[float] = None
    fontSize: Optional[float] = None

class Edge(BaseModel):
    source: str
    target: str
    type: str
    score: Optional[float] = None
    ref_label: Optional[str] = None
    ref_value: Optional[str] = None

class Graph(BaseModel):
    nodes: List[Node]
    edges: List[Edge]
