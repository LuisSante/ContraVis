import logging

from fastapi import APIRouter, HTTPException

from schemas.types import (
    AssistantChatRequest,
    AssistantChatResponse,
    SimplifySelectionRequest,
    SimplifySelectionResponse,
)
from services.assistant.contract_assistant import (
    fix_contradiction_selection,
    generate_assistant_response,
    simplify_paragraph_selection,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/assistant/chat", response_model=AssistantChatResponse)
def assistant_chat(payload: AssistantChatRequest):
    try:
        return generate_assistant_response(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected assistant error")
        raise HTTPException(status_code=500, detail="Failed to generate assistant response") from exc


@router.post("/assistant/simplify", response_model=SimplifySelectionResponse)
def assistant_simplify(payload: SimplifySelectionRequest):
    try:
        return simplify_paragraph_selection(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected simplify error")
        raise HTTPException(status_code=500, detail="Failed to simplify selection") from exc


@router.post("/assistant/fix_contradiction", response_model=SimplifySelectionResponse)
def assistant_fix_contradiction(payload: SimplifySelectionRequest):
    try:
        return fix_contradiction_selection(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected fix-contradiction error")
        raise HTTPException(status_code=500, detail="Failed to fix contradiction") from exc
