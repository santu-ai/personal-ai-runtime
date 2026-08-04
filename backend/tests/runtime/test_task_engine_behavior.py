"""task_engine — status vocabulary checks, dependency gating, recursive tree
assembly, cascade delete, and parent activity bump."""

from __future__ import annotations

import pytest

from app.core.runtime import task_engine


def test_create_goal_attaches_goal_fields_only_when_given(isolated_kernel):
    k, _db = isolated_kernel

    rich = task_engine.create_work_item(
        title="富目标", work_type="goal",
        progress=0.8, importance=0.9, urgency=0.3,
        deadline="2026-12-31T00:00:00", last_activity_at="2026-01-01T00:00:00",
    )
    assert rich["progress"] == 0.8
    assert rich["importance"] == 0.9
    assert rich["urgency"] == 0.3
    assert rich["deadline"] == "2026-12-31T00:00:00"
    assert rich["last_activity_at"] == "2026-01-01T00:00:00"

    # 非 goal 工作项不 attach goal 字段 → 回退 schema 默认值
    task = task_engine.create_work_item(title="普通任务", work_type="task")
    assert task["progress"] == 0.0
    assert task["importance"] == 0.5
    assert task["urgency"] == 0.5
    assert task["deadline"] is None
    assert task["last_activity_at"] is None


# ── update_work_item_fields: vocabulary checks ─────────────────────────────


def _create_task(k, *, title="任务", status="pending", work_type="task", **kw):
    return task_engine.create_work_item(title=title, work_type=work_type,
                                        status=status, **kw)


def test_update_fields_goal_invalid_status_raises(isolated_kernel):
    k, _db = isolated_kernel
    goal = _create_task(k, title="目标", work_type="goal")
    with pytest.raises(ValueError, match="Invalid goal status"):
        task_engine.update_work_item_fields(goal["id"], status="running")


def test_update_fields_work_item_invalid_status_raises(isolated_kernel):
    k, _db = isolated_kernel
    task = _create_task(k)
    with pytest.raises(ValueError, match="Invalid work item status"):
        task_engine.update_work_item_fields(task["id"], status="bogus_status")


def test_update_fields_goal_valid_statuses_accepted(isolated_kernel):
    k, _db = isolated_kernel
    goal = _create_task(k, title="目标", work_type="goal")
    for status in ("active", "completed", "paused"):
        updated = task_engine.update_work_item_fields(goal["id"], status=status)
        assert updated["status"] == status


def test_update_fields_empty_payload_returns_item_without_emit(isolated_kernel):
    k, _db = isolated_kernel
    task = _create_task(k)
    before = k.read_events(aggregate_id=task["id"], type="WorkItemUpdated")
    updated = task_engine.update_work_item_fields(task["id"])
    assert updated["id"] == task["id"]
    after = k.read_events(aggregate_id=task["id"], type="WorkItemUpdated")
    assert len(before) == len(after), "empty update must not emit WorkItemUpdated"


def test_update_fields_persists_changes(isolated_kernel):
    k, _db = isolated_kernel
    task = _create_task(k, title="旧标题", priority=1)
    updated = task_engine.update_work_item_fields(
        task["id"], title="新标题", priority=5, progress=0.5,
    )
    assert updated["title"] == "新标题"
    assert updated["priority"] == 5
    assert updated["progress"] == 0.5


def test_update_fields_missing_item_returns_none(isolated_kernel):
    assert task_engine.update_work_item_fields("missing") is None


# ── update_work_item_status: FSM enforcement via integration ───────────────


def test_update_status_illegal_transition_raises(isolated_kernel):
    k, _db = isolated_kernel
    task = _create_task(k)  # pending
    # pending -> completed 不在 FSM 转换表中
    with pytest.raises(ValueError, match="Illegal state transition"):
        task_engine.update_work_item_status(task["id"], "completed")


def test_update_status_running_then_completed(isolated_kernel):
    k, _db = isolated_kernel
    task = _create_task(k)
    running = task_engine.update_work_item_status(task["id"], "running")
    assert running["status"] == "running"
    done = task_engine.update_work_item_status(task["id"], "completed")
    assert done["status"] == "completed"


def test_update_status_missing_item_returns_none(isolated_kernel):
    assert task_engine.update_work_item_status("missing", "running") is None


# ── are_dependencies_met ───────────────────────────────────────────────────


def test_dependency_not_completed_blocks(isolated_kernel):
    k, _db = isolated_kernel
    dep = _create_task(k, title="依赖")
    main = _create_task(k, title="主任务", dependencies=[dep["id"]])
    # dep 仍是 pending → 依赖未满足
    assert task_engine.are_dependencies_met(main["id"]) is False


def test_dependency_missing_item_blocks(isolated_kernel):
    k, _db = isolated_kernel
    main = _create_task(k, title="主任务", dependencies=["ghost-dep"])
    assert task_engine.are_dependencies_met(main["id"]) is False


def test_dependency_completed_unblocks(isolated_kernel):
    k, _db = isolated_kernel
    dep = _create_task(k, title="依赖")
    task_engine.update_work_item_status(dep["id"], "running")
    task_engine.update_work_item_status(dep["id"], "completed")
    main = _create_task(k, title="主任务", dependencies=[dep["id"]])
    assert task_engine.are_dependencies_met(main["id"]) is True


def test_no_dependencies_returns_true(isolated_kernel):
    # 无 dependencies_json → 直接放行
    k, _db = isolated_kernel
    task = _create_task(k)
    assert task_engine.are_dependencies_met(task["id"]) is True


# ── get_work_item_tree: recursive assembly ─────────────────────────────────


def test_get_work_item_tree_nests_sub_items(isolated_kernel):
    k, _db = isolated_kernel
    goal = _create_task(k, title="目标", work_type="goal")
    action = _create_task(k, title="动作", work_type="action",
                          parent_goal_id=goal["id"])
    _create_task(k, title="子步骤", work_type="task", parent_work_id=action["id"])

    # tree 根是 goal 的子 action（按 parent_goal_id 组装），逐层嵌套 sub_items
    tree = task_engine.get_work_item_tree(goal["id"])
    assert len(tree) == 1
    root = tree[0]
    assert root["id"] == action["id"]
    assert root["sub_items"][0]["title"] == "子步骤"


# ── delete_work_item: cascade ──────────────────────────────────────────────


def test_delete_work_item_without_cascade_keeps_children(isolated_kernel):
    k, _db = isolated_kernel
    goal = _create_task(k, title="目标", work_type="goal")
    child = _create_task(k, title="动作", work_type="action",
                         parent_goal_id=goal["id"])

    task_engine.delete_work_item(goal["id"], cascade=False)

    assert task_engine.get_work_item(goal["id"]) is None
    assert task_engine.get_work_item(child["id"]) is not None


def test_delete_work_item_cascade_removes_direct_children(isolated_kernel):
    k, _db = isolated_kernel
    goal = _create_task(k, title="目标", work_type="goal")
    action = _create_task(k, title="动作", work_type="action",
                          parent_goal_id=goal["id"])
    # 孙级（parent_work_id=action，parent_goal_id=None）不在 cascade 范围
    subtask = _create_task(k, title="子步骤", work_type="task",
                           parent_work_id=action["id"])

    task_engine.delete_work_item(goal["id"], cascade=True)

    assert task_engine.get_work_item(goal["id"]) is None
    assert task_engine.get_work_item(action["id"]) is None
    assert task_engine.get_work_item(subtask["id"]) is not None


# ── bump_parent_activity ───────────────────────────────────────────────────


def test_bump_parent_activity_emits_updated(isolated_kernel):
    k, _db = isolated_kernel
    goal = _create_task(k, title="目标", work_type="goal")

    task_engine.bump_parent_activity(goal["id"])

    events = k.read_events(aggregate_id=goal["id"], type="WorkItemUpdated")
    assert len(events) == 1
    assert "last_activity_at" in events[0].payload


def test_bump_parent_activity_missing_parent_is_noop(isolated_kernel):
    k, _db = isolated_kernel
    before = len(k.read_events())
    task_engine.bump_parent_activity("ghost-parent")
    assert len(k.read_events()) == before
