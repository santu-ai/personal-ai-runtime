"""Personal Dashboard product unit tests — widgets from Kernel ABI."""


def test_generate_dashboard_with_seeded_data(product_kernel):
    """Dashboard widgets reflect seeded Runtime data."""
    k = product_kernel

    k.emit_event(
        "WorkItemCreated",
        "work_item",
        "g1",
        payload={
            "work_type": "goal",
            "status": "active",
            "title": "Learn Rust",
            "importance": 0.9,
            "progress": 0.5,
        },
        actor="test",
    )
    k.emit_event(
        "WorkItemCreated",
        "work_item",
        "g2",
        payload={
            "work_type": "goal",
            "status": "active",
            "title": "Ship feature",
            "importance": 0.7,
            "progress": 0.2,
        },
        actor="test",
    )
    k.emit_event(
        "TimerCreated",
        "timer",
        "t1",
        payload={
            "handler_name": "memory_decay",
            "schedule_type": "cron",
            "cron_expr": "hour=8,minute=0",
            "fire_at": "2026-06-16T08:00:00Z",
        },
        actor="test",
    )
    k.emit_event(
        "PolicyCreated",
        "policy",
        "p1",
        payload={"capability": "read_file", "risk_level": "low"},
        actor="test",
    )

    from app.product.personal_dashboard import generate_dashboard

    dashboard = generate_dashboard()

    assert dashboard["active_goals"]["count"] == 2
    top_titles = [g["title"] for g in dashboard["active_goals"]["top"]]
    assert top_titles[0] == "Learn Rust"
    assert "Ship feature" in top_titles

    assert dashboard["recent_events"]["count"] >= 1
    assert dashboard["timer_status"]["active_timers"] >= 1
    assert dashboard["governance_status"]["active_policies"] >= 1
    assert isinstance(dashboard["governance_status"]["active_policies"], int)
    assert "generated_at" in dashboard
    assert "recent_memories" in dashboard
    trust = dashboard["execution_trust"]
    assert isinstance(trust["by_status"], dict)
    assert isinstance(trust["pending_approvals"], int)
    assert isinstance(trust["failed"], list)
    assert isinstance(trust["in_retry"], list)
    assert isinstance(trust["dead_letter"], list)
    assert isinstance(trust["dead_letter_count"], int)


def test_recent_memories_uses_claim_filtered_recall(product_kernel, monkeypatch):
    """Dashboard must not surface proposed claims as known facts."""
    from app.product import personal_dashboard as pd

    def fake_recall(query, max_memories=5):
        assert "recent" in query
        assert max_memories == 5
        return [{
            "id": "ok",
            "content": "I drink tea every morning",
            "confidence": 0.9,
            "category": "habit",
        }]

    monkeypatch.setattr(pd.read_ports, "recall_memories_for_context", fake_recall)
    dashboard = pd.generate_dashboard()
    items = dashboard["recent_memories"]["items"]
    assert dashboard["recent_memories"]["count"] == 1
    assert items[0]["content"] == "I drink tea every morning"
    assert items[0]["category"] == "habit"

    sovereignty = dashboard["data_sovereignty"]
    for key in (
        "total_events",
        "total_memories",
        "memories_self_report",
        "memories_claim",
        "total_goals",
        "goals_active",
        "goals_completed",
        "total_conversations",
        "total_messages",
        "data_location",
        "last_belief_reflection",
        "export_supported",
    ):
        assert key in sovereignty
    for key in (
        "total_events",
        "total_memories",
        "total_goals",
        "total_conversations",
        "total_messages",
    ):
        assert isinstance(sovereignty[key], int)
        assert sovereignty[key] >= 0
    assert sovereignty["export_supported"] is True
    assert "本地" in sovereignty["data_location"]


def test_execution_trust_widget_surfaces_failed_and_dead_letter(product_kernel):
    """Dashboard execution_trust is rebuilt from existing Kernel ABI, no new selector."""
    from app.core.runtime.kernel.constants import AGGREGATE_EXECUTION
    from app.product.personal_dashboard import generate_dashboard

    k = product_kernel
    eid = "ex_fail_1"
    k.emit_event(
        "ExecutionRequested",
        AGGREGATE_EXECUTION,
        eid,
        payload={
            "handler_name": "inbox_poll",
            "trigger_event_type": "InboxPollRequested",
            "created_at": "2026-08-17T00:00:00+00:00",
            "event_seq": 0,
            "policy": {},
        },
        actor="scheduler",
    )
    k.emit_event(
        "ExecutionFailed",
        AGGREGATE_EXECUTION,
        eid,
        payload={
            "error": "imap timeout",
            "attempt": 3,
            "dead_letter": True,
            "failed_at": "2026-08-17T00:01:00+00:00",
        },
        actor="scheduler",
    )
    cid = "ex_ok_1"
    k.emit_event(
        "ExecutionRequested",
        AGGREGATE_EXECUTION,
        cid,
        payload={
            "handler_name": "memory_decay",
            "trigger_event_type": "TimerFired",
            "created_at": "2026-08-17T00:02:00+00:00",
            "event_seq": 1,
            "policy": {},
        },
        actor="scheduler",
    )
    k.emit_event(
        "ExecutionCompleted",
        AGGREGATE_EXECUTION,
        cid,
        payload={"completed_at": "2026-08-17T00:03:00+00:00"},
        actor="scheduler",
    )

    trust = generate_dashboard()["execution_trust"]
    assert trust["by_status"].get("failed") == 1
    assert trust["by_status"].get("completed") == 1
    assert trust["dead_letter_count"] == 1
    assert trust["last_failed"]["handler_name"] == "inbox_poll"
    assert "imap timeout" in (trust["last_failed"]["error"] or "")
    assert trust["last_completed"]["handler_name"] == "memory_decay"
