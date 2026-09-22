"""Suggestion adoption is rebuilt from ApprovalGranted / ApprovalDenied."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.runtime.read_ports import approvals as approvals_port


class FakeKernel:
    def __init__(self):
        self.events_by_type: dict[str, list] = {}

    def read_events(self, **kwargs):
        items = list(self.events_by_type.get(kwargs.get("type"), []))
        limit = kwargs.get("limit")
        if limit is not None:
            items = items[: int(limit)]
        return items


def _ev(aggregate_id: str, payload: dict, seq: int) -> SimpleNamespace:
    return SimpleNamespace(
        aggregate_id=aggregate_id,
        payload=payload,
        seq=seq,
        ts=f"2026-09-22T00:00:{seq:02d}+00:00",
    )


@pytest.fixture
def fake_kernel(monkeypatch):
    kernel = FakeKernel()
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    return kernel


def test_suggestion_adoption_splits_user_choices_from_system_outcomes(fake_kernel):
    fake_kernel.events_by_type["ApprovalGranted"] = [
        _ev("user_yes", {"reason": "pre_approved"}, 1),
        _ev("auto", {"reason": "auto_allow"}, 2),
        _ev("blank", {}, 3),
    ]
    fake_kernel.events_by_type["ApprovalDenied"] = [
        _ev("user_no", {"reason": "user_denied"}, 4),
        _ev("stale", {"reason": "auto_expired"}, 5),
    ]

    result = approvals_port.summarize_suggestion_adoption(days=7)

    assert result["adopted"] == 2
    assert result["rejected"] == 1
    assert result["expired"] == 1
    assert result["auto_allowed"] == 1
    assert result["decided"] == 3
    assert result["adoption_rate"] == pytest.approx(2 / 3)
    assert result["capped"] is False


def test_suggestion_adoption_keeps_latest_decision_per_approval(fake_kernel):
    fake_kernel.events_by_type["ApprovalGranted"] = [
        _ev("apr_1", {"reason": "pre_approved"}, 1),
    ]
    fake_kernel.events_by_type["ApprovalDenied"] = [
        _ev("apr_1", {"reason": "user_denied"}, 4),
    ]

    result = approvals_port.summarize_suggestion_adoption(days=7)

    assert result["adopted"] == 0
    assert result["rejected"] == 1
    assert result["adoption_rate"] == 0


def test_suggestion_adoption_ignores_ask_user_replies(fake_kernel):
    fake_kernel.events_by_type["ApprovalGranted"] = [
        _ev("clarified", {"action": "ask_user", "reason": "user_reply"}, 1),
        _ev("write", {"action": "write_file", "reason": "pre_approved"}, 2),
    ]
    fake_kernel.events_by_type["ApprovalDenied"] = [
        _ev("cancelled", {"action": "ask_user", "reason": "user_denied"}, 3),
    ]

    result = approvals_port.summarize_suggestion_adoption(days=7)

    assert result["adopted"] == 1
    assert result["rejected"] == 0
    assert result["decided"] == 1


def test_suggestion_adoption_empty_window_has_null_rate(fake_kernel):
    result = approvals_port.summarize_suggestion_adoption(days=7)
    assert result["decided"] == 0
    assert result["adoption_rate"] is None


def test_suggestion_adoption_reports_cap(fake_kernel):
    fake_kernel.events_by_type["ApprovalGranted"] = [
        _ev(f"apr_{i}", {"reason": "pre_approved"}, i) for i in range(3)
    ]
    result = approvals_port.summarize_suggestion_adoption(days=7, limit=2)
    assert result["capped"] is True
    assert result["adopted"] == 2


def test_combine_adoption_adds_tool_suggestions_and_memories():
    combined = approvals_port.combine_adoption(
        {
            "days": 7,
            "adopted": 3,
            "rejected": 1,
            "expired": 2,
            "auto_allowed": 4,
            "decided": 4,
            "adoption_rate": 0.75,
        },
        {
            "days": 7,
            "ratified": 1,
            "rejected": 1,
            "auto_expired": 5,
            "proposed_open": 2,
            "decided": 2,
            "conversion_rate": 0.5,
        },
    )
    assert combined["adopted"] == 4
    assert combined["rejected"] == 2
    assert combined["decided"] == 6
    assert combined["adoption_rate"] == pytest.approx(4 / 6)
    assert combined["suggestions"]["expired"] == 2
    assert combined["memories"]["auto_expired"] == 5
    assert combined["memories"]["proposed_open"] == 2


def test_combine_adoption_null_when_nothing_was_decided():
    combined = approvals_port.combine_adoption(
        {"days": 7, "adopted": 0, "rejected": 0, "expired": 1, "auto_allowed": 1, "decided": 0},
        {"days": 7, "ratified": 0, "rejected": 0, "auto_expired": 1, "decided": 0},
    )
    assert combined["adoption_rate"] is None
    assert combined["decided"] == 0
