"""Unit tests for claim-aware recall over-fetch."""

from __future__ import annotations

import pytest

from app.core.agents.memory_engine import MemoryEngine


@pytest.fixture(autouse=True)
def _no_supersession_chain(monkeypatch):
    monkeypatch.setattr(
        "app.core.agents.memory_engine.read_ports.collect_superseded_memory_ids",
        lambda _ids: set(),
    )


def test_recall_for_context_overfetches_past_proposed(monkeypatch):
    engine = MemoryEngine()

    monkeypatch.setattr(
        engine,
        "search_relevant_memories",
        lambda query, n_results=5: [
            {"id": "p1", "content": "proposed A"},
            {"id": "p2", "content": "proposed B"},
            {"id": "p3", "content": "proposed C"},
            {"id": "ok1", "content": "ratified fact"},
            {"id": "ok2", "content": "self report"},
        ][:n_results],
    )

    rows = {
        "p1": {"content": "proposed A", "confidence": 0.9, "claim_status": "proposed", "category": "fact"},
        "p2": {"content": "proposed B", "confidence": 0.9, "claim_status": "proposed", "category": "fact"},
        "p3": {"content": "proposed C", "confidence": 0.9, "claim_status": "proposed", "category": "fact"},
        "ok1": {"content": "ratified fact", "confidence": 0.8, "claim_status": "ratified", "category": "fact"},
        "ok2": {"content": "self report", "confidence": 0.7, "claim_status": None, "category": "preference"},
    }
    monkeypatch.setattr(
        "app.core.agents.memory_engine.read_ports.query_memory",
        lambda memory_id: rows.get(memory_id),
    )

    enriched = engine.recall_for_context("who am i", max_memories=2, overfetch_factor=4)
    assert [m["id"] for m in enriched] == ["ok1", "ok2"]
    assert enriched[0]["category"] == "fact"


def test_recall_orders_superseding_memory_first(monkeypatch):
    """Dogfood W34-R3: two ratified passcodes must reach the prompt newest-first.

    Relevance ranking put the stale value ahead of the current one and both
    rendered at identical confidence, leaving the model no basis to choose.
    """
    engine = MemoryEngine()

    monkeypatch.setattr(
        engine,
        "search_relevant_memories",
        lambda query, n_results=5: [
            {"id": "old", "content": "W34 passcode is TIANSHAN-DF-W34-0818"},
            {"id": "new", "content": "W34-R3 passcode is HUASHAN-DF-W34-R3-0819"},
        ][:n_results],
    )

    rows = {
        "old": {
            "content": "W34 passcode is TIANSHAN-DF-W34-0818",
            "confidence": 0.5,
            "claim_status": "ratified",
            "category": "fact",
            "created_at": "2026-08-18 09:14:02",
        },
        "new": {
            "content": "W34-R3 passcode is HUASHAN-DF-W34-R3-0819",
            "confidence": 0.5,
            "claim_status": "ratified",
            "category": "fact",
            "created_at": "2026-08-19 11:02:41",
        },
    }
    monkeypatch.setattr(
        "app.core.agents.memory_engine.read_ports.query_memory",
        lambda memory_id: rows.get(memory_id),
    )

    enriched = engine.recall_for_context("这周的暗号", max_memories=2)
    assert [m["id"] for m in enriched] == ["new", "old"]

    rendered = engine.format_memory_context(enriched)
    assert "2026-08-19" in rendered
    assert "以最新的为准" in rendered
    assert rendered.index("HUASHAN") < rendered.index("TIANSHAN")


def test_recall_excludes_decayed_low_confidence(monkeypatch):
    engine = MemoryEngine()
    monkeypatch.setattr(
        engine,
        "search_relevant_memories",
        lambda query, n_results=5: [
            {"id": "low", "content": "stale preference"},
            {"id": "high", "content": "current preference"},
        ][:n_results],
    )
    rows = {
        "low": {
            "content": "stale preference",
            "confidence": 0.2,
            "claim_status": "ratified",
            "category": "preference",
            "created_at": "2026-08-01",
        },
        "high": {
            "content": "current preference",
            "confidence": 0.8,
            "claim_status": "ratified",
            "category": "preference",
            "created_at": "2026-08-02",
        },
    }
    monkeypatch.setattr(
        "app.core.agents.memory_engine.read_ports.query_memory",
        lambda memory_id: rows.get(memory_id),
    )
    enriched = engine.recall_for_context("preference", max_memories=3)
    assert [m["id"] for m in enriched] == ["high"]


def test_recall_keeps_relevance_order_for_high_confidence(monkeypatch):
    engine = MemoryEngine()
    monkeypatch.setattr(
        engine,
        "search_relevant_memories",
        lambda query, n_results=5: [
            {"id": "first", "content": "more relevant"},
            {"id": "second", "content": "less relevant"},
        ][:n_results],
    )
    rows = {
        "first": {
            "content": "more relevant",
            "confidence": 0.9,
            "claim_status": "ratified",
            "category": "fact",
            "created_at": "",
        },
        "second": {
            "content": "less relevant",
            "confidence": 0.85,
            "claim_status": "ratified",
            "category": "fact",
            "created_at": "",
        },
    }
    monkeypatch.setattr(
        "app.core.agents.memory_engine.read_ports.query_memory",
        lambda memory_id: rows.get(memory_id),
    )
    assert [m["id"] for m in engine._enrich_recall_hits([
        {"id": "first"},
        {"id": "second"},
    ])] == ["first", "second"]


def test_format_memory_context_without_timestamp_keeps_confidence():
    engine = MemoryEngine()
    rendered = engine.format_memory_context(
        [{"id": "m1", "content": "User prefers Python", "confidence": 0.8}],
    )
    assert "[置信度 0.80] User prefers Python" in rendered


def test_recall_drops_superseded_memory(monkeypatch):
    engine = MemoryEngine()
    monkeypatch.setattr(
        engine,
        "search_relevant_memories",
        lambda query, n_results=5: [
            {"id": "old", "content": "passcode is TIANSHAN"},
            {"id": "new", "content": "passcode is HUASHAN"},
        ][:n_results],
    )
    rows = {
        "old": {
            "content": "passcode is TIANSHAN",
            "confidence": 0.5,
            "claim_status": "ratified",
            "category": "fact",
            "created_at": "2026-08-18",
        },
        "new": {
            "content": "passcode is HUASHAN",
            "confidence": 0.5,
            "claim_status": "ratified",
            "category": "fact",
            "created_at": "2026-08-19",
        },
    }
    monkeypatch.setattr(
        "app.core.agents.memory_engine.read_ports.query_memory",
        lambda memory_id: rows.get(memory_id),
    )
    monkeypatch.setattr(
        "app.core.agents.memory_engine.read_ports.collect_superseded_memory_ids",
        lambda ids: {"old"} if "new" in ids else set(),
    )
    enriched = engine.recall_for_context("暗号", max_memories=2)
    assert [m["id"] for m in enriched] == ["new"]
