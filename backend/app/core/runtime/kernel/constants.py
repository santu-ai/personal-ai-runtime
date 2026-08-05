"""Runtime Kernel 常量——事件类型、聚合类型与表名。

把这些字符串字面量集中，防止 Kernel、投影器、CI 检查与验证脚本之间漂移。
"""

# ── 事件类型 ─────────────────────────────────────────────────────────────

# ── WorkItem（task + action + goal 统一聚合，v1.0）─────────────────
EVENT_WORK_ITEM_CREATED = "WorkItemCreated"
EVENT_WORK_ITEM_UPDATED = "WorkItemUpdated"
EVENT_WORK_ITEM_DELETED = "WorkItemDeleted"
EVENT_WORK_ITEM_STATUS_CHANGED = "WorkItemStatusChanged"

EVENT_APPROVAL_REQUESTED = "ApprovalRequested"
EVENT_APPROVAL_GRANTED = "ApprovalGranted"
EVENT_APPROVAL_DENIED = "ApprovalDenied"  # 也覆盖自动过期（reason="auto_expired"）

EVENT_CAPABILITY_INVOKED = "CapabilityInvoked"
EVENT_CAPABILITY_FAILED = "CapabilityFailed"
EVENT_CAPABILITY_DENIED = "CapabilityDenied"  # 也覆盖 deferred（reason="deferred"）

EVENT_MEMORY_DERIVED = "MemoryDerived"
EVENT_MEMORY_UPDATED = "MemoryUpdated"
EVENT_MEMORY_DELETED = "MemoryDeleted"
EVENT_MEMORY_DECAYED = "MemoryDecayed"

EVENT_CLAIM_RATIFIED = "ClaimRatified"
EVENT_CLAIM_REJECTED = "ClaimRejected"
EVENT_CLAIM_CONTESTED = "ClaimContested"
# ChromaDB 索引修复耗尽重试预算时发出。记忆本身在 event_log + memories
# 投影中仍是权威；只是派生的向量索引缺失，因此召回时将其静默排除。
EVENT_MEMORY_INDEX_REPAIR_FAILED = "MemoryIndexRepairFailed"

EVENT_CONVERSATION_CREATED = "ConversationCreated"
EVENT_CONVERSATION_UPDATED = "ConversationUpdated"
EVENT_CONVERSATION_DELETED = "ConversationDeleted"
EVENT_MESSAGE_APPENDED = "MessageAppended"

EVENT_NOTIFICATION_CREATED = "NotificationCreated"
EVENT_NOTIFICATION_UPDATED = "NotificationUpdated"
EVENT_NOTIFICATION_READ = "NotificationRead"  # aggregate_id="all" 表示批量已读

# ── Chat（ADR 统一）──────────────────────────────────────────────────────

EVENT_CHAT_REQUESTED = "ChatRequested"
EVENT_CHAT_COMPLETED = "ChatCompleted"

EVENT_APPROVE_REQUESTED = "ApproveRequested"
EVENT_APPROVE_COMPLETED = "ApproveCompleted"

EVENT_EXECUTE_REQUESTED = "ExecuteRequested"
EVENT_EXECUTE_COMPLETED = "ExecuteCompleted"

EVENT_INBOX_POLL_REQUESTED = "InboxPollRequested"
EVENT_INBOX_POLL_COMPLETED = "InboxPollCompleted"
EVENT_INBOX_EMAIL_RECORDED = "InboxEmailRecorded"
# inbox_emails 是仅由事件派生的受治理投影。Status / notified / digested
# 转换全部事件溯源，使 verify_inbox_audit 能保证该表可完全从 event_log 重建。
EVENT_INBOX_EMAIL_STATUS_CHANGED = "InboxEmailStatusChanged"
# InboxEmailFlagSet 同时覆盖 notified 与 digested（payload.flag 区分）。
EVENT_INBOX_EMAIL_FLAG_SET = "InboxEmailFlagSet"

# 刻意不写入 event_log——只推 SSE 队列，避免污染真相层。
EVENT_CHAT_TEXT_DELTA = "ChatTextDelta"
EVENT_CHAT_DONE = "ChatDone"

# ── 应用审计 ───────────────────────────────────────────────────────

EVENT_APP_CONFIG_CHANGED = "AppConfigChanged"
# 遥测 LLM 调用是事件溯源的：brain_telemetry 发此事件而非直接 INSERT
# llm_calls APP_STORAGE 表；投影器（projectors_governance.py）派生表行。
EVENT_LLM_CALL_RECORDED = "LLMCallRecorded"

# ── Execution 聚合 ────────────────────────────────────────────────────

EVENT_EXECUTION_REQUESTED = "ExecutionRequested"
EVENT_EXECUTION_STARTED = "ExecutionStarted"
EVENT_EXECUTION_RETRIED = "ExecutionRetried"
EVENT_EXECUTION_COMPLETED = "ExecutionCompleted"
EVENT_EXECUTION_FAILED = "ExecutionFailed"

EVENT_USER_PROFILE_UPDATED = "UserProfileUpdated"

# ── 聚合类型 ─────────────────────────────────────────────────────────────

AGGREGATE_APPROVAL = "approval"
AGGREGATE_CAPABILITY = "capability"
AGGREGATE_MEMORY = "memory"
AGGREGATE_CONVERSATION = "conversation"
AGGREGATE_WORK_ITEM = "work_item"
AGGREGATE_NOTIFICATION = "notification"
AGGREGATE_EXECUTION = "execution"
AGGREGATE_TIMER = "timer"
AGGREGATE_POLICY = "policy"
AGGREGATE_INBOX_EMAIL = "inbox_email"

# ── Timer 聚合 ─────────────────────────────────────────────────────────

EVENT_TIMER_CREATED = "TimerCreated"
EVENT_TIMER_FIRED = "TimerFired"

# ── Policy 聚合（治理事件溯源）─────────────────────────────────────────────

EVENT_POLICY_CREATED = "PolicyCreated"
EVENT_POLICY_UPDATED = "PolicyUpdated"  # 也覆盖撤销（status="revoked"）

# ── 可快照的聚合 ─────────────────────────────────────────────────────────────

PROJECTION_SNAPSHOT_AGGREGATES = ("work_item", "memory", "conversation")

# ── 记忆索引事件类型 ────────────────────────────────────────────────────────

MEMORY_INDEX_EVENT_TYPES = frozenset({
    EVENT_MEMORY_DERIVED,
    EVENT_MEMORY_UPDATED,
    EVENT_MEMORY_DELETED,
})

# ── 事件 payload schema 版本（Architecture Contract）─────────────────────────
# 每次持久化发出都会从这个注册表压入 ``schema_version``。
# 当某事件类型的 payload *形状* 发生向后不兼容变化时，Bump 对应 override；
# 随后经 ``python -m scripts.check_event_schema --record`` 重新记录
# ``scripts/baselines/event_schema_versions.json``
# （仅在有意回滚时使用 ``--allow-downgrade``）。

PAYLOAD_SCHEMA_VERSION_KEY = "schema_version"
EVENT_SCHEMA_VERSION_DEFAULT = 1

# 类型字符串 → 版本。仍用默认值的条目可省略。
# WorkItem* 显式登记以启用 schema 版本机制（此前 OVERRIDES 为空、从未触发）。
EVENT_SCHEMA_VERSION_OVERRIDES: dict[str, int] = {
    EVENT_WORK_ITEM_CREATED: 1,
    EVENT_WORK_ITEM_UPDATED: 1,
    EVENT_WORK_ITEM_STATUS_CHANGED: 1,
}


def declared_event_types() -> frozenset[str]:
    """返回本模块声明的全部 ``EVENT_* = \"...\"`` 字符串值。"""
    return frozenset(
        v for k, v in globals().items()
        if k.startswith("EVENT_") and isinstance(v, str)
    )


def event_schema_version(event_type: str) -> int:
    """返回 ``event_type`` 当前 payload schema 版本。"""
    return int(
        EVENT_SCHEMA_VERSION_OVERRIDES.get(event_type, EVENT_SCHEMA_VERSION_DEFAULT)
    )


def stamp_event_payload(
    event_type: str,
    payload: dict[str, object] | None,
) -> dict[str, object]:
    """返回 ``payload`` 的副本，并从注册表写入 ``schema_version``。"""
    stamped = dict(payload or {})
    stamped[PAYLOAD_SCHEMA_VERSION_KEY] = event_schema_version(event_type)
    return stamped
