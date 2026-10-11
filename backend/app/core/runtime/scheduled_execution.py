"""ScheduledExecution — Lane A atomic unit of durable handler execution.

One ScheduledExecution = one invocation of one handler for one event.
Persisted in ``handler_executions`` (distinct from domain ``work_items``).

    Event → ScheduledExecution(s) → Scheduler → Handler
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

ScheduledExecutionStatus = Literal[
    "pending",
    "running",
    "completed",
    "failed",
    "retrying",
]

# Lane A only — deliberately narrower than domain ``work_item_engine.WorkItemStatus``.
_LANE_A_TRANSITIONS: dict[str, frozenset[str]] = {
    "pending": frozenset({"running", "failed"}),
    "running": frozenset({"completed", "failed", "retrying"}),
    "retrying": frozenset({"pending", "running", "failed"}),
    "completed": frozenset(),
    "failed": frozenset({"retrying", "pending"}),
}


@dataclass(frozen=True)
class ExecutionPolicy:
    """Execution parameters for a ScheduledExecution (Lane A)."""

    timeout_seconds: float = 30.0
    max_retries: int = 3
    retry_delay_seconds: float = 5.0

    @classmethod
    def default(cls) -> "ExecutionPolicy":
        return cls()


def policy_for_event(event_type: str, event: object | None = None) -> ExecutionPolicy:
    """Choose an ExecutionPolicy for a newly enqueued event."""
    if event_type == "ChatRequested":
        from app.config import settings

        return ExecutionPolicy(
            timeout_seconds=float(settings.total_tool_loop_timeout),
            # Two interrupt recoveries before DLQ. max_retries=1 made the
            # second crash terminal (ADR-R011). Approval continuation stays
            # one-shot and does not reopen tools.
            max_retries=2,
            retry_delay_seconds=2.0,
        )
    if event_type == "ExecuteRequested" and _is_project_brief_execute(event):
        from app.config import settings

        # The model client retries inside this one handler. 30s (and 60s+30s)
        # dead-letter the write stage while the page still says it is writing.
        # One extra handler retry is enough; the client already retries.
        return ExecutionPolicy(
            timeout_seconds=float(settings.total_tool_loop_timeout),
            max_retries=1,
            retry_delay_seconds=2.0,
        )
    return ExecutionPolicy.default()


def _is_project_brief_execute(event: object | None) -> bool:
    """True when this ExecuteRequested runs a project brief. False keeps 30s."""
    if event is None:
        return False
    payload = getattr(event, "payload", None)
    if not isinstance(payload, dict):
        return False
    action_id = payload.get("action_id")
    if not isinstance(action_id, str) or not action_id:
        return False
    try:
        from app.core.runtime import read_ports
        from app.core.runtime.handlers.execute_handlers import _is_project_brief_plan

        action = read_ports.query_work_item(action_id)
    except Exception:
        return False
    if not action:
        return False
    return _is_project_brief_plan(action.get("executable_plan"))


@dataclass
class ScheduledExecution:
    """One invocation of a handler for a specific event (Lane A WORK unit)."""

    id: str = field(default_factory=lambda: f"wi_{uuid.uuid4().hex[:12]}")

    event_seq: int = 0
    event_id: str = ""
    event_type: str = ""
    handler_name: str = ""
    instance_id: str = ""

    status: ScheduledExecutionStatus = "pending"
    retry_count: int = 0
    policy: ExecutionPolicy = field(default_factory=ExecutionPolicy.default)

    correlation_id: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    started_at: str | None = None
    completed_at: str | None = None

    error: str | None = None
    dead_letter: bool = False

    _event: object | None = field(default=None, repr=False, compare=False)

    def transition_to(self, status: ScheduledExecutionStatus) -> None:
        allowed = _LANE_A_TRANSITIONS.get(self.status, frozenset())
        if status not in allowed:
            raise ValueError(
                f"Invalid ScheduledExecution transition: {self.status!r} → {status!r}"
            )
        self.status = status
        if status == "running" and self.started_at is None:
            self.started_at = datetime.now(UTC).isoformat()
        if status in ("completed", "failed"):
            self.completed_at = datetime.now(UTC).isoformat()

    def can_retry(self) -> bool:
        return self.retry_count < self.policy.max_retries

    def to_row(self) -> dict:
        import json

        return {
            "id": self.id,
            "event_seq": self.event_seq,
            "event_id": self.event_id,
            "event_type": self.event_type,
            "handler_name": self.handler_name,
            "instance_id": self.instance_id,
            "status": self.status,
            "retry_count": self.retry_count,
            "policy_json": json.dumps({
                "timeout": self.policy.timeout_seconds,
                "max_retries": self.policy.max_retries,
                "retry_delay": self.policy.retry_delay_seconds,
            }),
            "correlation_id": self.correlation_id,
            "created_at": self.created_at,
            "started_at": self.started_at or "",
            "completed_at": self.completed_at or "",
            "error": self.error or "",
            "dead_letter": 1 if self.dead_letter else 0,
        }

    @classmethod
    def from_row(cls, row: dict) -> "ScheduledExecution":
        import json

        raw = row.get("policy_json") or "{}"
        policy_raw = json.loads(raw)
        policy = ExecutionPolicy(
            timeout_seconds=policy_raw.get("timeout", 30.0),
            max_retries=policy_raw.get("max_retries", 3),
            retry_delay_seconds=policy_raw.get("retry_delay", 5.0),
        )
        return cls(
            id=row["id"],
            event_seq=row.get("event_seq", 0),
            event_id=row.get("event_id", ""),
            event_type=row.get("event_type", ""),
            handler_name=row.get("handler_name", ""),
            instance_id=row.get("instance_id", ""),
            status=row["status"],
            retry_count=row.get("retry_count", 0),
            policy=policy,
            correlation_id=row.get("correlation_id", ""),
            created_at=row.get("created_at", ""),
            started_at=row.get("started_at") or None,
            completed_at=row.get("completed_at") or None,
            error=row.get("error") or None,
            dead_letter=bool(row.get("dead_letter") or 0),
        )
