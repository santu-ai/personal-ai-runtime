"""Local LLM — Ollama integration for high-frequency low-complexity tasks.

当前用途：记忆抽取（memory_extractor 经 `local_llm.extract_memories`）。
用本地模型降低云 API 成本并强化隐私优先叙事。
"""

from __future__ import annotations

import logging

from app.core.agents.fact_parsing import parse_facts_from_text

logger = logging.getLogger(__name__)


class LocalLLM:
    """Wrapper around Ollama for local inference tasks."""

    async def extract_memories(self, conversation_text: str) -> list[str]:
        """Extract user preferences and facts from conversation."""
        prompt = (
            "Extract durable, specific facts and preferences about the user. "
            "One fact per line, no bullets. Max 3 facts. "
            "Skip ephemeral chatter, questions, greetings, and vague statements.\n\n"
            f"{conversation_text[:3000]}"
        )
        try:
            from app.core.agents.brain_llm_ops import complete_text_with_failover

            text, _provider = await complete_text_with_failover(
                [{"role": "user", "content": prompt}],
                purpose="memory_extract",
                temperature=0.3,
                max_tokens=200,
                provider_name="ollama",
                actor="local_llm",
            )
            return parse_facts_from_text(text)
        except Exception as exc:
            logger.warning("Ollama memory extraction failed: %s", exc)
            return []


local_llm = LocalLLM()
