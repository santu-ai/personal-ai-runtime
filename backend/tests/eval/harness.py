"""Minimal Agent evaluation harness — Task → Runtime → Record.

No fake success: records whatever the Runtime actually did.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class EvalRecord:
    task_id: str
    input: str
    expected_behavior: str
    actual_behavior: str
    success: bool | None
    failure_reason: str | None
    tool_calls: list[str] = field(default_factory=list)
    tool_failures: list[str] = field(default_factory=list)
    duration_s: float = 0.0
    tokens_cost: str = "NOT MEASURED"
    trace_id: str = ""
    notes: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "input": self.input,
            "expected_behavior": self.expected_behavior,
            "actual_behavior": self.actual_behavior,
            "success": self.success,
            "failure_reason": self.failure_reason,
            "tool_calls": self.tool_calls,
            "tool_failures": self.tool_failures,
            "duration_s": round(self.duration_s, 4),
            "tokens_cost": self.tokens_cost,
            "trace_id": self.trace_id,
            "notes": self.notes,
        }


class EvalClock:
    def __init__(self) -> None:
        self._t0 = time.perf_counter()

    def elapsed(self) -> float:
        return time.perf_counter() - self._t0


def record_from_invoke(
    *,
    task_id: str,
    input_text: str,
    expected: str,
    result: dict[str, Any],
    clock: EvalClock,
    trace_id: str,
    kernel: Any,
) -> EvalRecord:
    from app.core.runtime.read_ports.events import reconstruct_execution_trace

    trace = reconstruct_execution_trace(trace_id)
    tools = [t.get("name") or "" for t in trace["tools"]]
    failures = [
        f"{t.get('name')}:{t.get('outcome')}"
        for t in trace["tools"]
        if not t.get("success")
    ]
    outcome = result.get("outcome") or result.get("status")
    return EvalRecord(
        task_id=task_id,
        input=input_text,
        expected_behavior=expected,
        actual_behavior=str(outcome),
        success=None,  # caller decides against expected
        failure_reason=result.get("error"),
        tool_calls=tools,
        tool_failures=failures,
        duration_s=clock.elapsed(),
        tokens_cost="NOT MEASURED",
        trace_id=trace_id,
        notes=f"status={result.get('status')} outcome={outcome}",
    )
