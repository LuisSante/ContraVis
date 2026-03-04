from pydantic import BaseModel, Field
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


AssistantMode = Literal["explain", "quote", "suggest_questions"]
AssistantScope = Literal["selected", "full_contract"]
AssistantProvider = Literal["gemini", "openai"]
AssistantMessageRole = Literal["user", "assistant"]


class AssistantParagraphNode(BaseModel):
    id: str
    text: str
    paragraph_enum: int
    page: int


class AssistantRelatedParagraph(BaseModel):
    id: str
    relationTypes: List[Literal["reference", "semantic_similarity"]] = Field(default_factory=list)
    semanticScore: Optional[float] = None
    references: List[str] = Field(default_factory=list)


class AssistantHistoryMessage(BaseModel):
    role: AssistantMessageRole
    content: str


class AssistantChatRequest(BaseModel):
    documentId: str
    question: str
    mode: AssistantMode = "explain"
    scope: AssistantScope = "selected"
    provider: AssistantProvider = "gemini"
    selectedParagraphId: Optional[str] = None
    relatedParagraphs: List[AssistantRelatedParagraph] = Field(default_factory=list)
    paragraphNodes: List[AssistantParagraphNode]
    history: List[AssistantHistoryMessage] = Field(default_factory=list)


class AssistantCitation(BaseModel):
    id: str
    excerpt: str
    page: Optional[int] = None
    paragraph_enum: Optional[int] = None


class AssistantChatResponse(BaseModel):
    answer: str
    citations: List[AssistantCitation]
    suggestedQuestions: List[str]
    mode: AssistantMode
    scope: AssistantScope
    provider: AssistantProvider
