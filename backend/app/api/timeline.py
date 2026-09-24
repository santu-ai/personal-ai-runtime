"""Timeline API — human-readable event log browsing."""

from fastapi import APIRouter, Query

from app.core.runtime.kernel_instance import kernel

router = APIRouter(tags=["timeline"])

# Event type → human-readable label mapping
# Keys must match Kernel event type constants (see kernel/constants.py).
EVENT_LABELS: dict[str, str] = {
    "WorkItemCreated": "创建了目标",
    "WorkItemUpdated": "更新了目标",
    "WorkItemStatusChanged": "完成了目标",
    "WorkItemDeleted": "删除了目标",
    "MemoryDerived": "AI 记住了新信息",
    "MemoryUpdated": "AI 更新了记忆",
    "MemoryDeleted": "移除了记忆",
    "ConversationCreated": "发起了新对话",
    "ConversationRecorded": "记录了对话回合",
    "MessageAppended": "发送了消息",
    "ChatRequested": "发起了 AI 对话",
    "ChatTextDelta": "AI 正在回复",
    "ChatDone": "AI 回复完成",
    "CapabilityInvoked": "调用了工具",
    "ApprovalRequested": "请求了操作确认",
    "ApprovalGranted": "操作已批准",
    "ApprovalDenied": "操作已拒绝",
    "InboxEmailRecorded": "收到了新邮件",
    "TimerFired": "定时任务触发",
    "NotificationCreated": "AI 给出了提醒",
}

# These events store the work item id on aggregate_id. Their payload usually
# has title/status, not work_id. Other aggregate types are not work ids.
_WORK_ITEM_EVENT_TYPES = frozenset({
    "WorkItemCreated",
    "WorkItemUpdated",
    "WorkItemStatusChanged",
    "WorkItemDeleted",
})
_APPROVAL_EVENT_TYPES = frozenset({
    "ApprovalRequested",
    "ApprovalGranted",
    "ApprovalDenied",
})


def _string_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _explicit_work_id(mapping: dict) -> tuple[bool, str | None]:
    """Top-level work_id, else task_id. A present unusable key does not fall through."""
    if "work_id" in mapping:
        return True, _string_id(mapping.get("work_id"))
    if "task_id" in mapping:
        return True, _string_id(mapping.get("task_id"))
    return False, None


def _timeline_work_id(event) -> str | None:
    """Work id already stored on the event.

    ``correlation_id``, ``parent_work_id``, ``action_id``, timer ids, and
    approval ids are not work ids. A present ``work_id`` that is blank or
    not a string does not fall through to another key.
    """
    payload = event.payload if isinstance(getattr(event, "payload", None), dict) else {}
    found, work_id = _explicit_work_id(payload)
    if found:
        return work_id

    event_type = getattr(event, "type", None)
    if event_type in _APPROVAL_EVENT_TYPES:
        ctx = payload.get("ctx")
        if isinstance(ctx, dict) and "task_id" in ctx:
            return _string_id(ctx.get("task_id"))
        return None

    if event_type in _WORK_ITEM_EVENT_TYPES:
        return _string_id(getattr(event, "aggregate_id", None))

    if event_type == "TimerFired":
        inner = payload.get("payload")
        if isinstance(inner, dict):
            inner_found, inner_id = _explicit_work_id(inner)
            if inner_found:
                return inner_id
    return None


def _translate_event(event) -> dict:
    """Translate an Event object into a human-readable timeline item."""
    event_type = event.type
    label = EVENT_LABELS.get(event_type, f"系统事件: {event_type}")
    payload = event.payload or {}
    actor = event.actor

    description = label
    if event_type == "WorkItemCreated":
        description = f'{label}「{payload.get("title", "")}」'
    elif event_type == "WorkItemStatusChanged":
        description = f'{label}「{payload.get("title", "")}」'
    elif event_type == "MemoryDerived":
        content = payload.get("content", "")
        snippet = content[:60] + "…" if len(content) > 60 else content
        description = f"{label}: {snippet}"
    elif event_type == "CapabilityInvoked":
        description = f'{label}「{payload.get("capability_name", event_type)}」'
    elif event_type == "ApprovalRequested":
        description = f'{label}: {payload.get("capability_name", "")}'
    elif event_type == "InboxEmailRecorded":
        description = f'{label}: {payload.get("subject", "")}'
    elif event_type == "NotificationCreated":
        description = f'{label}: {payload.get("title", "")}'
    elif event_type == "ConversationRecorded":
        msg = str(payload.get("user_message", ""))[:60]
        description = f"{label}: {msg}"

    return {
        "id": event.id,
        "seq": event.seq,
        "type": event_type,
        "description": description,
        "actor": actor,
        "ts": event.ts,
        "work_id": _timeline_work_id(event),
        "payload_snippet": {
            k: str(v)[:100] for k, v in (payload or {}).items()
            if k not in ("full_text", "raw_body", "params")
        },
    }


EVENT_ICONS: dict[str, str] = {
    "WorkItemCreated": "target",
    "WorkItemUpdated": "target",
    "WorkItemStatusChanged": "check-circle",
    "WorkItemDeleted": "target",
    "MemoryDerived": "brain",
    "MemoryUpdated": "brain",
    "ConversationCreated": "message-square",
    "ConversationRecorded": "message-square",
    "MessageAppended": "message-square",
    "ChatRequested": "message-square",
    "ChatDone": "message-square",
    "CapabilityInvoked": "zap",
    "ApprovalRequested": "shield",
    "ApprovalGranted": "shield-check",
    "ApprovalDenied": "shield",
    "InboxEmailRecorded": "mail",
    "TimerFired": "clock",
    "NotificationCreated": "bell",
}


@router.get("/events")
async def list_timeline_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    event_type: str | None = Query(None, description="Filter by event type"),
    date_from: str | None = Query(None, description="ISO date string, e.g. 2026-01-01"),
    date_to: str | None = Query(None, description="ISO date string, e.g. 2026-06-30"),
):
    """Return paginated, human-readable timeline events.

    **@public** SDK surface (read-only) — external agents may browse recent activity.

    Events are ordered by seq descending (newest first). Pagination is done
    in SQL (offset/limit) so results remain correct past the old 500-row cap.
    """
    since_ts = f"{date_from}T00:00:00+00:00" if date_from else None
    until_ts = f"{date_to}T23:59:59+00:00" if date_to else None
    offset = (page - 1) * page_size

    # Fetch one extra row to compute has_more without a separate COUNT.
    events = kernel.read_events(
        type=event_type,
        since_ts=since_ts,
        until_ts=until_ts,
        limit=page_size + 1,
        offset=offset,
        order="desc",
    )
    has_more = len(events) > page_size
    page_events = events[:page_size]

    items = [_translate_event(e) for e in page_events]
    if event_type:
        for item in items:
            item["icon"] = EVENT_ICONS.get(event_type, "activity")

    # Approximate total for UI: known prefix + whether more exists.
    total = offset + len(page_events) + (1 if has_more else 0)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": has_more,
        "icons": EVENT_ICONS,
    }
