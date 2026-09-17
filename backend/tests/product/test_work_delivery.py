"""T0: delivery/acceptance facts survive restart and rebuild on the Work aggregate."""

from __future__ import annotations

import pytest

from app.core.runtime import read_ports
from app.product.work_delivery import (
    DeliveryConflictError,
    DeliveryValidationError,
    accept_delivery,
    fold_delivery_history,
    publish_delivery,
    request_rework,
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
