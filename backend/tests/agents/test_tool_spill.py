"""Oversized tool results spill to disk; MessageAppended stores the preview."""

from pathlib import Path

from app.core.agents.context_compaction import COMPACT_MARKER
from app.core.agents.conversation import ConversationManager
from app.core.agents.tool_spill import (
    SPILL_MARKER,
    is_spilled_message,
    prepare_tool_result,
    spill_from_message,
)


def _open_conv(kernel, conv_id: str = "conv-spill") -> ConversationManager:
    kernel.emit_event(
        "ConversationCreated",
        "conversation",
        conv_id,
        payload={"title": "t", "created_at": "2026-01-01T00:00:00+00:00"},
        actor="user",
    )
    return ConversationManager(conversation_id=conv_id, kernel=kernel)


def _fat_body() -> str:
    return "HEADTOKEN" + ("x" * 1800) + "nonce-SPILL-ALPHA" + ("y" * 1800) + "TAILTOKEN"


def test_prepare_under_limit_is_passthrough():
    text, meta = prepare_tool_result(
        "hello",
        conversation_id="c1",
        tool_name="read_file",
        tool_call_id="tc1",
        limit=100,
    )
    assert text == "hello"
    assert meta is None


def test_prefix_alone_is_not_a_spill():
    msg = {"role": "tool", "content": f"{SPILL_MARKER} spoofed"}
    assert not is_spilled_message(msg)


def test_prepare_spills_over_limit_and_keeps_body_on_disk(isolated_kernel, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "tool_spill_char_limit", 80)
    k, _db = isolated_kernel
    mgr = _open_conv(k)
    body = _fat_body()
    row = mgr.save_tool_result(body, "call-1", tool_name="read_file")
    assert is_spilled_message(row)
    preview = row.get("content") or ""
    assert preview.startswith(SPILL_MARKER)
    assert "HEADTOKEN" in preview
    assert "TAILTOKEN" in preview
    assert "nonce-SPILL-ALPHA" not in preview

    meta = spill_from_message(row)
    assert meta is not None
    path = Path(meta["path"])
    assert path.is_file()
    on_disk = path.read_text(encoding="utf-8")
    assert on_disk == body
    assert "nonce-SPILL-ALPHA" in on_disk

    history = mgr.get_history()
    tool_rows = [m for m in history if m.get("role") == "tool"]
    assert len(tool_rows) == 1
    assert is_spilled_message(tool_rows[0])
    assert "nonce-SPILL-ALPHA" not in tool_rows[0]["content"]


def test_spill_survives_rebuild(isolated_kernel, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "tool_spill_char_limit", 80)
    k, _db = isolated_kernel
    mgr = _open_conv(k, "conv-spill-rebuild")
    body = _fat_body()
    mgr.save_tool_result(body, "call-r", tool_name="read_file")
    k.rebuild_all()
    mgr2 = ConversationManager(conversation_id="conv-spill-rebuild", kernel=k)
    recorded = mgr2.load_recorded_messages()
    spilled = [m for m in recorded if is_spilled_message(m)]
    assert len(spilled) == 1
    path = Path(spill_from_message(spilled[0])["path"])
    assert path.read_text(encoding="utf-8") == body


def test_write_failure_keeps_inline(monkeypatch, isolated_kernel):
    from app.config import settings

    monkeypatch.setattr(settings, "tool_spill_char_limit", 80)
    k, _db = isolated_kernel
    mgr = _open_conv(k, "conv-spill-fail")

    def boom(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr("pathlib.Path.write_text", boom)
    body = _fat_body()
    row = mgr.save_tool_result(body, "call-f", tool_name="read_file")
    assert not is_spilled_message(row)
    assert row["content"] == body


def test_compact_checkpoint_prefix_untouched_by_spill():
    assert COMPACT_MARKER != SPILL_MARKER
