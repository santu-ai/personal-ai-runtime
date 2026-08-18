"""read_ports.work — query/count parameter forwarding, background-task mapping,
cancel/execute guards, and notify_goal_action_completed side-effects."""

from __future__ import annotations

import pytest

from app.core.runtime.read_ports import work as work_port


# ── Query/count helper forwarding ─────────────────────────────────────────


class FakeKernel:
    def __init__(self):
        self.query_calls: list[tuple] = []
        self.count_calls: list[tuple] = []

    def query_state(self, selector: str, **filters):
        self.query_calls.append((selector, filters))
        return []

    def count_state(self, selector: str, **filters):
        self.count_calls.append((selector, filters))
        return 3


@pytest.fixture
def fake_kernel(monkeypatch):
    k = FakeKernel()
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)
    return k


def test_query_pending_work_items_forwards(fake_kernel):
    work_port.query_pending_work_items(limit=3)
    assert fake_kernel.query_calls == [
        ("work_items", {"status": "pending", "limit": 3, "order": "created_at_asc"}),
    ]


def test_query_top_active_goals_forwards(fake_kernel):
    work_port.query_top_active_goals(limit=2)
    assert fake_kernel.query_calls == [
        (
            "work_items",
            {
                "work_type": "goal",
                "status": "active",
                "limit": 2,
                "order": "importance_urgency_desc",
            },
        ),
    ]


def test_query_stagnant_goals_forwards(fake_kernel):
    work_port.query_stagnant_goals(days=5, limit=3)
    assert fake_kernel.query_calls == [
        (
            "work_items",
            {
                "work_type": "goal",
                "status": "active",
                "last_activity_older_than_days": 5,
                "limit": 3,
            },
        ),
    ]


def test_query_stagnant_goal_count_forwards(fake_kernel):
    assert work_port.query_stagnant_goal_count(days=7) == 3
    assert fake_kernel.count_calls == [
        (
            "work_items",
            {"work_type": "goal", "status": "active",
             "last_activity_older_than_days": 7},
        ),
    ]


def test_query_goals_forwards_status_and_limit(fake_kernel):
    work_port.query_goals(status="active", limit=10)
    assert fake_kernel.query_calls == [
        ("work_items", {"work_type": "goal", "limit": 10, "status": "active"}),
    ]


def test_count_goals_forwards(fake_kernel):
    assert work_port.count_goals(status="completed") == 3
    assert fake_kernel.count_calls == [
        ("work_items", {"work_type": "goal", "status": "completed"}),
    ]


def test_query_goal_actions_forwards(fake_kernel):
    work_port.query_goal_actions("g1")
    assert fake_kernel.query_calls == [
        ("work_items", {"parent_work_id": "g1", "work_type": "action"}),
    ]


def test_query_active_goals_forwards_custom_order(fake_kernel):
    work_port.query_active_goals(limit=5, order="priority_desc")
    assert fake_kernel.query_calls == [
        (
            "work_items",
            {"work_type": "goal", "status": "active", "limit": 5,
             "order": "priority_desc"},
        ),
    ]


def test_count_active_goals_forwards(fake_kernel):
    assert work_port.count_active_goals() == 3
    assert fake_kernel.count_calls == [
        ("work_items", {"work_type": "goal", "status": "active"}),
    ]


def test_query_completed_goals_forwards_updated_since(fake_kernel):
    work_port.query_completed_goals(limit=20, updated_since="2026-01-01T00:00:00")
    assert fake_kernel.query_calls == [
        (
            "work_items",
            {
                "work_type": "goal",
                "status": "completed",
                "limit": 20,
                "updated_since": "2026-01-01T00:00:00",
            },
        ),
    ]


def test_count_completed_goals_forwards(fake_kernel):
    assert work_port.count_completed_goals() == 3
    assert fake_kernel.count_calls == [
        ("work_items", {"work_type": "goal", "status": "completed"}),
    ]


def test_query_goals_with_deadline_forwards(fake_kernel):
    work_port.query_goals_with_deadline(limit=7)
    assert fake_kernel.query_calls == [
        (
            "work_items",
            {"work_type": "goal", "status": "active", "has_deadline": True, "limit": 7},
        ),
    ]


def test_query_work_items_by_parent_goal_forwards(fake_kernel):
    work_port.query_work_items_by_parent_goal("g1", limit=100)
    assert fake_kernel.query_calls == [
        ("work_items", {"parent_work_id": "g1", "limit": 100}),
    ]


# ── Background work items (isolated kernel) ───────────────────────────────


def _emit_background(k, item_id: str, *, status: str, plan: str = '{"steps": []}'):
    k.emit_event(
        "WorkItemCreated",
        "work_item",
        item_id,
        payload={"title": f"job {item_id}", "work_type": "background",
                 "executable_plan": plan, "status": status},
        actor="user",
    )


def test_query_background_work_item_returns_row(isolated_kernel):
    k, _db = isolated_kernel
    _emit_background(k, "b1", status="pending")
    row = work_port.query_background_work_item("b1")
    assert row["title"] == "job b1"
    assert row["work_type"] == "background"
    assert row["status"] == "pending"


def test_query_background_work_item_none_for_other_work_types(isolated_kernel):
    k, _db = isolated_kernel
    k.emit_event(
        "WorkItemCreated", "work_item", "t1",
        payload={"title": "task", "work_type": "task"},
        actor="user",
    )
    assert work_port.query_background_work_item("t1") is None


def test_query_background_work_items_filters_status(isolated_kernel):
    k, _db = isolated_kernel
    _emit_background(k, "b1", status="pending")
    _emit_background(k, "b2", status="completed")

    pending = work_port.query_background_work_items(status="pending")
    assert [m["id"] for m in pending] == ["b1"]

    all_items = work_port.query_background_work_items()
    assert {m["id"] for m in all_items} == {"b1", "b2"}


# ── cancel_background_work_item guards ────────────────────────────────────


def test_cancel_missing_item_raises_key_error(isolated_kernel):
    with pytest.raises(KeyError):
        work_port.cancel_background_work_item("missing")


def test_cancel_non_background_item_raises_key_error(isolated_kernel):
    k, _db = isolated_kernel
    k.emit_event(
        "WorkItemCreated", "work_item", "t1",
        payload={"title": "task", "work_type": "task", "status": "pending"},
        actor="user",
    )
    with pytest.raises(KeyError):
        work_port.cancel_background_work_item("t1")


def test_cancel_terminal_item_raises_value_error(isolated_kernel):
    k, _db = isolated_kernel
    _emit_background(k, "b1", status="completed")
    with pytest.raises(ValueError, match="terminal"):
        work_port.cancel_background_work_item("b1")


# ── request_work_item_execute guards ──────────────────────────────────────


def _emit_item(k, item_id: str, *, work_type: str = "task", status: str = "pending",
               plan: str | None = '{"steps": [{"id": "s1"}]}'):
    k.emit_event(
        "WorkItemCreated", "work_item", item_id,
        payload={"title": f"item {item_id}", "work_type": work_type,
                 "executable_plan": plan, "status": status},
        actor="user",
    )


def test_execute_missing_item_raises_key_error(isolated_kernel):
    with pytest.raises(KeyError):
        work_port.request_work_item_execute("missing")


def test_execute_goal_raises_value_error(isolated_kernel):
    k, _db = isolated_kernel
    _emit_item(k, "g1", work_type="goal", plan=None)
    with pytest.raises(ValueError, match="Goals cannot be executed"):
        work_port.request_work_item_execute("g1")


def test_execute_without_plan_raises_value_error(isolated_kernel):
    k, _db = isolated_kernel
    _emit_item(k, "t1", plan=None)
    with pytest.raises(ValueError, match="no executable_plan"):
        work_port.request_work_item_execute("t1")


def test_execute_with_invalid_plan_json_raises_value_error(isolated_kernel):
    k, _db = isolated_kernel
    _emit_item(k, "t1", plan="not json{{{")
    with pytest.raises(ValueError, match="invalid executable_plan"):
        work_port.request_work_item_execute("t1")


def test_execute_with_plan_without_steps_raises_value_error(isolated_kernel):
    k, _db = isolated_kernel
    _emit_item(k, "t1", plan='{"foo": 1}')
    with pytest.raises(ValueError, match="steps"):
        work_port.request_work_item_execute("t1")


def test_execute_terminal_item_raises_value_error(isolated_kernel):
    k, _db = isolated_kernel
    _emit_item(k, "t1", status="completed")
    with pytest.raises(ValueError, match="already terminal"):
        work_port.request_work_item_execute("t1")


def test_execute_running_item_raises_value_error(isolated_kernel):
    k, _db = isolated_kernel
    _emit_item(k, "t1", status="running")
    with pytest.raises(ValueError, match="wait for completion"):
        work_port.request_work_item_execute("t1")


def test_execute_valid_item_emits_running_then_execute_requested(isolated_kernel):
    k, _db = isolated_kernel
    _emit_item(k, "t1", plan='{"steps": [{"id": "s1"}]}')

    updated = work_port.request_work_item_execute("t1")
    assert updated["status"] == "running"

    events = [e for e in k.read_events()
              if e.aggregate_id in ("t1", "exec_t1")]
    types = [e.type for e in events]
    assert types == ["WorkItemCreated", "WorkItemStatusChanged", "ExecuteRequested"]


# ── notify_goal_action_completed ──────────────────────────────────────────


class _FakeMemoryEngine:
    def __init__(self):
        self.stored: list[dict] = []

    def store_memory(self, *, category, content, source, actor, **kwargs):
        self.stored.append({"category": category, "content": content,
                            "source": source, "actor": actor})


def _notification_rows(k, notif_type: str) -> list[dict]:
    return k.query_state("notifications", notification_type=notif_type, limit=10)


@pytest.fixture
def goal_with_actions(isolated_kernel, monkeypatch):
    k, _db = isolated_kernel
    engine = _FakeMemoryEngine()
    monkeypatch.setattr("app.core.agents.memory_engine.memory_engine", engine)

    goal = work_port.create_work_item(title="目标", work_type="goal")
    a1 = work_port.create_work_item(title="动作A", work_type="action",
                                    parent_work_id=goal["id"])
    a2 = work_port.create_work_item(title="动作B", work_type="action",
                                    parent_work_id=goal["id"])
    return k, engine, goal, a1, a2


def test_partial_completion_creates_goal_progress_notification(goal_with_actions):
    k, engine, goal, a1, _a2 = goal_with_actions

    work_port.notify_goal_action_completed(goal["id"], a1["id"], "动作A")

    rows = _notification_rows(k, "goal_progress")
    assert len(rows) == 1
    assert "1/2" in rows[0]["content"]

    assert engine.stored == []
    assert not _notification_rows(k, "goal_complete")


def test_all_actions_completed_creates_goal_complete_notification(goal_with_actions):
    k, engine, goal, a1, a2 = goal_with_actions

    work_port.notify_goal_action_completed(goal["id"], a1["id"], "动作A")
    # 前序 action 真正落库为 completed（notify 的双保险只强置当次 action）
    k.emit_event(
        "WorkItemStatusChanged", "work_item", a1["id"],
        payload={"status": "completed"}, actor="user",
    )
    work_port.notify_goal_action_completed(goal["id"], a2["id"], "动作B")

    rows = _notification_rows(k, "goal_complete")
    assert len(rows) == 1
    assert "所有步骤已完成" in rows[0]["title"]
    assert engine.stored == []


def test_notify_without_children_skips_notification(
    isolated_kernel, monkeypatch,
):
    """目标无子项（孤儿 action）时跳过进度/完成通知，也不写 proposed 记忆。

    锁定的真实行为：all_items 为空 → 不产生 "0/0 步已完成" 噪音通知。
    """
    k, _db = isolated_kernel
    engine = _FakeMemoryEngine()
    monkeypatch.setattr("app.core.agents.memory_engine.memory_engine", engine)

    goal = work_port.create_work_item(title="空目标", work_type="goal")
    work_port.notify_goal_action_completed(goal["id"], "orphan-action", "动作")

    assert _notification_rows(k, "goal_progress") == []
    assert _notification_rows(k, "goal_complete") == []
    assert engine.stored == []
