"""T0: delivery/acceptance facts survive restart and rebuild on the Work aggregate."""

from __future__ import annotations

import pytest

from app.core.runtime import read_ports
from app.product.work_delivery import (
    DeliveryConflictError,
    DeliveryValidationError,
    accept_delivery,
    adopt_suggested_action,
    fold_delivery_history,
    list_unreviewed_deliveries,
    public_bundle,
    publish_delivery,
    request_rework,
    summarize_delivery_metrics,
)


def _create_task(title: str = "项目简报") -> dict:
    return read_ports.create_work_item(
        title,
        description="整理最近变化",
        work_type="task",
        executable_plan='{"kind":"project_brief","contract":{"contract_version":1,"output_kind":"project_brief"},"steps":[]}',
    )


def test_publish_accept_rework_rebuild(isolated_kernel):
    k, _db = isolated_kernel
    item = _create_task()
    work_id = item["id"]

    v1 = publish_delivery(
        work_id,
        content="A" * 1500,
        summary="v1 summary",
        sources=[{"id": "email:1", "type": "email", "title": "Mail", "locator": "a@b.c"}],
        findings=[{"text": "change", "source_ids": ["email:1"], "kind": "change"}],
        limitations=[],
        execution_id="exec-1",
        qualified=True,
    )
    assert v1["version"] == 1
    assert len(v1["content"]) == 1500

    again = publish_delivery(
        work_id,
        content="should not replace",
        summary="dup",
        sources=[],
        execution_id="exec-1",
    )
    assert again["delivery_id"] == v1["delivery_id"]

    with pytest.raises(DeliveryValidationError):
        request_rework(work_id, v1["delivery_id"], reason="  ", dispatch=False)

    rework = request_rework(
        work_id,
        v1["delivery_id"],
        reason="需要补风险",
        idempotency_key="rework-1",
        dispatch=False,
    )
    assert rework["replayed"] is False
    replay = request_rework(
        work_id,
        v1["delivery_id"],
        reason="需要补风险",
        idempotency_key="rework-1",
        dispatch=False,
    )
    assert replay["replayed"] is True

    v2 = publish_delivery(
        work_id,
        content="v2 full body with sources",
        summary="v2 summary",
        sources=[{"id": "email:1", "type": "email", "title": "Mail", "locator": "a@b.c"}],
        findings=[{"text": "risk", "source_ids": ["email:1"], "kind": "risk"}],
        limitations=[],
        execution_id="exec-2",
        qualified=True,
    )
    assert v2["version"] == 2
    assert v2["supersedes_delivery_id"] == v1["delivery_id"]

    accepted = accept_delivery(work_id, v2["delivery_id"], idempotency_key="accept-v2")
    assert accepted["replayed"] is False
    assert accepted["bundle"]["current_review_status"] == "accepted"
    replay_accept = accept_delivery(work_id, v2["delivery_id"], idempotency_key="accept-v2")
    assert replay_accept["replayed"] is True

    with pytest.raises(DeliveryConflictError):
        accept_delivery(work_id, v1["delivery_id"])

    k.rebuild_all()
    folded = fold_delivery_history(work_id)
    assert len(folded["deliveries"]) == 2
    assert folded["current"]["delivery_id"] == v2["delivery_id"]
    assert folded["current"]["content"] == "v2 full body with sources"
    assert folded["current_review_status"] == "accepted"
    assert folded["current"]["version"] == 2
    assert any(d["delivery_id"] == v1["delivery_id"] for d in folded["deliveries"])


def test_old_work_without_delivery_still_reads(isolated_kernel):
    item = read_ports.create_work_item("普通任务", work_type="task")
    folded = fold_delivery_history(item["id"])
    assert folded["current"] is None
    assert folded["deliveries"] == []
    row = read_ports.query_work_item(item["id"])
    assert row is not None
    assert row["title"] == "普通任务"


def test_opposite_decision_conflicts(isolated_kernel):
    item = _create_task()
    work_id = item["id"]
    v1 = publish_delivery(
        work_id,
        content="body",
        summary="v1",
        sources=[],
        execution_id="exec-opp",
    )
    accepted = accept_delivery(work_id, v1["delivery_id"], idempotency_key="accept-1")
    assert accepted["replayed"] is False
    with pytest.raises(DeliveryConflictError, match="已验收"):
        request_rework(
            work_id,
            v1["delivery_id"],
            reason="再改一版",
            idempotency_key="rework-after-accept",
            dispatch=False,
        )


def test_idempotency_key_cannot_cover_different_request(isolated_kernel):
    item = _create_task()
    work_id = item["id"]
    v1 = publish_delivery(
        work_id,
        content="body",
        summary="v1",
        sources=[],
        execution_id="exec-key",
    )
    accept_delivery(work_id, v1["delivery_id"], idempotency_key="shared-key")
    with pytest.raises(DeliveryConflictError, match="幂等键"):
        request_rework(
            work_id,
            v1["delivery_id"],
            reason="不同请求",
            idempotency_key="shared-key",
            dispatch=False,
        )


def test_rework_replay_completes_dispatch_after_interrupt(isolated_kernel, monkeypatch):
    item = read_ports.create_work_item(
        "项目简报",
        description="整理最近变化",
        work_type="task",
        executable_plan=(
            '{"kind":"project_brief","contract":{"contract_version":1,'
            '"output_kind":"project_brief"},'
            '"steps":[{"tool":"echo","params":{"t":"1"}}]}'
        ),
        status="completed",
    )
    work_id = item["id"]
    v1 = publish_delivery(
        work_id,
        content="v1",
        summary="v1",
        sources=[],
        execution_id="exec-r2",
    )
    execute_calls: list[str] = []
    monkeypatch.setattr(
        read_ports,
        "request_work_item_execute",
        lambda wid: execute_calls.append(wid) or {"id": wid, "status": "running"},
    )

    def boom(_wid: str) -> None:
        raise RuntimeError("injected reset failure")

    monkeypatch.setattr(read_ports, "reset_work_item_plan_progress", boom)
    with pytest.raises(RuntimeError, match="injected"):
        request_rework(
            work_id,
            v1["delivery_id"],
            reason="需要补风险",
            idempotency_key="rework-resume",
        )
    assert execute_calls == []

    monkeypatch.setattr(read_ports, "reset_work_item_plan_progress", lambda _wid: None)
    replay = request_rework(
        work_id,
        v1["delivery_id"],
        reason="需要补风险",
        idempotency_key="rework-resume",
    )
    assert replay["replayed"] is True
    assert execute_calls == [work_id]
    folded = fold_delivery_history(work_id)
    assert folded["current_review_status"] == "changes_requested"
    assert any(
        str(row.get("delivery_id")) == v1["delivery_id"]
        for row in folded["_dispatches"]
    )
    second = request_rework(
        work_id,
        v1["delivery_id"],
        reason="需要补风险",
        idempotency_key="rework-resume",
    )
    assert second["replayed"] is True
    assert execute_calls == [work_id]


def _brief_task_with_steps() -> dict:
    return read_ports.create_work_item(
        "项目简报",
        description="整理最近变化",
        work_type="task",
        executable_plan=(
            '{"kind":"project_brief","contract":{"contract_version":1,'
            '"output_kind":"project_brief"},'
            '"steps":[{"tool":"echo","params":{"t":"1"}}]}'
        ),
        status="completed",
    )


def test_rework_emits_execute_after_running_without_execute_requested(isolated_kernel, monkeypatch):
    k, _db = isolated_kernel
    item = _brief_task_with_steps()
    work_id = item["id"]
    v1 = publish_delivery(
        work_id,
        content="v1",
        summary="v1",
        sources=[],
        execution_id="exec-r2b",
    )
    real_emit = k.emit_event

    def fail_execute_requested(*args, **kwargs):
        event_type = args[0] if args else kwargs.get("type")
        if event_type == "ExecuteRequested":
            raise RuntimeError("injected execute emit failure")
        return real_emit(*args, **kwargs)

    monkeypatch.setattr(k, "emit_event", fail_execute_requested)
    with pytest.raises(RuntimeError, match="injected execute"):
        request_rework(
            work_id,
            v1["delivery_id"],
            reason="需要补风险",
            idempotency_key="rework-running",
        )
    assert k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}") == []
    stuck = read_ports.query_work_item(work_id)
    assert stuck is not None
    assert stuck["status"] == "running"
    folded = fold_delivery_history(work_id)
    assert folded["_dispatches"] == []

    monkeypatch.setattr(k, "emit_event", real_emit)
    replay = request_rework(
        work_id,
        v1["delivery_id"],
        reason="需要补风险",
        idempotency_key="rework-running",
    )
    assert replay["replayed"] is True
    execs = k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}")
    assert len(execs) == 1
    folded = fold_delivery_history(work_id)
    assert len(folded["_dispatches"]) == 1
    again = request_rework(
        work_id,
        v1["delivery_id"],
        reason="需要补风险",
        idempotency_key="rework-running",
    )
    assert again["replayed"] is True
    assert len(k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}")) == 1


def test_rework_does_not_duplicate_execute_after_marker_gap(isolated_kernel, monkeypatch):
    k, _db = isolated_kernel
    item = _brief_task_with_steps()
    work_id = item["id"]
    v1 = publish_delivery(
        work_id,
        content="v1",
        summary="v1",
        sources=[],
        execution_id="exec-r2b-mark",
    )
    real_emit = k.emit_event

    def fail_dispatch_marker(*args, **kwargs):
        payload = kwargs.get("payload")
        if payload is None and len(args) >= 4:
            payload = args[3]
        if isinstance(payload, dict) and payload.get("rework_dispatched"):
            raise RuntimeError("injected marker failure")
        return real_emit(*args, **kwargs)

    monkeypatch.setattr(k, "emit_event", fail_dispatch_marker)
    with pytest.raises(RuntimeError, match="injected marker"):
        request_rework(
            work_id,
            v1["delivery_id"],
            reason="需要补风险",
            idempotency_key="rework-marker",
        )
    assert len(k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}")) == 1
    assert fold_delivery_history(work_id)["_dispatches"] == []

    monkeypatch.setattr(k, "emit_event", real_emit)
    replay = request_rework(
        work_id,
        v1["delivery_id"],
        reason="需要补风险",
        idempotency_key="rework-marker",
    )
    assert replay["replayed"] is True
    assert len(k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}")) == 1
    assert len(fold_delivery_history(work_id)["_dispatches"]) == 1


def test_adopt_suggested_action_dedupes_and_survives_rebuild(isolated_kernel):
    k, _db = isolated_kernel
    item = _create_task()
    work_id = item["id"]
    actions = [
        {"title": "核对排期", "reason": "邮件提到延期", "source_ids": ["email:1"]},
        {"title": "确认范围", "reason": "", "source_ids": []},
    ]
    v1 = publish_delivery(
        work_id,
        content="body",
        summary="v1",
        sources=[{"id": "email:1", "type": "email", "title": "延期"}],
        suggested_actions=actions,
        execution_id="exec-adopt",
    )
    v2 = publish_delivery(
        work_id,
        content="body-v2",
        summary="v2",
        sources=[],
        suggested_actions=actions,
        execution_id="exec-adopt-2",
    )

    with pytest.raises(DeliveryConflictError):
        adopt_suggested_action(work_id, v1["delivery_id"], 0, idempotency_key="old")
    with pytest.raises(DeliveryValidationError):
        adopt_suggested_action(work_id, v2["delivery_id"], 5)

    first = adopt_suggested_action(work_id, v2["delivery_id"], 0, idempotency_key="adopt-0")
    assert first["replayed"] is False
    child_id = first["work"]["id"]
    assert first["work"]["title"] == "核对排期"
    assert first["work"]["parent_work_id"] == work_id
    assert first["work"]["status"] == "pending"
    assert "adopted_suggestion" in first["work"]["executable_plan"]
    assert "邮件提到延期" in first["work"]["description"]

    again = adopt_suggested_action(work_id, v2["delivery_id"], 0, idempotency_key="adopt-other")
    assert again["replayed"] is True
    assert again["work"]["id"] == child_id
    assert len(read_ports.get_sub_work_items(work_id)) == 1

    with pytest.raises(DeliveryConflictError, match="幂等键"):
        adopt_suggested_action(work_id, v2["delivery_id"], 1, idempotency_key="adopt-0")

    orphan_plan = (
        '{"kind":"adopted_suggestion","source_work_id":"%s",'
        '"delivery_id":"%s","action_index":1,"source_ids":[]}'
    ) % (work_id, v2["delivery_id"])
    orphan = read_ports.create_work_item(
        "确认范围",
        work_type="task",
        parent_work_id=work_id,
        executable_plan=orphan_plan,
    )
    recovered = adopt_suggested_action(work_id, v2["delivery_id"], 1, idempotency_key="adopt-1")
    assert recovered["replayed"] is True
    assert recovered["work"]["id"] == orphan["id"]
    assert len(read_ports.get_sub_work_items(work_id)) == 2

    k.rebuild_all()
    bundle = public_bundle(work_id)
    adopted = bundle["current"]["suggested_actions"]
    assert adopted[0]["adopted_work_id"] == child_id
    assert adopted[1]["adopted_work_id"] == orphan["id"]
    assert read_ports.query_work_item(child_id)["title"] == "核对排期"


def test_delivery_metrics_track_first_acceptance_rework_and_adoption(isolated_kernel):
    first = _create_task("首版通过")
    first_v1 = publish_delivery(
        first["id"], content="v1", summary="v1", sources=[], execution_id="metric-1",
    )
    accept_delivery(first["id"], first_v1["delivery_id"], idempotency_key="metric-a1")

    revised = _create_task("返工通过")
    revised_v1 = publish_delivery(
        revised["id"], content="v1", summary="v1", sources=[], execution_id="metric-2",
    )
    request_rework(
        revised["id"], revised_v1["delivery_id"], reason="补风险",
        idempotency_key="metric-r1", dispatch=False,
    )
    revised_v2 = publish_delivery(
        revised["id"], content="v2", summary="v2", sources=[],
        suggested_actions=[{"title": "确认排期", "reason": "延期", "source_ids": []}],
        execution_id="metric-3",
    )
    accept_delivery(revised["id"], revised_v2["delivery_id"], idempotency_key="metric-a2")
    adopt_suggested_action(
        revised["id"], revised_v2["delivery_id"], 0, idempotency_key="metric-adopt",
    )

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["reviewed_tasks"] == 2
    assert metrics["accepted_tasks"] == 2
    assert metrics["first_reviewed_tasks"] == 2
    assert metrics["first_version_accepted_tasks"] == 1
    assert metrics["first_version_acceptance_rate"] == 0.5
    assert metrics["rework_count"] == 1
    assert metrics["adopted_action_count"] == 1
    assert metrics["average_review_latency_hours"] is not None
    assert metrics["attribution"]["approval_interventions"] == 0
    assert metrics["attribution"]["recovery_interventions"] == 0
    assert metrics["attribution"]["llm_cost"] == 0.0
    assert metrics["attribution"]["unattributed_project_brief_calls"] == 0
    by_title = {row["title"]: row for row in metrics["items"]}
    assert by_title["首版通过"]["first_review_accepted_v1"] is True
    assert by_title["返工通过"]["reworks"] == 1
    assert by_title["返工通过"]["adopted_actions"] == 1


def test_unreviewed_delivery_is_not_hidden_by_newer_ordinary_tasks(isolated_kernel):
    brief = _create_task("较早的待评审简报")
    delivery = publish_delivery(
        brief["id"], content="body", summary="summary", sources=[],
        execution_id="older-unreviewed",
    )
    for index in range(101):
        read_ports.create_work_item(f"普通任务 {index}", work_type="task")

    rows = list_unreviewed_deliveries(limit=20)

    assert any(
        row["work_id"] == brief["id"]
        and row["delivery_id"] == delivery["delivery_id"]
        for row in rows
    )


def test_delivery_metrics_attribute_approvals_recoveries_and_cost(isolated_kernel):
    kernel, _db = isolated_kernel
    execution_id = "exec-brief-1"
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        execution_id,
        payload={"execution_id": execution_id, "correlation_id": "corr-brief-1"},
        correlation_id="corr-brief-1",
    )
    kernel.emit_event(
        "CapabilityDenied",
        "capability",
        "cap_check_inbox",
        payload={
            "name": "check_inbox",
            "reason": "deferred",
            "approval_id": "apr_denied",
        },
        caused_by=execution_id,
        correlation_id="corr-brief-1",
    )
    kernel.emit_event(
        "ApprovalRequested",
        "approval",
        "apr_corr",
        payload={"action": "read_file", "risk": "high"},
        correlation_id="corr-brief-1",
    )
    kernel.emit_event(
        "ApprovalRequested",
        "approval",
        "apr_low",
        payload={"action": "read_file", "risk": "low"},
        correlation_id="corr-brief-1",
    )
    kernel.emit_event(
        "ExecutionRetried",
        "execution",
        execution_id,
        payload={
            "execution_id": execution_id,
            "attempt": 1,
            "reason": "interrupted",
            "status": "retrying",
        },
        correlation_id="corr-brief-1",
    )
    kernel.emit_event(
        "ExecutionRetried",
        "execution",
        execution_id,
        payload={
            "execution_id": execution_id,
            "attempt": 1,
            "reason": "interrupted",
            "status": "pending",
        },
        correlation_id="corr-brief-1",
    )
    kernel.emit_event(
        "ExecutionRetried",
        "execution",
        execution_id,
        payload={
            "execution_id": execution_id,
            "attempt": 2,
            "reason": "Timeout after 30s",
            "status": "retrying",
        },
        correlation_id="corr-brief-1",
    )
    kernel.emit_event(
        "CapabilityFailed",
        "capability",
        "cap_check_inbox",
        payload={"name": "check_inbox", "error": "interrupted_before_audit"},
        correlation_id="corr-brief-1",
    )
    kernel.emit_event(
        "CapabilityFailed",
        "capability",
        "cap_write_file",
        payload={"name": "write_file", "error": "interrupted_before_audit"},
        correlation_id="corr-brief-1",
    )
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_brief",
        payload={
            "purpose": "project_brief",
            "cost": 0.0125,
            "success": True,
        },
        caused_by=execution_id,
        correlation_id="corr-brief-1",
    )
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_chat",
        payload={"purpose": "chat", "cost": 9.0, "success": True},
        caused_by="exec-other",
    )
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_other_brief",
        payload={"purpose": "project_brief", "cost": 3.0, "success": True},
        caused_by="exec-other",
    )
    kernel.emit_event(
        "CapabilityDenied",
        "capability",
        "cap_other",
        payload={"name": "write_file", "reason": "deferred", "approval_id": "apr_other"},
        caused_by="exec-other",
    )

    task = _create_task("可归因简报")
    published = publish_delivery(
        task["id"], content="v1", summary="v1", sources=[], execution_id=execution_id,
    )
    accept_delivery(task["id"], published["delivery_id"], idempotency_key="attr-accept")

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["approval_interventions"] == 2
    # One crash: retrying replay plus the audit-gap twins on the same correlation.
    assert metrics["attribution"]["recovery_interventions"] == 1
    assert metrics["attribution"]["llm_cost"] == 0.0125
    assert metrics["attribution"]["unattributed_project_brief_calls"] == 0
    assert metrics["capped"] is False


def _accept_metric_brief(title: str, execution_id: str) -> None:
    task = _create_task(title)
    published = publish_delivery(
        task["id"], content="v1", summary="v1", sources=[], execution_id=execution_id,
    )
    accept_delivery(task["id"], published["delivery_id"], idempotency_key=f"accept-{execution_id}")


def test_distinct_interrupt_attempts_stay_separate_recoveries(isolated_kernel):
    kernel, _db = isolated_kernel
    execution_id = "exec-two-crashes"
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        execution_id,
        payload={"execution_id": execution_id, "correlation_id": "corr-two"},
        correlation_id="corr-two",
    )
    for attempt in (1, 2):
        kernel.emit_event(
            "ExecutionRetried",
            "execution",
            execution_id,
            payload={
                "execution_id": execution_id,
                "attempt": attempt,
                "reason": "interrupted",
                "status": "retrying",
            },
            correlation_id="corr-two",
        )
    kernel.emit_event(
        "CapabilityFailed",
        "capability",
        "cap_check_inbox",
        payload={"name": "check_inbox", "error": "interrupted_before_audit"},
        correlation_id="corr-two",
    )
    _accept_metric_brief("两次中断", execution_id)

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["recovery_interventions"] == 2


def test_dead_lettered_interruption_pairs_with_audit_gap(isolated_kernel):
    kernel, _db = isolated_kernel
    execution_id = "exec-dead-letter"
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        execution_id,
        payload={"execution_id": execution_id, "correlation_id": "corr-dlq"},
        correlation_id="corr-dlq",
    )
    kernel.emit_event(
        "ExecutionFailed",
        "execution",
        execution_id,
        payload={
            "execution_id": execution_id,
            "attempt": 3,
            "error": "interrupted",
            "terminal": True,
            "dead_letter": True,
        },
        correlation_id="corr-dlq",
    )
    kernel.emit_event(
        "CapabilityFailed",
        "capability",
        "cap_check_inbox",
        payload={"name": "check_inbox", "error": "interrupted_before_audit"},
        correlation_id="corr-dlq",
    )
    _accept_metric_brief("预算耗尽", execution_id)

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["recovery_interventions"] == 1


def test_audit_gap_without_handler_replay_counts_as_recovery(isolated_kernel):
    kernel, _db = isolated_kernel
    execution_id = "exec-audit-only"
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        execution_id,
        payload={"execution_id": execution_id, "correlation_id": "corr-audit"},
        correlation_id="corr-audit",
    )
    kernel.emit_event(
        "CapabilityFailed",
        "capability",
        "cap_check_inbox",
        payload={"name": "check_inbox", "error": "interrupted_before_audit"},
        correlation_id="corr-audit",
    )
    _accept_metric_brief("只有审计缺口", execution_id)

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["recovery_interventions"] == 1


def test_unattributed_audit_gap_twins_handler_without_clock(isolated_kernel):
    """没有归属字段的旧审计缺口并入同 correlation 的 handler replay。"""
    kernel, _db = isolated_kernel
    execution_id = "exec-legacy-gap"
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        execution_id,
        payload={"execution_id": execution_id, "correlation_id": "corr-legacy"},
        correlation_id="corr-legacy",
    )
    kernel.emit_event(
        "ExecutionRetried",
        "execution",
        execution_id,
        payload={
            "execution_id": execution_id,
            "attempt": 1,
            "reason": "interrupted",
            "status": "retrying",
        },
        correlation_id="corr-legacy",
    )
    kernel.emit_event(
        "CapabilityFailed",
        "capability",
        "cap_check_inbox",
        payload={"name": "check_inbox", "error": "interrupted_before_audit"},
        correlation_id="corr-legacy",
    )
    _accept_metric_brief("旧审计缺口", execution_id)

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["recovery_interventions"] == 1


def _emit_audit_gap(kernel, execution_id: str, correlation: str, retry_count: int) -> None:
    kernel.emit_event(
        "CapabilityFailed",
        "capability",
        "cap_check_inbox",
        payload={
            "name": "check_inbox",
            "error": "interrupted_before_audit",
            "execution_id": execution_id,
            "retry_count": retry_count,
        },
        caused_by=execution_id,
        correlation_id=correlation,
    )


def test_same_attempt_audit_gaps_count_once(isolated_kernel):
    kernel, _db = isolated_kernel
    execution_id = "exec-same-attempt"
    correlation = "corr-same"
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        execution_id,
        payload={"execution_id": execution_id, "correlation_id": correlation},
        correlation_id=correlation,
    )
    kernel.emit_event(
        "ExecutionRetried",
        "execution",
        execution_id,
        payload={
            "execution_id": execution_id,
            "attempt": 1,
            "reason": "interrupted",
            "status": "retrying",
        },
        correlation_id=correlation,
    )
    _emit_audit_gap(kernel, execution_id, correlation, 0)
    _emit_audit_gap(kernel, execution_id, correlation, 0)
    _accept_metric_brief("同一次中断的两个工具", execution_id)

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["recovery_interventions"] == 1


def test_distinct_attributed_crashes_stay_separate(isolated_kernel):
    kernel, _db = isolated_kernel
    execution_id = "exec-two-attributed"
    correlation = "corr-two-attr"
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        execution_id,
        payload={"execution_id": execution_id, "correlation_id": correlation},
        correlation_id=correlation,
    )
    for attempt, retry_count in ((1, 0), (2, 1)):
        kernel.emit_event(
            "ExecutionRetried",
            "execution",
            execution_id,
            payload={
                "execution_id": execution_id,
                "attempt": attempt,
                "reason": "interrupted",
                "status": "retrying",
            },
            correlation_id=correlation,
        )
        _emit_audit_gap(kernel, execution_id, correlation, retry_count)
    _accept_metric_brief("两次带归属的中断", execution_id)

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["recovery_interventions"] == 2


def test_unmatched_audit_generation_counts_separately(isolated_kernel):
    kernel, _db = isolated_kernel
    execution_id = "exec-unmatched-gen"
    correlation = "corr-unmatched"
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        execution_id,
        payload={"execution_id": execution_id, "correlation_id": correlation},
        correlation_id=correlation,
    )
    kernel.emit_event(
        "ExecutionRetried",
        "execution",
        execution_id,
        payload={
            "execution_id": execution_id,
            "attempt": 1,
            "reason": "interrupted",
            "status": "retrying",
        },
        correlation_id=correlation,
    )
    _emit_audit_gap(kernel, execution_id, correlation, 0)
    _emit_audit_gap(kernel, execution_id, correlation, 4)
    _accept_metric_brief("另一代审计缺口", execution_id)

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["recovery_interventions"] == 2


def test_attributed_dead_letter_pairs_with_audit_gap(isolated_kernel):
    kernel, _db = isolated_kernel
    execution_id = "exec-attr-dlq"
    correlation = "corr-attr-dlq"
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        execution_id,
        payload={"execution_id": execution_id, "correlation_id": correlation},
        correlation_id=correlation,
    )
    kernel.emit_event(
        "ExecutionFailed",
        "execution",
        execution_id,
        payload={
            "execution_id": execution_id,
            "attempt": 3,
            "error": "interrupted",
            "terminal": True,
            "dead_letter": True,
        },
        correlation_id=correlation,
    )
    _emit_audit_gap(kernel, execution_id, correlation, 3)
    _accept_metric_brief("带归属的预算耗尽", execution_id)

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["recovery_interventions"] == 1


def test_unlinked_brief_cost_is_counted_apart(isolated_kernel):
    kernel, _db = isolated_kernel
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_legacy",
        payload={"purpose": "project_brief", "cost": 1.5, "success": True},
    )
    task = _create_task("旧成本简报")
    published = publish_delivery(
        task["id"], content="v1", summary="v1", sources=[], execution_id="exec-legacy",
    )
    accept_delivery(task["id"], published["delivery_id"], idempotency_key="legacy-accept")

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["approval_interventions"] == 0
    assert metrics["attribution"]["llm_cost"] == 0.0
    assert metrics["attribution"]["unattributed_project_brief_calls"] == 1


def test_unattributed_brief_calls_keep_linked_cost(isolated_kernel):
    """缺少 caused_by 的简报调用另计次数，不把已归因金额打成 unavailable。"""
    kernel, _db = isolated_kernel
    execution_id = "exec-mixed-cost"
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_linked",
        payload={"purpose": "project_brief", "cost": 0.0125, "success": True},
        caused_by=execution_id,
    )
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_legacy",
        payload={"purpose": "project_brief", "cost": 1.5, "success": True},
    )
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_blank_cause",
        payload={"purpose": "project_brief", "cost": 0.4, "success": True},
        caused_by="  ",
    )
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_failed",
        payload={"purpose": "project_brief", "cost": 9.0, "success": False},
    )
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_chat",
        payload={"purpose": "chat", "cost": 4.0, "success": True},
    )
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_other",
        payload={"purpose": "project_brief", "cost": 3.0, "success": True},
        caused_by="exec-other",
    )
    _accept_metric_brief("混合成本", execution_id)

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["llm_cost"] == 0.0125
    assert metrics["attribution"]["unattributed_project_brief_calls"] == 2
    assert metrics["attribution"]["approval_interventions"] == 0
    assert metrics["capped"] is False


def test_llm_read_cap_hides_partial_brief_cost(isolated_kernel):
    kernel, _db = isolated_kernel
    execution_id = "exec-capped-cost"
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_linked",
        payload={"purpose": "project_brief", "cost": 0.0125, "success": True},
        caused_by=execution_id,
    )
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_legacy",
        payload={"purpose": "project_brief", "cost": 1.5, "success": True},
    )
    _accept_metric_brief("读上限成本", execution_id)

    metrics = summarize_delivery_metrics(days=30, limit=1)
    assert metrics["capped"] is True
    assert metrics["attribution"]["llm_cost"] == "unavailable"
    assert metrics["attribution"]["unattributed_project_brief_calls"] == "unavailable"


def test_unreviewed_scan_pages_past_newer_updates(isolated_kernel, monkeypatch):
    kernel, _db = isolated_kernel
    brief = _create_task("埋在更新后面的简报")
    delivery = publish_delivery(
        brief["id"], content="body", summary="summary", sources=[],
        execution_id="buried",
    )
    for index in range(250):
        kernel.emit_event(
            "WorkItemUpdated",
            "work_item",
            f"noise-{index}",
            payload={"progress": 0.2},
            actor="user",
        )

    limits: list[int | None] = []
    original = kernel.read_events

    def wrapped(*args, **kwargs):
        if (
            kwargs.get("type") == "WorkItemUpdated"
            and kwargs.get("aggregate_id") is None
            and kwargs.get("order") == "desc"
        ):
            limits.append(kwargs.get("limit"))
        return original(*args, **kwargs)

    monkeypatch.setattr(kernel, "read_events", wrapped)
    rows = list_unreviewed_deliveries(limit=20)

    assert limits
    assert all(limit == 200 for limit in limits)
    assert len(limits) >= 2
    assert any(row["work_id"] == brief["id"] and row["delivery_id"] == delivery["delivery_id"] for row in rows)
