"""Unit tests for morning brief generation + diagnostics."""

from __future__ import annotations

from app.product.morning_brief import generate_morning_brief


def test_generate_morning_brief_assembles_text(monkeypatch):
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_calendar_today_events",
        lambda: {"count": 2, "events": [{"title": "standup"}, {"title": "review"}]},
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_active_goals",
        lambda limit=10: [{"title": "Ship dogfood", "progress": 0.4}],
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_inbox_emails",
        lambda **kwargs: [{"id": "1"}, {"id": "2"}, {"id": "3"}],
    )

    result = generate_morning_brief()

    assert "Ship dogfood" in result.brief
    assert "(进度 40%)" in result.brief
    assert "未读邮件: 3 封" in result.brief
    assert "今日日程: 2 个" in result.brief
    assert result.goals_count == 1
    assert result.inbox_count == 3
    assert result.calendar_count == 2
    assert result.errors == []
    assert "goals" in result.steps_ms
    assert "inbox" in result.steps_ms
    assert "calendar" in result.steps_ms


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
        "app.core.runtime.read_ports.query_inbox_emails",
        lambda **kwargs: [],
    )

    result = generate_morning_brief()

    assert result.brief.startswith("早安！")
    assert result.calendar_count == 0
    assert any("calendar" in e for e in result.errors)
    assert "今日日程: 0 个" in result.brief
