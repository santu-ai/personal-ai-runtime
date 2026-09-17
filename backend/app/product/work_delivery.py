"""Work delivery / acceptance — product facts on the Work aggregate.

Deliveries and review decisions are immutable ``WorkItemUpdated`` payloads.
The work_items projector ignores these keys, so event_log is the source of
truth; folding reconstructs versions after restart or rebuild.

This is not a new Work subtype, event type, or governed table.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import uuid
from datetime import UTC, datetime
from typing import Any

from app.core.runtime import read_ports
from app.core.runtime.kernel.constants import (
    AGGREGATE_WORK_ITEM,
    EVENT_EXECUTE_REQUESTED,
    EVENT_WORK_ITEM_UPDATED,
)
from app.core.runtime.kernel_instance import kernel

logger = logging.getLogger(__name__)

PAYLOAD_DELIVERY_PUBLISHED = "delivery_published"
PAYLOAD_DELIVERY_DECISION = "delivery_decision"
PAYLOAD_REWORK_DISPATCHED = "rework_dispatched"
REVIEW_UNREVIEWED = "unreviewed"
REVIEW_ACCEPTED = "accepted"
REVIEW_CHANGES_REQUESTED = "changes_requested"
DECISION_ACCEPTED = "accepted"
DECISION_CHANGES_REQUESTED = "changes_requested"
DELIVERY_SCHEMA_VERSION = 1

_LOCKS_GUARD = threading.Lock()
_WORK_LOCKS: dict[str, threading.Lock] = {}


class DeliveryConflictError(Exception):
    """Stale version, illegal state, or conflicting concurrent decision."""

    def __init__(self, message: str, *, code: str = "conflict") -> None:
        super().__init__(message)
        self.code = code


class DeliveryNotFoundError(LookupError):
    pass


class DeliveryValidationError(ValueError):
    pass


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _work_lock(work_id: str) -> threading.Lock:
    with _LOCKS_GUARD:
        lock = _WORK_LOCKS.get(work_id)
        if lock is None:
            lock = threading.Lock()
            _WORK_LOCKS[work_id] = lock
        return lock


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def parse_plan(plan_raw: Any) -> dict[str, Any]:
    if isinstance(plan_raw, dict):
        return dict(plan_raw)
    if not isinstance(plan_raw, str) or not plan_raw.strip():
        return {}
    try:
        obj = json.loads(plan_raw)
    except json.JSONDecodeError:
        return {}
    return obj if isinstance(obj, dict) else {}


def is_project_brief_plan(plan_raw: Any) -> bool:
    plan = parse_plan(plan_raw)
    if plan.get("kind") == "project_brief":
        return True
    contract = plan.get("contract")
    return isinstance(contract, dict) and contract.get("output_kind") == "project_brief"


def contract_from_plan(plan_raw: Any) -> dict[str, Any] | None:
    plan = parse_plan(plan_raw)
    contract = plan.get("contract")
    if isinstance(contract, dict):
        return contract
    return None


def _read_work_events(work_id: str) -> list[Any]:
    return kernel.read_events(
        aggregate_type=AGGREGATE_WORK_ITEM,
        aggregate_id=work_id,
        order="asc",
    )


def fold_delivery_history(work_id: str) -> dict[str, Any]:
    """Replay work_item events into versioned deliveries + review state."""
    deliveries: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    dispatches: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}

    for event in _read_work_events(work_id):
        payload = event.payload or {}
        published = payload.get(PAYLOAD_DELIVERY_PUBLISHED)
        if isinstance(published, dict) and published.get("delivery_id"):
            row = dict(published)
            row.setdefault("event_id", event.id)
            row.setdefault("event_seq", event.seq)
            deliveries.append(row)
            by_id[str(row["delivery_id"])] = row
        decision = payload.get(PAYLOAD_DELIVERY_DECISION)
        if isinstance(decision, dict) and decision.get("delivery_id"):
            row = dict(decision)
            row.setdefault("event_id", event.id)
            row.setdefault("event_seq", event.seq)
            decisions.append(row)
        dispatched = payload.get(PAYLOAD_REWORK_DISPATCHED)
        if isinstance(dispatched, dict) and dispatched.get("delivery_id"):
            row = dict(dispatched)
            row.setdefault("event_id", event.id)
            row.setdefault("event_seq", event.seq)
            dispatches.append(row)

    latest_by_delivery: dict[str, dict[str, Any]] = {}
    by_idempotency: dict[str, dict[str, Any]] = {}
    for decision in decisions:
        did = str(decision.get("delivery_id") or "")
        latest_by_delivery[did] = decision
        key = str(decision.get("idempotency_key") or "").strip()
        if key and key not in by_idempotency:
            by_idempotency[key] = decision

    current = deliveries[-1] if deliveries else None
    current_id = str(current["delivery_id"]) if current else None
    current_decision = latest_by_delivery.get(current_id) if current_id else None
    review_status = REVIEW_UNREVIEWED
    if current_decision:
        review_status = _review_status_from_decision(
            str(current_decision.get("decision") or ""),
        )

    summaries = []
    for row in deliveries:
        did = str(row["delivery_id"])
        decision = latest_by_delivery.get(did)
        status = REVIEW_UNREVIEWED
        if decision:
            raw = str(decision.get("decision") or "")
            if raw == DECISION_ACCEPTED:
                status = REVIEW_ACCEPTED
            elif raw == DECISION_CHANGES_REQUESTED:
                status = REVIEW_CHANGES_REQUESTED
        summaries.append(_public_delivery(row, review_status=status, include_content=False))

    return {
        "work_id": work_id,
        "deliveries": summaries,
        "current": (
            _public_delivery(
                current,
                review_status=review_status,
                include_content=True,
            )
            if current
            else None
        ),
        "current_review_status": review_status if current else None,
        "latest_decision": current_decision,
        "_by_id": by_id,
        "_decisions": decisions,
        "_dispatches": dispatches,
        "_by_idempotency": by_idempotency,
        "_current_id": current_id,
    }


def _public_delivery(
    row: dict[str, Any] | None,
    *,
    review_status: str,
    include_content: bool,
) -> dict[str, Any] | None:
    if not row:
        return None
    out = {
        "delivery_id": row.get("delivery_id"),
        "version": int(row.get("version") or 0),
        "contract_version": int(row.get("contract_version") or 0),
        "execution_id": row.get("execution_id"),
        "created_at": row.get("created_at"),
        "summary": row.get("summary") or "",
        "limitations": list(row.get("limitations") or []),
        "suggested_actions": list(row.get("suggested_actions") or []),
        "sources": list(row.get("sources") or []),
        "checks": list(row.get("checks") or []),
        "findings": list(row.get("findings") or []),
        "supersedes_delivery_id": row.get("supersedes_delivery_id"),
        "schema_version": int(row.get("schema_version") or DELIVERY_SCHEMA_VERSION),
        "qualified": bool(row.get("qualified", True)),
        "review_status": review_status,
    }
    if include_content:
        out["content"] = row.get("content") or ""
    else:
        content = str(row.get("content") or "")
        out["content_length"] = len(content)
    return out


def get_delivery(work_id: str, delivery_id: str) -> dict[str, Any]:
    folded = fold_delivery_history(work_id)
    row = folded["_by_id"].get(delivery_id)
    if not row:
        raise DeliveryNotFoundError(delivery_id)
    latest = None
    for decision in folded["_decisions"]:
        if str(decision.get("delivery_id")) == delivery_id:
            latest = decision
    status = REVIEW_UNREVIEWED
    if latest:
        raw = str(latest.get("decision") or "")
        if raw == DECISION_ACCEPTED:
            status = REVIEW_ACCEPTED
        elif raw == DECISION_CHANGES_REQUESTED:
            status = REVIEW_CHANGES_REQUESTED
    public = _public_delivery(row, review_status=status, include_content=True)
    assert public is not None
    public["latest_decision"] = latest
    return public


def public_bundle(work_id: str) -> dict[str, Any]:
    folded = fold_delivery_history(work_id)
    return {
        "work_id": work_id,
        "deliveries": folded["deliveries"],
        "current": folded["current"],
        "current_review_status": folded["current_review_status"],
    }


def publish_delivery(
    work_id: str,
    *,
    content: str,
    summary: str,
    sources: list[dict[str, Any]],
    findings: list[dict[str, Any]] | None = None,
    limitations: list[str] | None = None,
    suggested_actions: list[dict[str, Any]] | None = None,
    checks: list[dict[str, Any]] | None = None,
    contract_version: int = 1,
    execution_id: str | None = None,
    qualified: bool = True,
    actor: str = "system",
) -> dict[str, Any]:
    """Append an immutable delivery version. Same execution_id is idempotent."""
    item = read_ports.query_work_item(work_id)
    if item is None:
        raise DeliveryNotFoundError(work_id)

    with _work_lock(work_id):
        folded = fold_delivery_history(work_id)
        if execution_id:
            for existing in folded["_by_id"].values():
                if str(existing.get("execution_id") or "") == execution_id:
                    status = REVIEW_UNREVIEWED
                    current = folded["current"]
                    if current and current.get("delivery_id") == existing.get("delivery_id"):
                        status = folded["current_review_status"] or REVIEW_UNREVIEWED
                    public = _public_delivery(
                        existing, review_status=status, include_content=True,
                    )
                    assert public is not None
                    return public

        current = folded["current"]
        version = int(current["version"]) + 1 if current else 1
        supersedes = current.get("delivery_id") if current else None
        delivery_id = str(uuid.uuid4())
        payload_body = {
            "delivery_id": delivery_id,
            "version": version,
            "contract_version": int(contract_version),
            "execution_id": execution_id,
            "created_at": _now(),
            "summary": summary,
            "content": content,
            "limitations": list(limitations or []),
            "suggested_actions": list(suggested_actions or []),
            "sources": list(sources or []),
            "findings": list(findings or []),
            "checks": list(checks or []),
            "supersedes_delivery_id": supersedes,
            "schema_version": DELIVERY_SCHEMA_VERSION,
            "qualified": bool(qualified),
        }
        kernel.emit_event(
            EVENT_WORK_ITEM_UPDATED,
            AGGREGATE_WORK_ITEM,
            work_id,
            payload={PAYLOAD_DELIVERY_PUBLISHED: payload_body},
            actor=actor,
        )
        public = _public_delivery(
            payload_body, review_status=REVIEW_UNREVIEWED, include_content=True,
        )
        assert public is not None
        return public


def _require_current_delivery(
    folded: dict[str, Any],
    delivery_id: str,
) -> dict[str, Any]:
    row = folded["_by_id"].get(delivery_id)
    if not row:
        raise DeliveryNotFoundError(delivery_id)
    current_id = folded.get("_current_id")
    if current_id != delivery_id:
        raise DeliveryConflictError(
            "该版本已不是当前交付，请刷新后操作当前版本",
            code="stale_delivery",
        )
    return row


def _idempotency_matches(prior: dict[str, Any], *, delivery_id: str, decision: str, reason: str) -> bool:
    if str(prior.get("delivery_id") or "") != delivery_id:
        return False
    if str(prior.get("decision") or "") != decision:
        return False
    return str(prior.get("reason") or "").strip() == str(reason or "").strip()


def _review_status_from_decision(raw: str) -> str:
    if raw == DECISION_ACCEPTED:
        return REVIEW_ACCEPTED
    if raw == DECISION_CHANGES_REQUESTED:
        return REVIEW_CHANGES_REQUESTED
    return REVIEW_UNREVIEWED


def _dispatch_recorded(
    folded: dict[str, Any],
    delivery_id: str,
    decision_id: str | None,
) -> bool:
    wanted = str(decision_id or "")
    for row in folded.get("_dispatches") or []:
        if str(row.get("delivery_id") or "") != delivery_id:
            continue
        recorded = str(row.get("decision_id") or "")
        if wanted and recorded and recorded != wanted:
            continue
        return True
    return False


def _decision_seq(folded: dict[str, Any], decision_id: str | None) -> int:
    wanted = str(decision_id or "")
    if wanted:
        for row in folded.get("_decisions") or []:
            if str(row.get("decision_id") or "") == wanted:
                return int(row.get("event_seq") or 0)
    latest = folded.get("latest_decision")
    if isinstance(latest, dict):
        return int(latest.get("event_seq") or 0)
    return 0


def _execute_requested_since(work_id: str, after_seq: int) -> bool:
    events = kernel.read_events(
        aggregate_type="action",
        aggregate_id=f"exec_{work_id}",
        type=EVENT_EXECUTE_REQUESTED,
        since_seq=int(after_seq or 0),
        order="asc",
        limit=1,
    )
    return bool(events)


def _has_rework_note(notes: list[Any], delivery_id: str, reason: str) -> bool:
    wanted = str(reason).strip()
    for note in notes:
        if not isinstance(note, dict):
            continue
        if str(note.get("delivery_id") or "") != delivery_id:
            continue
        if str(note.get("reason") or "").strip() == wanted:
            return True
    return False


def _emit_rework_dispatched(
    work_id: str,
    *,
    delivery_id: str,
    decision_id: str | None,
    actor: str,
) -> None:
    kernel.emit_event(
        EVENT_WORK_ITEM_UPDATED,
        AGGREGATE_WORK_ITEM,
        work_id,
        payload={
            PAYLOAD_REWORK_DISPATCHED: {
                "delivery_id": delivery_id,
                "decision_id": decision_id,
                "at": _now(),
            }
        },
        actor=actor,
    )


def decide_delivery(
    work_id: str,
    delivery_id: str,
    *,
    decision: str,
    reason: str = "",
    idempotency_key: str | None = None,
    actor: str = "user",
) -> dict[str, Any]:
    if decision not in {DECISION_ACCEPTED, DECISION_CHANGES_REQUESTED}:
        raise DeliveryValidationError("decision must be accepted or changes_requested")
    if decision == DECISION_CHANGES_REQUESTED and not str(reason).strip():
        raise DeliveryValidationError("返工必须填写非空理由")

    item = read_ports.query_work_item(work_id)
    if item is None:
        raise DeliveryNotFoundError(work_id)

    key = str(idempotency_key or "").strip()
    with _work_lock(work_id):
        folded = fold_delivery_history(work_id)
        if key:
            prior = folded["_by_idempotency"].get(key)
            if prior is not None:
                if not _idempotency_matches(
                    prior, delivery_id=delivery_id, decision=decision, reason=reason,
                ):
                    raise DeliveryConflictError(
                        "幂等键已用于不同的交付决定",
                        code="idempotency_conflict",
                    )
                return {
                    "work_id": work_id,
                    "replayed": True,
                    "decision": prior,
                    "bundle": public_bundle(work_id),
                }

        row = _require_current_delivery(folded, delivery_id)
        current_status = folded["current_review_status"]
        if current_status == REVIEW_ACCEPTED and decision != DECISION_ACCEPTED:
            raise DeliveryConflictError(
                "该版本已验收，不能再改为返工",
                code="decision_conflict",
            )
        if current_status == REVIEW_CHANGES_REQUESTED and decision != DECISION_CHANGES_REQUESTED:
            raise DeliveryConflictError(
                "该版本已要求返工，不能再改为验收",
                code="decision_conflict",
            )
        if (
            decision == DECISION_CHANGES_REQUESTED
            and current_status == REVIEW_CHANGES_REQUESTED
        ):
            existing = folded["latest_decision"]
            return {
                "work_id": work_id,
                "replayed": True,
                "decision": existing,
                "bundle": public_bundle(work_id),
            }
        if decision == DECISION_ACCEPTED and current_status == REVIEW_ACCEPTED:
            existing = folded["latest_decision"]
            return {
                "work_id": work_id,
                "replayed": True,
                "decision": existing,
                "bundle": public_bundle(work_id),
            }

        body = {
            "decision_id": str(uuid.uuid4()),
            "delivery_id": delivery_id,
            "delivery_version": int(row.get("version") or 0),
            "decision": decision,
            "reason": str(reason or "").strip(),
            "actor": actor,
            "created_at": _now(),
            "idempotency_key": key or None,
        }
        kernel.emit_event(
            EVENT_WORK_ITEM_UPDATED,
            AGGREGATE_WORK_ITEM,
            work_id,
            payload={PAYLOAD_DELIVERY_DECISION: body},
            actor=actor,
        )
        return {
            "work_id": work_id,
            "replayed": False,
            "decision": body,
            "bundle": public_bundle(work_id),
        }


def accept_delivery(
    work_id: str,
    delivery_id: str,
    *,
    reason: str = "",
    idempotency_key: str | None = None,
    actor: str = "user",
) -> dict[str, Any]:
    return decide_delivery(
        work_id,
        delivery_id,
        decision=DECISION_ACCEPTED,
        reason=reason,
        idempotency_key=idempotency_key,
        actor=actor,
    )


def request_rework(
    work_id: str,
    delivery_id: str,
    *,
    reason: str,
    idempotency_key: str | None = None,
    actor: str = "user",
    dispatch: bool = True,
) -> dict[str, Any]:
    item = read_ports.query_work_item(work_id)
    if item is None:
        raise DeliveryNotFoundError(work_id)
    status = str(item.get("status") or "")
    if status in {"running", "waiting_approval"}:
        folded = fold_delivery_history(work_id)
        latest = folded.get("latest_decision") or {}
        in_flight = (
            str(latest.get("delivery_id") or "") == delivery_id
            and str(latest.get("decision") or "") == DECISION_CHANGES_REQUESTED
        )
        if not in_flight:
            raise DeliveryConflictError("任务仍在执行或待审批，请等待完成后再返工")
        result = {
            "work_id": work_id,
            "replayed": True,
            "decision": latest,
            "bundle": public_bundle(work_id),
        }
        if dispatch:
            return _complete_rework_dispatch(
                work_id,
                delivery_id,
                reason=reason,
                actor=actor,
                result=result,
            )
        return result

    result = decide_delivery(
        work_id,
        delivery_id,
        decision=DECISION_CHANGES_REQUESTED,
        reason=reason,
        idempotency_key=idempotency_key,
        actor=actor,
    )
    if not dispatch:
        return result
    return _complete_rework_dispatch(
        work_id,
        delivery_id,
        reason=reason,
        actor=actor,
        result=result,
    )


def _complete_rework_dispatch(
    work_id: str,
    delivery_id: str,
    *,
    reason: str,
    actor: str,
    result: dict[str, Any],
) -> dict[str, Any]:
    """Resume notes / reopen / execute after a durable changes_requested decision."""
    raw_decision = result.get("decision")
    decision: dict[str, Any] = raw_decision if isinstance(raw_decision, dict) else {}
    decision_id = str(decision.get("decision_id") or "") or None
    with _work_lock(work_id):
        folded = fold_delivery_history(work_id)
        if _dispatch_recorded(folded, delivery_id, decision_id):
            result["replayed"] = True
            result["bundle"] = public_bundle(work_id)
            result["work"] = read_ports.query_work_item(work_id)
            return result

        if _execute_requested_since(work_id, _decision_seq(folded, decision_id)):
            _emit_rework_dispatched(
                work_id, delivery_id=delivery_id, decision_id=decision_id, actor=actor,
            )
            result["bundle"] = public_bundle(work_id)
            result["work"] = read_ports.query_work_item(work_id)
            return result

        item = read_ports.query_work_item(work_id)
        if item is None:
            raise DeliveryNotFoundError(work_id)
        status = str(item.get("status") or "pending")

        plan = parse_plan(item.get("executable_plan"))
        notes = list(plan.get("rework_notes") or [])
        if not _has_rework_note(notes, delivery_id, reason):
            notes.append({
                "delivery_id": delivery_id,
                "reason": str(reason).strip(),
                "at": _now(),
            })
            plan["rework_notes"] = notes
            kernel.emit_event(
                EVENT_WORK_ITEM_UPDATED,
                AGGREGATE_WORK_ITEM,
                work_id,
                payload={"executable_plan": json.dumps(plan, ensure_ascii=False)},
                actor=actor,
            )

        if status in {"completed", "failed"}:
            read_ports.update_work_item_status(work_id, "pending")
            status = "pending"
        read_ports.reset_work_item_plan_progress(work_id)
        try:
            if status == "running":
                read_ports.ensure_work_item_execute_requested(work_id)
            else:
                read_ports.request_work_item_execute(work_id)
        except ValueError as exc:
            logger.info("rework execute deferred for %s: %s", work_id, exc)
            result["execute_error"] = str(exc)
            result["bundle"] = public_bundle(work_id)
            result["work"] = read_ports.query_work_item(work_id)
            return result
        _emit_rework_dispatched(
            work_id, delivery_id=delivery_id, decision_id=decision_id, actor=actor,
        )
        result["bundle"] = public_bundle(work_id)
        result["work"] = read_ports.query_work_item(work_id)
        return result


def list_unreviewed_deliveries(*, limit: int = 20) -> list[dict[str, Any]]:
    items = read_ports.list_work_items(work_type="task", limit=100)
    out: list[dict[str, Any]] = []
    for item in items:
        if not is_project_brief_plan(item.get("executable_plan")):
            continue
        folded = fold_delivery_history(item["id"])
        current = folded["current"]
        if not current:
            continue
        if folded["current_review_status"] != REVIEW_UNREVIEWED:
            continue
        out.append({
            "work_id": item["id"],
            "title": item.get("title") or "",
            "delivery_id": current.get("delivery_id"),
            "version": current.get("version"),
            "summary": current.get("summary") or "",
            "updated_at": item.get("updated_at"),
        })
        if len(out) >= limit:
            break
    return out
