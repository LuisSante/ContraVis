from typing import Literal, Optional
from pydantic import BaseModel
from schemas.common import AssistantProvider
from schemas.assistant import AssistantChatRequest, SimplifySelectionRequest
from schemas.contradictions import ContradictionAnalysisRequest


LlmEstimateCallType = Literal[
    "assistant_chat",
    "assistant_simplify",
    "assistant_fix_contradiction",
    "contradictions_analyze",
]


class LlmEstimateRequest(BaseModel):
    callType: LlmEstimateCallType
    assistantChat: Optional[AssistantChatRequest] = None
    simplifySelection: Optional[SimplifySelectionRequest] = None
    contradictionAnalysis: Optional[ContradictionAnalysisRequest] = None


class LlmEstimateResponse(BaseModel):
    callType: LlmEstimateCallType
    provider: AssistantProvider
    model: str
    estimatedInputTokens: int
    estimatedOutputTokens: int
    estimatedTotalTokens: int
    estimatedCostUsd: Optional[float] = None
    estimatedCostUsdFormatted: str


class LlmUsageTotalResponse(BaseModel):
    totalCostUsd: float
    totalCostUsdFormatted: str
