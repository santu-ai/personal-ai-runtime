"""Runtime Ports ABI——Fragment / API / Product 面向的端口面。

包路径保持 ``app.core.runtime.read_ports`` 不变以维持稳定；其角色比投影
读取更广。调用方经这些端口而不是直接开 DB 会话、导入 ORM 模型或触达深层
Runtime 模块（``work_item_engine``、``reaction_registry``、桥、调度器内部）。

    调用方 → Port → Kernel / Runtime 内部

按域拆分在本包下。包括：

- **读** —— 受治理投影查询（``query_*`` / ``count_*``）
- **命令** —— Work 变更、触发器注册（惰性包装）
- **桥** —— SSE 队列注册/注销、通知推送

经 ``from app.core.runtime.read_ports import …`` 或
``from app.core.runtime import read_ports`` 导入。
"""

from typing import Any

from app.core.runtime.notification_bridge import NotificationPayload
from app.core.runtime.read_ports.approvals import (
    approval_correlation_id,
    combine_adoption,
    load_approval_chat_checkpoint,
    query_approval,
    query_approvals,
    query_pending_approval_count,
    query_pending_approvals,
    summarize_suggestion_adoption,
)
from app.core.runtime.read_ports.calendar_mcp import (
    get_mcp_server_status,
    get_mcp_server_tools,
    query_calendar_today_events,
    query_calendar_upcoming,
    query_world_context,
    test_mcp_connection,
)
from app.core.runtime.read_ports.conversation import (
    get_conversation_sources,
    query_conversation,
    query_conversation_messages,
    query_conversations,
    query_message,
)
from app.core.runtime.read_ports.events import (
    compare_periods,
    conversation_chat_in_flight,
    goal_events,
    mark_external_taint,
    query_execution_trust_summary,
    query_recent_events,
    recent_events,
    reconstruct_execution_trace,
    to_event_dict,
)
from app.core.runtime.read_ports.inbox import (
    count_inbox_emails,
    count_pending_inbox_emails,
    query_inbox_email,
    query_inbox_emails,
    query_latest_inbox_poll,
    query_pending_inbox_emails,
    query_recent_inbox_emails,
    search_inbox_emails,
    summarize_inbox_sync_metrics,
)
from app.core.runtime.read_ports.memory import (
    attach_claim_reject_reasons,
    build_memory_graph_edges,
    collect_superseded_memory_ids,
    count_memories,
    query_memories,
    query_memory,
    query_supersedes_memory_id,
    recall_memories_for_context,
    retrieve_memory_context,
    retrieve_memory_with_sources,
    summarize_claim_conversion,
    summarize_memory_stats,
)
from app.core.runtime.read_ports.notifications import (
    broadcast_event,
    cancel_chat_execution,
    create_notification,
    find_notification,
    push_notification,
    query_notification,
    query_notifications,
    query_unread_notification_count,
    register_sse_queue,
    unregister_sse_queue,
)
from app.core.runtime.read_ports.profile import (
    query_user_profile,
    query_user_profile_category,
)
from app.core.runtime.read_ports.telemetry import (
    query_llm_calls,
    query_recent_tool_names,
    query_tool_calls,
    summarize_call_failure_rates,
    summarize_llm_calls,
    summarize_llm_calls_by_model,
    summarize_tool_calls,
)
from app.core.runtime.read_ports.timers import (
    count_active_policies,
    count_active_timers,
    count_state_selectors,
    list_trigger_reactions,
    query_active_policies,
    query_active_timers,
    query_due_timers,
    query_timer,
    register_trigger_reaction,
    unregister_trigger_reaction,
)
from app.core.runtime.read_ports.work import (
    bump_parent_activity,
    cancel_background_work_item,
    count_active_goals,
    count_completed_goals,
    count_goals,
    create_work_item,
    delete_work_item,
    ensure_work_item_execute_requested,
    get_sub_work_items,
    get_work_item_tree,
    list_work_items,
    notify_goal_action_completed,
    query_active_goals,
    query_background_work_item,
    query_background_work_items,
    query_completed_goals,
    query_goal,
    query_goal_actions,
    query_goals,
    query_goals_with_deadline,
    query_pending_work_items,
    query_stagnant_goal_count,
    query_stagnant_goals,
    query_top_active_goals,
    query_work_item,
    query_work_items,
    query_work_items_by_parent_goal,
    request_work_item_execute,
    reset_work_item_plan_progress,
    update_work_item_fields,
    update_work_item_status,
    work_item_execution_snapshot,
)

# WorkItemStatusChanged.payload.reason。不是新事件类型。
# rerun_restore：再次运行把已完成简报先收成 pending，没执行起来时收回 completed。
#   依赖钩子和周期对比都不把它当成新的完成。
# rework_restore：返工把 completed 或 failed 收成 pending，没执行起来时收回
#   打开前的那个状态。不能复用 rerun_restore：那会跳过依赖钩子，并被当成
#   「不是新的完成」的再次运行收回，终态也只会是 completed。
WORK_STATUS_REASON_RERUN_RESTORE = "rerun_restore"
WORK_STATUS_REASON_REWORK_RESTORE = "rework_restore"

__all__ = [
    "count_active_goals",
    "count_completed_goals",
    "count_goals",
    "count_memories",
    "summarize_memory_stats",
    "query_pending_work_items",
    "query_top_active_goals",
    "query_stagnant_goals",
    "query_stagnant_goal_count",
    "query_work_item",
    "query_work_items",
    "query_goals",
    "query_goal",
    "query_goal_actions",
    "query_work_items_by_parent_goal",
    "query_active_goals",
    "query_completed_goals",
    "query_goals_with_deadline",
    "create_work_item",
    "request_work_item_execute",
    "ensure_work_item_execute_requested",
    "reset_work_item_plan_progress",
    "work_item_execution_snapshot",
    "update_work_item_fields",
    "update_work_item_status",
    "WORK_STATUS_REASON_RERUN_RESTORE",
    "WORK_STATUS_REASON_REWORK_RESTORE",
    "rework_open_waiting_for_execute",
    "restore_half_open_rework",
    "delete_work_item",
    "get_sub_work_items",
    "get_work_item_tree",
    "list_work_items",
    "bump_parent_activity",
    "recall_memories_for_context",
    "retrieve_memory_context",
    "retrieve_memory_with_sources",
    "query_memory",
    "query_memories",
    "query_supersedes_memory_id",
    "collect_superseded_memory_ids",
    "attach_claim_reject_reasons",
    "summarize_claim_conversion",
    "notify_goal_action_completed",
    "query_conversation_messages",
    "query_conversation",
    "query_conversations",
    "query_message",
    "get_conversation_sources",
    "query_recent_inbox_emails",
    "search_inbox_emails",
    "query_pending_inbox_emails",
    "count_pending_inbox_emails",
    "count_inbox_emails",
    "query_inbox_email",
    "query_inbox_emails",
    "query_latest_inbox_poll",
    "summarize_inbox_sync_metrics",
    "query_pending_approval_count",
    "query_pending_approvals",
    "summarize_suggestion_adoption",
    "combine_adoption",
    "approval_correlation_id",
    "load_approval_chat_checkpoint",
    "query_approval",
    "query_approvals",
    "query_notification",
    "query_notifications",
    "query_unread_notification_count",
    "NotificationPayload",
    "create_notification",
    "find_notification",
    "push_notification",
    "broadcast_event",
    "register_sse_queue",
    "unregister_sse_queue",
    "cancel_chat_execution",
    "query_llm_calls",
    "query_tool_calls",
    "query_recent_tool_names",
    "summarize_llm_calls",
    "summarize_llm_calls_by_model",
    "summarize_tool_calls",
    "summarize_call_failure_rates",
    "query_world_context",
    "query_calendar_upcoming",
    "query_calendar_today_events",
    "get_mcp_server_status",
    "get_mcp_server_tools",
    "test_mcp_connection",
    "query_background_work_item",
    "query_background_work_items",
    "cancel_background_work_item",
    "query_active_timers",
    "count_active_timers",
    "query_timer",
    "query_due_timers",
    "query_active_policies",
    "count_active_policies",
    "register_trigger_reaction",
    "list_trigger_reactions",
    "unregister_trigger_reaction",
    "count_state_selectors",
    "query_user_profile_category",
    "query_user_profile",
    "to_event_dict",
    "goal_events",
    "recent_events",
    "query_recent_events",
    "reconstruct_execution_trace",
    "query_execution_trust_summary",
    "compare_periods",
    "conversation_chat_in_flight",
    "mark_external_taint",
    "build_memory_graph_edges",
]


_REWORK_PRIOR_STATUSES = frozenset({"completed", "failed"})


def _rework_status_events(k: Any, work_id: str) -> list:
    """Newest first. Only events that actually carry a work status."""
    events = k.read_events(
        aggregate_type="work_item",
        aggregate_id=work_id,
        types=["WorkItemCreated", "WorkItemStatusChanged", "WorkItemUpdated"],
        order="desc",
    )
    return [
        event
        for event in events
        if isinstance(getattr(event, "payload", None), dict)
        and "status" in event.payload
    ]


def _rework_open_and_prior(k: Any, work_id: str) -> tuple[Any, str | None]:
    """Pending rework open with no later ``ExecuteRequested``, plus prior status.

    The prior status is the event immediately before that open, and only when
    it is ``completed`` or ``failed``. Anything else is not this rework window.
    """
    events = _rework_status_events(k, work_id)
    if not events:
        return None, None
    latest = events[0]
    payload = latest.payload if isinstance(latest.payload, dict) else {}
    if payload.get("status") != "pending":
        return None, None
    if payload.get("reason") != WORK_STATUS_REASON_REWORK_RESTORE:
        return None, None
    pending_seq = int(getattr(latest, "seq", 0) or 0)
    requests = k.read_events(
        type="ExecuteRequested",
        aggregate_type="action",
        aggregate_id=f"exec_{work_id}",
        order="desc",
        limit=1,
    )
    if requests and int(getattr(requests[0], "seq", 0) or 0) > pending_seq:
        return None, None
    prior: str | None = None
    if len(events) > 1:
        status = str(events[1].payload.get("status") or "")
        if status in _REWORK_PRIOR_STATUSES:
            prior = status
    return latest, prior


def rework_open_waiting_for_execute(work_id: str) -> bool:
    """True when a rework reopen is still pending and execute never started."""
    from app.core.runtime.read_ports._common import kernel as get_kernel

    latest, _prior = _rework_open_and_prior(get_kernel(), work_id)
    return latest is not None


def restore_half_open_rework(
    work_id: str,
    *,
    actor: str = "user",
    require_stash: bool = False,
) -> str | None:
    """Put back the pre-rework status when this rework never dispatched.

    Restores ``rerun_stash:{work_id}`` when the clear committed and the live
    cursor is gone. Emits ``WorkItemStatusChanged`` with the status from before
    the pending open (``completed`` or ``failed``) and ``reason=rework_restore``.
    Returns that status, or None when this row is not a half-open rework.
    ``require_stash`` skips the undo unless the cursor stash is still present,
    so a retry can finish a dispatch whose clear never committed.
    """
    from app.core.runtime.plan_resume import (
        peek_plan_resume,
        rerun_stash_key,
        restore_rerun_plan_stash,
    )
    from app.core.runtime.read_ports._common import kernel as get_kernel
    from app.core.runtime.read_ports._common import logger as ports_logger

    k = get_kernel()
    _latest, prior = _rework_open_and_prior(k, work_id)
    if prior is None:
        return None
    if require_stash and peek_plan_resume(rerun_stash_key(work_id), kernel=k) is None:
        return None
    restore_rerun_plan_stash(work_id, kernel=k)
    k.emit_event(
        "WorkItemStatusChanged",
        "work_item",
        work_id,
        payload={"status": prior, "reason": WORK_STATUS_REASON_REWORK_RESTORE},
        actor=actor,
    )
    ports_logger.info(
        "restored %s work %s after rework execute did not start", prior, work_id,
    )
    return prior
