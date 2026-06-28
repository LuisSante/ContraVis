from typing import List, Literal, Optional
from pydantic import BaseModel, Field
from schemas.common import (
    AssistantMessageRole,
    AssistantMode,
    AssistantProvider,
    AssistantScope,
)


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
