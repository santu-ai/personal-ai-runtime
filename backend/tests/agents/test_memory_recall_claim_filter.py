"""Unit tests for claim-aware recall over-fetch."""

from __future__ import annotations

from app.core.agents.memory_engine import MemoryEngine


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
