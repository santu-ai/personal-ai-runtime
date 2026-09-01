"""Spill oversized tool results off the conversation event surface.

Kernel / CapabilityInvoked still sees the full handler return (up to the
mcp_hub hard cap). The LLM window and ``MessageAppended`` tool row get a
preview plus an on-disk locator so the model-visible text is reconstructable
without stuffing the body into ``event_log``. No new event type.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any

from app.core.agents.tool_postprocess import compact_for_llm

logger = logging.getLogger(__name__)

SPILL_MARKER = "[spilled]"
SPILL_SOURCE_TYPE = "tool_spill"
DEFAULT_SPILL_CHAR_LIMIT = 8000
_HEAD_CHARS = 1500
_TAIL_CHARS = 400
_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._-]+")


def spill_source(spill: dict[str, Any]) -> dict[str, Any]:
    """Marker stored in MessageAppended.sources (already projected)."""
    return {"type": SPILL_SOURCE_TYPE, **spill}


def _as_source_items(raw: Any) -> list[dict[str, Any]]:
    if raw is None or raw == "":
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return []
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def spill_from_message(msg: dict[str, Any]) -> dict[str, Any] | None:
    """Return spill metadata, or None when *msg* is not a spilled tool result."""
    spill = msg.get("spill")
    if isinstance(spill, dict) and spill.get("kind") == "spill":
        return spill
    for item in _as_source_items(msg.get("sources")):
        if item.get("type") == SPILL_SOURCE_TYPE and item.get("kind") == "spill":
            return item
    return None


def is_spilled_message(msg: dict[str, Any]) -> bool:
    return spill_from_message(msg) is not None


def _safe_segment(raw: str, fallback: str) -> str:
    cleaned = _SAFE_SEGMENT.sub("_", raw or "").strip("._")[:80]
    return cleaned or fallback


def render_spill_content(original: str, meta: dict[str, Any]) -> str:
    n = len(original)
    head = original[:_HEAD_CHARS]
    lines = [
        f"{SPILL_MARKER} {n} chars folded out of the conversation event. "
        "Full text is on disk and can be rebuilt; this preview is what the model sees.",
        f"Path: {meta.get('path', '')}",
        "Use read_file on that path if it is inside allowed filesystem roots; "
        "otherwise use the preview.",
        "Head:",
        head,
    ]
    if n > _HEAD_CHARS + _TAIL_CHARS:
        lines.extend(["", "Tail:", original[-_TAIL_CHARS:]])
    return "\n".join(lines)


def _spill_dir(conversation_id: str) -> Path | None:
    from app.config import settings

    root = Path(settings.data_dir).expanduser().resolve() / "spills"
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    if root.is_symlink():
        return None
    conv = root / _safe_segment(conversation_id, "conv")
    try:
        conv.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    if conv.is_symlink():
        return None
    try:
        conv.resolve().relative_to(root.resolve())
    except ValueError:
        return None
    return conv


def write_spill(
    content: str,
    *,
    conversation_id: str,
    tool_name: str,
    tool_call_id: str,
) -> dict[str, Any] | None:
    """Persist *content* under DATA_DIR/spills. Best-effort: None on failure."""
    directory = _spill_dir(conversation_id)
    if directory is None:
        return None
    name = _safe_segment(tool_call_id, "call") + ".txt"
    final = directory / name
    tmp = directory / f".{name}.{uuid.uuid4().hex}.tmp"
    try:
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(final)
    except OSError:
        logger.warning("tool spill write failed", exc_info=True)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return None
    path = str(final)
    return {
        "kind": "spill",
        "path": path,
        "bytes": len(content.encode("utf-8")),
        "char_count": len(content),
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
    }


def prepare_tool_result(
    content: str,
    *,
    conversation_id: str,
    tool_name: str = "",
    tool_call_id: str = "",
    limit: int | None = None,
) -> tuple[str, dict[str, Any] | None]:
    """Shape *content* for the LLM window: compact_for_llm, then spill if huge.

    Returns ``(model_facing_text, spill_meta_or_none)``. A write failure keeps
    the compact inline result (DSH best-effort).
    """
    from app.config import settings

    if tool_name:
        shaped = compact_for_llm(tool_name, content)
    else:
        shaped = content
    cap = int(limit if limit is not None else settings.tool_spill_char_limit or DEFAULT_SPILL_CHAR_LIMIT)
    if cap < 1 or len(shaped) <= cap:
        return shaped, None
    meta = write_spill(
        shaped,
        conversation_id=conversation_id,
        tool_name=tool_name,
        tool_call_id=tool_call_id,
    )
    if meta is None:
        return shaped, None
    return render_spill_content(shaped, meta), meta
