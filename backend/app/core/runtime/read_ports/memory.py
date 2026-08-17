"""记忆投影与召回读端口。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.runtime.read_ports._common import kernel


def recall_memories_for_context(query: str, *, max_memories: int = 3) -> list[dict]:
    """Claim-filtered semantic recall for Chat / dashboard / SDK surfaces."""
    from app.core.agents.memory_engine import memory_engine

    return memory_engine.recall_for_context(query, max_memories=max_memories)


def retrieve_memory_context(query: str, *, max_memories: int = 3) -> str:
    from app.core.agents.memory_engine import memory_engine

    return memory_engine.retrieve_context_string(query, max_memories=max_memories)


def retrieve_memory_with_sources(query: str, *, max_memories: int = 3) -> tuple[str, list[dict]]:
    """Retrieve memory context and return (context_str, sources)."""
    from app.core.agents.memory_engine import memory_engine

    enriched = recall_memories_for_context(query, max_memories=max_memories)
    context_str = memory_engine.format_memory_context(enriched)
    sources = [
        {"id": mem["id"], "type": "memory", "title": mem.get("content", "")[:80]}
        for mem in enriched
        if mem.get("id")
    ]
    return context_str, sources


def query_memory(memory_id: str) -> dict[str, Any] | None:
    rows = kernel().query_state("memories", id=memory_id, limit=1)
    return rows[0] if rows else None


def query_memories(
    *,
    category: str | None = None,
    limit: int = 5000,
    order: str | None = None,
    confidence_gt: float | None = None,
    confidence_lt: float | None = None,
    decay_eligible: bool | None = None,
    claim_status: str | None = None,
) -> list[dict[str, Any]]:
    filters: dict[str, Any] = {"limit": limit}
    if category:
        filters["category"] = category
    if order:
        filters["order"] = order
    if confidence_gt is not None:
        filters["confidence_gt"] = confidence_gt
    if confidence_lt is not None:
        filters["confidence_lt"] = confidence_lt
    if decay_eligible is not None:
        filters["decay_eligible"] = decay_eligible
    if claim_status is not None:
        filters["claim_status"] = claim_status
    return kernel().query_state("memories", **filters)


def count_memories(
    *,
    category: str | None = None,
    origin: str | None = None,
    claim_status: str | None = None,
    confidence_gt: float | None = None,
    confidence_lt: float | None = None,
    decay_eligible: bool | None = None,
) -> int:
    filters: dict[str, Any] = {}
    if category is not None:
        filters["category"] = category
    if origin is not None:
        filters["origin"] = origin
    if claim_status is not None:
        filters["claim_status"] = claim_status
    if confidence_gt is not None:
        filters["confidence_gt"] = confidence_gt
    if confidence_lt is not None:
        filters["confidence_lt"] = confidence_lt
    if decay_eligible is not None:
        filters["decay_eligible"] = decay_eligible
    return kernel().count_state("memories", **filters)


def summarize_memory_stats() -> dict[str, Any]:
    """Memory totals / categories / recent_7d via SQL COUNT."""
    return kernel().aggregate_state("memory_stats")


def attach_claim_reject_reasons(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fill ``reject_reason`` from the latest ClaimRejected payload (event log)."""
    rejected_ids = {r.get("id") for r in rows if r.get("claim_status") == "rejected" and r.get("id")}
    if not rejected_ids:
        return rows
    events = kernel().read_events(type="ClaimRejected", limit=500, order="desc")
    latest: dict[str, str] = {}
    for ev in events:
        mid = ev.aggregate_id
        if mid in rejected_ids and mid not in latest:
            latest[mid] = str((ev.payload or {}).get("reason") or "").strip()
            if len(latest) == len(rejected_ids):
                break
    return [
        {**row, "reject_reason": latest.get(row["id"]) or None}
        if row.get("id") in rejected_ids
        else row
        for row in rows
    ]


def summarize_claim_conversion(*, days: int = 30, limit: int = 500) -> dict[str, Any]:
    """proposed → ratified conversion and reject rate from claim events."""
    since_ts = (datetime.now(UTC) - timedelta(days=days)).isoformat()
    ratified = kernel().read_events(
        type="ClaimRatified", since_ts=since_ts, limit=limit, order="desc",
    )
    rejected = kernel().read_events(
        type="ClaimRejected", since_ts=since_ts, limit=limit, order="desc",
    )
    proposed_open = count_memories(claim_status="proposed")
    ratified_n = len(ratified)
    rejected_n = len(rejected)
    decided = ratified_n + rejected_n
    conversion_rate = (ratified_n / decided) if decided else None
    false_positive_rate = (rejected_n / decided) if decided else None
    return {
        "days": days,
        "proposed_open": proposed_open,
        "ratified": ratified_n,
        "rejected": rejected_n,
        "decided": decided,
        "conversion_rate": conversion_rate,
        "false_positive_rate": false_positive_rate,
    }


def build_memory_graph_edges(sources: list[dict]) -> list[dict]:
    """Build similarity edges via MemoryIndexPort batch search (sync, for to_thread)."""
    if not sources:
        return []

    port = getattr(kernel(), "_memory_index", None)
    if port is None or not hasattr(port, "search_memories_batch"):
        return []

    query_texts = [m.get("content", "") for m in sources]
    batches = port.search_memories_batch(query_texts, n_results=5)

    edges: list[dict] = []
    edge_set: set[tuple[str, str]] = set()

    for mem, similar in zip(sources, batches, strict=False):
        mem_id = mem.get("id", "")
        for hit in similar:
            other_id = hit.get("id", "")
            if other_id == mem_id or not other_id:
                continue
            edge_key = tuple(sorted([mem_id, other_id]))
            if edge_key in edge_set:
                continue
            edge_set.add(edge_key)
            distance = hit.get("distance", 1.0) or 1.0
            weight = max(0.1, 1.0 - float(distance))
            edges.append({
                "source": mem_id,
                "target": other_id,
                "weight": round(weight, 2),
            })

    edges.sort(key=lambda e: e["weight"], reverse=True)
    return edges[:100]

