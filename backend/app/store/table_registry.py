"""受治理投影表 vs 应用存储表的显式注册表。

SQLite 中的每张业务表必须**正好**落入以下两个集合之一。
新增表必须在此分类，否则 schema contract 测试会失败。
"""

from __future__ import annotations

# 受治理投影表的预期列（PRAGMA contract）。
GOVERNED_SCHEMA: dict[str, frozenset[str]] = {
    "work_items": frozenset({
        "id", "title", "description", "work_type", "parent_work_id",
        "status", "priority", "dependencies_json",
        "executable_plan", "created_at", "updated_at", "completed_at",
        # Goal 列（work_type='goal' 的行才会填充）：
        "progress", "importance", "urgency", "deadline", "last_activity_at",
    }),
    "memories": frozenset({
        "id", "category", "content", "source", "embedding_id", "created_at",
        "confidence", "derived_from_event", "decayed_at", "status", "origin",
        "claim_status", "source_document_id", "source_document_name",
    }),
    "approvals": frozenset({
        "id", "task_id", "action", "params", "proposed_by", "status",
        "created_at", "expires_at", "resolved_at", "resolved_by",
    }),
    "conversations": frozenset({
        "id", "title", "summary", "created_at", "updated_at",
    }),
    "messages": frozenset({
        "id", "conversation_id", "role", "content", "tool_calls", "tool_call_id",
        "created_at", "source_event_id", "sources",
    }),
    "notifications": frozenset({
        "id", "type", "title", "content", "read",
        "related_id", "related_type", "notification_type", "dedup_key", "created_at",
    }),
    "event_log": frozenset({
        "seq", "id", "type", "aggregate_type", "aggregate_id", "actor", "payload",
        "caused_by", "correlation_id", "ts",
    }),
    "projection_checkpoints": frozenset({
        "agent_id", "aggregate_type", "last_applied_seq", "snapshot_json", "created_at",
    }),
    "handler_executions": frozenset({
        "id", "event_seq", "event_id", "event_type", "handler_name",
        "instance_id", "status", "retry_count", "policy_json",
        "correlation_id", "created_at", "started_at", "completed_at", "error",
        "dead_letter",
    }),
    "timer_events": frozenset({
        "id", "handler_name", "schedule_type", "cron_expr", "delay_seconds",
        "fire_at", "status", "payload_json", "created_at", "fired_at",
    }),
    "policy_events": frozenset({
        "id", "capability", "risk_level", "status", "created_at", "updated_at",
    }),
    # 仅由 InboxEmail* 事件经 projectors_inbox.py 派生而来，
    # 因此该表完全可从 event_log 重建。
    "inbox_emails": frozenset({
        "id", "server_id", "sender", "subject", "date", "preview",
        "full_text", "status", "category", "importance", "reason",
        "notified", "digested", "created_at", "received_at",
    }),
    # 仅由 Capability* 事件经 projectors_governance.py 派生而来。
    # 每行 1:1 对应 event_log 中的一条 CapabilityInvoked / CapabilityFailed /
    # CapabilityDenied 事件。
    "tool_calls": frozenset({
        "id", "tool_name", "success", "latency_ms", "error_message", "created_at",
    }),
    # 仅由 LLMCallRecorded 事件经 projectors_governance.py 派生而来。
    "llm_calls": frozenset({
        "id", "provider", "model", "prompt_tokens", "completion_tokens",
        "latency_ms", "cost", "success", "error_message", "purpose", "created_at",
    }),
    # 仅由 UserProfileUpdated 事件经 projectors_core.py 派生而来。
    "user_profile": frozenset({
        "id", "category", "data_json", "confidence", "created_at", "updated_at",
    }),
}

# 应用存储表的预期列。
#
# 为何这些表**不**走事件溯源：
# Truth Layer（event_log + GOVERNED_TABLES）走事件溯源是因为它们承载
# 个人事实，丢失会破坏数据主权。下面的表是运维/观测性的：
#   (a) 可从权威来源重建；
#   (b) 是纯缓存；
#   (c) 仅持有无审计要求的应用本地配置。
# 它们永远不能作为第二可信源呈现给上层。
APP_STORAGE_SCHEMA: dict[str, frozenset[str]] = {
    # 人类可读的活动日志；从 event_log 投影得到。
    "activity_log": frozenset({
        "id", "type", "payload", "timestamp",
    }),
    # 应用配置（UI 偏好、LLM/Email 连接配置）。仅本地运维配置，
    # 不是受治理事实。
    "app_settings": frozenset({
        "category", "data_json", "updated_at",
    }),
    # ChromaDB 索引修复的待处理队列：某些 memory 事件的 embedding 同步失败。
    # 权威记录是 event_log 中的 MemoryDerived/Updated 事件；
    # 本队列跟踪未完成的对账工作，由 RuntimeLoop._maintenance 通过
    # memory index repair worker 消费。
    "memory_index_repairs": frozenset({
        "id", "aggregate_id", "event_type", "event_seq", "error",
        "retry_count", "status", "created_at", "last_retry_at",
    }),
    # 计划步骤因 approval 暂停后的运维续跑坐标。Approval 行本身仍是治理权威；
    # 本表只用于跨进程重启保留续跑坐标（见 plan_resume.py）。
    "plan_resumes": frozenset({
        "approval_id", "kind", "resume_from", "previous_output_json",
        "action_id", "task_id", "plan_json", "created_at",
    }),
}

# Kernel 拥有的投影（事件溯源读模型 + 事件日志）。
GOVERNED_TABLES: frozenset[str] = frozenset(GOVERNED_SCHEMA.keys())

# 应用存储（允许在 Kernel ABI 之外直接读写）。
APP_STORAGE_TABLES: frozenset[str] = frozenset(APP_STORAGE_SCHEMA.keys())

ALL_CLASSIFIED_TABLES = GOVERNED_TABLES | APP_STORAGE_TABLES

# ── 非主权附件 ────────────────────────────────────────────────────────────
# 显式注册的、**不能**从 event_log 重建的存储。
# 当前为空 —— Knowledge Base（Path B attachment）已移除。若未来加入无法从
# event_log 重建的存储，请显式在此注册，而不是默默让它成为第二 Truth Layer。
NON_SOVEREIGN_ATTACHMENTS: dict[str, dict[str, str]] = {}

# 设计哲学 / Truth Layer 例外（必须保持显式 —— Fitness registry）。
# 每条都是对「万物皆为 Event/State」的一次刻意豁免。
PHILOSOPHY_EXCEPTIONS: dict[str, dict[str, str]] = {
    "transport_chat_delta": {
        "rule": "ChatTextDelta / SSE / WS are TRANSPORT — not event_log",
        "evidence": "constants.EVENT_CHAT_TEXT_DELTA",
    },
    "memory_vector_index": {
        "rule": "Chroma memory index is eventually consistent derived State",
        "evidence": "kernel.emit_event post-commit sync + memory_index_repairs",
    },
    "app_storage": {
        "rule": "APP_STORAGE is operational — not governed Truth",
        "evidence": "APP_STORAGE_SCHEMA",
    },
    "single_process_control_plane": {
        "rule": "No distributed lease / multi-worker (Non-goal)",
        "evidence": "INV-W6; ADR-R009",
    },
    "handler_executions_soft_prune": {
        "rule": "Terminal handler_executions may be DELETE'd without Event (INV-S1a)",
        "evidence": "sovereignty_ops.prune_handler_executions; ADR-R014",
    },
}


def is_non_sovereign_attachment(attachment_id: str) -> bool:
    return attachment_id in NON_SOVEREIGN_ATTACHMENTS


# 不变量校验。
if __debug__:
    assert GOVERNED_TABLES.isdisjoint(APP_STORAGE_TABLES), (
        f"Overlap between GOVERNED and APP_STORAGE: {GOVERNED_TABLES & APP_STORAGE_TABLES}"
    )
