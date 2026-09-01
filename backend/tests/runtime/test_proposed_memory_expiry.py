"""Proposed claim TTL maintenance invariants."""

from datetime import UTC, datetime, timedelta


def _seed_claim(kernel, memory_id: str) -> None:
    kernel.emit_event(
        "MemoryDerived",
        "memory",
        memory_id,
        payload={"category": "fact", "content": f"claim {memory_id}", "confidence": 0.5},
        actor="extractor",
    )


def test_expiry_rejects_only_due_proposed_claims(isolated_kernel, monkeypatch):
    k, db = isolated_kernel
    import app.core.runtime.cron_registry as cron

    cron.kernel = k
    monkeypatch.setattr(cron.settings, "proposed_memory_ttl_days", 30)
    now = datetime(2026, 9, 1, tzinfo=UTC)
    for memory_id in ("due", "young", "ratified"):
        _seed_claim(k, memory_id)
    k.emit_event(
        "ClaimRatified", "memory", "ratified", payload={"by": "user"}, actor="user",
    )
    with db.get_db() as conn:
        conn.execute(
            "UPDATE memories SET created_at = ? WHERE id IN ('due', 'ratified')",
            ((now - timedelta(days=30)).isoformat(),),
        )
        conn.execute(
            "UPDATE memories SET created_at = ? WHERE id = 'young'",
            ((now - timedelta(days=29, hours=23)).isoformat(),),
        )

    assert cron.expire_proposed_memories(now=now) == 1
    assert k.query_state("memories", id="due")[0]["claim_status"] == "rejected"
    assert k.query_state("memories", id="young")[0]["claim_status"] == "proposed"
    assert k.query_state("memories", id="ratified")[0]["claim_status"] == "ratified"

    events = k.read_events(type="ClaimRejected", aggregate_id="due")
    assert len(events) == 1
    assert events[0].payload["reason"] == "auto_expired"
    assert events[0].payload["by"] == "scheduler"
    assert events[0].actor == "scheduler"
    assert cron.expire_proposed_memories(now=now) == 0


def test_zero_ttl_disables_expiry(isolated_kernel, monkeypatch):
    k, _db = isolated_kernel
    import app.core.runtime.cron_registry as cron

    cron.kernel = k
    monkeypatch.setattr(cron.settings, "proposed_memory_ttl_days", 0)
    _seed_claim(k, "kept")

    assert cron.expire_proposed_memories(
        now=datetime(2030, 1, 1, tzinfo=UTC),
    ) == 0
    assert k.query_state("memories", id="kept")[0]["claim_status"] == "proposed"
