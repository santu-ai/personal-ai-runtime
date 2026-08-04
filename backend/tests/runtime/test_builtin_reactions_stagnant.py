"""builtin_reactions._check_stagnant_goals — grace period, dedup, and
notification payload behavior."""

from __future__ import annotations

import pytest

from app.core.runtime.builtin_reactions import _check_stagnant_goals


def _emit_goal(k, goal_id: str, *, created_at: str, last_activity_at: str,
               status: str = "active"):
    k.emit_event(
        "WorkItemCreated", "work_item", goal_id,
        payload={"title": f"目标 {goal_id}", "work_type": "goal",
                 "status": status, "created_at": created_at,
                 "last_activity_at": last_activity_at},
        actor="user",
    )


def _stagnant_notifications(k) -> list[dict]:
    return k.query_state(
        "notifications", notification_type="goal_stagnant", limit=10,
    )


def test_stagnant_goal_creates_notification(isolated_kernel):
    k, _db = isolated_kernel
    _emit_goal(
        k, "g1",
        created_at="2026-07-20T00:00:00+00:00",  # 15 天前
        last_activity_at="2026-07-30T00:00:00+00:00",  # 5 天前
    )

    _check_stagnant_goals()

    rows = _stagnant_notifications(k)
    assert len(rows) == 1
    assert rows[0]["notification_type"] == "goal_stagnant"
    assert rows[0]["related_id"] == "g1"
    assert "5 天" in rows[0]["content"]
    assert "目标 g1" in rows[0]["title"]


def test_recent_goal_skipped_by_grace_period(isolated_kernel):
    k, _db = isolated_kernel
    from datetime import UTC, datetime
    now = datetime.now(UTC).isoformat()
    _emit_goal(k, "g1", created_at=now, last_activity_at=now)

    _check_stagnant_goals()

    assert _stagnant_notifications(k) == []


def test_active_recent_goal_not_stagnant(isolated_kernel):
    k, _db = isolated_kernel
    from datetime import UTC, datetime
    now = datetime.now(UTC).isoformat()
    _emit_goal(k, "g1", created_at="2026-07-01T00:00:00+00:00",
               last_activity_at=now)  # 今天活跃

    _check_stagnant_goals()

    assert _stagnant_notifications(k) == []


def test_completed_goal_not_stagnant(isolated_kernel):
    k, _db = isolated_kernel
    _emit_goal(k, "g1", status="completed",
               created_at="2026-07-01T00:00:00+00:00",
               last_activity_at="2026-07-02T00:00:00+00:00")

    _check_stagnant_goals()

    assert _stagnant_notifications(k) == []


def test_repeated_check_does_not_duplicate(isolated_kernel):
    k, _db = isolated_kernel
    _emit_goal(
        k, "g1",
        created_at="2026-07-20T00:00:00+00:00",
        last_activity_at="2026-07-30T00:00:00+00:00",
    )

    _check_stagnant_goals()
    _check_stagnant_goals()

    assert len(_stagnant_notifications(k)) == 1


def test_invalid_last_activity_defaults_to_three_days(isolated_kernel, monkeypatch):
    """防御分支：注入带非法 last_activity 的 goal 行，验证天数回退为 3。

    真实 query_state 的字符串比较会把非法 last_activity 过滤在查询外，所以
    用 fake kernel 直接构造该输入来锁定防御逻辑。
    """
    emitted: list[dict] = []

    class _FakeKernel:
        def query_state(self, selector, **filters):
            if selector == "work_items":
                return [{
                    "id": "g1", "title": "目标 g1",
                    "created_at": "2026-07-20T00:00:00+00:00",
                    "last_activity_at": "not-a-date",
                }]
            return []  # notifications existing check

        def emit_event(self, *args, **kwargs):
            emitted.append({"type": args[0], "payload": kwargs.get("payload", {})})

    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", _FakeKernel())

    _check_stagnant_goals()

    assert len(emitted) == 1
    assert emitted[0]["type"] == "NotificationCreated"
    assert "3 天" in emitted[0]["payload"]["content"]
