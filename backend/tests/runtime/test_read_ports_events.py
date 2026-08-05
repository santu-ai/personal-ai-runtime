"""read_ports.events — UI mapping, recent/goal event queries."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from app.core.runtime.kernel.event import Event
from app.core.runtime.read_ports import events as events_port
from app.core.runtime.reaction_registry import reset_reactions


def _evt(
    type_: str,
    *,
    aggregate_type: str = "work_item",
    aggregate_id: str = "g1",
    payload: dict | None = None,
    seq: int = 1,
    ts: str = "2026-08-04T10:00:00+00:00",
) -> Event:
    return Event(
        type=type_,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        payload=payload or {},
        actor="user",
        ts=ts,
        id=f"evt_{type_}_{seq}",
    ).with_seq(seq)


# ── Pure helpers ──────────────────────────────────────────────────────────


def test_to_event_dict_keeps_real_type_and_summary():
    event = _evt(
        "CapabilityInvoked",
        aggregate_type="capability",
        aggregate_id="cap1",
        payload={"name": "read_file"},
    )
    row = events_port.to_event_dict(event)
    assert row["type"] == "CapabilityInvoked"
    assert row["summary"] == "Tool called: read_file"
    assert row["id"] == event.id
    assert row["timestamp"] == event.ts
    assert json.loads(row["payload"])["name"] == "read_file"


def test_to_event_dict_unknown_type_passthrough():
    event = _evt("CustomThing", payload={})
    row = events_port.to_event_dict(event)
    assert row["type"] == "CustomThing"
    assert row["summary"].startswith("CustomThing:")


@pytest.mark.parametrize(
    "type_,payload,needle",
    [
        ("ApprovalRequested", {"action": "shell_exec"}, "Approval requested: shell_exec"),
        ("ApprovalGranted", {"action": "shell_exec"}, "Approval granted: shell_exec"),
        ("ApprovalDenied", {"action": "shell_exec"}, "Approval denied: shell_exec"),
        ("WorkItemCreated", {"title": "Goal"}, "WorkItem created: Goal"),
        ("WorkItemUpdated", {"status": "active"}, "WorkItem active:"),
        ("MemoryDerived", {"content": "likes tea"}, "Memory derived: likes tea"),
        ("ConversationRecorded", {"user_message": "hello world"}, "Conversation: hello world"),
    ],
)
def test_summary_for_event_types(type_, payload, needle):
    event = _evt(type_, payload=payload)
    assert needle in events_port._summary_for(event)


def test_goal_id_from_work_item_parent_or_self():
    child = _evt(
        "WorkItemCreated",
        aggregate_type="work_item",
        aggregate_id="a1",
        payload={"parent_work_id": "g1", "title": "Step"},
    )
    assert events_port._goal_id_for(child) == "g1"

    root = _evt(
        "WorkItemCreated",
        aggregate_type="work_item",
        aggregate_id="g1",
        payload={"title": "Root", "work_type": "goal"},
    )
    assert events_port._goal_id_for(root) == "g1"


def test_goal_id_from_other_aggregate_payload():
    mem = _evt(
        "MemoryDerived",
        aggregate_type="memory",
        aggregate_id="m1",
        payload={"goal_id": "g2", "content": "x"},
    )
    assert events_port._goal_id_for(mem) == "g2"


# ── recent_events (injected read_fn) ──────────────────────────────────────


def test_recent_events_filters_and_limit():
    captured: list[dict] = []

    def fake_read(**filters):
        captured.append(filters)
        return [
            _evt("WorkItemCreated", aggregate_id="g1", payload={"title": "A"}, seq=3),
            _evt(
                "WorkItemCreated",
                aggregate_id="g2",
                payload={"title": "B", "parent_work_id": "g1"},
                seq=2,
            ),
            _evt("CapabilityInvoked", aggregate_type="capability", aggregate_id="c1",
                 payload={"name": "x"}, seq=1),
        ]

    rows = events_port.recent_events(
        fake_read, days=3, limit=2, event_type="WorkItemCreated",
    )
    assert len(rows) == 2
    assert captured[0]["type"] == "WorkItemCreated"
    assert captured[0]["order"] == "desc"
    assert captured[0]["limit"] == 2
    since = datetime.fromisoformat(captured[0]["since_ts"].replace("Z", "+00:00"))
    assert datetime.now(UTC) - since < timedelta(days=3, minutes=1)
    assert datetime.now(UTC) - since > timedelta(days=2, hours=23)


def test_recent_events_filters_by_goal_id():
    def fake_read(**_filters):
        return [
            _evt(
                "WorkItemCreated",
                aggregate_id="a1",
                payload={"title": "child", "parent_work_id": "g1"},
                seq=2,
            ),
            _evt(
                "WorkItemCreated",
                aggregate_id="a2",
                payload={"title": "other", "parent_work_id": "g2"},
                seq=1,
            ),
        ]

    rows = events_port.recent_events(fake_read, goal_id="g1", limit=10)
    assert len(rows) == 1
    assert rows[0]["goal_id"] == "g1"


# ── goal_events (isolated kernel) ─────────────────────────────────────────


@pytest.fixture
def kernel(isolated_kernel):
    k, _db = isolated_kernel
    reset_reactions()
    yield k
    reset_reactions()


def test_goal_events_combines_work_item_own_and_children(kernel):
    kernel.emit_event(
        "WorkItemCreated", "work_item", "g1",
        payload={"title": "Ship", "work_type": "goal", "status": "active"},
        actor="user",
    )
    kernel.emit_event(
        "WorkItemCreated", "work_item", "a1",
        payload={
            "title": "Step",
            "work_type": "action",
            "parent_work_id": "g1",
            "status": "pending",
        },
        actor="user",
    )
    kernel.emit_event(
        "WorkItemUpdated", "work_item", "g1",
        payload={"status": "active", "progress": 0.5},
        actor="user",
    )

    rows = events_port.goal_events("g1", limit=10)
    # g1 Created (seq 1), child a1 (seq 2), g1 Updated (seq 3) → desc by seq.
    assert [r["type"] for r in rows] == [
        "WorkItemUpdated", "WorkItemCreated", "WorkItemCreated",
    ]
    assert rows[0]["summary"] == "WorkItem active: g1"
    assert rows[1]["summary"] == "WorkItem created: Step"
    assert rows[2]["summary"] == "WorkItem created: Ship"
