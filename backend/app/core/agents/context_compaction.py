"""Conversation-surface compaction as a logged MessageAppended checkpoint.

Silent history truncation is replaced by an append-only checkpoint: older
messages stay in the ``messages`` projection (UI + rebuild), while the LLM
window starts at the latest checkpoint. No new event type — the checkpoint
is ``MessageAppended`` with ``role=system`` and a ``compact`` payload.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.core.agents.token_counter import count_message_tokens, truncate_to_token_budget

if TYPE_CHECKING:
    from app.core.agents.conversation import ConversationManager

logger = logging.getLogger(__name__)

COMPACT_MARKER = "[compacted]"
HISTORY_SCAN_LIMIT = 5000
_SUMMARY_TOKEN_BUDGET = 400


def is_checkpoint_message(msg: dict[str, Any]) -> bool:
    """True when *msg* is a compaction checkpoint (LLM-window reset)."""
    if msg.get("role") != "system":
        return False
    content = msg.get("content") or ""
    return content.startswith(COMPACT_MARKER)


def surface_from(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Slice *messages* from the latest checkpoint (inclusive), else all."""
    start = 0
    for i, msg in enumerate(messages):
        if is_checkpoint_message(msg):
            start = i
    return messages[start:]


def keep_recent_count(max_messages: int) -> int:
    """How many tail messages to retain when compacting.

    Must be strictly below *max_messages* so a compact actually shrinks
    the LLM window. Tiny caps (tests) still keep at least one turn.
    """
    if max_messages <= 2:
        return 1
    return max(1, max_messages // 2)


def _is_safe_cut(messages: list[dict[str, Any]], cut: int) -> bool:
    """Do not split an assistant tool_calls batch across the cut."""
    if cut <= 0 or cut >= len(messages):
        return False
    if messages[cut].get("role") == "tool":
        return False
    return True


def find_safe_cut(messages: list[dict[str, Any]], keep_recent: int) -> int:
    """Return exclusive end index of the shadowed prefix, or 0 if none."""
    if keep_recent <= 0 or len(messages) <= keep_recent:
        return 0
    cut = len(messages) - keep_recent
    while cut > 0 and not _is_safe_cut(messages, cut):
        cut -= 1
    return cut


def _first_user_excerpt(messages: list[dict[str, Any]], *, limit: int = 160) -> str:
    for msg in messages:
        if msg.get("role") == "user":
            text = (msg.get("content") or "").strip().replace("\n", " ")
            if text:
                return text[:limit]
    return ""


def _last_user_excerpt(messages: list[dict[str, Any]], *, limit: int = 160) -> str:
    for msg in reversed(messages):
        if msg.get("role") == "user":
            text = (msg.get("content") or "").strip().replace("\n", " ")
            if text:
                return text[:limit]
    return ""


def _tool_names(messages: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for msg in messages:
        if msg.get("role") != "assistant":
            continue
        for call in msg.get("tool_calls") or []:
            if not isinstance(call, dict):
                continue
            name = (call.get("function") or {}).get("name") or call.get("name") or ""
            if name and name not in seen:
                seen.add(name)
                names.append(name)
    return names


def render_checkpoint_content(
    shadowed: list[dict[str, Any]],
    *,
    token_count: int,
) -> str:
    """Deterministic extractive summary — no LLM call, reconstructable."""
    count = len(shadowed)
    first = _first_user_excerpt(shadowed)
    last = _last_user_excerpt(shadowed)
    tools = _tool_names(shadowed)
    lines = [
        f"{COMPACT_MARKER} {count} earlier messages (~{token_count} tokens) "
        "folded. Full transcript remains in event_log and can be rebuilt.",
    ]
    if first:
        lines.append(f"First user: {first}")
    if tools:
        lines.append("Tools: " + ", ".join(tools))
    if last and last != first:
        lines.append(f"Last user: {last}")
    text = "\n".join(lines)
    return truncate_to_token_budget(text, _SUMMARY_TOKEN_BUDGET)


def ensure_compacted(
    conversation: "ConversationManager",
    *,
    max_messages: int | None = None,
) -> dict[str, Any] | None:
    """If the LLM surface exceeds *max_messages*, append a checkpoint.

    Returns the saved checkpoint row, or None when no compact ran.
    """
    from app.config import settings

    cap = int(max_messages if max_messages is not None else settings.max_recent_messages)
    if cap < 2:
        return None
    recorded = conversation.load_recorded_messages()
    surface = surface_from(recorded)
    if len(surface) <= cap:
        return None
    keep = keep_recent_count(cap)
    cut = find_safe_cut(surface, keep)
    if cut < 1:
        logger.warning(
            "compaction skipped: no safe cut (surface=%d keep=%d)",
            len(surface),
            keep,
        )
        return None
    shadowed = surface[:cut]
    token_count = count_message_tokens(shadowed)
    shadowed_ids = [m["id"] for m in shadowed if m.get("id")]
    content = render_checkpoint_content(shadowed, token_count=token_count)
    row = conversation.save_message(
        role="system",
        content=content,
        actor="system",
        compact={
            "kind": "checkpoint",
            "shadowed_message_ids": shadowed_ids,
            "shadowed_count": len(shadowed),
            "shadowed_token_count": token_count,
        },
    )
    logger.info(
        "compacted %d messages (~%d tokens) in conversation %s",
        len(shadowed),
        token_count,
        conversation.conversation_id,
    )
    return row
