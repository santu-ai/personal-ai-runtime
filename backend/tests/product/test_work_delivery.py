"""T0: delivery/acceptance facts survive restart and rebuild on the Work aggregate."""

from __future__ import annotations

import pytest

from app.core.runtime import read_ports
from app.product.work_delivery import (
    DeliveryConflictError,
    DeliveryNotFoundError,
    DeliveryValidationError,
    accept_delivery,
    adopt_suggested_action,
    fold_delivery_history,
    get_delivery,
    list_rerunnable_briefs,
    list_unreviewed_deliveries,
    public_bundle,
    publish_delivery,
    request_rework,
    rerun_project_brief,
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


def test_public_delivery_keeps_rework_reason(isolated_kernel):
    k, _db = isolated_kernel
    item = _create_task()
    work_id = item["id"]
    v1 = publish_delivery(
        work_id,
        content="v1 body",
        summary="v1",
        sources=[],
        execution_id="exec-reason",
    )
    assert v1["latest_decision"] is None

    request_rework(
        work_id,
        v1["delivery_id"],
        reason="  需要补风险  ",
        dispatch=False,
    )
    bundle = public_bundle(work_id)
    decision = bundle["current"]["latest_decision"]
    assert bundle["current"]["review_status"] == "changes_requested"
    assert decision["reason"] == "需要补风险"
    assert decision["decision"] == "changes_requested"
    assert bundle["deliveries"][0]["latest_decision"]["reason"] == "需要补风险"

    single = get_delivery(work_id, v1["delivery_id"])
    assert single["latest_decision"]["reason"] == "需要补风险"
    assert single["latest_decision"]["decision_id"] == decision["decision_id"]

    v2 = publish_delivery(
        work_id,
        content="v2 body",
        summary="v2",
        sources=[],
        execution_id="exec-reason-2",
    )
    assert v2["latest_decision"] is None
    assert v2["review_status"] == "unreviewed"

    again = publish_delivery(
        work_id,
        content="ignored",
        summary="ignored",
        sources=[],
        execution_id="exec-reason",
    )
    assert again["delivery_id"] == v1["delivery_id"]
    assert again["review_status"] == "changes_requested"
    assert again["latest_decision"]["reason"] == "需要补风险"

    k.rebuild_all()
    bundle = public_bundle(work_id)
    assert bundle["current"]["delivery_id"] == v2["delivery_id"]
    assert bundle["current"]["latest_decision"] is None
    old = next(row for row in bundle["deliveries"] if row["delivery_id"] == v1["delivery_id"])
    assert old["review_status"] == "changes_requested"
    assert old["latest_decision"]["reason"] == "需要补风险"
    assert "content" not in old


def test_public_delivery_keeps_accept_reason(isolated_kernel):
    k, _db = isolated_kernel
    item = _create_task()
    work_id = item["id"]
    v1 = publish_delivery(
        work_id,
        content="v1 body",
        summary="v1",
        sources=[],
        execution_id="exec-accept-note",
    )
    accepted = accept_delivery(
        work_id,
        v1["delivery_id"],
        reason="  来源齐全  ",
        idempotency_key="accept-note",
    )
    assert accepted["replayed"] is False
    assert accepted["decision"]["reason"] == "来源齐全"
    assert accepted["decision"]["decision"] == "accepted"

    bundle = public_bundle(work_id)
    decision = bundle["current"]["latest_decision"]
    assert bundle["current"]["review_status"] == "accepted"
    assert decision["reason"] == "来源齐全"
    assert bundle["deliveries"][0]["latest_decision"]["reason"] == "来源齐全"

    single = get_delivery(work_id, v1["delivery_id"])
    assert single["latest_decision"]["reason"] == "来源齐全"
    assert single["latest_decision"]["decision_id"] == decision["decision_id"]

    replay = accept_delivery(
        work_id,
        v1["delivery_id"],
        reason="来源齐全",
        idempotency_key="accept-note",
    )
    assert replay["replayed"] is True
    assert replay["decision"]["reason"] == "来源齐全"

    k.rebuild_all()
    bundle = public_bundle(work_id)
    assert bundle["current"]["latest_decision"]["reason"] == "来源齐全"
    assert bundle["current"]["review_status"] == "accepted"


def test_blank_accept_reason_stays_blank(isolated_kernel):
    item = _create_task()
    work_id = item["id"]
    published = publish_delivery(
        work_id,
        content="v1 body",
        summary="v1",
        sources=[],
        execution_id="exec-accept-blank",
    )
    accepted = accept_delivery(work_id, published["delivery_id"], reason="   ")
    assert accepted["decision"]["reason"] == ""
    bundle = public_bundle(work_id)
    assert bundle["current"]["review_status"] == "accepted"
    assert bundle["current"]["latest_decision"]["reason"] == ""


def test_changes_from_previous_use_stored_delivery_fields(isolated_kernel):
    k, _db = isolated_kernel
    item = _create_task()
    work_id = item["id"]
    v1 = publish_delivery(
        work_id,
        content="body-v1",
        summary="第一版",
        sources=[{"id": "email:1", "type": "email", "title": "旧邮件", "locator": "a"}],
        findings=[
            {"text": "进度正常", "kind": "change", "source_ids": ["email:1"]},
            {"text": "范围只含邮件", "kind": "change", "source_ids": ["email:1"]},
        ],
        limitations=["只看了邮件"],
        suggested_actions=[{
            "title": "核对排期",
            "reason": "旧理由",
            "source_ids": ["email:1"],
        }],
        execution_id="exec-d1",
    )
    assert v1["changes_from_previous"] is None

    again = publish_delivery(
        work_id,
        content="ignored",
        summary="ignored",
        sources=[],
        execution_id="exec-d1",
    )
    assert again["delivery_id"] == v1["delivery_id"]
    assert again["changes_from_previous"] is None

    v2 = publish_delivery(
        work_id,
        content="body-v2",
        summary="第二版",
        sources=[
            {"id": "email:1", "type": "email", "title": "新邮件", "locator": "b"},
            {"id": "file:1", "type": "file", "title": "纪要", "locator": "notes.md"},
        ],
        findings=[
            {"text": "进度正常", "kind": "risk", "source_ids": ["file:1", "email:1"]},
            {"text": "新增风险", "kind": "risk", "source_ids": ["file:1"]},
        ],
        limitations=["只看了邮件", "缺附件"],
        suggested_actions=[{
            "title": "核对排期",
            "reason": "新理由",
            "source_ids": ["file:1"],
        }],
        execution_id="exec-d2",
    )
    delta = v2["changes_from_previous"]
    assert delta["previous_delivery_id"] == v1["delivery_id"]
    assert delta["previous_version"] == 1
    assert delta["summary_changed"] is True
    assert delta["content_changed"] is True
    assert delta["findings_added"] == [{
        "text": "新增风险",
        "kind": "risk",
        "source_ids": ["file:1"],
    }]
    assert delta["findings_removed"] == [{
        "text": "范围只含邮件",
        "kind": "change",
        "source_ids": ["email:1"],
    }]
    changed = delta["findings_changed"][0]
    assert changed["text"] == "进度正常"
    assert changed["kind"] == "risk"
    assert changed["previous_kind"] == "change"
    assert changed["previous_source_ids"] == ["email:1"]
    assert delta["sources_added"][0]["id"] == "file:1"
    assert delta["sources_removed"] == []
    assert delta["sources_changed"][0]["id"] == "email:1"
    assert delta["sources_changed"][0]["previous_title"] == "旧邮件"
    assert delta["sources_changed"][0]["title"] == "新邮件"
    assert delta["limitations_added"] == ["缺附件"]
    assert delta["limitations_removed"] == []
    assert delta["actions_added"] == []
    assert delta["actions_removed"] == []
    assert delta["actions_changed"][0]["previous_reason"] == "旧理由"
    assert "body-v1" not in str(delta)
    assert "body-v2" not in str(delta)

    v3 = publish_delivery(
        work_id,
        content="body-v2",
        summary="第二版",
        sources=[
            {"id": "email:1", "type": "email", "title": "新邮件", "locator": "b"},
            {"id": "file:1", "type": "file", "title": "纪要", "locator": "notes.md"},
        ],
        findings=[
            {"text": "进度正常", "kind": "risk", "source_ids": ["email:1", "file:1"]},
            {"text": "新增风险", "kind": "risk", "source_ids": ["file:1"]},
        ],
        limitations=["缺附件", "只看了邮件"],
        suggested_actions=[{
            "title": "核对排期",
            "reason": "新理由",
            "source_ids": ["file:1"],
        }],
        execution_id="exec-d3",
    )
    same = v3["changes_from_previous"]
    assert same["previous_version"] == 2
    assert same["summary_changed"] is False
    assert same["content_changed"] is False
    assert same["findings_added"] == []
    assert same["findings_removed"] == []
    assert same["findings_changed"] == []
    assert same["sources_changed"] == []
    assert same["limitations_added"] == []
    assert same["actions_changed"] == []

    bundle = public_bundle(work_id)
    assert bundle["deliveries"][0]["changes_from_previous"] is None
    assert "content" not in bundle["deliveries"][1]
    assert bundle["deliveries"][1]["changes_from_previous"]["findings_added"][0]["text"] == "新增风险"
    assert get_delivery(work_id, v2["delivery_id"])["changes_from_previous"]["previous_version"] == 1

    k.rebuild_all()
    rebuilt = get_delivery(work_id, v2["delivery_id"])
    assert rebuilt["changes_from_previous"]["findings_removed"][0]["text"] == "范围只含邮件"
    assert "body-v1" not in str(rebuilt["changes_from_previous"])


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
    k, _db = isolated_kernel
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

    def fake_execute(wid: str) -> dict[str, str]:
        execute_calls.append(wid)
        k.emit_event(
            "ExecuteRequested",
            "action",
            f"exec_{wid}",
            payload={"action_id": wid},
            actor="user",
        )
        return {"id": wid, "status": "running"}

    monkeypatch.setattr(read_ports, "request_work_item_execute", fake_execute)

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
    assert metrics["attribution"]["unattributed_project_brief_cost"] == 0.0
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
    assert metrics["attribution"]["unattributed_project_brief_cost"] == 0.0
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
    assert metrics["attribution"]["unattributed_project_brief_cost"] == 1.5


def test_unattributed_brief_calls_keep_linked_cost(isolated_kernel):
    """缺少 caused_by 的简报调用另计次数和金额，不并进已归因合计。"""
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
        "llm_string_cost",
        payload={"purpose": "project_brief", "cost": "0.25", "success": True},
    )
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        "llm_bad_cost",
        payload={"purpose": "project_brief", "cost": "nope", "success": True},
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
    assert metrics["attribution"]["unattributed_project_brief_calls"] == 4
    assert metrics["attribution"]["unattributed_project_brief_cost"] == 2.15
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
    assert metrics["attribution"]["unattributed_project_brief_cost"] == "unavailable"


def _emit_execution(kernel, execution_id: str, correlation: str) -> None:
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        execution_id,
        payload={"execution_id": execution_id, "correlation_id": correlation},
        correlation_id=correlation,
    )


def _emit_crash_retry(kernel, execution_id: str, correlation: str, attempt: int) -> None:
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


def _emit_brief_cost(kernel, caused_by: str | None, cost: float, aggregate_id: str) -> None:
    kwargs = {}
    if caused_by is not None:
        kwargs["caused_by"] = caused_by
    kernel.emit_event(
        "LLMCallRecorded",
        "llm_call",
        aggregate_id,
        payload={"purpose": "project_brief", "cost": cost, "success": True},
        **kwargs,
    )


def test_each_delivery_keeps_its_own_model_cost(isolated_kernel):
    """One version's money and recoveries stay on that execution_id."""
    kernel, _db = isolated_kernel
    _emit_execution(kernel, "exec-v1", "corr-v1")
    _emit_crash_retry(kernel, "exec-v1", "corr-v1", 1)
    kernel.emit_event(
        "CapabilityFailed",
        "capability",
        "cap_v1",
        payload={"name": "check_inbox", "error": "interrupted_before_audit"},
        correlation_id="corr-v1",
    )
    _emit_brief_cost(kernel, "exec-v1", 0.2, "llm-v1")
    _emit_execution(kernel, "exec-v2", "corr-v2")
    _emit_crash_retry(kernel, "exec-v2", "corr-v2", 1)
    _emit_crash_retry(kernel, "exec-v2", "corr-v2", 2)
    _emit_brief_cost(kernel, "exec-v2", 1.25, "llm-v2")
    _emit_brief_cost(kernel, None, 4.5, "llm-unlinked")
    _emit_execution(kernel, "exec-other", "corr-other")
    _emit_crash_retry(kernel, "exec-other", "corr-other", 1)
    _emit_brief_cost(kernel, "exec-other", 9.0, "llm-other")

    task = _create_task("分版本成本")
    v1 = publish_delivery(
        task["id"], content="v1", summary="v1", sources=[], execution_id="exec-v1",
    )
    publish_delivery(
        task["id"], content="v2", summary="v2", sources=[], execution_id="exec-v2",
    )

    bundle = public_bundle(task["id"])
    assert bundle["current"]["execution_id"] == "exec-v2"
    assert bundle["current"]["model_cost"] == {
        "llm_cost": 1.25,
        "recovery_interventions": 2,
    }
    listed_v1 = next(row for row in bundle["deliveries"] if row["delivery_id"] == v1["delivery_id"])
    assert listed_v1["model_cost"] == {
        "llm_cost": 0.2,
        "recovery_interventions": 1,
    }
    assert get_delivery(task["id"], v1["delivery_id"])["model_cost"] == listed_v1["model_cost"]

    metrics = summarize_delivery_metrics(days=30)
    assert metrics["attribution"]["llm_cost"] == 1.45
    assert metrics["attribution"]["recovery_interventions"] == 3
    assert metrics["attribution"]["unattributed_project_brief_cost"] == 4.5
    assert metrics["attribution"]["unattributed_project_brief_calls"] == 1


def test_delivery_model_cost_stays_unavailable_when_read_is_capped(isolated_kernel, monkeypatch):
    monkeypatch.setattr("app.product.work_delivery._DELIVERY_MODEL_COST_LIMIT", 1)
    kernel, _db = isolated_kernel
    _emit_execution(kernel, "exec-capped-delivery", "corr-capped-delivery")
    _emit_crash_retry(kernel, "exec-capped-delivery", "corr-capped-delivery", 1)
    _emit_brief_cost(kernel, "exec-capped-delivery", 0.2, "llm-capped-linked")
    _emit_brief_cost(kernel, None, 4.5, "llm-capped-unlinked")

    task = _create_task("读满的交付成本")
    published = publish_delivery(
        task["id"], content="v1", summary="v1", sources=[],
        execution_id="exec-capped-delivery",
    )
    cost = public_bundle(task["id"])["current"]["model_cost"]
    assert cost == {
        "llm_cost": "unavailable",
        "recovery_interventions": "unavailable",
    }
    assert get_delivery(task["id"], published["delivery_id"])["model_cost"] == cost
    assert cost["llm_cost"] != 0
    assert cost["llm_cost"] != 0.2
    assert cost["llm_cost"] != 4.5
    assert cost["recovery_interventions"] != 0


def test_delivery_without_execution_does_not_absorb_unattributed_cost(isolated_kernel):
    kernel, _db = isolated_kernel
    _emit_brief_cost(kernel, None, 3.0, "llm-orphan")
    _emit_execution(kernel, "exec-elsewhere", "corr-elsewhere")
    _emit_crash_retry(kernel, "exec-elsewhere", "corr-elsewhere", 1)
    _emit_brief_cost(kernel, "exec-elsewhere", 2.0, "llm-elsewhere")

    task = _create_task("没有执行号")
    published = publish_delivery(task["id"], content="v1", summary="v1", sources=[])
    assert published["model_cost"] == {
        "llm_cost": 0.0,
        "recovery_interventions": 0,
    }
    assert public_bundle(task["id"])["current"]["model_cost"] == published["model_cost"]


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


def test_rerun_same_brief_reexecutes_without_a_review_decision(isolated_kernel):
    """再次运行同一份已完成简报：不记评审，下一版仍对照上一版。"""
    k, _db = isolated_kernel
    item = _brief_task_with_steps()
    work_id = item["id"]
    plan_before = item["executable_plan"]
    v1 = publish_delivery(
        work_id,
        content="第一期正文",
        summary="第一期",
        sources=[{"id": "email:a", "type": "email", "title": "来信"}],
        execution_id="rerun-v1",
    )

    from app.core.runtime.plan_resume import (
        load_plan_progress,
        lookup_action_step_success,
        peek_plan_resume,
        record_step_success,
        rerun_stash_key,
        save_plan_progress,
    )

    save_plan_progress(
        work_id, resume_from=2, previous_output={"step_1_output": "ok"}, kernel=k,
    )
    record_step_success("corr-rerun", 0, "step-ok", action_id=work_id, kernel=k)

    result = rerun_project_brief(work_id)
    assert result["supersedes_delivery_id"] == v1["delivery_id"]
    assert result["work"]["status"] == "running"
    assert load_plan_progress(work_id, kernel=k) is None
    assert lookup_action_step_success(work_id, 0, kernel=k) is None
    assert peek_plan_resume(rerun_stash_key(work_id), kernel=k) is None
    stored = read_ports.query_work_item(work_id)
    assert stored is not None
    assert stored["executable_plan"] == plan_before
    assert "rework_notes" not in stored["executable_plan"]

    decisions = k.read_events(type="WorkItemUpdated", aggregate_id=work_id)
    assert all(
        "delivery_decision" not in (event.payload or {})
        for event in decisions
    )
    assert len(k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}")) == 1

    with pytest.raises(DeliveryConflictError):
        rerun_project_brief(work_id)

    v2 = publish_delivery(
        work_id,
        content="第二期正文",
        summary="第二期",
        sources=[{"id": "email:b", "type": "email", "title": "新来信"}],
        execution_id="rerun-v2",
    )
    delta = v2["changes_from_previous"]
    assert delta["previous_delivery_id"] == v1["delivery_id"]
    assert delta["previous_version"] == 1
    assert delta["content_changed"] is True
    assert delta["summary_changed"] is True
    assert "第一期正文" not in str(delta)
    bundle = public_bundle(work_id)
    assert bundle["current_review_status"] == "unreviewed"
    assert bundle["current"]["version"] == 2


def _status_names(kernel, work_id: str) -> list[str]:
    return [
        str((event.payload or {}).get("status") or "")
        for event in kernel.read_events(
            type="WorkItemStatusChanged",
            aggregate_id=work_id,
        )
    ]


def _seed_rerun_progress(kernel, work_id: str) -> None:
    from app.core.runtime.plan_resume import record_step_success, save_plan_progress

    save_plan_progress(
        work_id, resume_from=2, previous_output={"step_1_output": "ok"}, kernel=kernel,
    )
    record_step_success("corr-rerun", 0, "step-ok", action_id=work_id, kernel=kernel)


def _assert_rerun_progress(kernel, work_id: str) -> None:
    from app.core.runtime.plan_resume import (
        load_plan_progress,
        lookup_action_step_success,
        lookup_step_success,
        peek_plan_resume,
        rerun_stash_key,
    )

    progress = load_plan_progress(work_id, kernel=kernel)
    assert progress is not None
    assert progress.resume_from == 2
    assert progress.previous_output == {"step_1_output": "ok"}
    assert lookup_action_step_success(work_id, 0, kernel=kernel) == "step-ok"
    assert lookup_step_success("corr-rerun", 0, kernel=kernel) == "step-ok"
    assert peek_plan_resume(rerun_stash_key(work_id), kernel=kernel) is None


def test_rerun_rejects_unexecutable_plan_without_reopening(isolated_kernel):
    """计划在打开前就不能执行时，不改已完成状态，也不清进度。"""
    k, _db = isolated_kernel
    item = read_ports.create_work_item(
        "坏步骤简报",
        work_type="task",
        executable_plan=(
            '{"kind":"project_brief","contract":{"contract_version":1,'
            '"output_kind":"project_brief"},"steps":["bad"]}'
        ),
        status="completed",
    )
    work_id = item["id"]
    published = publish_delivery(
        work_id, content="第一期", summary="第一期", sources=[],
        execution_id="rerun-bad-plan",
    )
    _seed_rerun_progress(k, work_id)
    before = _status_names(k, work_id)

    with pytest.raises(DeliveryValidationError, match="no steps"):
        rerun_project_brief(work_id)

    stored = read_ports.query_work_item(work_id)
    assert stored is not None
    assert stored["status"] == "completed"
    assert _status_names(k, work_id) == before
    assert fold_delivery_history(work_id)["current"]["delivery_id"] == published["delivery_id"]
    assert k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}") == []
    _assert_rerun_progress(k, work_id)


def test_rerun_restores_completed_delivery_when_execute_request_fails(isolated_kernel, monkeypatch):
    """执行请求在重新打开之后失败时，收回 completed，当前交付和计划进度都还在。"""
    k, _db = isolated_kernel
    item = _brief_task_with_steps()
    work_id = item["id"]
    published = publish_delivery(
        work_id, content="第一期", summary="第一期", sources=[],
        execution_id="rerun-emit-fail",
    )
    _seed_rerun_progress(k, work_id)
    original = k.emit_event

    def drop_execute(*args, **kwargs):
        event_type = kwargs.get("type")
        if event_type is None and args:
            event_type = args[0]
        if event_type == "ExecuteRequested":
            raise RuntimeError("execute request dropped")
        return original(*args, **kwargs)

    monkeypatch.setattr(k, "emit_event", drop_execute)

    with pytest.raises(RuntimeError, match="execute request dropped"):
        rerun_project_brief(work_id)

    stored = read_ports.query_work_item(work_id)
    assert stored is not None
    assert stored["status"] == "completed"
    assert "rework_notes" not in stored["executable_plan"]
    assert fold_delivery_history(work_id)["current"]["delivery_id"] == published["delivery_id"]
    assert k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}") == []
    assert _status_names(k, work_id)[-2:] == ["running", "completed"]
    restored = k.read_events(type="WorkItemStatusChanged", aggregate_id=work_id)
    pending = [event for event in restored if event.payload.get("status") == "pending"]
    assert pending[-1].payload.get("reason") == "rerun_restore"
    assert restored[-1].payload.get("reason") == "rerun_restore"
    _assert_rerun_progress(k, work_id)
    assert [row["work_id"] for row in list_rerunnable_briefs()] == [work_id]


def test_rerun_restores_completed_when_progress_clear_fails(isolated_kernel, monkeypatch):
    """清理执行游标失败发生在派发前，简报不能留在 pending。"""
    k, _db = isolated_kernel
    item = _brief_task_with_steps()
    work_id = item["id"]
    published = publish_delivery(
        work_id, content="第一期", summary="第一期", sources=[],
        execution_id="rerun-progress-clear-fail",
    )

    def fail_clear(*args, **kwargs):
        raise RuntimeError("progress storage unavailable")

    monkeypatch.setattr(read_ports, "reset_work_item_plan_progress", fail_clear)

    with pytest.raises(RuntimeError, match="progress storage unavailable"):
        rerun_project_brief(work_id)

    stored = read_ports.query_work_item(work_id)
    assert stored is not None
    assert stored["status"] == "completed"
    assert fold_delivery_history(work_id)["current"]["delivery_id"] == published["delivery_id"]
    assert k.read_events(
        type="ExecuteRequested", aggregate_id=f"exec_{work_id}",
    ) == []
    restored = k.read_events(type="WorkItemStatusChanged", aggregate_id=work_id)
    assert restored[-2].payload.get("status") == "pending"
    assert restored[-2].payload.get("reason") == "rerun_restore"
    assert restored[-1].payload.get("reason") == "rerun_restore"


def test_rerun_restore_does_not_mark_other_pending_tasks_running(isolated_kernel, monkeypatch):
    """依赖钩子已订阅时，收回 completed 不把无关待办或后继标成运行中。"""
    from app.core.runtime.cron_registry import _on_work_item_status_changed

    k, _db = isolated_kernel
    unsub = k.subscribe_events(_on_work_item_status_changed, type="WorkItemStatusChanged")
    try:
        item = _brief_task_with_steps()
        work_id = item["id"]
        publish_delivery(
            work_id, content="第一期", summary="第一期", sources=[],
            execution_id="rerun-hook",
        )
        unrelated = read_ports.create_work_item("无关待办", work_type="task")
        dependent = read_ports.create_work_item(
            "后继待办", work_type="task", dependencies=[work_id],
        )
        original = k.emit_event

        def drop_execute(*args, **kwargs):
            event_type = kwargs.get("type")
            if event_type is None and args:
                event_type = args[0]
            if event_type == "ExecuteRequested":
                raise RuntimeError("execute request dropped")
            return original(*args, **kwargs)

        monkeypatch.setattr(k, "emit_event", drop_execute)

        with pytest.raises(RuntimeError, match="execute request dropped"):
            rerun_project_brief(work_id)
    finally:
        unsub()

    assert read_ports.query_work_item(work_id)["status"] == "completed"
    assert read_ports.query_work_item(unrelated["id"])["status"] == "pending"
    assert read_ports.query_work_item(dependent["id"])["status"] == "pending"
    assert _status_names(k, unrelated["id"]) == []
    assert _status_names(k, dependent["id"]) == []
    restored = k.read_events(type="WorkItemStatusChanged", aggregate_id=work_id)
    assert restored[-1].payload.get("status") == "completed"
    assert restored[-1].payload.get("reason") == "rerun_restore"


def test_rework_restores_completed_when_execute_fails_after_stash(isolated_kernel, monkeypatch):
    """返工清游标之后执行请求失败时，收回 completed，并放回计划游标。"""
    from app.core.runtime.cron_registry import _on_work_item_status_changed
    from app.core.runtime.read_ports.events import _is_completion

    k, _db = isolated_kernel
    monkeypatch.setattr("app.core.runtime.cron_registry.kernel", k)
    monkeypatch.setattr("app.core.runtime.work_item_engine.kernel", k)
    unsub = k.subscribe_events(_on_work_item_status_changed, type="WorkItemStatusChanged")
    try:
        item = _brief_task_with_steps()
        work_id = item["id"]
        published = publish_delivery(
            work_id, content="第一期", summary="第一期", sources=[],
            execution_id="rework-emit-fail",
        )
        _seed_rerun_progress(k, work_id)
        successor = read_ports.create_work_item(
            "后继待办", work_type="task", dependencies=[work_id],
        )

        def drop_execute(_work_id: str):
            raise RuntimeError("execute request dropped")

        monkeypatch.setattr(read_ports, "request_work_item_execute", drop_execute)

        with pytest.raises(RuntimeError, match="execute request dropped"):
            request_rework(
                work_id, published["delivery_id"], reason="需要补风险",
                idempotency_key="rework-stash-fail",
            )
    finally:
        unsub()

    stored = read_ports.query_work_item(work_id)
    assert stored is not None
    assert stored["status"] == "completed"
    assert k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}") == []
    restored = k.read_events(type="WorkItemStatusChanged", aggregate_id=work_id)
    assert restored[-2].payload.get("status") == "pending"
    assert restored[-2].payload.get("reason") == "rework_restore"
    assert restored[-1].payload.get("status") == "completed"
    assert restored[-1].payload.get("reason") == "rework_restore"
    assert restored[-1].payload.get("reason") != "rerun_restore"
    assert _is_completion(restored[-1]) is False
    _assert_rerun_progress(k, work_id)
    assert read_ports.query_work_item(successor["id"])["status"] == "pending"
    assert _status_names(k, successor["id"]) == []


def test_rework_restores_failed_when_execute_fails_after_stash(isolated_kernel, monkeypatch):
    """打开前是 failed 时，执行请求失败收回 failed，而不是 completed。"""
    k, _db = isolated_kernel
    item = _brief_task_with_steps()
    work_id = item["id"]
    published = publish_delivery(
        work_id, content="第一期", summary="第一期", sources=[],
        execution_id="rework-failed-emit",
    )
    k.emit_event(
        "WorkItemStatusChanged", "work_item", work_id,
        payload={"status": "failed"}, actor="executor",
    )
    _seed_rerun_progress(k, work_id)

    def drop_execute(_work_id: str):
        raise RuntimeError("execute request dropped")

    monkeypatch.setattr(read_ports, "request_work_item_execute", drop_execute)
    with pytest.raises(RuntimeError, match="execute request dropped"):
        request_rework(
            work_id, published["delivery_id"], reason="需要补风险",
            idempotency_key="rework-failed-stash",
        )

    stored = read_ports.query_work_item(work_id)
    assert stored is not None
    assert stored["status"] == "failed"
    restored = k.read_events(type="WorkItemStatusChanged", aggregate_id=work_id)
    assert restored[-1].payload.get("status") == "failed"
    assert restored[-1].payload.get("reason") == "rework_restore"
    assert restored[-1].payload.get("reason") != "rerun_restore"
    _assert_rerun_progress(k, work_id)
    assert k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}") == []
    folded = fold_delivery_history(work_id)
    assert folded["_rework_withdrawn"] is True
    assert folded["current_review_status"] == "unreviewed"
    assert public_bundle(work_id)["current"]["latest_decision"] is None


def test_rework_retry_restores_stashed_open_without_executing(isolated_kernel, monkeypatch):
    """进程死在暂存之后时，再次提交同一返工只收回，不再派发。"""
    from app.core.runtime.plan_resume import take_plan_resumes_for_work_item

    k, _db = isolated_kernel
    item = _brief_task_with_steps()
    work_id = item["id"]
    published = publish_delivery(
        work_id, content="第一期", summary="第一期", sources=[],
        execution_id="rework-retry-open",
    )
    _seed_rerun_progress(k, work_id)
    k.emit_event(
        "WorkItemStatusChanged", "work_item", work_id,
        payload={"status": "pending", "reason": "rework_restore"},
        actor="user",
    )
    assert take_plan_resumes_for_work_item(work_id, kernel=k)

    def boom(_work_id: str):
        raise AssertionError("execute should not run")

    monkeypatch.setattr(read_ports, "request_work_item_execute", boom)
    monkeypatch.setattr(read_ports, "ensure_work_item_execute_requested", boom)

    result = request_rework(
        work_id, published["delivery_id"], reason="需要补风险",
        idempotency_key="rework-retry-stash",
    )
    assert result["restored_status"] == "completed"
    assert result["work"]["status"] == "completed"
    restored = k.read_events(type="WorkItemStatusChanged", aggregate_id=work_id)
    assert restored[-1].payload.get("status") == "completed"
    assert restored[-1].payload.get("reason") == "rework_restore"
    assert restored[-1].payload.get("reason") != "rerun_restore"
    _assert_rerun_progress(k, work_id)
    assert k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}") == []


def test_withdrawn_rework_is_not_presented_as_in_progress(isolated_kernel, monkeypatch):
    """收回后的 changes_requested 不再当成正在返工，当前交付回到待验收。"""
    k, _db = isolated_kernel
    item = _brief_task_with_steps()
    work_id = item["id"]
    published = publish_delivery(
        work_id, content="第一期", summary="第一期", sources=[],
        execution_id="rework-present",
    )
    _seed_rerun_progress(k, work_id)

    def drop_execute(_work_id: str):
        raise RuntimeError("execute request dropped")

    monkeypatch.setattr(read_ports, "request_work_item_execute", drop_execute)
    with pytest.raises(RuntimeError, match="execute request dropped"):
        request_rework(
            work_id, published["delivery_id"], reason="需要补风险",
            idempotency_key="rework-present",
        )

    folded = fold_delivery_history(work_id)
    assert folded["_rework_withdrawn"] is True
    assert folded["current_review_status"] == "unreviewed"
    assert folded["current"]["review_status"] == "unreviewed"
    assert folded["current"]["latest_decision"] is None
    assert folded["deliveries"][-1]["review_status"] == "unreviewed"
    assert folded["deliveries"][-1]["latest_decision"] is None
    assert folded["latest_decision"]["decision"] == "changes_requested"
    assert folded["latest_decision"]["reason"] == "需要补风险"
    bundle = public_bundle(work_id)
    assert bundle["current_review_status"] == "unreviewed"
    single = get_delivery(work_id, published["delivery_id"])
    assert single["review_status"] == "unreviewed"
    assert single["latest_decision"] is None

    accepted = accept_delivery(
        work_id, published["delivery_id"], reason="可以留下",
        idempotency_key="after-withdraw",
    )
    assert accepted["bundle"]["current_review_status"] == "accepted"
    assert accepted["bundle"]["current"]["latest_decision"]["reason"] == "可以留下"


def test_half_open_rework_pending_is_not_presented_as_in_progress(isolated_kernel):
    """打开之后还没有 ExecuteRequested 时，也不显示成正在返工。"""
    k, _db = isolated_kernel
    item = _brief_task_with_steps()
    work_id = item["id"]
    published = publish_delivery(
        work_id, content="第一期", summary="第一期", sources=[],
        execution_id="rework-open-present",
    )
    request_rework(
        work_id, published["delivery_id"], reason="需要补风险",
        idempotency_key="rework-open-present", dispatch=False,
    )
    k.emit_event(
        "WorkItemStatusChanged", "work_item", work_id,
        payload={"status": "pending", "reason": "rework_restore"},
        actor="user",
    )
    folded = fold_delivery_history(work_id)
    assert folded["_rework_withdrawn"] is True
    assert folded["current_review_status"] == "unreviewed"
    assert public_bundle(work_id)["current"]["review_status"] == "unreviewed"
    assert k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}") == []


def test_dispatched_rework_stays_changes_requested(isolated_kernel):
    """ExecuteRequested 落在返工打开之后时，当前交付仍是已要求返工。"""
    k, _db = isolated_kernel
    item = _brief_task_with_steps()
    work_id = item["id"]
    published = publish_delivery(
        work_id, content="第一期", summary="第一期", sources=[],
        execution_id="rework-dispatched-present",
    )
    request_rework(
        work_id, published["delivery_id"], reason="需要补风险",
        idempotency_key="rework-dispatched-present",
    )
    assert k.read_events(type="ExecuteRequested", aggregate_id=f"exec_{work_id}")
    folded = fold_delivery_history(work_id)
    assert folded["_rework_withdrawn"] is False
    assert folded["current_review_status"] == "changes_requested"
    assert folded["current"]["latest_decision"]["reason"] == "需要补风险"
    assert public_bundle(work_id)["current_review_status"] == "changes_requested"


def test_rerun_same_brief_rejects_missing_delivery_and_other_work(isolated_kernel):
    item = _brief_task_with_steps()
    with pytest.raises(DeliveryValidationError, match="还没有可对照的交付"):
        rerun_project_brief(item["id"])

    other = read_ports.create_work_item(
        "普通任务",
        work_type="task",
        executable_plan='{"steps":[{"tool":"echo","params":{}}]}',
        status="completed",
    )
    with pytest.raises(DeliveryValidationError, match="只有项目简报"):
        rerun_project_brief(other["id"])

    failed = _brief_task_with_steps()
    publish_delivery(
        failed["id"],
        content="v",
        summary="v",
        sources=[],
        execution_id="rerun-failed",
    )
    read_ports.update_work_item_status(failed["id"], "pending")
    read_ports.update_work_item_status(failed["id"], "running")
    read_ports.update_work_item_status(failed["id"], "failed")
    with pytest.raises(DeliveryConflictError, match="只有已完成"):
        rerun_project_brief(failed["id"])

    with pytest.raises(DeliveryNotFoundError):
        rerun_project_brief("missing-brief")


def test_list_rerunnable_briefs_keeps_completed_briefs_with_a_delivery(isolated_kernel):
    ready = _brief_task_with_steps()
    published = publish_delivery(
        ready["id"],
        content="正文",
        summary="摘要",
        sources=[],
        execution_id="list-ready",
    )
    bare = read_ports.create_work_item(
        "还没有交付",
        work_type="task",
        executable_plan=ready["executable_plan"],
        status="completed",
    )
    plain = read_ports.create_work_item(
        "普通任务",
        work_type="task",
        executable_plan='{"steps":[{"tool":"echo","params":{}}]}',
        status="completed",
    )
    pending = read_ports.create_work_item(
        "还在进行",
        work_type="task",
        executable_plan=ready["executable_plan"],
    )
    publish_delivery(
        pending["id"],
        content="进行中",
        summary="进行中",
        sources=[],
        execution_id="list-pending",
    )

    rows = list_rerunnable_briefs()
    assert [row["work_id"] for row in rows] == [ready["id"]]
    assert rows[0]["title"] == "项目简报"
    assert rows[0]["version"] == 1
    assert rows[0]["delivery_id"] == published["delivery_id"]
    assert bare["id"] not in {row["work_id"] for row in rows}
    assert plain["id"] not in {row["work_id"] for row in rows}
    assert pending["id"] not in {row["work_id"] for row in rows}
