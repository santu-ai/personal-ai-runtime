"""API tests for memory claim bulk actions and count/grouped filters."""

from app.core.agents.memory_engine import memory_engine


def _store_claim(content: str, category: str = "fact") -> str:
    return memory_engine.store_memory(
        content, category=category, source="conversation", actor="extractor",
    )


def test_count_memories_proposed(client):
    mid = _store_claim("User prefers dark mode for coding")
    assert mid

    r = client.get("/api/memory/memories/count", params={"claim_status": "proposed"})
    assert r.status_code == 200
    assert r.json()["count"] >= 1


def test_grouped_returns_total_and_filters(client):
    _store_claim("User bikes to work on weekdays", category="habit")
    _store_claim("User likes espresso in the morning", category="preference")

    r = client.get(
        "/api/memory/memories/grouped",
        params={
            "claim_status": "proposed",
            "category": "habit",
            "order": "created_at_desc",
            "limit": 10,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert "total" in body
    assert body["total"] >= 1
    assert all(m.get("category") == "habit" for m in body["memories"])


def test_bulk_ratify_and_reject(client):
    a = _store_claim("User speaks Mandarin and English fluently")
    b = _store_claim("User works as a software engineer in Shanghai")
    c = _store_claim("User prefers keyboard-driven workflows")

    ratify = client.post(
        "/api/memory/memories/claims/bulk",
        json={"action": "ratify", "ids": [a, b]},
    )
    assert ratify.status_code == 200, ratify.text
    assert ratify.json()["ok"] == 2
    assert ratify.json()["skipped"] == []

    reject = client.post(
        "/api/memory/memories/claims/bulk",
        json={"action": "reject", "ids": [c]},
    )
    assert reject.status_code == 200
    assert reject.json()["ok"] == 1

    listed = client.get(
        "/api/memory/memories/grouped",
        params={"claim_status": "proposed"},
    )
    proposed_ids = {m["id"] for m in listed.json()["memories"]}
    assert a not in proposed_ids
    assert b not in proposed_ids
    assert c not in proposed_ids


def test_search_uses_claim_filtered_recall(client, monkeypatch):
    """Public search is Chat recall, not raw Chroma (proposed must not leak)."""

    def fake_recall(query, max_memories=5, overfetch_factor=4):
        assert query == "who am i"
        assert max_memories == 3
        return [{"id": "ok", "content": "ratified only", "confidence": 0.9}]

    def boom(*_a, **_k):
        raise AssertionError("search must not return unfiltered chroma hits")

    monkeypatch.setattr(memory_engine, "recall_for_context", fake_recall)
    monkeypatch.setattr(memory_engine, "search_relevant_memories", boom)

    r = client.get("/api/memory/memories/search", params={"q": "who am i", "n": 3})
    assert r.status_code == 200
    assert r.json() == [{"id": "ok", "content": "ratified only", "confidence": 0.9}]


def test_bulk_skips_missing_and_manual(client):
    manual = client.post(
        "/api/memory/memories",
        json={"content": "I told you I like tea", "category": "fact"},
    )
    assert manual.status_code == 200
    manual_id = manual.json()["id"]

    r = client.post(
        "/api/memory/memories/claims/bulk",
        json={"action": "ratify", "ids": ["missing-id", manual_id]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] == 0
    reasons = {s["id"]: s["reason"] for s in body["skipped"]}
    assert reasons["missing-id"] == "not_found"
    assert reasons[manual_id] == "not_claim"


def test_bulk_rejects_empty_ids(client):
    r = client.post(
        "/api/memory/memories/claims/bulk",
        json={"action": "ratify", "ids": []},
    )
    assert r.status_code == 422
