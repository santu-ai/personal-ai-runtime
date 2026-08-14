# mypy: disable-error-code="attr-defined"
"""治理操作——审批 + invoke_capability。

从 ``kernel_governance.GovernanceMixin`` 抽出，让 God Object 的 LOC
预算可以收缩。函数接收 Kernel 类对象。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

DEFAULT_APPROVAL_TTL_SECONDS = 86_400  # 24 小时



def request_approval(
    kernel,
    action: str,
    risk: str = "low",
    ctx: dict[str, Any] | None = None,
    actor: str = "system",
    correlation_id: str | None = None,
    expires_in_seconds: int = DEFAULT_APPROVAL_TTL_SECONDS,
) -> dict:
    """请求一次能力调用的审批。

    风险策略：
      - "low"  → 自动放行，立即发出 ApprovalGranted
      - "high" → 需要用户确认，发出 ApprovalRequested 并返回 pending
    """
    approval_id = f"apr_{uuid.uuid4().hex}"
    expires_at = (datetime.now(UTC) + timedelta(seconds=expires_in_seconds)).isoformat()

    kernel.emit_event(
        type="ApprovalRequested",
        aggregate_type="approval",
        aggregate_id=approval_id,
        payload={
            "action": action,
            "risk": risk,
            "ctx": ctx or {},
            "expires_at": expires_at,
        },
        actor=actor,
        correlation_id=correlation_id,
    )

    if risk == "low":
        kernel.emit_event(
            type="ApprovalGranted",
            aggregate_type="approval",
            aggregate_id=approval_id,
            payload={"action": action, "reason": "auto_allow"},
            actor="kernel",
            correlation_id=correlation_id,
        )
        return {"status": "approved", "approval_id": approval_id}

    _notify_approval_changed(kernel,
        approval_id, status="pending", action=action, event_type="ApprovalRequested",
    )
    return {
        "status": "pending",
        "approval_id": approval_id,
        "reason": "needs_user_confirmation",
    }

def expire_stale_approvals(kernel) -> int:
    """过期所有 expires_at 已到的 pending 审批。

    纯 emit 路径：受治理的 ``approvals`` 表仅由 ApprovalDenied 投影器
    更新（``reason=auto_expired`` → status expired）。投影器用
    ``UPDATE ... WHERE status='pending'`` 做幂等收敛。单进程 RuntimeLoop
    下重复 emit 是安全的。
    """
    now_iso = datetime.now(UTC).isoformat()

    with kernel._db.get_db() as conn:
        rows = conn.execute(
            "SELECT id, action FROM approvals "
            "WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?",
            (now_iso,),
        ).fetchall()

    expired_ids = [(row["id"], row["action"] or "") for row in rows]

    if expired_ids:
        from app.core.runtime.plan_resume import take_plan_resume

        for approval_id, action in expired_ids:
            take_plan_resume(approval_id, kernel=kernel)
            kernel.emit_event(
                type="ApprovalDenied",
                aggregate_type="approval",
                aggregate_id=approval_id,
                payload={"action": action, "reason": "auto_expired"},
                actor="kernel",
            )
            _notify_approval_changed(kernel,
                approval_id, status="expired", action=action, event_type="ApprovalDenied",
            )
    return len(expired_ids)

def grant_approval(
    kernel,
    approval_id: str,
    action: str = "",
    actor: str = "user",
    reason: str = "",
    correlation_id: str | None = None,
) -> None:
    """在受治理的审批投影上记录一次批准。"""
    kernel.emit_event(
        type="ApprovalGranted",
        aggregate_type="approval",
        aggregate_id=approval_id,
        payload={"action": action, "reason": reason},
        actor=actor,
        correlation_id=correlation_id,
    )
    _notify_approval_changed(kernel,
        approval_id, status="approved", action=action, event_type="ApprovalGranted",
    )

def deny_approval(
    kernel,
    approval_id: str,
    action: str = "",
    actor: str = "user",
    reason: str = "",
    correlation_id: str | None = None,
) -> None:
    """在受治理的审批投影上记录一次拒绝。"""
    kernel.emit_event(
        type="ApprovalDenied",
        aggregate_type="approval",
        aggregate_id=approval_id,
        payload={"action": action, "reason": reason},
        actor=actor,
        correlation_id=correlation_id,
    )
    _notify_approval_changed(kernel,
        approval_id, status="denied", action=action, event_type="ApprovalDenied",
    )

def _notify_approval_changed(
    kernel,
    approval_id: str,
    *,
    status: str,
    action: str,
    event_type: str,
) -> None:
    """推送轻量 WS 提示，让 Approvals / Trust 缓存刷新。"""
    from app.core.runtime.notification_bridge import broadcast_event

    broadcast_event({
        "type": "approval_changed",
        "event_type": event_type,
        "approval_id": approval_id,
        "status": status,
        "action": action,
    })

def _handler_execution_exists(kernel, execution_id: str) -> bool:
    with kernel._db.get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM handler_executions WHERE id = ? LIMIT 1",
            (execution_id,),
        ).fetchone()
    return row is not None


_SUMMARY_CAP = 200


def _cap_summary(value: Any, limit: int = _SUMMARY_CAP) -> str:
    return str(value)[:limit]


def _emit_capability_denied(
    kernel,
    *,
    name: str,
    reason: str,
    actor: str,
    correlation_id: str | None = None,
    caused_by: str | None = None,
    extra_payload: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {"name": name, "reason": reason}
    if extra_payload:
        payload.update(extra_payload)
    kwargs: dict[str, Any] = {
        "type": "CapabilityDenied",
        "aggregate_type": "capability",
        "aggregate_id": f"cap_{name}",
        "payload": payload,
        "actor": actor,
        "correlation_id": correlation_id,
    }
    if caused_by is not None:
        kwargs["caused_by"] = caused_by
    kernel.emit_event(**kwargs)


async def invoke_capability(
    kernel,
    name: str,
    args: dict[str, Any] | None = None,
    actor: str = "system",
    correlation_id: str | None = None,
    caused_by: str | None = None,
    pre_approved: bool = False,
    approval_id: str | None = None,
    principal: Any | None = None,
    execution_id: str | None = None,
) -> dict:
    """经 Kernel 调用能力，带审批门控。

    Execution 契约 §9：授权委托给 CapabilityGateway，其用类型化
    Principal（§8）做基于身份的判断。

    提供 execution_id 时，本次调用通过 caused_by 归属到所属 Execution 聚合。
    """
    args = args or {}
    from app.core.harness.mcp_hub import mcp_hub
    from app.core.runtime.capability_governance import capability_governance
    from app.core.runtime.execution import (
        actor_requires_execution_ownership,
        get_current_execution_id,
        identity_resolver,
    )
    from app.core.runtime.plan_resume import (
        clear_capability_intent,
        record_capability_intent,
    )
    from app.core.runtime.taint import is_write_class_tool

    tool = mcp_hub.get_tool(name)
    if tool is None:
        kernel.emit_event(
            type="CapabilityFailed",
            aggregate_type="capability",
            aggregate_id=f"cap_{name}",
            payload={
                "name": name,
                "error": f"Unknown capability: {name}",
                "outcome": "tool_not_found",
                "latency_ms": 0,
            },
            actor=principal.actor if principal is not None else actor,
            caused_by=caused_by,
            correlation_id=correlation_id,
        )
        return {
            "status": "error",
            "error": f"Unknown capability: {name}",
            "outcome": "tool_not_found",
        }

    if principal is None:
        principal = identity_resolver.resolve(actor, kernel)

    resolved_execution_id = execution_id or get_current_execution_id()
    if resolved_execution_id == "":
        resolved_execution_id = None

    if actor_requires_execution_ownership(actor) and not resolved_execution_id:
        _emit_capability_denied(
            kernel,
            name=name,
            reason="missing_execution_id",
            actor=principal.actor,
            correlation_id=correlation_id,
        )
        return {
            "status": "error",
            "error": "missing_execution_id",
            "outcome": "authorization_failure",
        }

    if resolved_execution_id:
        if not _handler_execution_exists(kernel, resolved_execution_id):
            _emit_capability_denied(
                kernel,
                name=name,
                reason="invalid_execution_id",
                actor=principal.actor,
                correlation_id=correlation_id,
            )
            return {
                "status": "error",
                "error": "invalid_execution_id",
                "outcome": "authorization_failure",
            }

    capability_caused_by = resolved_execution_id or caused_by

    decision = capability_governance.decide(
        principal,
        name,
        args,
        kernel,
        correlation_id=correlation_id,
        pre_approved=pre_approved,
        approval_id=approval_id,
        execution_id=resolved_execution_id,
        invoking_actor=actor,
    )

    if decision.decision == "deny":
        _emit_capability_denied(
            kernel,
            name=name,
            reason=decision.reason,
            actor=principal.actor,
            correlation_id=correlation_id,
        )
        return {
            "status": "error",
            "error": decision.reason,
            "outcome": "authorization_failure",
        }

    if decision.decision == "defer":
        _emit_capability_denied(
            kernel,
            name=name,
            reason="deferred",
            actor=principal.actor,
            correlation_id=correlation_id,
            caused_by=capability_caused_by,
            extra_payload={
                "args_summary": _cap_summary(args),
                "deny_reason": decision.reason,
                "approval_id": decision.approval_id,
            },
        )
        return {
            "status": "pending",
            "approval_id": decision.approval_id,
            "outcome": "approval_required",
        }

    # 双写窗口收窄（P0）：write-class 工具在外部副作用发生前先持久化调用
    # 意图（APP_STORAGE ``plan_resumes``，键 ``cap_intent:{id}``），审计事件
    # 落库后清除。进程在「副作用 → 审计事件」窗口内死亡时，遗留意图由
    # RuntimeLoop 启动清扫补发 CapabilityFailed(error=interrupted_before_audit)，
    # 保证每次可能已发生的副作用在 event_log 中留有记录（INV-C4 崩溃语义）。
    intent_id: str | None = None
    if is_write_class_tool(name):
        import uuid as _uuid

        intent_id = _uuid.uuid4().hex
        record_capability_intent(
            intent_id,
            name=name,
            args_summary=_cap_summary(args),
            actor=principal.actor,
            correlation_id=correlation_id,
            kernel=kernel,
        )

    import time as _time
    _t0 = _time.perf_counter()
    try:
        result_str = await mcp_hub.invoke_tool(name, args)
        _latency_ms = (_time.perf_counter() - _t0) * 1000

        kernel.emit_event(
            type="CapabilityInvoked",
            aggregate_type="capability",
            aggregate_id=f"cap_{name}",
            payload={
                "name": name,
                "args_summary": _cap_summary(args),
                "result_summary": _cap_summary(result_str),
                "latency_ms": round(_latency_ms, 2),
            },
            actor=principal.actor,
            caused_by=capability_caused_by,
            correlation_id=correlation_id,
        )
        if intent_id:
            clear_capability_intent(intent_id, kernel=kernel)
        if correlation_id:
            from app.core.runtime.taint import is_external_ingestion_tool, taint_registry

            if is_external_ingestion_tool(name):
                taint_registry.mark(
                    correlation_id,
                    source="external_ingestion",
                    reason=name,
                )
        return {"status": "success", "result": result_str, "outcome": "success"}
    except Exception as exc:
        _latency_ms = (_time.perf_counter() - _t0) * 1000
        outcome = getattr(exc, "reason", None) or "internal_error"
        kernel.emit_event(
            type="CapabilityFailed",
            aggregate_type="capability",
            aggregate_id=f"cap_{name}",
            payload={
                "name": name,
                "error": str(exc),
                "outcome": outcome,
                "latency_ms": round(_latency_ms, 2),
            },
            actor=principal.actor,
            caused_by=capability_caused_by,
            correlation_id=correlation_id,
        )
        if intent_id:
            clear_capability_intent(intent_id, kernel=kernel)
        return {"status": "error", "error": str(exc), "outcome": outcome}
