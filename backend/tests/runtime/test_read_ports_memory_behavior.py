"""read_ports.memory — retrieval paths, query/count parameter forwarding."""

from __future__ import annotations

import pytest

from app.core.runtime.read_ports import memory as memory_port


class FakeKernel:
    def __init__(self):
        self.query_calls: list[tuple] = []
        self.count_calls: list[tuple] = []
        self.aggregate_calls: list[tuple] = []

    def query_state(self, selector: str, **filters):
        self.query_calls.append((selector, filters))
        return [{"selector": selector, **filters}]

    def count_state(self, selector: str, **filters):
        self.count_calls.append((selector, filters))
        return 7

    def aggregate_state(self, selector: str, **filters):
        self.aggregate_calls.append((selector, filters))
        return {"total_memories": 10}


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
