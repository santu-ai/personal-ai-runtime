"""Unit tests for URL diff monitors."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.product import inbox_monitors as inbox_mon
from app.product import url_monitors as um


def test_content_hash_normalizes_whitespace():
    a = um.content_hash("Hello   World\n")
    b = um.content_hash("hello world")
    assert a == b
    assert a != um.content_hash("hello other")


def test_validate_url_rejects_bad_scheme():
    with pytest.raises(ValueError, match="http"):
        um.validate_url_fields(name="x", url="ftp://example.com")
    with pytest.raises(ValueError, match="name"):
        um.validate_url_fields(name="  ", url="https://example.com")


def test_due_for_check_respects_interval():
    now = datetime(2026, 8, 6, 12, 0, tzinfo=UTC)
    never = {"enabled": True, "check_interval_minutes": 60, "last_checked_at": None}
    assert um.due_for_check(never, now=now)

    recent = {
        "enabled": True,
        "check_interval_minutes": 60,
        "last_checked_at": (now - timedelta(minutes=30)).isoformat(),
    }
    assert not um.due_for_check(recent, now=now)

    stale = {
        "enabled": True,
        "check_interval_minutes": 60,
        "last_checked_at": (now - timedelta(minutes=61)).isoformat(),
    }
    assert um.due_for_check(stale, now=now)


def test_config_merge_preserves_sibling_lists(product_kernel):
    """Saving inbox filters must not wipe url_monitors (and vice versa)."""
    _ = product_kernel
    inbox_mon.save_monitors_config({"inbox_filters": [], "url_monitors": []})
    um.create_url_monitor(name="HN", url="https://news.ycombinator.com/")
    inbox_mon.create_inbox_filter(name="Acme", sender_contains="acme.com")

    cfg = inbox_mon.load_monitors_config()
    assert len(cfg["inbox_filters"]) == 1
    assert len(cfg["url_monitors"]) == 1
    assert cfg["url_monitors"][0]["name"] == "HN"


@pytest.mark.asyncio
async def test_evaluate_baseline_then_change(product_kernel, monkeypatch):
    _ = product_kernel
    inbox_mon.save_monitors_config({"inbox_filters": [], "url_monitors": []})
    row = um.create_url_monitor(name="Page", url="https://example.com/page")
    seen: list[str] = []
    pages = [
        {"title": "v1", "content": "alpha content here"},
        {"title": "v2", "content": "beta content changed"},
        {"title": "v2", "content": "beta content changed"},
    ]
    call = {"i": 0}

    async def fake_fetch(url: str) -> dict:
        del url
        i = call["i"]
        call["i"] += 1
        return pages[min(i, len(pages) - 1)]

    def fake_find(notif_type, title=None, *, dedup_key=None, kernel=None):
        del notif_type, title, kernel
        return {"id": "existing"} if dedup_key in seen else None

    def fake_push(notif_type, title, content, **kwargs):
        del notif_type, title, content
        key = kwargs.get("dedup_key")
        assert key
        seen.append(key)
        return {"id": "n1", "dedup_key": key}

    monkeypatch.setattr(um, "_fetch_page", fake_fetch)
    monkeypatch.setattr("app.core.runtime.read_ports.find_notification", fake_find)
    monkeypatch.setattr("app.core.runtime.read_ports.push_notification", fake_push)

    assert await um.evaluate_url_monitors(force=True) == 0  # baseline
    stored = um.list_url_monitors()[0]
    assert stored["last_hash"] == um.content_hash("alpha content here")

    assert await um.evaluate_url_monitors(force=True) == 1  # change
    assert await um.evaluate_url_monitors(force=True) == 0  # same content, dedup
    digest = um.content_hash("beta content changed")
    assert seen == [um.dedup_key_for(row["id"], digest)]


def test_url_change_resets_baseline(product_kernel):
    _ = product_kernel
    inbox_mon.save_monitors_config({"url_monitors": []})
    row = um.create_url_monitor(name="P", url="https://example.com/a")
    monitors = um.list_url_monitors()
    monitors[0]["last_hash"] = "abc"
    inbox_mon.save_monitors_config({"url_monitors": monitors})

    updated = um.update_url_monitor(row["id"], url="https://example.com/b")
    assert updated["last_hash"] is None
    assert updated["url"] == "https://example.com/b"


def test_save_aborts_when_strict_load_fails(product_kernel, monkeypatch):
    """Merge write must not wipe sibling lists if the read for merge fails."""
    _ = product_kernel
    inbox_mon.save_monitors_config({
        "inbox_filters": [{"id": "if_keep", "name": "Keep", "enabled": True,
                           "sender_contains": "a", "subject_contains": ""}],
        "url_monitors": [],
    })

    def boom():
        raise RuntimeError("db down")

    with monkeypatch.context() as m:
        m.setattr(inbox_mon, "_load_monitors_config_strict", boom)
        with pytest.raises(RuntimeError, match="db down"):
            inbox_mon.save_monitors_config({"url_monitors": [{"id": "um_x"}]})

    cfg = inbox_mon.load_monitors_config()
    assert len(cfg["inbox_filters"]) == 1
    assert cfg["inbox_filters"][0]["id"] == "if_keep"


@pytest.mark.asyncio
async def test_cron_path_caps_checks_per_tick(product_kernel, monkeypatch):
    _ = product_kernel
    inbox_mon.save_monitors_config({"inbox_filters": [], "url_monitors": []})
    for i in range(5):
        um.create_url_monitor(name=f"P{i}", url=f"https://example.com/{i}")

    fetches: list[str] = []

    async def fake_fetch(url: str) -> dict:
        fetches.append(url)
        return {"title": "t", "content": f"body-{url}"}

    monkeypatch.setattr(um, "_fetch_page", fake_fetch)
    monkeypatch.setattr(
        "app.core.runtime.read_ports.find_notification",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.push_notification",
        lambda *a, **k: {"id": "n"},
    )

    assert await um.evaluate_url_monitors(force=False) == 0  # baselines only
    assert len(fetches) == um.MAX_CHECKS_PER_CRON
