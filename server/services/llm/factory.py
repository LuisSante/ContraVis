from __future__ import annotations

import os
from dotenv import load_dotenv

from services.llm.base import LLMProvider
from services.llm.gemini_provider import GeminiProvider
from services.llm.openai_provider import OpenAIProvider
from logging import getLogger
load_dotenv()

logger = getLogger(__name__)

class LLMProviderFactory:
    _cache: dict[str, LLMProvider] = {}

    @classmethod
    def create(cls, provider_name: str) -> LLMProvider:
        normalized = (provider_name or "").strip().lower() or "gemini"

        if normalized in cls._cache:
            return cls._cache[normalized]

        if normalized == "gemini":
            api_key = os.getenv("GEMINI_API_KEY")
            logger.info(api_key)
            if not api_key:
                raise RuntimeError("GEMINI_API_KEY is not configured")
            provider = GeminiProvider(api_key=api_key)
            cls._cache[normalized] = provider
            return provider

        if normalized == "openai":
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise RuntimeError("OPENAI_API_KEY is not configured")
            provider = OpenAIProvider(api_key=api_key)
            cls._cache[normalized] = provider
            return provider

        raise RuntimeError(f"Unsupported provider: {provider_name}")
