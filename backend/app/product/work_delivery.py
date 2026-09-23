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
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.runtime import read_ports
from app.core.runtime.kernel.constants import (
    AGGREGATE_EXECUTION,
    AGGREGATE_WORK_ITEM,
    EVENT_APPROVAL_REQUESTED,
    EVENT_CAPABILITY_DENIED,
    EVENT_CAPABILITY_FAILED,
    EVENT_EXECUTE_REQUESTED,
    EVENT_EXECUTION_FAILED,
    EVENT_EXECUTION_REQUESTED,
    EVENT_EXECUTION_RETRIED,
    EVENT_LLM_CALL_RECORDED,
    EVENT_WORK_ITEM_STATUS_CHANGED,
    EVENT_WORK_ITEM_UPDATED,
)
from app.core.runtime.kernel_instance import get_current_execution_id, kernel

logger = logging.getLogger(__name__)

PAYLOAD_DELIVERY_PUBLISHED = "delivery_published"
PAYLOAD_DELIVERY_DECISION = "delivery_decision"
PAYLOAD_REWORK_DISPATCHED = "rework_dispatched"
PAYLOAD_ACTION_ADOPTED = "suggested_action_adopted"
ADOPTED_SUGGESTION_KIND = "adopted_suggestion"
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
    adoptions: list[dict[str, Any]] = []
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
        adopted = payload.get(PAYLOAD_ACTION_ADOPTED)
        if isinstance(adopted, dict) and adopted.get("created_work_id"):
            row = dict(adopted)
            row.setdefault("event_id", event.id)
            row.setdefault("event_seq", event.seq)
            adoptions.append(row)

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
        status = (
            _review_status_from_decision(str(decision.get("decision") or ""))
            if decision
            else REVIEW_UNREVIEWED
        )
        public = _public_delivery(
            row,
            review_status=status,
            include_content=False,
            latest_decision=decision,
        )
        assert public is not None
        public["changes_from_previous"] = _changes_for(row, by_id)
        summaries.append(public)

    current_public = None
    if current:
        current_public = _public_delivery(
            current,
            review_status=review_status,
            include_content=True,
            latest_decision=current_decision,
        )
        assert current_public is not None
        current_public["changes_from_previous"] = _changes_for(current, by_id)

    return {
        "work_id": work_id,
        "deliveries": summaries,
        "current": current_public,
        "current_review_status": review_status if current else None,
        "latest_decision": current_decision,
        "_by_id": by_id,
        "_decisions": decisions,
        "_dispatches": dispatches,
        "_by_idempotency": by_idempotency,
        "_adoptions": adoptions,
        "_by_adoption_key": _adoption_idempotency_index(adoptions),
        "_current_id": current_id,
    }


def _decision_for(
    decisions: list[dict[str, Any]],
    delivery_id: str,
) -> dict[str, Any] | None:
    """Latest ``delivery_decision`` for one version, in event order."""
    latest = None
    for decision in decisions:
        if str(decision.get("delivery_id") or "") == delivery_id:
            latest = decision
    return latest


def _public_delivery(
    row: dict[str, Any] | None,
    *,
    review_status: str,
    include_content: bool,
    latest_decision: dict[str, Any] | None = None,
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
        "latest_decision": dict(latest_decision) if latest_decision else None,
    }
    if include_content:
        out["content"] = row.get("content") or ""
    else:
        content = str(row.get("content") or "")
        out["content_length"] = len(content)
    return out


def _plain_text(value: Any) -> str:
    return str(value or "").strip()


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _dict_rows(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _id_key(value: Any) -> tuple[str, ...]:
    return tuple(sorted(_string_list(value)))


def _finding_view(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "text": _plain_text(item.get("text")),
        "kind": _plain_text(item.get("kind")) or "change",
        "source_ids": _string_list(item.get("source_ids")),
    }


def _source_view(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _plain_text(item.get("id")),
        "type": _plain_text(item.get("type")),
        "title": _plain_text(item.get("title")),
        "locator": _plain_text(item.get("locator")),
    }


def _action_view(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": _plain_text(item.get("title")),
        "reason": _plain_text(item.get("reason")),
        "source_ids": _string_list(item.get("source_ids")),
    }


def _partition_changes(
    previous: list[dict[str, Any]],
    current: list[dict[str, Any]],
    *,
    key_of,
    same,
    view,
    changed_view,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Match rows by a stable key. Same key with different fields is a rewrite."""
    unused = list(previous)
    added: list[dict[str, Any]] = []
    changed: list[dict[str, Any]] = []
    for item in current:
        key = key_of(item)
        match_at = next((index for index, old in enumerate(unused) if key_of(old) == key), None)
        if match_at is None:
            added.append(view(item))
            continue
        old = unused.pop(match_at)
        if not same(old, item):
            changed.append(changed_view(old, item))
    removed = [view(old) for old in unused]
    return added, removed, changed


def _string_delta(previous: list[str], current: list[str]) -> tuple[list[str], list[str]]:
    previous_counts = Counter(previous)
    added: list[str] = []
    for item in current:
        if previous_counts[item]:
            previous_counts[item] -= 1
        else:
            added.append(item)
    current_counts = Counter(current)
    removed: list[str] = []
    for item in previous:
        if current_counts[item]:
            current_counts[item] -= 1
        else:
            removed.append(item)
    return added, removed


def _changes_from_previous(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """Structured delta already stored on the two delivery payloads.

    The result cites findings, sources, limitations, and suggested actions.
    It does not copy either version's full body.
    """
    prev_findings = _dict_rows(previous.get("findings"))
    next_findings = _dict_rows(current.get("findings"))
    findings_added, findings_removed, findings_changed = _partition_changes(
        prev_findings,
        next_findings,
        key_of=lambda item: _plain_text(item.get("text")),
        same=lambda old, item: (
            (_plain_text(old.get("kind")) or "change")
            == (_plain_text(item.get("kind")) or "change")
            and _id_key(old.get("source_ids")) == _id_key(item.get("source_ids"))
        ),
        view=_finding_view,
        changed_view=lambda old, item: {
            **_finding_view(item),
            "previous_kind": _plain_text(old.get("kind")) or "change",
            "previous_source_ids": _string_list(old.get("source_ids")),
        },
    )
    prev_sources = _dict_rows(previous.get("sources"))
    next_sources = _dict_rows(current.get("sources"))

    def _source_key(item: dict[str, Any]) -> str:
        source_id = _plain_text(item.get("id"))
        if source_id:
            return f"id:{source_id}"
        return f"title:{_plain_text(item.get('title'))}"

    sources_added, sources_removed, sources_changed = _partition_changes(
        prev_sources,
        next_sources,
        key_of=_source_key,
        same=lambda old, item: _source_view(old) == _source_view(item),
        view=_source_view,
        changed_view=lambda old, item: {
            **_source_view(item),
            "previous_title": _plain_text(old.get("title")),
            "previous_locator": _plain_text(old.get("locator")),
            "previous_type": _plain_text(old.get("type")),
        },
    )
    prev_actions = _dict_rows(previous.get("suggested_actions"))
    next_actions = _dict_rows(current.get("suggested_actions"))
    actions_added, actions_removed, actions_changed = _partition_changes(
        prev_actions,
        next_actions,
        key_of=lambda item: _plain_text(item.get("title")),
        same=lambda old, item: (
            _plain_text(old.get("reason")) == _plain_text(item.get("reason"))
            and _id_key(old.get("source_ids")) == _id_key(item.get("source_ids"))
        ),
        view=_action_view,
        changed_view=lambda old, item: {
            **_action_view(item),
            "previous_reason": _plain_text(old.get("reason")),
            "previous_source_ids": _string_list(old.get("source_ids")),
        },
    )
    limitations_added, limitations_removed = _string_delta(
        _string_list(previous.get("limitations")),
        _string_list(current.get("limitations")),
    )
    return {
        "previous_delivery_id": previous.get("delivery_id"),
        "previous_version": int(previous.get("version") or 0),
        "summary_changed": (
            _plain_text(previous.get("summary")) != _plain_text(current.get("summary"))
        ),
        "content_changed": str(previous.get("content") or "") != str(current.get("content") or ""),
        "findings_added": findings_added,
        "findings_removed": findings_removed,
        "findings_changed": findings_changed,
        "sources_added": sources_added,
        "sources_removed": sources_removed,
        "sources_changed": sources_changed,
        "limitations_added": limitations_added,
        "limitations_removed": limitations_removed,
        "actions_added": actions_added,
        "actions_removed": actions_removed,
        "actions_changed": actions_changed,
    }


def _changes_for(row: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    previous_id = str(row.get("supersedes_delivery_id") or "").strip()
    if not previous_id:
        return None
    previous = by_id.get(previous_id)
    if not isinstance(previous, dict):
        return None
    return _changes_from_previous(previous, row)


def _coerce_action_index(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _adoption_idempotency_index(adoptions: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for row in adoptions:
        key = str(row.get("idempotency_key") or "").strip()
        if key:
            indexed[key] = row
    return indexed


def _live_adopted_indexes(adoptions: list[dict[str, Any]], delivery_id: str) -> dict[int, str]:
    """Latest still-existing child work for each suggestion on one delivery."""
    grouped: dict[int, list[str]] = {}
    for row in adoptions:
        if str(row.get("delivery_id") or "") != delivery_id:
            continue
        index = _coerce_action_index(row.get("action_index"))
        if index is None:
            continue
        created = str(row.get("created_work_id") or "").strip()
        if created:
            grouped.setdefault(index, []).append(created)
    live: dict[int, str] = {}
    for index, work_ids in grouped.items():
        for created in reversed(work_ids):
            if read_ports.query_work_item(created):
                live[index] = created
                break
    return live


def _annotate_adoptions(delivery: dict[str, Any] | None, adopted: dict[int, str]) -> None:
    if not delivery or not adopted:
        return
    actions: list[dict[str, Any]] = []
    for index, action in enumerate(delivery.get("suggested_actions") or []):
        row = dict(action) if isinstance(action, dict) else {"title": str(action)}
        work_id = adopted.get(index)
        if work_id:
            row["adopted_work_id"] = work_id
        actions.append(row)
    delivery["suggested_actions"] = actions


def _annotate_bundle(bundle: dict[str, Any], adoptions: list[dict[str, Any]]) -> dict[str, Any]:
    current = bundle.get("current")
    if isinstance(current, dict):
        _annotate_adoptions(
            current,
            _live_adopted_indexes(adoptions, str(current.get("delivery_id") or "")),
        )
    for row in bundle.get("deliveries") or []:
        if isinstance(row, dict):
            _annotate_adoptions(
                row,
                _live_adopted_indexes(adoptions, str(row.get("delivery_id") or "")),
            )
    return bundle


def get_delivery(work_id: str, delivery_id: str) -> dict[str, Any]:
    folded = fold_delivery_history(work_id)
    row = folded["_by_id"].get(delivery_id)
    if not row:
        raise DeliveryNotFoundError(delivery_id)
    latest = _decision_for(folded["_decisions"], delivery_id)
    status = (
        _review_status_from_decision(str(latest.get("decision") or ""))
        if latest
        else REVIEW_UNREVIEWED
    )
    public = _public_delivery(
        row,
        review_status=status,
        include_content=True,
        latest_decision=latest,
    )
    assert public is not None
    public["changes_from_previous"] = _changes_for(row, folded["_by_id"])
    _annotate_adoptions(
        public,
        _live_adopted_indexes(folded.get("_adoptions") or [], delivery_id),
    )
    return public


def public_bundle(work_id: str) -> dict[str, Any]:
    folded = fold_delivery_history(work_id)
    bundle = {
        "work_id": work_id,
        "deliveries": folded["deliveries"],
        "current": folded["current"],
        "current_review_status": folded["current_review_status"],
    }
    return _annotate_bundle(bundle, folded.get("_adoptions") or [])


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
                    did = str(existing.get("delivery_id") or "")
                    decision = _decision_for(folded["_decisions"], did)
                    status = (
                        _review_status_from_decision(str(decision.get("decision") or ""))
                        if decision
                        else REVIEW_UNREVIEWED
                    )
                    public = _public_delivery(
                        existing,
                        review_status=status,
                        include_content=True,
                        latest_decision=decision,
                    )
                    assert public is not None
                    public["changes_from_previous"] = _changes_for(existing, folded["_by_id"])
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
        public["changes_from_previous"] = _changes_for(payload_body, folded["_by_id"])
        return public


def _adoption_plan(
    *,
    source_work_id: str,
    delivery_id: str,
    action_index: int,
    source_ids: list[str],
) -> str:
    return json.dumps(
        {
            "kind": ADOPTED_SUGGESTION_KIND,
            "source_work_id": source_work_id,
            "delivery_id": delivery_id,
            "action_index": action_index,
            "source_ids": source_ids,
        },
        ensure_ascii=False,
    )


def _matching_adopted_child(
    source_work_id: str,
    delivery_id: str,
    action_index: int,
) -> dict[str, Any] | None:
    for child in read_ports.get_sub_work_items(source_work_id):
        plan = parse_plan(child.get("executable_plan"))
        if plan.get("kind") != ADOPTED_SUGGESTION_KIND:
            continue
        if str(plan.get("source_work_id") or "") != source_work_id:
            continue
        if str(plan.get("delivery_id") or "") != delivery_id:
            continue
        child_index = _coerce_action_index(plan.get("action_index"))
        if child_index is None or child_index != action_index:
            continue
        return child
    return None


def _adoption_matches(prior: dict[str, Any], *, delivery_id: str, action_index: int) -> bool:
    if str(prior.get("delivery_id") or "") != delivery_id:
        return False
    return _coerce_action_index(prior.get("action_index")) == action_index


def _record_adoption(
    work_id: str,
    *,
    delivery_id: str,
    action_index: int,
    title: str,
    created_work_id: str,
    idempotency_key: str,
    actor: str,
) -> dict[str, Any]:
    body = {
        "delivery_id": delivery_id,
        "action_index": action_index,
        "title": title,
        "created_work_id": created_work_id,
        "idempotency_key": idempotency_key or None,
        "created_at": _now(),
    }
    kernel.emit_event(
        EVENT_WORK_ITEM_UPDATED,
        AGGREGATE_WORK_ITEM,
        work_id,
        payload={PAYLOAD_ACTION_ADOPTED: body},
        actor=actor,
    )
    return body


def _adoption_result(
    work_id: str,
    *,
    replayed: bool,
    action_index: int,
    created_work_id: str,
    adoption: dict[str, Any] | None,
) -> dict[str, Any]:
    work = read_ports.query_work_item(created_work_id)
    return {
        "work_id": work_id,
        "replayed": replayed,
        "action_index": action_index,
        "created_work_id": created_work_id,
        "adoption": adoption,
        "work": work,
        "bundle": public_bundle(work_id),
    }


def adopt_suggested_action(
    work_id: str,
    delivery_id: str,
    action_index: int,
    *,
    idempotency_key: str | None = None,
    actor: str = "user",
) -> dict[str, Any]:
    """Turn one current-delivery suggestion into a child task.

    The same delivery index always returns the existing task. A repeated
    idempotency key for a different index is a conflict. The child is an
    ordinary Work item; the link is a ``WorkItemUpdated`` payload, not a new
    event type or table.
    """
    if action_index < 0:
        raise DeliveryValidationError("action_index must be >= 0")
    parent = read_ports.query_work_item(work_id)
    if parent is None:
        raise DeliveryNotFoundError(work_id)

    key = str(idempotency_key or "").strip()
    with _work_lock(work_id):
        folded = fold_delivery_history(work_id)
        if key:
            prior = folded.get("_by_adoption_key", {}).get(key)
            if prior is not None:
                if not _adoption_matches(prior, delivery_id=delivery_id, action_index=action_index):
                    raise DeliveryConflictError(
                        "幂等键已用于不同的建议待办",
                        code="idempotency_conflict",
                    )
                created = str(prior.get("created_work_id") or "")
                if read_ports.query_work_item(created):
                    return _adoption_result(
                        work_id,
                        replayed=True,
                        action_index=action_index,
                        created_work_id=created,
                        adoption=prior,
                    )

        row = _require_current_delivery(folded, delivery_id)
        actions = list(row.get("suggested_actions") or [])
        if action_index >= len(actions) or not isinstance(actions[action_index], dict):
            raise DeliveryValidationError("suggested action index is out of range")
        action = actions[action_index]
        title = str(action.get("title") or "").strip()
        if not title:
            raise DeliveryValidationError("suggested action has no title")
        title = title[:500]
        source_ids = [
            str(sid).strip()
            for sid in (action.get("source_ids") or [])
            if str(sid).strip()
        ]

        live = _live_adopted_indexes(folded.get("_adoptions") or [], delivery_id)
        existing_id = live.get(action_index)
        child = read_ports.query_work_item(existing_id) if existing_id else None
        if child is None:
            child = _matching_adopted_child(work_id, delivery_id, action_index)
        if child is not None:
            created_id = str(child["id"])
            already = existing_id == created_id
            adoption = None
            if not already:
                adoption = _record_adoption(
                    work_id,
                    delivery_id=delivery_id,
                    action_index=action_index,
                    title=title,
                    created_work_id=created_id,
                    idempotency_key=key,
                    actor=actor,
                )
            return _adoption_result(
                work_id,
                replayed=True,
                action_index=action_index,
                created_work_id=created_id,
                adoption=adoption,
            )

        reason = str(action.get("reason") or "").strip()
        version = int(row.get("version") or 0)
        lines = [line for line in (reason,) if line]
        if source_ids:
            lines.append("来源：" + "、".join(source_ids))
        parent_title = str(parent.get("title") or "简报")
        lines.append(f"采纳自《{parent_title}》交付 v{version}")
        child = read_ports.create_work_item(
            title,
            description="\n".join(lines)[:20000],
            work_type="task",
            parent_work_id=work_id,
            status="pending",
            executable_plan=_adoption_plan(
                source_work_id=work_id,
                delivery_id=delivery_id,
                action_index=action_index,
                source_ids=source_ids,
            ),
        )
        read_ports.bump_parent_activity(work_id)
        adoption = _record_adoption(
            work_id,
            delivery_id=delivery_id,
            action_index=action_index,
            title=title,
            created_work_id=str(child["id"]),
            idempotency_key=key,
            actor=actor,
        )
        return _adoption_result(
            work_id,
            replayed=False,
            action_index=action_index,
            created_work_id=str(child["id"]),
            adoption=adoption,
        )


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


# Recent completed tasks scanned for a project brief that already has a delivery.
# Not a new work model: the next publish still supersedes the current version.
_RERUN_SCAN = 30


def list_rerunnable_briefs(*, limit: int = 5) -> list[dict[str, Any]]:
    """Completed project briefs that already have a delivery.

    Opening one and running it again stays on the same work item. The next
    ``publish_delivery`` sets ``supersedes_delivery_id``, so
    ``changes_from_previous`` is the comparison with the previous version.
    """
    limit = max(1, min(int(limit), 5))
    rows = read_ports.query_work_items(
        work_type="task",
        status="completed",
        order="created_at_desc",
        limit=_RERUN_SCAN,
    )
    out: list[dict[str, Any]] = []
    for item in rows:
        if len(out) >= limit:
            break
        work_id = str(item.get("id") or "")
        if not work_id or not is_project_brief_plan(item.get("executable_plan")):
            continue
        try:
            folded = fold_delivery_history(work_id)
        except Exception:
            logger.warning("skip rerunnable brief %s", work_id, exc_info=True)
            continue
        current = folded.get("current")
        if not isinstance(current, dict) or not current.get("delivery_id"):
            continue
        out.append({
            "work_id": work_id,
            "title": item.get("title") or "",
            "version": current.get("version"),
            "delivery_id": current.get("delivery_id"),
        })
    return out


def _require_completed_brief(work_id: str) -> tuple[dict[str, Any], str]:
    """Completed project brief that already has a delivery, plus that delivery id."""
    item = read_ports.query_work_item(work_id)
    if item is None:
        raise DeliveryNotFoundError(work_id)
    if not is_project_brief_plan(item.get("executable_plan")):
        raise DeliveryValidationError("只有项目简报可以再次运行")
    status = str(item.get("status") or "")
    if status != "completed":
        raise DeliveryConflictError("只有已完成的简报可以再次运行")
    folded = fold_delivery_history(work_id)
    current = folded.get("current")
    if not isinstance(current, dict) or not current.get("delivery_id"):
        raise DeliveryValidationError("还没有可对照的交付")
    return item, str(current.get("delivery_id") or "")


def _reject_unexecutable_plan(item: dict[str, Any]) -> None:
    """Refuse plans ``request_work_item_execute`` would reject before any emit.

    ``completed`` is not checked here: rerun leaves that status on purpose.
    A failure at this step does not reopen the brief.
    """
    if item.get("work_type") == "goal":
        raise DeliveryValidationError(
            "Goals cannot be executed; run child actions instead",
        )
    plan_raw = item.get("executable_plan")
    if not isinstance(plan_raw, str) or not plan_raw.strip():
        raise DeliveryValidationError("Work item has no executable_plan")
    try:
        plan_obj = json.loads(plan_raw)
    except json.JSONDecodeError as exc:
        raise DeliveryValidationError(f"invalid executable_plan JSON: {exc}") from exc
    if not isinstance(plan_obj, dict) or not isinstance(plan_obj.get("steps"), list):
        raise DeliveryValidationError(
            "executable_plan must be an object with a steps list",
        )
    if not any(isinstance(step, dict) for step in plan_obj["steps"]):
        raise DeliveryValidationError("executable_plan has no steps")


def _execute_requested_ids(work_id: str) -> set[str]:
    events = kernel.read_events(
        type=EVENT_EXECUTE_REQUESTED,
        aggregate_type="action",
        aggregate_id=f"exec_{work_id}",
    )
    return {str(getattr(event, "id", "") or "") for event in events}


def _restore_completed_brief(
    work_id: str,
    snapshot: list,
    before_ids: set[str],
    *,
    restore_progress: bool = True,
) -> None:
    """Put a brief back on its completed delivery when execute never started.

    Each Kernel emit is its own transaction, so reopen and ``ExecuteRequested``
    cannot commit together. If the request is already in the log, leave the
    running brief alone.
    """
    if _execute_requested_ids(work_id) - before_ids:
        return
    item = read_ports.query_work_item(work_id)
    status = str((item or {}).get("status") or "")
    if status in {"pending", "running"}:
        # pending/running → completed is already a legal transition. The reason
        # marks a restore so the dependency hook does not treat it as a new finish.
        kernel.emit_event(
            EVENT_WORK_ITEM_STATUS_CHANGED,
            AGGREGATE_WORK_ITEM,
            work_id,
            payload={
                "status": "completed",
                "reason": read_ports.WORK_STATUS_REASON_RERUN_RESTORE,
            },
            actor="user",
        )
    if restore_progress:
        read_ports.reset_work_item_plan_progress(work_id, snapshot=snapshot)
    logger.info("restored completed brief %s after execute request failed", work_id)


def rerun_project_brief(work_id: str) -> dict[str, Any]:
    """Re-execute a completed project brief on the same work item.

    Does not record a review decision and does not append rework notes.
    Reopens ``completed`` → ``pending``, clears plan progress, then uses the
    existing ``ExecuteRequested`` path. Kernel commits each event alone, so a
    failure after that reopen restores ``completed`` (``reason=rerun_restore``)
    and the cleared plan rows. That reason is not a new completion, so the
    dependency hook does not start other pending tasks. The current delivery
    stays. The next published delivery supersedes it. A plan that cannot run
    is rejected before the reopen.
    """
    with _work_lock(work_id):
        item, previous_id = _require_completed_brief(work_id)
        _reject_unexecutable_plan(item)
        before_ids = _execute_requested_ids(work_id)
        snapshot: list = []
        reopened = False
        progress_cleared = False
        try:
            read_ports.update_work_item_status(work_id, "pending")
            reopened = True
            snapshot = read_ports.reset_work_item_plan_progress(work_id)
            progress_cleared = True
            work = read_ports.request_work_item_execute(work_id)
        except Exception as exc:
            if _execute_requested_ids(work_id) - before_ids:
                started = read_ports.query_work_item(work_id)
                if started is not None:
                    logger.info(
                        "brief rerun kept %s after %s", work_id, type(exc).__name__,
                    )
                    return {
                        "work_id": work_id,
                        "supersedes_delivery_id": previous_id,
                        "work": started,
                    }
            if reopened:
                try:
                    _restore_completed_brief(
                        work_id,
                        snapshot,
                        before_ids,
                        restore_progress=progress_cleared,
                    )
                except Exception:
                    logger.exception("brief rerun restore failed for %s", work_id)
                    raise
            if isinstance(exc, ValueError):
                raise DeliveryValidationError(str(exc)) from exc
            raise
        return {
            "work_id": work_id,
            "supersedes_delivery_id": previous_id,
            "work": work,
        }


_REPEAT_MESSAGE_LIMIT = 200


def _repeat_timer_message(title: str) -> str:
    text = f"再次运行：{title}".strip() or "再次运行"
    if len(text) > _REPEAT_MESSAGE_LIMIT:
        return text[:_REPEAT_MESSAGE_LIMIT]
    return text


async def schedule_brief_repeat(
    work_id: str,
    *,
    minutes: float = 0,
    hours: float = 0,
) -> dict[str, Any]:
    """Schedule ``set_timer`` so this same brief repeats once.

    The nested timer payload stores the existing ``work_id``. Scheduling does
    not change the work item and does not publish a delivery. On fire, the
    reminder handler re-runs this task or opens it.
    """
    with _work_lock(work_id):
        item, _previous_id = _require_completed_brief(work_id)
        message = _repeat_timer_message(str(item.get("title") or "项目简报"))
    cap = await kernel.invoke_capability(
        "set_timer",
        {
            "minutes": minutes,
            "hours": hours,
            "message": message,
            "work_id": work_id,
        },
        actor="user",
        execution_id=get_current_execution_id(),
    )
    if cap.get("status") != "success":
        raise DeliveryValidationError(str(cap.get("error") or "无法设置定时"))
    try:
        data = json.loads(cap.get("result") or "")
    except (json.JSONDecodeError, TypeError) as exc:
        raise DeliveryValidationError("无法设置定时") from exc
    if not isinstance(data, dict) or not data.get("timer_id"):
        raise DeliveryValidationError("无法设置定时")
    return {
        "work_id": work_id,
        "timer_id": str(data["timer_id"]),
        "fire_at": str(data.get("fire_at") or ""),
    }


# Each read stays inside Kernel's limit. Pages stop once the inbox is full.
# If that window is entirely newer non-delivery updates, fall back to a bounded
# task-row scan so an older unreviewed brief is not dropped.
_UNREVIEWED_PAGE_SIZE = 200
_UNREVIEWED_MAX_PAGES = 25
_UNREVIEWED_TASK_SCAN = 1000


def _unreviewed_delivery_row(work_id: str, item: dict[str, Any]) -> dict[str, Any] | None:
    if item.get("work_type") != "task":
        return None
    if not is_project_brief_plan(item.get("executable_plan")):
        return None
    folded = fold_delivery_history(work_id)
    current = folded["current"]
    if not current or folded["current_review_status"] != REVIEW_UNREVIEWED:
        return None
    return {
        "work_id": work_id,
        "title": item.get("title") or "",
        "delivery_id": current.get("delivery_id"),
        "version": current.get("version"),
        "summary": current.get("summary") or "",
        "updated_at": item.get("updated_at"),
    }


def list_unreviewed_deliveries(*, limit: int = 20) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    limit = max(1, int(limit))
    truncated = True
    for page in range(_UNREVIEWED_MAX_PAGES):
        events = kernel.read_events(
            type=EVENT_WORK_ITEM_UPDATED,
            aggregate_type=AGGREGATE_WORK_ITEM,
            order="desc",
            limit=_UNREVIEWED_PAGE_SIZE,
            offset=page * _UNREVIEWED_PAGE_SIZE,
        )
        if len(events) < _UNREVIEWED_PAGE_SIZE:
            truncated = False
        for event in events:
            if not isinstance((event.payload or {}).get(PAYLOAD_DELIVERY_PUBLISHED), dict):
                continue
            work_id = str(event.aggregate_id)
            if work_id in seen:
                continue
            seen.add(work_id)
            item = read_ports.query_work_item(work_id)
            if not item:
                continue
            row = _unreviewed_delivery_row(work_id, item)
            if row is None:
                continue
            out.append(row)
            if len(out) >= limit:
                return out
        if not truncated:
            break
    if not truncated or len(out) >= limit:
        return out
    tasks = read_ports.query_work_items(
        work_type="task",
        order="created_at_desc",
        limit=_UNREVIEWED_TASK_SCAN,
    )
    for item in tasks:
        if len(out) >= limit:
            break
        work_id = str(item.get("id") or "")
        if not work_id or work_id in seen:
            continue
        seen.add(work_id)
        row = _unreviewed_delivery_row(work_id, item)
        if row is not None:
            out.append(row)
    return out


def _metric_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


_APPROVAL_LOOKBACK = timedelta(days=7)
_COST_LOOKBACK = timedelta(days=1)
_INTERRUPTION = "interrupted"
_INTERRUPTED_BEFORE_AUDIT = "interrupted_before_audit"


def _event_payload(event: Any) -> dict[str, Any]:
    raw = getattr(event, "payload", None)
    return raw if isinstance(raw, dict) else {}


def _time_in_window(value: Any, since: datetime, moment: datetime) -> bool:
    at = _metric_datetime(value)
    return bool(at and since <= at <= moment)


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _recorded_cost(payload: dict[str, Any]) -> float:
    """Dollar amount on an ``LLMCallRecorded`` payload, or 0 when unusable."""
    try:
        return float(payload.get("cost") or 0)
    except (TypeError, ValueError):
        return 0.0


def _event_correlation(event: Any) -> str:
    payload = _event_payload(event)
    return str(event.correlation_id or payload.get("correlation_id") or "").strip()


def _handler_interruption(event: Any, payload: dict[str, Any]) -> bool:
    """Scheduler replay of one crash, not the follow-up pending enqueue."""
    if event.type == EVENT_EXECUTION_RETRIED:
        return (
            payload.get("reason") == _INTERRUPTION
            and payload.get("status") == "retrying"
        )
    return event.type == EVENT_EXECUTION_FAILED and payload.get("error") == _INTERRUPTION


def _audit_execution_id(event: Any) -> str:
    payload = _event_payload(event)
    return str(getattr(event, "caused_by", None) or payload.get("execution_id") or "").strip()


def _audit_retry_count(payload: dict[str, Any]) -> int | None:
    if "retry_count" not in payload or payload.get("retry_count") is None:
        return None
    try:
        return int(payload["retry_count"])
    except (TypeError, ValueError):
        return None


def _audit_twins_recovery(
    event: Any,
    *,
    handler_slots: set[tuple[str, int, str]],
    handler_correlations: set[str],
) -> bool:
    """True when this audit gap is the same crash as a handler replay.

    Closures stamped at intent time carry the in-flight ``retry_count``.
    Scheduler replay emits ``ExecutionRetried(attempt=retry_count+1)``;
    a budget-exhausted ``ExecutionFailed(error=interrupted)`` keeps
    ``attempt == retry_count``. Events that predate that stamp stay twins
    of any handler replay on the same correlation.
    """
    execution_id = _audit_execution_id(event)
    if execution_id:
        recorded = _audit_retry_count(_event_payload(event))
        if recorded is None:
            return any(slot[0] == execution_id for slot in handler_slots)
        return (execution_id, recorded + 1, "retry") in handler_slots or (
            execution_id,
            recorded,
            "fail",
        ) in handler_slots
    correlation = _event_correlation(event)
    return bool(correlation) and correlation in handler_correlations


def _execution_ids_in_window(
    folded: dict[str, Any],
    *,
    since: datetime,
    moment: datetime,
) -> tuple[set[str], datetime | None]:
    """Execution ids for deliveries published or reviewed inside the window."""
    reviewed = {
        str(row.get("delivery_id") or "")
        for row in (folded.get("_decisions") or [])
        if _time_in_window(row.get("created_at"), since, moment)
    }
    ids: set[str] = set()
    earliest: datetime | None = None
    for delivery in (folded.get("_by_id") or {}).values():
        created = _metric_datetime(delivery.get("created_at"))
        published = bool(created and since <= created <= moment)
        delivery_id = str(delivery.get("delivery_id") or "")
        if not published and delivery_id not in reviewed:
            continue
        execution_id = str(delivery.get("execution_id") or "").strip()
        if execution_id:
            ids.add(execution_id)
        if created and (earliest is None or created < earliest):
            earliest = created
    return ids, earliest


def _attribute_delivery_activity(
    execution_ids: set[str],
    *,
    earliest: datetime | None,
    until: datetime,
    limit: int,
) -> tuple[dict[str, Any], bool]:
    """Count approvals, crash recoveries, and model cost for known executions.

    Joins existing events only. Approvals are high-risk ``ApprovalRequested``
    rows on the execution correlation, plus ``CapabilityDenied`` rows whose
    ``caused_by`` is that execution. One crash recovery is one count: scheduler
    ``ExecutionRetried(reason=interrupted, status=retrying)`` or
    ``ExecutionFailed(error=interrupted)``, keyed by execution and attempt.
    ``CapabilityFailed(error=interrupted_before_audit)`` stamped with that
    execution and the in-flight ``retry_count`` is the audit-closure twin of
    the same attempt, so it does not add a second recovery. An audit gap with
    no matching handler replay still counts. Events without the stamp stay
    twins of a handler replay on the same correlation. Model cost sums
    ``LLMCallRecorded`` with ``purpose=project_brief`` and ``caused_by`` equal
    to the execution id. Successful calls that omit ``caused_by`` increment
    ``unattributed_project_brief_calls`` and add their ``cost`` to
    ``unattributed_project_brief_cost``. That amount stays separate from
    attributable ``llm_cost``. A read that hits its cap marks the attributable
    cost, the unattributed count, and the unattributed cost ``unavailable``.
    """
    zeros = {
        "approval_interventions": 0,
        "recovery_interventions": 0,
        "llm_cost": 0.0,
        "unattributed_project_brief_calls": 0,
        "unattributed_project_brief_cost": 0.0,
    }
    if not execution_ids:
        return zeros, False

    capped = False
    approvals: set[str] = set()
    correlations: set[str] = set()
    execution_correlations: dict[str, set[str]] = {}
    recoveries = 0
    recovery_seen: set[str] = set()
    handler_slots: set[tuple[str, int, str]] = set()
    handler_correlations: set[str] = set()

    def mark_recovery(key: str) -> bool:
        nonlocal recoveries
        if key in recovery_seen:
            return False
        recovery_seen.add(key)
        recoveries += 1
        return True

    for execution_id in execution_ids:
        requested = kernel.read_events(
            type=EVENT_EXECUTION_REQUESTED,
            aggregate_type=AGGREGATE_EXECUTION,
            aggregate_id=execution_id,
            order="desc",
            limit=5,
        )
        for event in requested:
            correlation = _event_correlation(event)
            if correlation:
                correlations.add(correlation)
                execution_correlations.setdefault(execution_id, set()).add(correlation)

        lifecycle = kernel.read_events(
            aggregate_type=AGGREGATE_EXECUTION,
            aggregate_id=execution_id,
            types=[EVENT_EXECUTION_RETRIED, EVENT_EXECUTION_FAILED],
            order="asc",
            limit=limit,
        )
        if len(lifecycle) >= limit:
            capped = True
        for event in lifecycle:
            payload = _event_payload(event)
            if not _handler_interruption(event, payload):
                continue
            key = (
                f"{execution_id}:{event.type}:{_safe_int(payload.get('attempt'))}:"
                f"{payload.get('status') or ''}"
            )
            if not mark_recovery(key):
                continue
            attempt = _safe_int(payload.get("attempt"))
            kind = "retry" if event.type == EVENT_EXECUTION_RETRIED else "fail"
            handler_slots.add((execution_id, attempt, kind))
            linked = _event_correlation(event)
            linked_ids = (
                {linked} if linked else set(execution_correlations.get(execution_id, ()))
            )
            handler_correlations.update(linked_ids)

    for correlation in correlations:
        approval_events = kernel.read_events(
            type=EVENT_APPROVAL_REQUESTED,
            correlation_id=correlation,
            order="asc",
            limit=limit,
        )
        if len(approval_events) >= limit:
            capped = True
        for event in approval_events:
            if _event_payload(event).get("risk") != "high":
                continue
            approvals.add(str(event.aggregate_id))

        failed = kernel.read_events(
            type=EVENT_CAPABILITY_FAILED,
            correlation_id=correlation,
            order="asc",
            limit=limit,
        )
        if len(failed) >= limit:
            capped = True
        for event in failed:
            payload = _event_payload(event)
            if payload.get("error") != _INTERRUPTED_BEFORE_AUDIT:
                continue
            audit_execution = _audit_execution_id(event)
            if audit_execution and audit_execution not in execution_ids:
                continue
            if _audit_twins_recovery(
                event,
                handler_slots=handler_slots,
                handler_correlations=handler_correlations,
            ):
                continue
            recorded_retry = _audit_retry_count(payload)
            if audit_execution and recorded_retry is not None:
                audit_key = f"audit:{audit_execution}:{recorded_retry}"
            elif audit_execution:
                audit_key = f"audit:{audit_execution}"
            else:
                audit_key = str(event.id)
            mark_recovery(audit_key)

    approval_since = (earliest or until) - _APPROVAL_LOOKBACK
    denied = kernel.read_events(
        type=EVENT_CAPABILITY_DENIED,
        since_ts=approval_since.isoformat(),
        until_ts=until.isoformat(),
        order="desc",
        limit=limit,
    )
    if len(denied) >= limit:
        capped = True
    for event in denied:
        if str(event.caused_by or "") not in execution_ids:
            continue
        approval_id = str(_event_payload(event).get("approval_id") or "").strip()
        if approval_id:
            approvals.add(approval_id)

    cost_since = (earliest or until) - _COST_LOOKBACK
    llm_events = kernel.read_events(
        type=EVENT_LLM_CALL_RECORDED,
        since_ts=cost_since.isoformat(),
        until_ts=until.isoformat(),
        order="desc",
        limit=limit,
    )
    if len(llm_events) >= limit:
        capped = True
    linked_cost = 0.0
    unattributed_calls = 0
    unattributed_cost = 0.0
    for event in llm_events:
        payload = _event_payload(event)
        if payload.get("purpose") != "project_brief" or not payload.get("success", True):
            continue
        caused = str(event.caused_by or "").strip()
        if not caused:
            unattributed_calls += 1
            unattributed_cost += _recorded_cost(payload)
            continue
        if caused not in execution_ids:
            continue
        linked_cost += _recorded_cost(payload)

    if capped:
        cost_value: Any = "unavailable"
        unattributed_calls_value: Any = "unavailable"
        unattributed_cost_value: Any = "unavailable"
    else:
        cost_value = round(linked_cost, 6)
        unattributed_calls_value = unattributed_calls
        unattributed_cost_value = round(unattributed_cost, 6)
    if capped:
        approval_value: Any = "unavailable"
        recovery_value: Any = "unavailable"
    else:
        approval_value = len(approvals)
        recovery_value = recoveries
    return {
        "approval_interventions": approval_value,
        "recovery_interventions": recovery_value,
        "llm_cost": cost_value,
        "unattributed_project_brief_calls": unattributed_calls_value,
        "unattributed_project_brief_cost": unattributed_cost_value,
    }, capped


def summarize_delivery_metrics(
    *,
    days: int = 30,
    limit: int = 5000,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Summarize project-brief review outcomes from existing Work events.

    The first-version rate is tasks whose first review accepted delivery v1
    divided by tasks whose first review happened in the window. Approval count,
    crash-recovery count, and model cost are joined from the delivery's
    ``execution_id`` onto existing correlation and execution events. An
    ``interrupted_before_audit`` closure twins the handler replay of the same
    attempt via ``retry_count``, not a clock window. Model cost is the sum of
    attributable calls. Successful ``project_brief`` calls in the lookback
    that omit ``caused_by`` increment ``unattributed_project_brief_calls``
    and add their dollars to ``unattributed_project_brief_cost``. That amount
    is not merged into the attributable sum, and a missing ``caused_by`` does
    not replace the attributable sum with ``unavailable``. The attributable
    cost, the unattributed count, and the unattributed cost stay
    ``unavailable`` when a read hits its cap.
    """
    days = min(365, max(1, int(days)))
    limit = max(1, int(limit))
    moment = now or datetime.now(UTC)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    moment = moment.astimezone(UTC)
    since = moment - timedelta(days=days)
    recent = kernel.read_events(
        type=EVENT_WORK_ITEM_UPDATED,
        aggregate_type=AGGREGATE_WORK_ITEM,
        since_ts=since.isoformat(),
        until_ts=moment.isoformat(),
        order="desc",
        limit=limit,
    )
    work_ids = {
        str(event.aggregate_id)
        for event in recent
        if isinstance(event.payload or {}, dict)
        and (
            isinstance((event.payload or {}).get(PAYLOAD_DELIVERY_DECISION), dict)
            or isinstance((event.payload or {}).get(PAYLOAD_ACTION_ADOPTED), dict)
        )
    }

    reviewed_tasks = accepted_tasks = first_reviewed = first_accepted = 0
    reworks = adopted_actions = 0
    review_latency_hours: list[float] = []
    per_work: list[dict[str, Any]] = []
    folded_by_work: dict[str, dict[str, Any]] = {}

    def in_window(row: dict[str, Any]) -> bool:
        return _time_in_window(row.get("created_at"), since, moment)

    for work_id in sorted(work_ids):
        folded = fold_delivery_history(work_id)
        folded_by_work[work_id] = folded
        decisions = list(folded.get("_decisions") or [])
        decisions.sort(key=lambda row: int(row.get("event_seq") or 0))
        current_decisions = [row for row in decisions if in_window(row)]
        current_adoptions = [
            row for row in (folded.get("_adoptions") or []) if in_window(row)
        ]
        if not current_decisions and not current_adoptions:
            continue

        accepted = [
            row for row in current_decisions
            if row.get("decision") == DECISION_ACCEPTED
        ]
        changes = [
            row for row in current_decisions
            if row.get("decision") == DECISION_CHANGES_REQUESTED
        ]
        if current_decisions:
            reviewed_tasks += 1
        if accepted:
            accepted_tasks += 1
        reworks += len(changes)
        adopted_actions += len(current_adoptions)

        first = decisions[0] if decisions else None
        first_is_current = first is not None and in_window(first)
        raw_version = first.get("delivery_version") if first_is_current and first is not None else None
        version_number = raw_version if isinstance(raw_version, int) and not isinstance(raw_version, bool) else 0
        first_was_accepted = bool(
            first_is_current
            and first is not None
            and first.get("decision") == DECISION_ACCEPTED
            and version_number == 1
        )
        if first_is_current:
            first_reviewed += 1
        if first_was_accepted:
            first_accepted += 1

        latencies: list[float] = []
        deliveries = folded.get("_by_id") or {}
        for decision in current_decisions:
            delivery = deliveries.get(str(decision.get("delivery_id") or "")) or {}
            published_at = _metric_datetime(delivery.get("created_at"))
            decided_at = _metric_datetime(decision.get("created_at"))
            if published_at and decided_at and decided_at >= published_at:
                hours = (decided_at - published_at).total_seconds() / 3600
                latencies.append(hours)
                review_latency_hours.append(hours)

        item = read_ports.query_work_item(work_id) or {}
        per_work.append({
            "work_id": work_id,
            "title": item.get("title") or "",
            "reviews": len(current_decisions),
            "accepted": bool(accepted),
            "first_review_accepted_v1": first_was_accepted,
            "reworks": len(changes),
            "adopted_actions": len(current_adoptions),
            "average_review_latency_hours": (
                round(sum(latencies) / len(latencies), 2) if latencies else None
            ),
        })

    per_work.sort(key=lambda row: (not row["accepted"], row["title"], row["work_id"]))
    for event in recent:
        payload = event.payload if isinstance(event.payload, dict) else {}
        if not isinstance(payload.get(PAYLOAD_DELIVERY_PUBLISHED), dict):
            continue
        published_id = str(event.aggregate_id)
        if published_id not in folded_by_work:
            folded_by_work[published_id] = fold_delivery_history(published_id)

    execution_ids: set[str] = set()
    earliest: datetime | None = None
    for folded in folded_by_work.values():
        ids, folded_earliest = _execution_ids_in_window(
            folded, since=since, moment=moment,
        )
        execution_ids.update(ids)
        if folded_earliest and (earliest is None or folded_earliest < earliest):
            earliest = folded_earliest
    attribution, attribution_capped = _attribute_delivery_activity(
        execution_ids,
        earliest=earliest,
        until=moment,
        limit=limit,
    )
    return {
        "window_days": days,
        "reviewed_tasks": reviewed_tasks,
        "accepted_tasks": accepted_tasks,
        "first_reviewed_tasks": first_reviewed,
        "first_version_accepted_tasks": first_accepted,
        "first_version_acceptance_rate": (
            first_accepted / first_reviewed if first_reviewed else None
        ),
        "rework_count": reworks,
        "adopted_action_count": adopted_actions,
        "average_review_latency_hours": (
            round(sum(review_latency_hours) / len(review_latency_hours), 2)
            if review_latency_hours else None
        ),
        "attribution": attribution,
        "capped": len(recent) >= limit or attribution_capped,
        "cap_limit": limit,
        "items": per_work,
    }
