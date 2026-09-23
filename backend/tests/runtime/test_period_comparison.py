"""Period comparison replays existing events into two adjacent windows."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.core.runtime.kernel.event import Event

NOW = datetime(2026, 9, 22, 12, 0, tzinfo=UTC)
CURRENT_START = NOW - timedelta(days=7)
PREVIOUS = NOW - timedelta(days=10)
OUTSIDE = NOW - timedelta(days=20)


def test_rerun_restore_is_not_a_completion():
    from app.core.runtime.read_ports.events import _is_completion

    event = Event(
        type="WorkItemStatusChanged",
        aggregate_type="work_item",
        aggregate_id="brief",
        payload={"status": "completed", "reason": "rerun_restore"},
    )
    assert _is_completion(event) is False


def test_rework_restore_is_not_a_completion():
    from app.core.runtime.read_ports.events import _is_completion

    event = Event(
        type="WorkItemStatusChanged",
        aggregate_type="work_item",
        aggregate_id="brief",
        payload={"status": "completed", "reason": "rework_restore"},
    )
    assert _is_completion(event) is False
    failed = Event(
        type="WorkItemStatusChanged",
        aggregate_type="work_item",
        aggregate_id="brief",
        payload={"status": "failed", "reason": "rework_restore"},
    )
    assert _is_completion(failed) is False


def test_compare_periods_excludes_rerun_restore(isolated_kernel, monkeypatch):
    """收回 completed 不进入近 7 日与前 7 日的完成数。"""
    kernel, _db = isolated_kernel
    _emit_at(
        monkeypatch, kernel, NOW - timedelta(hours=1),
        "WorkItemCreated", "work_item", "brief_restore",
        payload={"work_type": "task", "title": "收回的简报", "status": "pending"},
    )
    _emit_at(
        monkeypatch, kernel, NOW - timedelta(minutes=30),
        "WorkItemStatusChanged", "work_item", "brief_restore",
        payload={"status": "completed", "reason": "rerun_restore"},
    )

    from app.core.runtime.read_ports.events import compare_periods

    result = compare_periods(days=7, now=NOW)
    assert result["signals"]["tasks_completed"]["current"] == 0
    assert result["signals"]["goals_completed"]["current"] == 0
    assert result["signals"]["work_completed_untyped"]["current"] == 0


def test_compare_periods_excludes_rework_restore(isolated_kernel, monkeypatch):
    """返工收回 completed 不进入近 7 日完成数。"""
    kernel, _db = isolated_kernel
    _emit_at(
        monkeypatch, kernel, NOW - timedelta(hours=1),
        "WorkItemCreated", "work_item", "brief_rework",
        payload={"work_type": "task", "title": "收回的返工", "status": "pending"},
    )
    _emit_at(
        monkeypatch, kernel, NOW - timedelta(minutes=30),
        "WorkItemStatusChanged", "work_item", "brief_rework",
        payload={"status": "completed", "reason": "rework_restore"},
    )

    from app.core.runtime.read_ports.events import compare_periods

    result = compare_periods(days=7, now=NOW)
    assert result["signals"]["tasks_completed"]["current"] == 0
    assert result["signals"]["goals_completed"]["current"] == 0
    assert result["signals"]["work_completed_untyped"]["current"] == 0


def _emit_at(monkeypatch, kernel, when: datetime, *args, **kwargs):
    class _Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return when.replace(tzinfo=None)
            return when.astimezone(tz)

    monkeypatch.setattr("app.core.runtime.kernel.event.datetime", _Clock)
    return kernel.emit_event(*args, **kwargs)


def _seed(monkeypatch, kernel) -> None:
    def emit(when: datetime, *args, **kwargs):
        return _emit_at(monkeypatch, kernel, when, *args, **kwargs)

    emit(
        NOW - timedelta(hours=1),
        "WorkItemCreated", "work_item", "goal_now",
        payload={"work_type": "goal", "title": "本周目标", "status": "active"},
    )
    emit(
        NOW - timedelta(hours=1),
        "WorkItemStatusChanged", "work_item", "goal_now",
        payload={"status": "completed"},
    )
    # Progress rewrite must not count as another completion.
    emit(
        NOW - timedelta(minutes=30),
        "WorkItemUpdated", "work_item", "goal_now",
        payload={"progress": 1.0},
    )
    # The split instant belongs to the current window.
    emit(
        CURRENT_START,
        "WorkItemCreated", "work_item", "task_edge",
        payload={"work_type": "task", "title": "边界任务", "status": "pending"},
    )
    emit(
        CURRENT_START,
        "WorkItemStatusChanged", "work_item", "task_edge",
        payload={"status": "completed"},
    )
    emit(
        PREVIOUS,
        "WorkItemCreated", "work_item", "action_prev",
        payload={"work_type": "action", "title": "上周行动", "status": "pending"},
    )
    emit(
        PREVIOUS,
        "WorkItemUpdated", "work_item", "action_prev",
        payload={"status": "completed"},
    )
    emit(
        PREVIOUS + timedelta(seconds=1),
        "WorkItemUpdated", "work_item", "action_prev",
        payload={"completed_at": (PREVIOUS + timedelta(seconds=1)).isoformat()},
    )
    emit(
        PREVIOUS,
        "WorkItemCreated", "work_item", "gone",
        payload={"work_type": "goal", "title": "已删除", "status": "active"},
    )
    emit(
        PREVIOUS + timedelta(minutes=1),
        "WorkItemStatusChanged", "work_item", "gone",
        payload={"status": "completed"},
    )
    emit(PREVIOUS + timedelta(minutes=2), "WorkItemDeleted", "work_item", "gone", payload={})
    emit(
        OUTSIDE,
        "WorkItemCreated", "work_item", "old_task",
        payload={"work_type": "task", "title": "更早", "status": "pending"},
    )
    emit(
        OUTSIDE,
        "WorkItemStatusChanged", "work_item", "old_task",
        payload={"status": "completed"},
    )
    emit(NOW - timedelta(hours=2), "InboxEmailRecorded", "inbox_email", "mail_now", payload={"subject": "本周"})
    emit(NOW - timedelta(hours=3), "InboxEmailRecorded", "inbox_email", "mail_now_2", payload={"subject": "本周2"})
    emit(PREVIOUS, "InboxEmailRecorded", "inbox_email", "mail_prev", payload={"subject": "上周"})
    emit(
        NOW - timedelta(hours=1),
        "ApprovalGranted", "approval", "apr_yes",
        payload={"action": "write_file", "reason": "pre_approved"},
    )
    emit(
        NOW - timedelta(hours=1),
        "ApprovalDenied", "approval", "apr_no",
        payload={"action": "send_email", "reason": "user_denied"},
    )
    emit(
        NOW - timedelta(hours=1),
        "ApprovalGranted", "approval", "apr_auto",
        payload={"action": "read_file", "reason": "auto_allow"},
    )
    emit(
        NOW - timedelta(hours=1),
        "ApprovalGranted", "approval", "apr_ask",
        payload={"action": "ask_user", "reason": "user_reply"},
    )
    emit(
        NOW - timedelta(hours=1),
        "ClaimRatified", "memory", "mem_yes",
        payload={"by": "user"},
    )
    emit(
        PREVIOUS,
        "ApprovalGranted", "approval", "apr_prev",
        payload={"action": "write_file", "reason": "pre_approved"},
    )


def test_compare_periods_splits_adjacent_weeks(isolated_kernel, monkeypatch):
    kernel, _db = isolated_kernel
    _seed(monkeypatch, kernel)

    from app.core.runtime.read_ports.events import compare_periods

    result = compare_periods(days=7, now=NOW)
    signals = result["signals"]

    assert result["days"] == 7
    assert result["capped"] is False
    assert signals["goals_completed"] == {"current": 1, "previous": 0, "delta": 1}
    assert signals["tasks_completed"] == {"current": 1, "previous": 1, "delta": 0}
    assert signals["work_completed_untyped"] == {"current": 0, "previous": 1, "delta": -1}
    assert signals["inbox_recorded"] == {"current": 2, "previous": 1, "delta": 1}
    assert signals["adoption_decided"] == {"current": 3, "previous": 1, "delta": 2}
    assert signals["adoption_rate"]["current"] == 2 / 3
    assert signals["adoption_rate"]["previous"] == 1
    assert signals["adoption_rate"]["delta"] == (2 / 3) - 1
    assert result["adoption"]["current"]["suggestions"]["auto_allowed"] == 1
    assert result["adoption"]["current"]["suggestions"]["adopted"] == 1
    assert result["current"]["end"] == NOW.isoformat()
    assert result["previous"]["end"] == CURRENT_START.isoformat()


def test_compare_periods_empty_window_has_null_rate(isolated_kernel):
    _kernel, _db = isolated_kernel
    from app.core.runtime.read_ports.events import compare_periods

    result = compare_periods(days=7, now=NOW)
    assert result["signals"]["goals_completed"]["current"] == 0
    assert result["signals"]["adoption_rate"]["current"] is None
    assert result["signals"]["adoption_rate"]["delta"] is None
    assert result["capped"] is False


def test_compare_periods_reports_cap(isolated_kernel, monkeypatch):
    kernel, _db = isolated_kernel
    for index in range(3):
        _emit_at(
            monkeypatch, kernel, NOW - timedelta(hours=index + 1),
            "InboxEmailRecorded", "inbox_email", f"mail_{index}",
            payload={"subject": str(index)},
        )

    from app.core.runtime.read_ports.events import compare_periods

    result = compare_periods(days=7, now=NOW, limit=2)
    assert result["capped"] is True
    assert result["signals"]["inbox_recorded"]["current"] == 2


def test_world_prompt_includes_period_comparison(isolated_kernel, monkeypatch):
    kernel, _db = isolated_kernel
    _seed(monkeypatch, kernel)

    class _Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return NOW.replace(tzinfo=None)
            return NOW.astimezone(tz)

    monkeypatch.setattr("app.core.runtime.read_ports.events.datetime", _Clock)
    from app.core.agents.world_model import world_model

    text = world_model.to_prompt_context()
    assert "Period comparison (last 7d vs previous 7d)" in text
    assert "goals completed 1 vs 0" in text
    assert "inbox recorded 2 vs 1" in text


def test_period_comparison_endpoint(client: TestClient):
    from app.core.runtime.kernel_instance import kernel

    kernel.emit_event(
        "WorkItemCreated", "work_item", "goal_api",
        payload={"work_type": "goal", "title": "接口目标", "status": "active"},
    )
    kernel.emit_event(
        "WorkItemStatusChanged", "work_item", "goal_api",
        payload={"status": "completed"},
    )

    missing = client.get("/api/dashboard/periods?days=0")
    assert missing.status_code == 422

    response = client.get("/api/dashboard/periods?days=7")
    assert response.status_code == 200
    body = response.json()
    assert body["days"] == 7
    assert body["signals"]["goals_completed"]["current"] == 1
    assert "adoption" in body
    assert body["capped"] is False
