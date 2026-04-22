from pydantic import BaseModel, Field
from typing import Any, Literal, List, Optional

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


class KGNode(BaseModel):
    id: str
    contract_id: str
    type: str
    label: str
    source_paragraph_id: Optional[str] = None
    properties: dict[str, Any] = Field(default_factory=dict)


class KGEdge(BaseModel):
    source: str
    target: str
    type: str
    confidence: Optional[float] = None
    evidence_paragraph_id: Optional[str] = None
    evidence: dict[str, Any] = Field(default_factory=dict)


class KGTriple(BaseModel):
    head: str
    relation: str
    tail: str


class KnowledgeGraph(BaseModel):
    schema_version: str
    contract_id: str
    nodes: List[KGNode]
    edges: List[KGEdge]
    triples: List[KGTriple] = Field(default_factory=list)


AssistantMode = Literal["explain", "quote", "suggest_questions"]
AssistantScope = Literal["selected", "full_contract"]
AssistantProvider = Literal["openai", "gemini"]
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
    model: Optional[str] = None
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


class SimplifyEvidence(BaseModel):
    paragraph_id: str
    selection_start: int
    selection_end: int


class SimplifyAudit(BaseModel):
    system_prompt: str
    user_prompt: str
    model_response: str


class SimplifyRelatedParagraph(BaseModel):
    id: str
    text: str
    paragraph_enum: Optional[int] = None
    page: Optional[int] = None
    relationTypes: List[Literal["reference", "semantic_similarity"]] = Field(default_factory=list)
    semanticScore: Optional[float] = None
    references: List[str] = Field(default_factory=list)


class SimplifySelectionRequest(BaseModel):
    documentId: str
    provider: AssistantProvider = "gemini"
    paragraphId: str
    paragraphText: str
    selectionStart: int = 0
    selectionEnd: int = 0
    contradictionReason: Optional[str] = None
    relatedParagraphs: List[SimplifyRelatedParagraph] = Field(default_factory=list)


class SimplifySelectionResponse(BaseModel):
    paragraphId: str
    provider: AssistantProvider
    originalSnippet: str
    simplifiedSnippet: str
    evidence: SimplifyEvidence
    audit: SimplifyAudit


class ContradictionEvidence(BaseModel):
    snippet_a: str = ""
    snippet_b: str = ""
    source_a: Literal["paragraph", "context", "unknown"] = "unknown"
    source_b: Literal["paragraph", "context", "unknown"] = "unknown"
    evidence_status: Literal["exact", "missing", "approximate"] = "missing"
    evidence_note: str = ""


class ContradictionParagraphResult(BaseModel):
    paragraph_id: str
    contradiction: bool
    confidence: int = Field(ge=0, le=100)
    brief_reason: str = ""
    evidence: Optional[ContradictionEvidence] = None


class ContradictionAnalysisRequest(BaseModel):
    documentId: str
    graph: Graph
    provider: AssistantProvider = "openai"
    temperature: float = 0.3
    model: Optional[str] = None


class ContradictionAnalysisResponse(BaseModel):
    documentId: str
    provider: AssistantProvider
    temperature: float
    model: Optional[str] = None
    paragraphResults: List[ContradictionParagraphResult]
    rawResponse: str

class SavedContradictionsResponse(BaseModel):
    documentId: str
    sourceFile: str
    paragraphResults: List[ContradictionParagraphResult]
