"""Local LLM — Ollama integration for high-frequency low-complexity tasks.

当前用途：记忆抽取（memory_extractor 经 `local_llm.extract_memories`）。
用本地模型降低云 API 成本并强化隐私优先叙事。
"""

from __future__ import annotations

import logging
import os
import time

from openai import AsyncOpenAI

from app.core.agents.fact_parsing import parse_facts_from_text

logger = logging.getLogger(__name__)


class LocalLLM:
    """Wrapper around Ollama for local inference tasks."""

    def __init__(self):
        base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
        self.model = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
        from app.config import settings
        self.client = AsyncOpenAI(
            api_key="ollama",
            base_url=base_url,
            timeout=float(settings.llm_timeout_seconds),
            max_retries=3,
        )

    def _record(
        self,
        *,
        llm_start: float,
        success: bool,
        purpose: str,
        error_message: str | None = None,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
    ) -> None:
        from app.core.agents.brain_telemetry import record_llm_outcome

        record_llm_outcome(
            provider_name="ollama",
            provider_model=self.model,
            llm_start=llm_start,
            success=success,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            error_message=error_message,
            purpose=purpose,
            actor="local_llm",
        )

    async def extract_memories(self, conversation_text: str) -> list[str]:
        """Extract user preferences and facts from conversation."""
        prompt = (
            "Extract key facts and preferences about the user from this conversation. "
            "Return each fact as a separate line. Only extract clear, explicit information.\n\n"
            f"{conversation_text[:3000]}"
        )
        llm_start = time.time()
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
                temperature=0.3,
            )
            text = response.choices[0].message.content or ""
            facts = parse_facts_from_text(text)
            from app.core.agents.token_counter import count_text_tokens

            self._record(
                llm_start=llm_start,
                success=True,
                purpose="memory_extract",
                completion_tokens=count_text_tokens(text),
            )
            return facts
        except Exception as exc:
            logger.warning("Ollama memory extraction failed: %s", exc)
            self._record(
                llm_start=llm_start,
                success=False,
                purpose="memory_extract",
                error_message=str(exc)[:500],
            )
            return []


local_llm = LocalLLM()
