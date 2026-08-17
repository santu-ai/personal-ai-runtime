"""read_ports.memory — retrieval paths, query/count parameter forwarding."""

from __future__ import annotations

import pytest

from app.core.runtime.read_ports import memory as memory_port


class FakeKernel:
    def __init__(self):
        self.query_calls: list[tuple] = []
        self.count_calls: list[tuple] = []
        self.aggregate_calls: list[tuple] = []
        self.read_event_calls: list[dict] = []
        self.events_by_type: dict[str, list] = {}

    def query_state(self, selector: str, **filters):
        self.query_calls.append((selector, filters))
        return [{"selector": selector, **filters}]

    def count_state(self, selector: str, **filters):
        self.count_calls.append((selector, filters))
        return 7

    def aggregate_state(self, selector: str, **filters):
        self.aggregate_calls.append((selector, filters))
        return {"total_memories": 10}

    def read_events(self, **kwargs):
        self.read_event_calls.append(kwargs)
        event_type = kwargs.get("type")
        items = list(self.events_by_type.get(event_type, []))
        limit = kwargs.get("limit")
        if limit is not None:
            items = items[: int(limit)]
        return items


@pytest.fixture
def fake_kernel(monkeypatch):
    k = FakeKernel()
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)
    return k


def test_query_memory_filters_by_id(fake_kernel):
    row = memory_port.query_memory("m1")
    assert fake_kernel.query_calls == [("memories", {"id": "m1", "limit": 1})]
    assert row["id"] == "m1"


def test_query_memory_none_when_empty(fake_kernel):
    fake_kernel.query_calls = []
    fake_kernel.query_state = lambda *_a, **_k: []  # type: ignore[assignment]
    assert memory_port.query_memory("missing") is None


def test_query_memories_forwards_all_filters(fake_kernel):
    memory_port.query_memories(
        category="fact",
        limit=10,
        order="confidence_desc",
        confidence_gt=0.5,
        confidence_lt=0.9,
        decay_eligible=True,
    )
    assert fake_kernel.query_calls == [
        (
            "memories",
            {
                "limit": 10,
                "category": "fact",
                "order": "confidence_desc",
                "confidence_gt": 0.5,
                "confidence_lt": 0.9,
                "decay_eligible": True,
            },
        ),
    ]


def test_query_memories_omits_optional_filters(fake_kernel):
    memory_port.query_memories(limit=5)
    assert fake_kernel.query_calls == [("memories", {"limit": 5})]


@pytest.mark.parametrize(
    "kwargs,expected",
    [
        ({}, {}),
        ({"category": "fact"}, {"category": "fact"}),
        ({"origin": "conversation"}, {"origin": "conversation"}),
        ({"claim_status": "claimed"}, {"claim_status": "claimed"}),
        ({"confidence_gt": 0.3}, {"confidence_gt": 0.3}),
        ({"confidence_lt": 0.7}, {"confidence_lt": 0.7}),
        ({"decay_eligible": True}, {"decay_eligible": True}),
        (
            {"category": "goal", "origin": "test", "claim_status": "unclaimed"},
            {"category": "goal", "origin": "test", "claim_status": "unclaimed"},
        ),
    ],
)
def test_count_memories_forwards_filters(fake_kernel, kwargs, expected):
    assert memory_port.count_memories(**kwargs) == 7
    assert fake_kernel.count_calls == [("memories", expected)]


def test_summarize_memory_stats_forwards(fake_kernel):
    result = memory_port.summarize_memory_stats()
    assert fake_kernel.aggregate_calls == [("memory_stats", {})]
    assert result["total_memories"] == 10


class _Ev:
    def __init__(self, aggregate_id, payload, type_="ClaimRejected", seq=None, ts=""):
        self.aggregate_id = aggregate_id
        self.payload = payload
        self.type = type_
        self.seq = seq
        self.ts = ts


def test_attach_claim_reject_reasons_uses_latest_event(fake_kernel):
    fake_kernel.events_by_type["ClaimRejected"] = [
        _Ev("m1", {"reason": "不准确"}),
        _Ev("m1", {"reason": "旧原因"}),
        _Ev("m2", {"reason": "  "}),
    ]
    rows = [
        {"id": "m1", "claim_status": "rejected", "content": "a"},
        {"id": "m2", "claim_status": "rejected", "content": "b"},
        {"id": "m3", "claim_status": "proposed", "content": "c"},
    ]
    out = memory_port.attach_claim_reject_reasons(rows)
    assert out[0]["reject_reason"] == "不准确"
    assert out[1]["reject_reason"] is None
    assert "reject_reason" not in out[2]


def test_attach_claim_reject_reasons_skips_when_none_rejected(fake_kernel):
    out = memory_port.attach_claim_reject_reasons(
        [{"id": "m1", "claim_status": "proposed"}],
    )
    assert fake_kernel.read_event_calls == []
    assert out[0]["claim_status"] == "proposed"


def test_summarize_claim_conversion(fake_kernel):
    fake_kernel.events_by_type["ClaimRatified"] = [_Ev("a", {}), _Ev("b", {})]
    fake_kernel.events_by_type["ClaimRejected"] = [_Ev("c", {"reason": "no"})]
    result = memory_port.summarize_claim_conversion(days=30)
    assert result["proposed_open"] == 7
    assert result["ratified"] == 2
    assert result["rejected"] == 1
    assert result["decided"] == 3
    assert result["conversion_rate"] == pytest.approx(2 / 3)
    assert result["false_positive_rate"] == pytest.approx(1 / 3)
    assert result["days"] == 30


def test_summarize_claim_conversion_deduplicates_latest_decision(fake_kernel):
    fake_kernel.events_by_type["ClaimRatified"] = [
        _Ev("m1", {}, type_="ClaimRatified", seq=2),
        _Ev("m2", {}, type_="ClaimRatified", seq=1),
    ]
    fake_kernel.events_by_type["ClaimRejected"] = [
        _Ev("m1", {"reason": "corrected"}, seq=3),
        _Ev("m3", {"reason": "wrong"}, seq=4),
    ]

    result = memory_port.summarize_claim_conversion(days=30)

    assert result["ratified"] == 1
    assert result["rejected"] == 2
    assert result["decided"] == 3
    assert result["conversion_rate"] == pytest.approx(1 / 3)
    assert result["false_positive_rate"] == pytest.approx(2 / 3)


# ── Retrieval paths (mock memory_engine) ──────────────────────────────────


class _FakeMemoryEngine:
    def __init__(self):
        self.context_calls: list[tuple] = []
        self.recall_calls: list[tuple] = []
        self._hits = []

    def retrieve_context_string(self, query: str, *, max_memories: int):
        self.context_calls.append((query, max_memories))
        return "## Relevant Memories\n- recalled"

    def recall_for_context(self, query: str, *, max_memories: int = 3, overfetch_factor: int = 4):
        self.recall_calls.append((query, max_memories))
        return list(self._hits)[:max_memories]

    def format_memory_context(self, enriched):
        if not enriched:
            return "## Relevant Memories\n- (none)"
        return "## Relevant Memories\n- " + "\n- ".join(
            m.get("content", "") for m in enriched
        )


@pytest.fixture
def fake_memory_engine(monkeypatch):
    engine = _FakeMemoryEngine()
    monkeypatch.setattr("app.core.agents.memory_engine.memory_engine", engine)
    return engine


def test_retrieve_memory_context_forwards_query(fake_memory_engine):
    result = memory_port.retrieve_memory_context("who am i", max_memories=5)
    assert fake_memory_engine.context_calls == [("who am i", 5)]
    assert "recalled" in result


def test_recall_memories_for_context_forwards_query(fake_memory_engine):
    fake_memory_engine._hits = [{"id": "m1", "content": "likes tea", "category": "habit"}]
    hits = memory_port.recall_memories_for_context("tea", max_memories=3)
    assert fake_memory_engine.recall_calls == [("tea", 3)]
    assert hits == [{"id": "m1", "content": "likes tea", "category": "habit"}]


def test_retrieve_memory_with_sources_returns_context_and_sources(fake_memory_engine):
    fake_memory_engine._hits = [
        {"id": "m1", "content": "likes tea" * 20},  # > 80 chars → truncated title
        {"id": "m2", "content": "short"},
        {"no_id": True, "content": "skipped"},  # no id → excluded from sources
    ]
    context, sources = memory_port.retrieve_memory_with_sources("tea", max_memories=3)

    assert fake_memory_engine.recall_calls == [("tea", 3)]
    assert "likes tea" in context
    assert sources == [
        {"id": "m1", "type": "memory", "title": ("likes tea" * 20)[:80]},
        {"id": "m2", "type": "memory", "title": "short"},
    ]


def test_retrieve_memory_with_sources_empty_hits(fake_memory_engine):
    context, sources = memory_port.retrieve_memory_with_sources("nothing")
    # 端口透传 context（格式由 memory_engine 决定），自身只保证空 hits 不抛错、
    # sources 为空。
    assert isinstance(context, str) and context
    assert sources == []
