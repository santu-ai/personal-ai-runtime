"""Integration tests for Timeline API — deep paths beyond api smoke."""

from fastapi.testclient import TestClient

from app.core.runtime.kernel_instance import kernel


def test_timeline_events_filter_goal_alias(client: TestClient):
    """Legacy GoalCreated filter maps to WorkItemCreated timeline rows."""
    r = client.get("/api/timeline/events?event_type=GoalCreated")
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    for item in data["items"]:
        assert item["type"] == "WorkItemCreated"


def test_timeline_pagination_beyond_500(client: TestClient):
    """SQL offset pagination must remain correct past the old 500-row hard cap."""
    probe_type = "TimelinePaginationProbe"
    for i in range(520):
        kernel.emit_event(
            probe_type,
            "probe",
            f"tl_page_{i}",
            payload={"i": i},
        )

    total_count = len(kernel.read_events(type=probe_type, limit=2000))
    assert total_count == 520

    page_size = 30
    deep_page = (500 // page_size) + 2  # page 18 → offset 510
    sql_offset = (deep_page - 1) * page_size
    assert sql_offset > 500

    direct = kernel.read_events(
        type=probe_type,
        limit=page_size,
        offset=sql_offset,
        order="desc",
    )
    assert len(direct) == 520 - sql_offset  # 10

    r = client.get(
        f"/api/timeline/events?page={deep_page}&page_size={page_size}"
        f"&event_type={probe_type}"
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data["items"]) == 10
    assert data["has_more"] is False
    assert [item["id"] for item in data["items"]] == [e.id for e in direct]

    r1 = client.get(
        f"/api/timeline/events?page=1&page_size={page_size}&event_type={probe_type}"
    )
    assert r1.json()["has_more"] is True
    assert len(r1.json()["items"]) == page_size
    assert r1.json()["items"][0]["id"] != data["items"][0]["id"]


def _work_id_for(client: TestClient, event_type: str, event_id: str):
    r = client.get(f"/api/timeline/events?event_type={event_type}&page_size=20")
    assert r.status_code == 200
    matches = [item for item in r.json()["items"] if item["id"] == event_id]
    assert len(matches) == 1
    return matches[0]["work_id"]


def test_timeline_work_item_id_ignores_correlation_and_parent(client: TestClient):
    """WorkItem* rows use aggregate_id. parent_work_id and correlation_id are not links."""
    event = kernel.emit_event(
        "WorkItemCreated",
        "work_item",
        "task/1",
        payload={"title": "周报", "parent_work_id": "goal-parent", "work_type": "task"},
        correlation_id="corr-not-a-task",
    )
    assert _work_id_for(client, "WorkItemCreated", event.id) == "task/1"

    blank_aggregate = kernel.emit_event(
        "WorkItemUpdated",
        "work_item",
        "   ",
        payload={"title": "空白聚合"},
        correlation_id="corr-blank-aggregate",
    )
    assert _work_id_for(client, "WorkItemUpdated", blank_aggregate.id) is None


def test_timeline_explicit_ids_do_not_fall_through(client: TestClient):
    """A present blank work_id does not fall through to task_id or correlation_id."""
    linked = kernel.emit_event(
        "MemoryDerived",
        "memory",
        "mem-1",
        payload={"content": "记一笔", "task_id": "  task 2  "},
        correlation_id="corr-task",
    )
    assert _work_id_for(client, "MemoryDerived", linked.id) == "task 2"

    blank = kernel.emit_event(
        "MemoryUpdated",
        "memory",
        "mem-2",
        payload={"content": "改一笔", "work_id": "   ", "task_id": "should-not-link"},
        correlation_id="task/should-not-link",
    )
    assert _work_id_for(client, "MemoryUpdated", blank.id) is None

    numeric = kernel.emit_event(
        "CapabilityInvoked",
        "capability",
        "cap-1",
        payload={"capability_name": "shell", "work_id": 12, "task_id": "also-no"},
        correlation_id="corr-num",
    )
    assert _work_id_for(client, "CapabilityInvoked", numeric.id) is None

    unrelated = kernel.emit_event(
        "TimelineWorkIdProbe",
        "work_item",
        "task-looking-aggregate",
        payload={"correlation_id": "corr-in-payload"},
        correlation_id="corr-only",
    )
    assert _work_id_for(client, "TimelineWorkIdProbe", unrelated.id) is None


def test_timeline_approval_and_timer_work_ids(client: TestClient):
    """Approval task_id lives on ctx. Timer work_id lives on the nested payload."""
    approval = kernel.emit_event(
        "ApprovalRequested",
        "approval",
        "apr_1",
        payload={
            "action": "send_email",
            "ctx": {"task_id": " brief/9 ", "args": {}},
        },
        correlation_id="corr-approval",
    )
    assert _work_id_for(client, "ApprovalRequested", approval.id) == "brief/9"

    blank_task = kernel.emit_event(
        "ApprovalGranted",
        "approval",
        "apr_2",
        payload={"action": "send_email", "ctx": {"task_id": "  "}},
        correlation_id="corr-should-not-link",
    )
    assert _work_id_for(client, "ApprovalGranted", blank_task.id) is None

    timer = kernel.emit_event(
        "TimerFired",
        "timer",
        "timer-1",
        payload={
            "handler_name": "brief_repeat",
            "payload": {
                "work_id": " brief/3 ",
                "action_id": "not-used",
                "correlation_id": "corr-timer",
            },
        },
        correlation_id="corr-timer-event",
    )
    assert _work_id_for(client, "TimerFired", timer.id) == "brief/3"

    blank_timer = kernel.emit_event(
        "TimerFired",
        "timer",
        "timer-2",
        payload={
            "handler_name": "brief_repeat",
            "payload": {"work_id": " ", "action_id": "brief/3"},
        },
        correlation_id="brief/3",
    )
    assert _work_id_for(client, "TimerFired", blank_timer.id) is None


def test_timeline_message_appended_label(client: TestClient):
    kernel.emit_event(
        "ConversationCreated",
        "conversation",
        "tl_msg_1",
        payload={"title": "t"},
    )
    kernel.emit_event(
        "MessageAppended",
        "conversation",
        "tl_msg_1",
        payload={"role": "user", "content": "hi"},
    )
    r = client.get("/api/timeline/events?event_type=MessageAppended&page_size=5")
    assert r.status_code == 200
    items = r.json()["items"]
    assert items
    assert items[0]["description"] == "发送了消息"
