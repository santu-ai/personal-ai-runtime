"""Memory Extractor — automatic fact extraction after conversation turns.

Extracts durable user facts via local LLM (Ollama) and persists them through
the Kernel as MemoryDerived events. Degrades to no-op when Ollama is unavailable.

Structured preference categories (preferences/values/…) belong in UserProfile;
this extractor only writes free-form MemoryDerived facts.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from app.core.agents.fact_parsing import parse_facts_from_text
from app.core.agents.memory_engine import memory_engine
from app.core.runtime.runtime_container import _LazyProxy, runtime

logger = logging.getLogger(__name__)

ExtractFn = Callable[[str], Awaitable[list[str]]]

# Cap concurrent fire-and-forget extractions so chat storms cannot pile up
# Ollama/cloud jobs indefinitely.
_MAX_PENDING_TASKS = 3
# Same turn (or identical text) scheduled twice within this window is dropped.
_DEDUP_WINDOW_SEC = 120.0
# Stricter than the historical 0.92 — near-paraphrases still flood proposed.
_DEDUP_SIMILARITY = 0.85
_MIN_FACT_CHARS = 12
_MAX_FACT_CHARS = 280
_MAX_FACTS_PER_TURN = 3

_EXTRACT_PROMPT = (
    "Extract durable, specific facts about the user as a person "
    "(identity, preferences, relationships, places, standing decisions). "
    "One fact per line, no bullets. Max 3 facts. "
    "Skip ephemeral chatter, questions, greetings, vague statements, "
    "tool/file operations, file paths, debug tokens, work-item status, "
    "the language the user spoke, and meta comments about missing facts "
    "or confidence.\n\n"
)

# English phrases use word boundaries; CJK markers use plain substring match
# because ``\b`` does not split continuous Chinese text.
_NOISE_EN_RE = re.compile(
    r"(?i)\b("
    r"i don't know|as an ai|as a language model|"
    r"user said|the user mentioned|the conversation|"
    r"used chinese language|write_file|file write|file-writing|"
    r"file creation|debug identifier|exact file content|"
    r"requested a file|testing or debugging"
    r")\b"
)
_NOISE_CJK_MARKERS = (
    "不知道",
    "作为ai",
    "作为AI",
    "作为人工智能",
    "用户说",
    "对话中",
    "根据对话",
    "用户未提供",
    "可提取的持久性",
    "完成了行动步骤",
    "置信度为",
    "暗号记忆置信度",
)
_PATHISH_RE = re.compile(
    r"(?i)(/tmp/|/home/|/users/|C:\\Users|\\\\|[A-Za-z]:\\|\bwrite_file\b)",
)


class MemoryExtractor:
    """Fire-and-forget memory extraction from conversation text."""

    def __init__(self, extract_fn: ExtractFn | None = None):
        # Hold strong references to fire-and-forget tasks so CPython's
        # garbage collector does not reap them before completion.
        self._pending_tasks: set[asyncio.Task] = set()
        self._recent_keys: dict[str, float] = {}
        if extract_fn is not None:
            self._extract = extract_fn
        else:
            self._extract = self._default_extract

    async def _default_extract(self, conversation_text: str) -> list[str]:
        from app.config import settings
        from app.core.agents.local_llm import local_llm

        if settings.memory_extractor == "cloud":
            return await self._cloud_extract(conversation_text)
        facts = await local_llm.extract_memories(conversation_text)
        if facts:
            return facts
        if settings.llm_api_key:
            return await self._cloud_extract(conversation_text)
        return []

    async def _cloud_extract(self, conversation_text: str) -> list[str]:
        from app.core.agents.brain_telemetry import record_llm_outcome
        from app.core.agents.llm_failover import llm_router
        from app.core.runtime.egress.egress_gate import audit_llm_egress

        llm_start = time.time()
        provider_name = "cloud"
        provider_model = "unknown"
        try:
            client, provider = llm_router.get_client()
            provider_name = provider.name
            provider_model = provider.model
            prompt = _EXTRACT_PROMPT + conversation_text[:3000]
            msg = {"role": "user", "content": prompt}
            egress_messages, _egress_audit = audit_llm_egress(
                [msg], purpose="memory_extract",
            )
            response = await client.chat.completions.create(
                model=provider.model,
                messages=egress_messages,  # type: ignore[arg-type]
                max_tokens=200,
                temperature=0.3,
            )
            text = response.choices[0].message.content or ""
            facts = parse_facts_from_text(text)
            from app.core.agents.token_counter import count_text_tokens

            record_llm_outcome(
                provider_name=provider_name,
                provider_model=provider_model,
                llm_start=llm_start,
                success=True,
                completion_tokens=count_text_tokens(text),
                price_per_prompt_token=getattr(provider, "price_per_prompt_token", 0.0),
                price_per_completion_token=getattr(provider, "price_per_completion_token", 0.0),
                purpose="memory_extract",
                actor="extractor",
            )
            return facts
        except Exception as exc:
            logger.warning("Cloud memory extraction failed", exc_info=True)
            record_llm_outcome(
                provider_name=provider_name,
                provider_model=provider_model,
                llm_start=llm_start,
                success=False,
                error_message=str(exc)[:500],
                purpose="memory_extract",
                actor="extractor",
            )
            return []

    async def extract_and_store(
        self,
        conversation_text: str,
        source: str = "conversation",
        *,
        source_document_id: str | None = None,
        source_document_name: str | None = None,
    ) -> list[str]:
        """Extract facts and store each as MemoryDerived with category=fact.

        Deduplication: before storing a fact, a semantic recall is performed.
        If an existing memory is highly similar, the fact is skipped to avoid
        polluting the memory store with near-duplicates.

        Low-quality / ephemeral lines are dropped before store so they never
        enter ``proposed`` triage.

        When source_document_id is provided, every extracted memory is linked
        back to that document. (Knowledge Base was removed; the field remains
        available for future document-sourced extraction.)

        Note: philosophically every memory is a decaying belief (see
        test_memory_belief), but the storage taxonomy uses ``category="fact"``
        for extractor output — not ``category="belief"``.
        """
        if not conversation_text.strip():
            return []

        facts = await self._extract(conversation_text)
        stored: list[str] = []
        for fact in facts:
            if len(stored) >= _MAX_FACTS_PER_TURN:
                logger.debug(
                    "Capping extraction at %d facts/turn", _MAX_FACTS_PER_TURN,
                )
                break
            fact = fact.strip()
            if not fact:
                continue
            if self._is_low_quality(fact):
                logger.debug("Skipping low-quality memory: %s", fact[:80])
                continue
            if self._is_duplicate(fact):
                logger.debug("Skipping duplicate memory: %s", fact[:80])
                continue
            memory_engine.store_memory(
                content=fact,
                category="fact",
                source=source,
                actor="extractor",
                source_document_id=source_document_id,
                source_document_name=source_document_name,
            )
            stored.append(fact)
        return stored

    @staticmethod
    def _is_low_quality(fact: str) -> bool:
        """Return True for facts that should never enter proposed triage."""
        if len(fact) < _MIN_FACT_CHARS or len(fact) > _MAX_FACT_CHARS:
            return True
        if fact.endswith("?") or fact.endswith("？"):
            return True
        if _NOISE_EN_RE.search(fact):
            return True
        compact = re.sub(r"\s+", "", fact)
        if any(marker in fact or marker in compact for marker in _NOISE_CJK_MARKERS):
            return True
        if _PATHISH_RE.search(fact):
            return True
        # Reject lines that are mostly whitespace / punctuation after strip.
        alnum = sum(1 for c in fact if c.isalnum())
        if alnum < 8:
            return True
        return False

    @staticmethod
    def _hit_similarity(hit: dict) -> float | None:
        """Normalize recall hit scores; Chroma returns distance, not similarity."""
        score = hit.get("score")
        if isinstance(score, (int, float)):
            return float(score)
        similarity = hit.get("similarity")
        if isinstance(similarity, (int, float)):
            return float(similarity)
        distance = hit.get("distance")
        if isinstance(distance, (int, float)):
            return 1.0 - float(distance)
        return None

    @staticmethod
    def _is_duplicate(fact: str, *, threshold: float = _DEDUP_SIMILARITY) -> bool:
        """Return True if a near-duplicate memory already exists.

        Uses semantic recall via the Kernel; when the vector store is
        unavailable (cold start, Ollama down) the check degrades to a
        substring match against recent memories so we still catch verbatim
        duplicates.
        """
        try:
            hits = memory_engine.search_relevant_memories(fact, n_results=3)
        except Exception:
            hits = []
        for hit in hits:
            existing = (hit.get("content") or "").strip()
            if not existing:
                continue
            sim = MemoryExtractor._hit_similarity(hit)
            if sim is not None and sim >= threshold:
                return True
            if existing == fact or existing in fact or fact in existing:
                return True
        return False

    def _fingerprint(self, conversation_text: str, *, dedup_key: str | None) -> str:
        if dedup_key:
            return f"key:{dedup_key}"
        digest = hashlib.sha1(conversation_text.strip().encode("utf-8")).hexdigest()[:16]
        return f"text:{digest}"

    def _prune_recent_keys(self, now: float) -> None:
        cutoff = now - _DEDUP_WINDOW_SEC
        stale = [k for k, ts in self._recent_keys.items() if ts < cutoff]
        for k in stale:
            self._recent_keys.pop(k, None)

    def schedule(
        self,
        conversation_text: str,
        source: str = "conversation",
        *,
        source_document_id: str | None = None,
        source_document_name: str | None = None,
        dedup_key: str | None = None,
    ) -> bool:
        """Schedule extraction without blocking the caller (fire-and-forget).

        Returns True when a task was scheduled, False when dropped (backlog
        full or duplicate within the dedup window).

        The created task is registered in ``self._pending_tasks`` and removed
        via a done-callback. Without this strong reference CPython may collect
        the task before it runs, causing intermittent silent memory loss.
        """
        if not conversation_text.strip():
            return False

        now = time.monotonic()
        self._prune_recent_keys(now)
        fp = self._fingerprint(conversation_text, dedup_key=dedup_key)
        if fp in self._recent_keys:
            logger.debug("Skipping duplicate memory extraction schedule: %s", fp)
            return False

        # Count only unfinished tasks toward the backlog cap.
        pending = {t for t in self._pending_tasks if not t.done()}
        self._pending_tasks = pending
        if len(pending) >= _MAX_PENDING_TASKS:
            logger.warning(
                "Memory extraction backlog full (%d); dropping schedule",
                _MAX_PENDING_TASKS,
            )
            return False

        async def _run() -> None:
            try:
                await self.extract_and_store(
                    conversation_text,
                    source=source,
                    source_document_id=source_document_id,
                    source_document_name=source_document_name,
                )
            except Exception:
                logger.exception("Memory extraction failed")

        try:
            loop = asyncio.get_running_loop()
            task = loop.create_task(_run())
            self._pending_tasks.add(task)
            self._recent_keys[fp] = now
            task.add_done_callback(self._pending_tasks.discard)
            return True
        except RuntimeError:
            return False


if TYPE_CHECKING:
    memory_extractor: MemoryExtractor
else:
    memory_extractor = _LazyProxy(lambda: runtime.memory_extractor)
