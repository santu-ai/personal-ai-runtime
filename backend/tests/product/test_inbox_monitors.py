"""Unit tests for inbox filter monitor matching and evaluation."""

from __future__ import annotations

from app.product import inbox_monitors as mon


def test_filter_matches_and_case_insensitive():
    filt = {"sender_contains": "Boss@", "subject_contains": "URGENT"}
    assert mon.filter_matches_email(
        filt, {"sender": "boss@acme.com", "subject": "Re: urgent review"},
    )
    assert not mon.filter_matches_email(
        filt, {"sender": "boss@acme.com", "subject": "weekly notes"},
    )
    assert not mon.filter_matches_email(
        filt, {"sender": "other@acme.com", "subject": "urgent"},
    )


def test_filter_matches_ignores_empty_fields():
    assert mon.filter_matches_email(
        {"sender_contains": "acme", "subject_contains": ""},
        {"sender": "a@acme.com", "subject": "anything"},
    )
    assert not mon.filter_matches_email(
        {"sender_contains": "", "subject_contains": ""},
        {"sender": "a@acme.com", "subject": "x"},
    )


def test_evaluate_dedups_second_pass(product_kernel, monkeypatch):
    """Dedup uses isolated DB via product_kernel (runtime._db), not the live data dir."""
    _ = product_kernel
    mon.save_monitors_config({"inbox_filters": []})
    row = mon.create_inbox_filter(name="Acme", sender_contains="acme.com")
    stored = [{"id": "m1", "sender": "x@acme.com", "subject": "hi"}]
    seen: list[str] = []

    def fake_find(notif_type, title=None, *, dedup_key=None, kernel=None):
        return {"id": "existing"} if dedup_key in seen else None

    def fake_push(notif_type, title, content, **kwargs):
        key = kwargs.get("dedup_key")
        assert key
        seen.append(key)
        return {"id": "n1", "dedup_key": key}

    monkeypatch.setattr("app.core.runtime.read_ports.find_notification", fake_find)
    monkeypatch.setattr("app.core.runtime.read_ports.push_notification", fake_push)

    assert mon.evaluate_inbox_filters(stored) == 1
    assert mon.evaluate_inbox_filters(stored) == 0
    assert seen == [mon.dedup_key_for(row["id"], "m1")]
