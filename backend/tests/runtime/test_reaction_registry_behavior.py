"""reaction_registry — ReactionWhen gating, register/unregister, state-gate
decision, evaluate_cycle isolation, list_reactions, and the @reaction
decorator."""

from __future__ import annotations

import pytest

from app.core.runtime.reaction_registry import (
    Reaction,
    ReactionRegistry,
    ReactionThen,
    ReactionWhen,
    get_reaction_registry,
    reset_reactions,
)


class _FakeEvent:
    def __init__(self, type: str = "", aggregate_type: str = ""):
        self.type = type
        self.aggregate_type = aggregate_type


# ── ReactionWhen.matches_event ─────────────────────────────────────────────


def test_matches_event_requires_event_type_when_configured():
    when = ReactionWhen(event_type="InboxEmailRecorded")
    assert when.matches_event(_FakeEvent(type="InboxEmailRecorded"))
    assert not when.matches_event(_FakeEvent(type="OtherEvent"))


def test_matches_event_event_types_list():
    when = ReactionWhen(event_types=["A", "B"])
    assert when.matches_event(_FakeEvent(type="A"))
    assert when.matches_event(_FakeEvent(type="B"))
    assert not when.matches_event(_FakeEvent(type="C"))


def test_matches_event_event_type_prefers_explicit_list():
    # event_types 优先于 event_type
    when = ReactionWhen(event_type="A", event_types=["B"])
    assert when.matches_event(_FakeEvent(type="B"))
    assert not when.matches_event(_FakeEvent(type="A"))


def test_matches_event_aggregate_type_filter():
    when = ReactionWhen(aggregate_type="work_item")
    assert when.matches_event(_FakeEvent(aggregate_type="work_item"))
    assert not when.matches_event(_FakeEvent(aggregate_type="memory"))


def test_matches_event_combined_filters():
    when = ReactionWhen(event_type="WorkItemUpdated", aggregate_type="work_item")
    assert when.matches_event(_FakeEvent("WorkItemUpdated", "work_item"))
    assert not when.matches_event(_FakeEvent("WorkItemUpdated", "memory"))
    assert not when.matches_event(_FakeEvent("WorkItemCreated", "work_item"))


def test_matches_event_no_filters_matches_any():
    when = ReactionWhen()
    assert when.matches_event(_FakeEvent("Anything", "whatever"))


# ── ReactionWhen.is_periodic ───────────────────────────────────────────────


def test_is_periodic_every_cycle_opt_in():
    assert ReactionWhen(every_cycle=True).is_periodic()


def test_is_periodic_count_gte_opt_in_without_every_cycle():
    assert ReactionWhen(count_gte=5).is_periodic()


def test_is_periodic_state_selector_opt_in():
    assert ReactionWhen(state_selector="inbox_emails").is_periodic()


def test_is_periodic_false_when_all_empty():
    assert not ReactionWhen().is_periodic()
    # 仅描述性 event_type 不参与周期性评估
    assert not ReactionWhen(event_type="InboxEmailRecorded").is_periodic()


# ── register / unregister ──────────────────────────────────────────────────


def test_register_overwrites_same_name():
    reg = ReactionRegistry()
    reg.register(Reaction("r", handler=lambda k: None))
    reg.register(Reaction("r", handler=lambda k: None))
    assert len(reg.list_reactions()) == 1


def test_unregister_returns_presence():
    reg = ReactionRegistry()
    reg.register(Reaction("r", handler=lambda k: None))
    assert reg.unregister("r") is True
    assert reg.unregister("r") is False


# ── _state_gate_passes ─────────────────────────────────────────────────────


class _FakeKernel:
    def __init__(self, *, supports_count=True, count=10, rows=None):
        self.supports = supports_count
        self.count = count
        self.rows = rows if rows is not None else []
        self.count_calls: list[tuple] = []
        self.query_calls: list[tuple] = []

    def supports_count_state(self, selector):
        return self.supports

    def count_state(self, selector, **filters):
        self.count_calls.append((selector, filters))
        return self.count

    def query_state(self, selector, **filters):
        self.query_calls.append((selector, filters))
        return self.rows


def _gated_reaction(*, selector="inbox_emails", count_gte=50, filters=None):
    return Reaction(
        "gated",
        handler=lambda k: None,
        when=ReactionWhen(
            state_selector=selector,
            state_filters=filters if filters is not None else {"status": "pending"},
            count_gte=count_gte,
        ),
    )


def test_gate_passes_without_selector_or_threshold(monkeypatch):
    reg = ReactionRegistry()
    kernel = _FakeKernel()
    monkeypatch.setattr(kernel, "count_state", lambda *a, **k: pytest.fail("must not query"))
    monkeypatch.setattr(kernel, "query_state", lambda *a, **k: pytest.fail("must not query"))
    reaction = Reaction("plain", handler=lambda k: None, when=ReactionWhen())
    assert reg._state_gate_passes(reaction, kernel) is True


def test_gate_uses_count_state_when_supported():
    reg = ReactionRegistry()
    kernel = _FakeKernel(supports_count=True, count=50)
    reaction = _gated_reaction(count_gte=50)
    assert reg._state_gate_passes(reaction, kernel) is True
    assert kernel.count_calls == [("inbox_emails", {"status": "pending"})]
    assert kernel.query_calls == []


def test_gate_count_below_threshold_fails():
    reg = ReactionRegistry()
    kernel = _FakeKernel(supports_count=True, count=49)
    assert reg._state_gate_passes(_gated_reaction(count_gte=50), kernel) is False


def test_gate_falls_back_to_query_state_when_not_supported():
    reg = ReactionRegistry()
    kernel = _FakeKernel(supports_count=False, rows=[{"id": "a"}, {"id": "b"}])
    reaction = _gated_reaction(count_gte=2)
    assert reg._state_gate_passes(reaction, kernel) is True
    assert kernel.count_calls == []
    assert kernel.query_calls == [("inbox_emails", {"limit": 2, "status": "pending"})]


def test_gate_query_fallback_below_threshold_fails():
    reg = ReactionRegistry()
    kernel = _FakeKernel(supports_count=False, rows=[{"id": "a"}])
    assert reg._state_gate_passes(_gated_reaction(count_gte=2), kernel) is False


def test_gate_query_exception_returns_false():
    reg = ReactionRegistry()

    class _ExplodingKernel:
        def supports_count_state(self, selector):
            return False

        def query_state(self, selector, **filters):
            raise RuntimeError("db down")

    assert reg._state_gate_passes(_gated_reaction(), _ExplodingKernel()) is False


# ── evaluate_cycle ─────────────────────────────────────────────────────────


def test_evaluate_cycle_skips_handlerless_and_non_periodic():
    reg = ReactionRegistry()
    calls: list[str] = []
    reg.register(Reaction("no-handler", when=ReactionWhen(every_cycle=True)))
    reg.register(Reaction("non-periodic", handler=lambda k: calls.append("np")))
    assert reg.evaluate_cycle(_FakeKernel()) == 0
    assert calls == []


def test_evaluate_cycle_gate_failure_skips_handler():
    reg = ReactionRegistry()
    calls: list[str] = []
    reg.register(
        Reaction(
            "gated",
            handler=lambda k: calls.append("fired"),
            when=ReactionWhen(state_selector="inbox_emails", count_gte=50),
        )
    )
    kernel = _FakeKernel(supports_count=True, count=10)
    assert reg.evaluate_cycle(kernel) == 0
    assert calls == []


def test_evaluate_cycle_invokes_handler_and_counts_fired():
    reg = ReactionRegistry()
    calls: list[str] = []
    reg.register(
        Reaction("every", handler=lambda k: calls.append("every"),
                 when=ReactionWhen(every_cycle=True))
    )
    reg.register(
        Reaction("gated-pass", handler=lambda k: calls.append("gated-pass"),
                 when=ReactionWhen(state_selector="inbox_emails", count_gte=1))
    )
    kernel = _FakeKernel(supports_count=True, count=1)
    assert reg.evaluate_cycle(kernel) == 2
    assert calls == ["every", "gated-pass"]


def test_evaluate_cycle_handler_exception_does_not_break_others():
    reg = ReactionRegistry()
    calls: list[str] = []

    def _boom(k):
        raise RuntimeError("handler crashed")

    reg.register(Reaction("boom", handler=_boom, when=ReactionWhen(every_cycle=True)))
    reg.register(Reaction("ok", handler=lambda k: calls.append("ok"),
                          when=ReactionWhen(every_cycle=True)))
    assert reg.evaluate_cycle(_FakeKernel()) == 1
    assert calls == ["ok"]


# ── list_reactions ─────────────────────────────────────────────────────────


def _reaction_list_snapshot(reg):
    return sorted(reg.list_reactions(), key=lambda r: r["name"])


def test_list_reactions_gated_by_classification():
    reg = ReactionRegistry()
    reg.register(_gated_reaction())  # state gate
    reg.register(Reaction("handler-only", handler=lambda k: None))  # handler
    reg.register(Reaction("bare"))  # none

    by_name = {r["name"]: r for r in reg.list_reactions()}
    assert by_name["gated"]["gated_by"] == "state"
    assert by_name["gated"]["threshold"] == 50
    assert by_name["gated"]["state_selector"] == "inbox_emails"
    assert by_name["handler-only"]["gated_by"] == "handler"
    assert by_name["bare"]["gated_by"] == "none"
    assert by_name["bare"]["has_handler"] is False


def test_list_reactions_every_cycle_flag():
    reg = ReactionRegistry()
    reg.register(Reaction("periodic", handler=lambda k: None,
                          when=ReactionWhen(every_cycle=True)))
    reg.register(Reaction("selector", handler=lambda k: None,
                          when=ReactionWhen(state_selector="x")))
    by_name = {r["name"]: r for r in reg.list_reactions()}
    assert by_name["periodic"]["every_cycle"] is True
    assert by_name["selector"]["every_cycle"] is True  # state_selector 也算 periodic


# ── reset_reactions ────────────────────────────────────────────────────────


def test_reset_reactions_clears_registry():
    get_reaction_registry().register(
        Reaction("leak", handler=lambda k: None, when=ReactionWhen(every_cycle=True))
    )
    try:
        reset_reactions()
        assert get_reaction_registry().list_reactions() == []
        assert get_reaction_registry().evaluate_cycle(_FakeKernel()) == 0
    finally:
        reset_reactions()


# ── @reaction decorator ────────────────────────────────────────────────────


def test_reaction_decorator_registers_with_default_and_custom_name():
    reset_reactions()
    try:
        from app.core.runtime.reaction_registry import reaction

        @reaction(when=ReactionWhen(every_cycle=True))
        def my_periodic_check(kernel=None):
            return "ok"

        @reaction(when=ReactionWhen(every_cycle=True), name="custom_name")
        def other(kernel=None):
            return "ok"

        names = {r["name"] for r in get_reaction_registry().list_reactions()}
        assert "my_periodic_check" in names
        assert "custom_name" in names
        assert "other" not in names
    finally:
        reset_reactions()
