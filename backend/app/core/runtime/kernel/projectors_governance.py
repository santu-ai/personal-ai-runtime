"""治理投影器——Policy 聚合的事件溯源投影。

policy_events 是 Policy 聚合事件流的投影，可完全从事件日志重建。
"""

from __future__ import annotations

import logging

from .constants import AGGREGATE_POLICY
from .event import Event
from .projectors_registry import _OWNED_TABLES, projector

logger = logging.getLogger(__name__)

_OWNED_TABLES[AGGREGATE_POLICY] = ["policy_events"]


def _invalidate_risk_cache() -> None:
    """Policy 表变化——丢弃 CapabilityGovernance 风险缓存。"""
    try:
        from app.core.runtime.capability_governance import capability_governance

        capability_governance.invalidate_risk_cache()
    except Exception:
        logger.debug("Could not invalidate risk cache", exc_info=True)


# ── Policy 投影器 ───────────────────────────────────────────────────

@projector("PolicyCreated")
def _on_policy_created(event: Event, conn) -> None:
    p = event.payload
    conn.execute(
        """INSERT OR REPLACE INTO policy_events
           (id, capability, risk_level, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)""",
        (
            event.aggregate_id,
            p.get("capability", ""),
            p.get("risk_level", "low"),
            event.ts,
            event.ts,
        ),
    )
    _invalidate_risk_cache()


@projector("PolicyUpdated")
def _on_policy_updated(event: Event, conn) -> None:
    p = event.payload
    status = p.get("status")
    if status == "revoked":
        conn.execute(
            "UPDATE policy_events SET status = 'revoked', updated_at = ? WHERE id = ?",
            (event.ts, event.aggregate_id),
        )
        _invalidate_risk_cache()
        return
    if status == "active":
        # 有意撤销后的重新激活（INV-C6）：恢复 active 状态与风险等级。
        risk = p.get("risk_level", "low")
        conn.execute(
            "UPDATE policy_events SET status = 'active', risk_level = ?, "
            "updated_at = ? WHERE id = ?",
            (risk, event.ts, event.aggregate_id),
        )
        _invalidate_risk_cache()
        return
    conn.execute(
        "UPDATE policy_events SET risk_level = ?, updated_at = ? WHERE id = ?",
        (p.get("risk_level", "low"), event.ts, event.aggregate_id),
    )
    _invalidate_risk_cache()


# --- 遥测投影（折叠在此以保持 runtime_files 零和）---

_OWNED_TABLES["capability"] = ["tool_calls"]
_OWNED_TABLES["llm_call"] = ["llm_calls"]


# ── tool_calls ────────────────────────────────────────────────────────────

@projector("CapabilityInvoked")
def _on_capability_invoked(event: Event, conn) -> None:
    p = event.payload
    conn.execute(
        """INSERT OR REPLACE INTO tool_calls
           (id, tool_name, success, latency_ms, error_message, created_at)
           VALUES (?, ?, 1, ?, NULL, ?)""",
        (
            f"tc_{event.seq}",
            p.get("name", ""),
            p.get("latency_ms", 0),
            event.ts,
        ),
    )


@projector("CapabilityFailed")
def _on_capability_failed(event: Event, conn) -> None:
    p = event.payload
    conn.execute(
        """INSERT OR REPLACE INTO tool_calls
           (id, tool_name, success, latency_ms, error_message, created_at)
           VALUES (?, ?, 0, ?, ?, ?)""",
        (
            f"tc_{event.seq}",
            p.get("name", ""),
            p.get("latency_ms", 0),
            p.get("error", ""),
            event.ts,
        ),
    )


@projector("CapabilityDenied")
def _on_capability_denied(event: Event, conn) -> None:
    """被拒绝的调用也是 tool call（在调用前就被拦下）。"""
    p = event.payload
    conn.execute(
        """INSERT OR REPLACE INTO tool_calls
           (id, tool_name, success, latency_ms, error_message, created_at)
           VALUES (?, ?, 0, 0, ?, ?)""",
        (
            f"tc_{event.seq}",
            p.get("name", ""),
            f"denied: {p.get('reason', '')}",
            event.ts,
        ),
    )


# ── llm_calls ─────────────────────────────────────────────────────────────

@projector("LLMCallRecorded")
def _on_llm_call_recorded(event: Event, conn) -> None:
    p = event.payload
    conn.execute(
        """INSERT OR REPLACE INTO llm_calls
           (id, provider, model, prompt_tokens, completion_tokens,
            latency_ms, cost, success, error_message, purpose, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            f"llm_{event.seq}",
            p.get("provider", ""),
            p.get("model", ""),
            p.get("prompt_tokens", 0),
            p.get("completion_tokens", 0),
            p.get("latency_ms", 0),
            p.get("cost", 0),
            1 if p.get("success", True) else 0,
            p.get("error_message"),
            p.get("purpose") or "chat",
            event.ts,
        ),
    )
