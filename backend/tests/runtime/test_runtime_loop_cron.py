"""Cron next-fire boundary cases for RuntimeLoop._next_cron_fire."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.core.runtime.runtime_loop import RuntimeLoop


@pytest.fixture(autouse=True)
def _tz_shanghai(monkeypatch):
    monkeypatch.setattr(
        "app.core.runtime.runtime_loop.settings.timezone",
        "Asia/Shanghai",
    )


def test_minute_star_slash_5_advances_within_hour():
    """minute=*/5 from :02 → next block :05 (local), returned as UTC Z."""
    from_ts = datetime(2026, 8, 4, 10, 2, 0, tzinfo=UTC)  # 18:02 Shanghai
    result = RuntimeLoop._next_cron_fire("minute=*/5", from_ts=from_ts)
    assert result.endswith("Z")
    nxt = datetime.fromisoformat(result.replace("Z", "+00:00"))
    # 18:05 CST = 10:05 UTC
    assert nxt == datetime(2026, 8, 4, 10, 5, tzinfo=UTC)


def test_minute_star_slash_5_rolls_to_next_hour():
    """minute=*/5 from :58 → next hour :00+interval."""
    from_ts = datetime(2026, 8, 4, 10, 58, 0, tzinfo=UTC)  # 18:58 Shanghai
    result = RuntimeLoop._next_cron_fire("minute=*/5", from_ts=from_ts)
    nxt = datetime.fromisoformat(result.replace("Z", "+00:00"))
    # next_minute=60 → hour+1, minute 0 → 19:00 CST = 11:00 UTC
    assert nxt == datetime(2026, 8, 4, 11, 0, tzinfo=UTC)


def test_daily_hour_minute_rolls_to_tomorrow_when_past():
    """hour=9,minute=0 after 09:00 local → next day 09:00."""
    # 18:30 Shanghai = 10:30 UTC on Aug 4
    from_ts = datetime(2026, 8, 4, 10, 30, 0, tzinfo=UTC)
    result = RuntimeLoop._next_cron_fire("hour=9,minute=0", from_ts=from_ts)
    nxt = datetime.fromisoformat(result.replace("Z", "+00:00"))
    # Aug 5 09:00 CST = Aug 5 01:00 UTC
    assert nxt == datetime(2026, 8, 5, 1, 0, tzinfo=UTC)


def test_naive_from_ts_treated_as_utc():
    """Naive timestamps are interpreted as UTC then converted to local TZ."""
    from_ts = datetime(2026, 8, 4, 1, 0, 0)  # naive → UTC → 09:00 Shanghai
    result = RuntimeLoop._next_cron_fire("hour=10,minute=0", from_ts=from_ts)
    nxt = datetime.fromisoformat(result.replace("Z", "+00:00"))
    # Same day 10:00 CST = 02:00 UTC
    assert nxt == datetime(2026, 8, 4, 2, 0, tzinfo=UTC)


def test_day_of_week_name_advances_to_named_weekday():
    """day_of_week=mon picks the next Monday at the given hour/minute."""
    # 2026-08-04 is Tuesday
    from_ts = datetime(2026, 8, 4, 1, 0, 0, tzinfo=UTC)
    result = RuntimeLoop._next_cron_fire(
        "hour=9,minute=0,day_of_week=mon",
        from_ts=from_ts,
    )
    nxt = datetime.fromisoformat(result.replace("Z", "+00:00"))
    # Next Monday 09:00 CST = 2026-08-10 01:00 UTC
    assert nxt == datetime(2026, 8, 10, 1, 0, tzinfo=UTC)


def test_day_of_week_keeps_today_when_time_has_not_arrived():
    """Sunday 05:00 local + day_of_week=sun,hour=6 → later today, not next week."""
    # 2026-08-02 is Sunday. 05:00 CST = 2026-08-01 21:00 UTC
    from_ts = datetime(2026, 8, 1, 21, 0, 0, tzinfo=UTC)
    result = RuntimeLoop._next_cron_fire(
        "day_of_week=sun,hour=6,minute=0",
        from_ts=from_ts,
    )
    nxt = datetime.fromisoformat(result.replace("Z", "+00:00"))
    # 2026-08-02 06:00 CST = 2026-08-01 22:00 UTC
    assert nxt == datetime(2026, 8, 1, 22, 0, tzinfo=UTC)


def test_day_of_week_rolls_to_next_week_when_todays_slot_passed():
    """Sunday 07:00 local + day_of_week=sun,hour=6 → next Sunday."""
    # 07:00 CST Sunday = 2026-08-01 23:00 UTC
    from_ts = datetime(2026, 8, 1, 23, 0, 0, tzinfo=UTC)
    result = RuntimeLoop._next_cron_fire(
        "day_of_week=sun,hour=6,minute=0",
        from_ts=from_ts,
    )
    nxt = datetime.fromisoformat(result.replace("Z", "+00:00"))
    # 2026-08-09 06:00 CST = 2026-08-08 22:00 UTC
    assert nxt == datetime(2026, 8, 8, 22, 0, tzinfo=UTC)


def test_monthly_day_keeps_this_month_when_not_yet_due():
    """day=15 from Aug 10 local → Aug 15, not Sep 1."""
    # 2026-08-10 18:00 CST = 10:00 UTC
    from_ts = datetime(2026, 8, 10, 10, 0, 0, tzinfo=UTC)
    result = RuntimeLoop._next_cron_fire("day=15,hour=9,minute=0", from_ts=from_ts)
    nxt = datetime.fromisoformat(result.replace("Z", "+00:00"))
    # Aug 15 09:00 CST = Aug 15 01:00 UTC
    assert nxt == datetime(2026, 8, 15, 1, 0, tzinfo=UTC)


def test_monthly_day_rolls_to_next_month_after_the_slot():
    """day=15 from Aug 20 local → Sep 15."""
    from_ts = datetime(2026, 8, 20, 10, 0, 0, tzinfo=UTC)
    result = RuntimeLoop._next_cron_fire("day=15,hour=9,minute=0", from_ts=from_ts)
    nxt = datetime.fromisoformat(result.replace("Z", "+00:00"))
    assert nxt == datetime(2026, 9, 15, 1, 0, tzinfo=UTC)

