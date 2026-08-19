"""Tests for notification related-id handling and event-sourced writes."""

from app.core.runtime import read_ports


def test_create_notification_stores_related_id_in_column(product_kernel):
    k = product_kernel

    first = read_ports.create_notification("alert", "提醒 A", "old content", kernel=k)
    assert first["content"] == "old content"
    assert first.get("related_id") is None

    second = read_ports.create_notification(
        "alert",
        "提醒 A",
        "new content",
        related_id="entity-001",
        related_type="goal",
        kernel=k,
    )
    assert second["id"] == first["id"]
    assert second["content"] == "old content"
    assert second["related_id"] == "entity-001"

    rows = k.query_state("notifications", related_id="entity-001")
    assert len(rows) == 1
    assert rows[0]["related_id"] == "entity-001"
    assert not rows[0]["content"].startswith("@related:")


def test_create_notification_related_id_on_create(product_kernel):
    k = product_kernel
    n = read_ports.create_notification(
        "goal_stagnant",
        "目标停滞: X",
        "目标已 3 天未更新",
        related_id="goal-1",
        related_type="goal",
        kernel=k,
    )
    assert n["content"] == "目标已 3 天未更新"
    rows = k.query_state("notifications", related_id="goal-1")
    assert len(rows) == 1
    assert rows[0]["related_id"] == "goal-1"


def test_notification_rebuild(product_kernel):
    k = product_kernel
    read_ports.create_notification("alert", "Test alert", "Body", related_id="r1", kernel=k)
    before = k.query_state("notifications")
    k.rebuild("notification")
    after = k.query_state("notifications")
    assert before == after
    assert len(after) == 1
    assert after[0]["read"] == 0
    assert after[0]["related_id"] == "r1"

    k.emit_event("NotificationRead", "notification", after[0]["id"], payload={}, actor="test")
    k.rebuild("notification")
    read_rows = k.query_state("notifications")
    assert read_rows[0]["read"] == 1


def test_morning_brief_persist_does_not_collapse_across_days(product_kernel):
    """Fixed title '早安简报' used to fold every day's persist into the first row."""
    from app.product.morning_brief import notification_dedup_key, notification_title

    k = product_kernel
    day_18 = read_ports.create_notification(
        "morning_brief",
        notification_title("2026-08-18"),
        "早安！2026年08月18日 简报",
        dedup_key=notification_dedup_key("2026-08-18"),
        kernel=k,
    )
    day_19 = read_ports.create_notification(
        "morning_brief",
        notification_title("2026-08-19"),
        "早安！2026年08月19日 简报",
        dedup_key=notification_dedup_key("2026-08-19"),
        kernel=k,
    )
    same_day = read_ports.create_notification(
        "morning_brief",
        notification_title("2026-08-19"),
        "retry should collapse",
        dedup_key=notification_dedup_key("2026-08-19"),
        kernel=k,
    )
    assert day_18["id"] != day_19["id"]
    assert same_day["id"] == day_19["id"]
    assert same_day["content"] == "早安！2026年08月19日 简报"
    rows = k.query_state("notifications", type="morning_brief")
    assert len(rows) == 2


def test_deadline_alert_persist_does_not_collapse_across_goals_or_days(product_kernel):
    """Fixed title 'Deadline 预警' used to fold every goal/day into the first row."""
    from app.core.agents.handlers.timer_trigger_handler import (
        deadline_alert_dedup_key,
        deadline_alert_title,
    )

    k = product_kernel
    g1_d18 = read_ports.create_notification(
        "goal_deadline",
        deadline_alert_title("Same Title"),
        "目标「Same Title」还有 3 天截止",
        related_id="g1",
        related_type="goal",
        dedup_key=deadline_alert_dedup_key("g1", "2026-08-18"),
        kernel=k,
    )
    g2_d18 = read_ports.create_notification(
        "goal_deadline",
        deadline_alert_title("Same Title"),
        "目标「Same Title」还有 1 天截止",
        related_id="g2",
        related_type="goal",
        dedup_key=deadline_alert_dedup_key("g2", "2026-08-18"),
        kernel=k,
    )
    g1_d19 = read_ports.create_notification(
        "goal_deadline",
        deadline_alert_title("Same Title"),
        "目标「Same Title」还有 1 天截止",
        related_id="g1",
        related_type="goal",
        dedup_key=deadline_alert_dedup_key("g1", "2026-08-19"),
        kernel=k,
    )
    retry = read_ports.create_notification(
        "goal_deadline",
        deadline_alert_title("Same Title"),
        "retry should collapse",
        related_id="g1",
        related_type="goal",
        dedup_key=deadline_alert_dedup_key("g1", "2026-08-19"),
        kernel=k,
    )
    assert len({g1_d18["id"], g2_d18["id"], g1_d19["id"]}) == 3
    assert retry["id"] == g1_d19["id"]
    assert retry["content"] == "目标「Same Title」还有 1 天截止"
    rows = k.query_state("notifications", type="goal_deadline")
    assert len(rows) == 3
