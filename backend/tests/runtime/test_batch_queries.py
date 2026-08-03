"""Batch query support: query_work_items(id_in=...) and read_events(aggregate_ids=...).

Both were added to eliminate N+1 patterns in approval enrichment. These
tests verify the batch paths return identical results to per-id loops.
"""

from __future__ import annotations

from app.core.runtime.kernel.kernel import Kernel
from app.store.database import Database


def _seed_work_items(db_path: str) -> tuple[Kernel, list[str]]:
    db = Database(db_path=db_path)
    k = Kernel(db=db)
    ids = []
    for title in ("alpha", "beta", "gamma"):
        wid = f"wi_{title}"
        k.emit_event(
            "WorkItemCreated",
            "work_item",
            wid,
            payload={"work_type": "task", "title": title},
            actor="test",
        )
        ids.append(wid)
    return k, ids


def test_query_state_work_items_id_in_matches_per_id(tmp_path):
    """id_in must return the same rows as N individual id= queries."""
    k, ids = _seed_work_items(str(tmp_path / "wi.db"))

    # Per-id baseline
    by_id = {row["id"]: row for row in k.query_state("work_items")}

    # Batch lookup (order is unspecified — compare by id key, not list order)
    batch = k.query_state("work_items", id_in=ids)
    batch_by_id = {row["id"]: row for row in batch}

    assert set(batch_by_id.keys()) == set(ids)
    for i in ids:
        assert batch_by_id[i]["title"] == by_id[i]["title"]


def test_query_state_work_items_id_in_empty_and_unknown(tmp_path):
    """Edge cases: empty list and ids not in the table."""
    k, _ = _seed_work_items(str(tmp_path / "wi2.db"))

    assert k.query_state("work_items", id_in=[]) == []
    assert k.query_state("work_items", id_in=["nonexistent"]) == []


def test_read_events_aggregate_ids_matches_per_aggregate(tmp_path):
    """aggregate_ids must return the same events as N aggregate_id= queries."""
    db = Database(db_path=str(tmp_path / "ev.db"))
    k = Kernel(db=db)

    # Emit 3 events per approval aggregate
    approval_ids = [f"ap_{i}" for i in range(3)]
    for aid in approval_ids:
        k.emit_event(
            "ApprovalRequested",
            "approval",
            aid,
            payload={"action": "noop"},
            actor="test",
            correlation_id=f"corr_{aid}",
        )
        # Second event per aggregate (must NOT shadow the first when batched).
        k.emit_event(
            "ApprovalResolved",
            "approval",
            aid,
            payload={"decision": "approve"},
            actor="test",
            correlation_id=f"corr_{aid}",
        )

    # Per-aggregate baseline: earliest ApprovalRequested per aggregate
    expected_first = {}
    for aid in approval_ids:
        events = k.read_events(
            aggregate_type="approval",
            aggregate_id=aid,
            type="ApprovalRequested",
            order="asc",
        )
        assert events, f"baseline missing for {aid}"
        expected_first[aid] = events[0].correlation_id

    # Batch: one SQL, then take first occurrence per aggregate_id (ascending)
    batch = k.read_events(
        aggregate_type="approval",
        aggregate_ids=approval_ids,
        type="ApprovalRequested",
        order="asc",
    )
    batch_first: dict[str, str] = {}
    for evt in batch:
        if evt.aggregate_id not in batch_first:
            batch_first[evt.aggregate_id] = evt.correlation_id or ""

    assert set(batch_first.keys()) == set(approval_ids)
    for aid in approval_ids:
        assert batch_first[aid] == expected_first[aid]


def test_read_events_aggregate_ids_empty_returns_empty(tmp_path):
    """Empty aggregate_ids must short-circuit (no IN () syntax error).

    Regression guard: this must return [] even when the db has other events
    (a naive `if aggregate_ids:` skips the filter and returns everything).
    """
    db = Database(db_path=str(tmp_path / "ev2.db"))
    k = Kernel(db=db)
    k.emit_event(
        "ApprovalRequested", "approval", "ap_other",
        payload={"action": "noop"}, actor="test",
    )
    assert len(k.read_events()) == 1
    assert k.read_events(aggregate_ids=[]) == []
