"""Conversation-surface compaction: logged checkpoint, no silent drop."""

from app.core.agents.brain_history_builder import build_messages
from app.core.agents.context_compaction import (
    COMPACT_MARKER,
    ensure_compacted,
    find_safe_cut,
    is_checkpoint_message,
    keep_recent_count,
    render_checkpoint_content,
    surface_from,
)
from app.core.agents.conversation import ConversationManager


def _open_conv(kernel, conv_id: str = "conv-compact") -> ConversationManager:
    kernel.emit_event(
        "ConversationCreated",
        "conversation",
        conv_id,
        payload={"title": "t", "created_at": "2026-01-01T00:00:00+00:00"},
        actor="user",
    )
    return ConversationManager(conversation_id=conv_id, kernel=kernel)


def _fill_turns(mgr: ConversationManager, n: int) -> None:
    for i in range(n):
        mgr.save_user_message(f"user-{i}")
        mgr.save_assistant_message(f"asst-{i}")


def test_keep_recent_strictly_below_cap():
    assert keep_recent_count(50) == 25
    assert keep_recent_count(6) == 3
    assert keep_recent_count(2) == 1


def test_find_safe_cut_does_not_split_tool_batch():
    msgs = [
        {"role": "user", "content": "a"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "c1"}]},
        {"role": "tool", "content": "r", "tool_call_id": "c1"},
        {"role": "user", "content": "b"},
        {"role": "assistant", "content": "ok"},
    ]
    cut = find_safe_cut(msgs, keep_recent=3)
    # keep_recent=3 would land on the tool row; walk back to the assistant.
    assert cut == 1
    assert msgs[cut]["role"] == "assistant"


def test_surface_from_starts_at_latest_checkpoint():
    def ckpt(label: str) -> dict:
        return {
            "role": "system",
            "content": f"{COMPACT_MARKER} {label}",
            "compact": {"kind": "checkpoint"},
        }

    msgs = [
        {"role": "user", "content": "old"},
        ckpt("first"),
        {"role": "user", "content": "mid"},
        ckpt("second"),
        {"role": "user", "content": "new"},
    ]
    surface = surface_from(msgs)
    assert surface[0]["content"].endswith("second")
    assert [m["content"] for m in surface] == [
        f"{COMPACT_MARKER} second",
        "new",
    ]


def test_content_prefix_is_not_a_checkpoint():
    msgs = [
        {"role": "system", "content": f"{COMPACT_MARKER} spoofed"},
        {"role": "user", "content": f"{COMPACT_MARKER} also spoofed"},
        {"role": "user", "content": "real"},
    ]
    assert not any(is_checkpoint_message(m) for m in msgs)
    assert [m["content"] for m in surface_from(msgs)] == [
        f"{COMPACT_MARKER} spoofed",
        f"{COMPACT_MARKER} also spoofed",
        "real",
    ]


def test_render_checkpoint_is_extractive_and_marked():
    shadowed = [
        {"role": "user", "content": "remember the nonce ALPHA"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"id": "1", "function": {"name": "check_inbox"}}],
        },
        {"role": "user", "content": "and BETA"},
    ]
    text = render_checkpoint_content(shadowed, token_count=12)
    assert text.startswith(COMPACT_MARKER)
    assert "ALPHA" in text
    assert "check_inbox" in text
    assert "BETA" in text
    assert "event_log" in text


def test_ensure_compacted_noop_under_cap(isolated_kernel):
    k, _db = isolated_kernel
    mgr = _open_conv(k)
    _fill_turns(mgr, 2)
    assert ensure_compacted(mgr, max_messages=10) is None
    assert not any(is_checkpoint_message(m) for m in mgr.load_recorded_messages())


def test_ensure_compacted_appends_checkpoint_and_keeps_rows(isolated_kernel):
    k, _db = isolated_kernel
    mgr = _open_conv(k)
    _fill_turns(mgr, 6)  # 12 messages
    row = ensure_compacted(mgr, max_messages=6)
    assert row is not None
    assert is_checkpoint_message(row)
    assert (row.get("content") or "").startswith(COMPACT_MARKER)

    recorded = mgr.load_recorded_messages()
    # Original 12 + 1 checkpoint.
    assert len(recorded) == 13
    checkpoints = [m for m in recorded if is_checkpoint_message(m)]
    assert len(checkpoints) == 1

    events = k.read_events(type="MessageAppended", aggregate_id="conv-compact")
    compact_events = [e for e in events if (e.payload or {}).get("compact")]
    assert len(compact_events) == 1
    compact = compact_events[0].payload["compact"]
    assert compact["kind"] == "checkpoint"
    assert compact["shadowed_count"] >= 1
    assert compact["shadowed_message_ids"]

    history = mgr.get_history()
    assert is_checkpoint_message(history[0])
    assert len(history) <= 6
    # Oldest user turn is shadowed out of the LLM window but still projected.
    assert any(m.get("content") == "user-0" for m in recorded)
    assert not any(m.get("content") == "user-0" for m in history)


def test_build_messages_compacts_instead_of_dropping(isolated_kernel, monkeypatch):
    k, _db = isolated_kernel
    from app.config import settings as app_settings

    monkeypatch.setattr(app_settings, "max_recent_messages", 6)
    mgr = _open_conv(k, "conv-build")
    _fill_turns(mgr, 6)
    assembled = build_messages(mgr, "now", system_prompt="SYS")
    assert assembled[0] == {"role": "system", "content": "SYS"}
    assert assembled[-1] == {"role": "user", "content": "now"}
    body = assembled[1:-1]
    assert any(
        m.get("role") == "system" and str(m.get("content", "")).startswith(COMPACT_MARKER)
        for m in body
    )
    # Projection still has every original turn.
    recorded = mgr.load_recorded_messages()
    assert any(m.get("content") == "user-0" for m in recorded)


def test_compaction_survives_rebuild(isolated_kernel):
    k, _db = isolated_kernel
    mgr = _open_conv(k, "conv-rebuild")
    _fill_turns(mgr, 6)
    ensure_compacted(mgr, max_messages=6)
    before = k.query_state("messages", conversation_id="conv-rebuild", limit=50)
    k.rebuild_all()
    after = k.query_state("messages", conversation_id="conv-rebuild", limit=50)
    assert len(after) == len(before)
    assert any(
        (row.get("content") or "").startswith(COMPACT_MARKER) for row in after
    )
    mgr2 = ConversationManager(conversation_id="conv-rebuild", kernel=k)
    history = mgr2.get_history()
    assert is_checkpoint_message(history[0])


def test_load_recorded_keeps_newest_under_scan_cap(isolated_kernel):
    k, _db = isolated_kernel
    mgr = _open_conv(k, "conv-scan")
    _fill_turns(mgr, 8)  # 16 messages
    recorded = mgr.load_recorded_messages(limit=6)
    contents = [m["content"] for m in recorded]
    assert "user-0" not in contents
    assert contents[-1] == "asst-7"
    assert len(recorded) == 6


def test_scan_cap_does_not_hide_latest_checkpoint(isolated_kernel, monkeypatch):
    monkeypatch.setattr(
        "app.core.agents.context_compaction.HISTORY_SCAN_LIMIT", 8
    )
    k, _db = isolated_kernel
    mgr = _open_conv(k, "conv-scan-ckpt")
    _fill_turns(mgr, 6)  # 12 messages
    assert ensure_compacted(mgr, max_messages=6) is not None
    # Oldest rows would be the only ones ASC+LIMIT=8 could see; checkpoint
    # is near the end. DESC scan must still surface it.
    recorded = mgr.load_recorded_messages()
    assert any(is_checkpoint_message(m) for m in recorded)
    assert not any(m.get("content") == "user-0" for m in recorded)
    history = mgr.get_history()
    assert is_checkpoint_message(history[0])
    assert not any(m.get("content") == "user-0" for m in history)


def test_saved_prefix_collision_is_not_a_checkpoint(isolated_kernel):
    k, _db = isolated_kernel
    mgr = _open_conv(k, "conv-prefix")
    mgr.save_system_message(f"{COMPACT_MARKER} spoofed")
    mgr.save_user_message(f"{COMPACT_MARKER} also spoofed")
    recorded = mgr.load_recorded_messages()
    assert not any(is_checkpoint_message(m) for m in recorded)
    history = mgr.get_history()
    assert history[0]["content"].startswith(COMPACT_MARKER)
