"""Cross-session memory benefit: a later task sees only memories that should help.

Each case is an earlier session's stored memories and a later task query.
The later task result is the memory context that session would receive.
Memory helped when that context carries the current fact and the same task
with an empty store does not.
"""

from __future__ import annotations

import pytest

from app.core.agents.memory_engine import MemoryEngine


def _mem(
    memory_id: str,
    content: str,
    claim_status: str | None,
    created_at: str,
    confidence: float = 0.8,
) -> dict:
    return {
        "id": memory_id,
        "content": content,
        "claim_status": claim_status,
        "created_at": created_at,
        "confidence": confidence,
        "category": "fact",
    }


CASES: list[dict] = [
    {
        "id": "ratified-fact-helps",
        "theme": "ratified",
        "query": "项目暗号是什么",
        "memories": [
            _mem("m1", "项目暗号是 QOMOLANGMA-DF-W36-0901-R1", "ratified", "2026-09-01 10:00:00"),
        ],
        "hits": ["m1"],
        "helps": ["QOMOLANGMA-DF-W36-0901-R1"],
        "absent": [],
    },
    {
        "id": "self-report-helps",
        "theme": "ratified",
        "query": "我用什么语言",
        "memories": [
            _mem("m1", "用户主要写 Python", None, "2026-09-01 10:00:00"),
        ],
        "hits": ["m1"],
        "helps": ["Python"],
        "absent": [],
    },
    {
        "id": "proposed-does-not-help",
        "theme": "proposed",
        "query": "项目暗号是什么",
        "memories": [
            _mem("p1", "项目暗号是 PROPOSED-ONLY-0901", "proposed", "2026-09-01 10:00:00"),
        ],
        "hits": ["p1"],
        "helps": [],
        "absent": ["PROPOSED-ONLY-0901"],
    },
    {
        "id": "rejected-does-not-help",
        "theme": "rejected",
        "query": "项目暗号是什么",
        "memories": [
            _mem("r1", "项目暗号是 REJECTED-OLD-0818", "rejected", "2026-08-18 09:00:00"),
        ],
        "hits": ["r1"],
        "helps": [],
        "absent": ["REJECTED-OLD-0818"],
    },
    {
        "id": "contested-does-not-help",
        "theme": "rejected",
        "query": "预算口径",
        "memories": [
            _mem("c1", "预算口径是 CONTESTED-100", "contested", "2026-09-01 10:00:00"),
        ],
        "hits": ["c1"],
        "helps": [],
        "absent": ["CONTESTED-100"],
    },
    {
        "id": "newer-ratified-comes-first",
        "theme": "recency",
        "query": "这周的暗号",
        "memories": [
            _mem("old", "暗号是 TIANSHAN-DF-W34-0818", "ratified", "2026-08-18 09:14:02", 0.5),
            _mem("new", "暗号是 HUASHAN-DF-W34-R3-0819", "ratified", "2026-08-19 11:02:41", 0.5),
        ],
        "hits": ["old", "new"],
        "helps": ["HUASHAN-DF-W34-R3-0819"],
        "absent": [],
        "before": ("HUASHAN-DF-W34-R3-0819", "TIANSHAN-DF-W34-0818"),
    },
    {
        "id": "decayed-fact-does-not-help",
        "theme": "decayed",
        "query": "偏好",
        "memories": [
            _mem("low", "偏好是 DECAYED-TEA", "ratified", "2026-08-01 00:00:00", 0.2),
            _mem("high", "偏好是 CURRENT-COFFEE", "ratified", "2026-08-02 00:00:00", 0.8),
        ],
        "hits": ["low", "high"],
        "helps": ["CURRENT-COFFEE"],
        "absent": ["DECAYED-TEA"],
    },
    {
        "id": "confidence-at-threshold-helps",
        "theme": "decayed",
        "query": "偏好",
        "memories": [
            _mem("edge", "偏好是 THRESHOLD-030", "ratified", "2026-08-02 00:00:00", 0.3),
        ],
        "hits": ["edge"],
        "helps": ["THRESHOLD-030"],
        "absent": [],
    },
    {
        "id": "just-below-threshold-does-not-help",
        "theme": "decayed",
        "query": "偏好",
        "memories": [
            _mem("edge", "偏好是 BELOW-029", "ratified", "2026-08-02 00:00:00", 0.29),
        ],
        "hits": ["edge"],
        "helps": [],
        "absent": ["BELOW-029"],
    },
    {
        "id": "superseded-fact-does-not-help",
        "theme": "superseded",
        "query": "暗号",
        "memories": [
            _mem("old", "暗号是 SUPERSEDED-TIANSHAN", "ratified", "2026-08-18 09:00:00"),
            _mem("new", "暗号是 CURRENT-HUASHAN", "ratified", "2026-08-19 11:00:00"),
        ],
        "hits": ["old", "new"],
        "superseded": ["old"],
        "helps": ["CURRENT-HUASHAN"],
        "absent": ["SUPERSEDED-TIANSHAN"],
    },
    {
        "id": "empty-store-does-not-invent",
        "theme": "baseline",
        "query": "项目暗号是什么",
        "memories": [],
        "hits": [],
        "helps": [],
        "absent": ["QOMOLANGMA"],
    },
    {
        "id": "overfetch-keeps-ratified-behind-proposed",
        "theme": "ratified",
        "query": "我是谁",
        "memories": [
            _mem("p1", "待确认 PROPOSED-A", "proposed", "2026-09-01 01:00:00"),
            _mem("p2", "待确认 PROPOSED-B", "proposed", "2026-09-01 02:00:00"),
            _mem("p3", "待确认 PROPOSED-C", "proposed", "2026-09-01 03:00:00"),
            _mem("ok", "已确认身份 RATIFIED-SELF", "ratified", "2026-09-01 04:00:00"),
        ],
        "hits": ["p1", "p2", "p3", "ok"],
        "helps": ["RATIFIED-SELF"],
        "absent": ["PROPOSED-A", "PROPOSED-B", "PROPOSED-C"],
        "max_memories": 1,
    },
    {
        "id": "missing-projection-does-not-help",
        "theme": "baseline",
        "query": "暗号",
        "memories": [],
        "hits": ["gone"],
        "helps": [],
        "absent": ["GONE-FACT"],
    },
    {
        "id": "blank-hit-id-is-ignored",
        "theme": "baseline",
        "query": "暗号",
        "memories": [
            _mem("ok", "暗号是 KEPT-FACT", "ratified", "2026-09-01 10:00:00"),
        ],
        "hits": ["", "ok"],
        "helps": ["KEPT-FACT"],
        "absent": [],
    },
    {
        "id": "rejected-does-not-crowd-out-current",
        "theme": "rejected",
        "query": "预算",
        "memories": [
            _mem("bad", "预算是 REJECTED-200", "rejected", "2026-09-02 10:00:00"),
            _mem("good", "预算是 RATIFIED-100", "ratified", "2026-09-01 10:00:00"),
        ],
        "hits": ["bad", "good"],
        "helps": ["RATIFIED-100"],
        "absent": ["REJECTED-200"],
        "max_memories": 1,
    },
    {
        "id": "newest-of-three-leads",
        "theme": "recency",
        "query": "截止日期",
        "memories": [
            _mem("a", "截止日期 DATE-OLDEST", "ratified", "2026-07-01 00:00:00", 0.9),
            _mem("b", "截止日期 DATE-MIDDLE", "ratified", "2026-08-01 00:00:00", 0.9),
            _mem("c", "截止日期 DATE-NEWEST", "ratified", "2026-09-01 00:00:00", 0.9),
        ],
        "hits": ["a", "b", "c"],
        "helps": ["DATE-NEWEST"],
        "absent": [],
        "before": ("DATE-NEWEST", "DATE-MIDDLE"),
    },
]


def _rows(memories: list[dict]) -> dict[str, dict]:
    return {row["id"]: row for row in memories if row.get("id")}


def measure(case: dict, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Whether memory changed the later task, without inventing a baseline fact."""
    import app.core.agents.memory_engine as memory_engine

    rows = _rows(case["memories"])
    hits = list(case["hits"])
    superseded = set(case.get("superseded") or [])

    def search(_query: str, n_results: int = 5) -> list[dict]:
        found = []
        for memory_id in hits:
            row = rows.get(memory_id) if memory_id else None
            found.append({
                "id": memory_id,
                "content": (row or {}).get("content", ""),
            })
        return found[:n_results]

    engine = MemoryEngine()
    monkeypatch.setattr(engine, "search_relevant_memories", search)
    monkeypatch.setattr(
        memory_engine.read_ports,
        "query_memory",
        lambda memory_id: rows.get(memory_id),
    )
    monkeypatch.setattr(
        memory_engine.read_ports,
        "collect_superseded_memory_ids",
        lambda ids: {item for item in ids if item in superseded},
    )
    with_memory = engine.retrieve_context_string(
        case["query"],
        max_memories=int(case.get("max_memories") or 3),
    )
    monkeypatch.setattr(engine, "search_relevant_memories", lambda _query, n_results=5: [])
    without = engine.retrieve_context_string(
        case["query"],
        max_memories=int(case.get("max_memories") or 3),
    )
    helps = list(case.get("helps") or [])
    absent = list(case.get("absent") or [])
    carried = all(token in with_memory for token in helps)
    baseline_clean = all(token not in without for token in helps)
    no_harm = all(token not in with_memory for token in absent)
    order = case.get("before")
    ordered = True
    if order:
        earlier, later = order
        ordered = earlier in with_memory and (
            later not in with_memory or with_memory.index(earlier) < with_memory.index(later)
        )
    helped = bool(helps) and carried and baseline_clean and no_harm and ordered
    return {
        "helped": helped,
        "no_harm": no_harm,
        "ordered": ordered,
        "with_memory": with_memory,
    }


@pytest.mark.parametrize("case", CASES, ids=[item["id"] for item in CASES])
def test_memory_benefit_eval(case: dict, monkeypatch: pytest.MonkeyPatch):
    result = measure(case, monkeypatch)
    assert result["helped"] is bool(case.get("helps"))
    assert result["no_harm"] is True
    assert result["ordered"] is True
    for token in case.get("absent") or []:
        assert token not in result["with_memory"]


def test_eval_set_covers_cross_session_themes():
    ids = [item["id"] for item in CASES]
    assert len(ids) >= 12
    assert len(ids) == len(set(ids))
    themes = {item["theme"] for item in CASES}
    assert {
        "ratified",
        "proposed",
        "rejected",
        "recency",
        "decayed",
        "superseded",
        "baseline",
    } <= themes
    helped = [item["id"] for item in CASES if item.get("helps")]
    silent = [item["id"] for item in CASES if not item.get("helps")]
    assert len(helped) >= 6
    assert len(silent) >= 4
