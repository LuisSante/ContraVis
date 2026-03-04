from __future__ import annotations

from typing import Any

from services.llm.base import LLMProvider


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
