"""Unit tests for morning brief generation + diagnostics."""

from __future__ import annotations

from app.product.morning_brief import (
    generate_morning_brief,
    notification_dedup_key,
    notification_title,
)


def _period_comparison(*, capped: bool = False) -> dict:
    return {
        "days": 7,
        "signals": {
            "goals_completed": {"current": 2, "previous": 1, "delta": 1},
            "tasks_completed": {"current": 1, "previous": 1, "delta": 0},
            "work_completed_untyped": {"current": 0, "previous": 1, "delta": -1},
            "inbox_recorded": {"current": 4, "previous": 6, "delta": -2},
            "adoption_decided": {"current": 3, "previous": 2, "delta": 1},
            "adoption_rate": {"current": 2 / 3, "previous": 0.5, "delta": 0.17},
        },
        "capped": capped,
    }


def _stub_reads(monkeypatch, *, periods=None, calendar=None) -> None:
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_calendar_today_events",
        calendar or (lambda: {"count": 2, "events": [{"title": "standup"}, {"title": "review"}]}),
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_active_goals",
        lambda limit=10: [{"title": "Ship dogfood", "progress": 0.4}],
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.count_pending_inbox_emails",
        lambda: 3,
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.count_inbox_emails",
        lambda: 21,
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.count_memories",
        lambda **kwargs: (
            2 if kwargs.get("claim_status") == "proposed" else 0
        ),
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.compare_periods",
        periods or (lambda **kwargs: _period_comparison(capped=True)),
    )


def test_generate_morning_brief_assembles_text(monkeypatch):
    _stub_reads(monkeypatch)

    result = generate_morning_brief()

    assert "Ship dogfood" in result.brief
    assert "(进度 40%)" in result.brief
    assert "收件箱: 21 封（未读 3）" in result.brief
    assert "今日日程: 2 个" in result.brief
    assert "待确认记忆: 2 条" in result.brief
    assert "近 7 日 vs 前 7 日" in result.brief
    assert "完成目标 2（+1）" in result.brief
    assert "完成任务 1（持平）" in result.brief
    assert "已完成（类型未知） 0（-1）" in result.brief
    assert "新邮件 4（-2）" in result.brief
    assert "采纳率 67%（+17 个百分点）" in result.brief
    assert "这段时间事件较多，数字可能不完整" in result.brief
    assert "dark mode" not in result.brief
    assert "/memories?tab=review" in result.brief
    assert result.goals_count == 1
    assert result.inbox_count == 3
    assert result.mailbox_count == 21
    assert result.calendar_count == 2
    assert result.proposed_count == 2
    assert result.errors == []
    assert "goals" in result.steps_ms
    assert "inbox" in result.steps_ms
    assert "calendar" in result.steps_ms
    assert "proposed_memories" in result.steps_ms
    assert "periods" in result.steps_ms


def test_generate_morning_brief_degrades_on_source_failure(monkeypatch):
    def boom():
        raise RuntimeError("calendar down")

    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_calendar_today_events",
        boom,
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_active_goals",
        lambda limit=10: [],
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.count_pending_inbox_emails",
        lambda: 0,
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.count_inbox_emails",
        lambda: 0,
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.count_memories",
        lambda **kwargs: 0,
    )

    def periods_down(**_kwargs):
        raise RuntimeError("periods down")

    monkeypatch.setattr(
        "app.core.runtime.read_ports.compare_periods",
        periods_down,
    )

    result = generate_morning_brief()

    assert result.brief.startswith("早安！")
    assert result.calendar_count == 0
    assert result.proposed_count == 0
    assert any("calendar" in e for e in result.errors)
    assert any(e.startswith("periods:") for e in result.errors)
    assert "今日日程: 0 个" in result.brief
    assert "收件箱: 0 封（未读 0）" in result.brief
    assert "待确认记忆: 0 条" in result.brief
    assert "近 7 日 vs 前 7 日" in result.brief
    assert "获取失败" in result.brief
    assert "祝你今天一切顺利" in result.brief


def test_morning_brief_notification_identity_is_date_scoped():
    assert notification_title("2026-08-19") == "早安简报 - 2026-08-19"
    assert notification_dedup_key("2026-08-19") == "morning_brief:2026-08-19"
    assert notification_dedup_key("2026-08-18") != notification_dedup_key("2026-08-19")
