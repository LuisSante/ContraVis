from __future__ import annotations

import logging
from typing import Any

from services.llm.base import LLMProvider

logger = logging.getLogger(__name__)

MODEL_PRICING_USD_PER_1M: dict[str, dict[str, float]] = {
    "gpt-4.1": {"input": 2.0, "output": 8.0},
    "gpt-4.1-2025-04-14": {"input": 2.0, "output": 8.0},
    "gpt-4_1-2025-04-14": {"input": 2.0, "output": 8.0},
}


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self, *, api_key: str, model: str = "gpt-4o-mini"):
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError(
                "OpenAI provider requires the `openai` package. Install dependencies and retry."
            ) from exc

        self._client = OpenAI(api_key=api_key)
        self._model = model

    def generate(self, *, system_prompt: str, user_prompt: str, temperature: float = 0.2) -> str:
        try:
            response = self._client.chat.completions.create(
                model=self._model,
                temperature=temperature,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
        except Exception as exc:
            raise RuntimeError(f"OpenAI request failed: {exc}") from exc

        self._log_usage(response)

        content = self._extract_content(response)
        if not content:
            raise RuntimeError("OpenAI returned an empty response")
        return content

    @staticmethod
    def _extract_content(response: Any) -> str:
        choices = getattr(response, "choices", None)
        if not isinstance(choices, list) or not choices:
            return ""

        message = getattr(choices[0], "message", None)
        if message is None:
            return ""

        content = getattr(message, "content", None)
        if isinstance(content, str):
            return content.strip()

        if isinstance(content, list):
            parts: list[str] = []
            for chunk in content:
                text = chunk.get("text") if isinstance(chunk, dict) else None
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
            return "\n".join(parts).strip()

        return ""

    def _log_usage(self, response: Any) -> None:
        usage = getattr(response, "usage", None)
        if usage is None:
            return

        prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        total_tokens = int(
            getattr(usage, "total_tokens", prompt_tokens + completion_tokens) or 0
        )

        effective_model = str(getattr(response, "model", self._model) or self._model)
        estimated_cost = _estimate_model_cost_usd(
            model_name=effective_model,
            input_tokens=prompt_tokens,
            output_tokens=completion_tokens,
        )

        logger.info(
            (
                "OpenAI usage model=%s prompt_tokens=%d completion_tokens=%d "
                "total_tokens=%d est_cost_usd=%s"
            ),
            effective_model,
            prompt_tokens,
            completion_tokens,
            total_tokens,
            _format_cost(estimated_cost),
        )


def _estimate_model_cost_usd(*, model_name: str, input_tokens: int, output_tokens: int) -> float | None:
    rates = _resolve_model_rates(model_name)
    if rates is None:
        return None

    return (
        (input_tokens / 1_000_000.0) * rates["input"]
        + (output_tokens / 1_000_000.0) * rates["output"]
    )


def _resolve_model_rates(model_name: str) -> dict[str, float] | None:
    normalized = (model_name or "").strip().lower()
    if not normalized:
        return None

    if normalized in MODEL_PRICING_USD_PER_1M:
        return MODEL_PRICING_USD_PER_1M[normalized]

    normalized_alt = normalized.replace(".", "_")
    if normalized_alt in MODEL_PRICING_USD_PER_1M:
        return MODEL_PRICING_USD_PER_1M[normalized_alt]

    if normalized.startswith("gpt-4.1-"):
        return MODEL_PRICING_USD_PER_1M["gpt-4.1"]

    if normalized.startswith("gpt-4_1-"):
        return MODEL_PRICING_USD_PER_1M["gpt-4.1"]

    return None


def _format_cost(cost: float | None) -> str:
    if cost is None:
        return "unknown"
    return f"{cost:.6f}"
