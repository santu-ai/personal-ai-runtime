"""Additional scheduler handler coverage via timer_trigger_handler."""

from unittest.mock import patch

import pytest


@pytest.mark.asyncio
@patch("app.core.runtime.cron_registry.run_memory_decay")
async def test_run_memory_decay(mock_decay):
    from app.core.agents.handlers.timer_trigger_handler import _call_product

    await _call_product("memory_decay")
    mock_decay.assert_called_once()


@pytest.mark.asyncio
@patch("app.core.agents.world_model.world_model.refresh_snapshot")
async def test_run_world_model_snapshot(mock_refresh):
    from app.core.agents.handlers.timer_trigger_handler import _call_product

    await _call_product("world_model_snapshot")
    mock_refresh.assert_called_once()


@pytest.mark.asyncio
@patch("app.product.inbox.generate_inbox_digest")
async def test_run_inbox_digest(mock_digest):
    from app.core.agents.handlers.timer_trigger_handler import _call_product

    await _call_product("inbox_digest")
    mock_digest.assert_called_once()


@pytest.mark.asyncio
@patch("app.core.runtime.kernel_instance.kernel.save_projection_snapshots")
async def test_run_projection_snapshots(mock_save):
    mock_save.return_value = [{"aggregate_type": "goal"}]

    from app.core.agents.handlers.timer_trigger_handler import _call_product

    await _call_product("projection_snapshots")
    mock_save.assert_called_once()


@pytest.mark.asyncio
@patch("app.core.runtime.kernel_instance.kernel.query_state")
async def test_run_deadline_alert_creates_notifications(mock_query):
    from datetime import UTC, datetime, timedelta

    from app.core.agents.handlers.timer_trigger_handler import (
        _call_product,
        _local_tz,
        deadline_alert_dedup_key,
        deadline_alert_title,
    )

    tz = _local_tz()
    today = datetime.now(tz).date()

    def iso_at(offset_days: int):
        return datetime(
            today.year, today.month, today.day, tzinfo=tz,
        ).astimezone(UTC) + timedelta(days=offset_days)

    due_1 = iso_at(1).isoformat()
    due_2 = iso_at(2).isoformat()
    due_3 = iso_at(3).isoformat()
    mock_query.return_value = [
        {"id": "g1", "title": "Same Title", "deadline": due_1},
        {"id": "g2", "title": "Same Title", "deadline": due_1},
        {"id": "g-skip", "title": "Two days", "deadline": due_2},
        {"id": "g3", "title": "In three", "deadline": due_3},
        {"title": "No id", "deadline": due_1},
    ]

    with patch("app.core.runtime.notification_bridge.create_notification") as create:
        await _call_product("deadline_alert")
        assert create.call_count == 3
        by_goal = {
            call.kwargs["related_id"]: call
            for call in create.call_args_list
        }
        assert set(by_goal) == {"g1", "g2", "g3"}
        date_local = today.isoformat()
        for goal_id, title, days in (("g1", "Same Title", 1), ("g2", "Same Title", 1), ("g3", "In three", 3)):
            call = by_goal[goal_id]
            assert call.args[0] == "goal_deadline"
            assert call.args[1] == deadline_alert_title(title)
            assert f"还有 {days} 天截止" in call.args[2]
            assert call.kwargs["related_type"] == "goal"
            assert call.kwargs["dedup_key"] == deadline_alert_dedup_key(
                goal_id, date_local,
            )


def test_deadline_alert_notification_identity_is_goal_and_date_scoped():
    from app.core.agents.handlers.timer_trigger_handler import (
        deadline_alert_dedup_key,
        deadline_alert_title,
    )

    assert deadline_alert_title("Ship") == "Deadline 预警: Ship"
    assert deadline_alert_dedup_key("g1", "2026-08-19") == "deadline_alert:g1:2026-08-19"
    assert deadline_alert_dedup_key("g1", "2026-08-18") != deadline_alert_dedup_key(
        "g1", "2026-08-19",
    )
    assert deadline_alert_dedup_key("g1", "2026-08-19") != deadline_alert_dedup_key(
        "g2", "2026-08-19",
    )


@pytest.mark.asyncio
async def test_call_product_unknown_handler():
    """Unknown handler name must not crash — should log warning and return."""
    from app.core.agents.handlers.timer_trigger_handler import _call_product

    result = await _call_product("nonexistent_handler")
    # Unknown handler path logs warning and returns None (no-op)
    assert result is None


@pytest.mark.asyncio
@patch("app.core.runtime.notification_channel.notification_router.notify")
@patch("app.product.morning_brief.generate_morning_brief")
async def test_run_morning_brief_uses_dated_title_and_dedup(mock_gen, mock_notify):
    from app.core.agents.handlers.timer_trigger_handler import _call_product
    from app.product.morning_brief import MorningBriefResult

    mock_gen.return_value = MorningBriefResult(
        brief="早安！2026年08月19日 简报",
        date_local="2026-08-19",
    )
    mock_notify.return_value = {"persisted": True}

    await _call_product("morning_brief")

    mock_notify.assert_awaited_once()
    args, kwargs = mock_notify.call_args
    assert args[0] == "早安简报 - 2026-08-19"
    assert args[1] == "早安！2026年08月19日 简报"
    assert kwargs["type_"] == "morning_brief"
    assert kwargs["persist"] is True
    assert kwargs["dedup_key"] == "morning_brief:2026-08-19"
