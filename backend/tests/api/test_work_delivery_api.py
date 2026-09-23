"""API contract for project-brief create / delivery accept / rework."""

from __future__ import annotations

import json

from app.core.runtime import read_ports
from app.product.work_delivery import publish_delivery, request_rework


def test_create_project_brief_keeps_readable_objective(client):
    r = client.post("/api/work-items/project-brief", json={
        "title": "项目 A 简报",
        "objective": "整理最近三天邮件，列出变化和风险",
        "source_scope": {
            "email": {"enabled": True, "query": "项目A", "days": 3},
            "files": [{"path": "C:/tmp/notes.md", "label": "notes"}],
        },
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["work_type"] == "task"
    assert body["description"] == "整理最近三天邮件，列出变化和风险"
    assert "project_brief" in body["executable_plan"]
    assert "整理最近三天邮件" in body["executable_plan"]


def test_create_project_brief_requires_objective(client):
    r = client.post("/api/work-items/project-brief", json={
        "title": "X",
        "objective": "  ",
    })
    assert r.status_code == 400


def test_accept_rework_conflict_and_idempotency(client):
    created = client.post("/api/work-items/project-brief", json={
        "title": "简报",
        "objective": "列出变化",
        "source_scope": {"email": {"enabled": False}, "files": []},
    })
    work_id = created.json()["id"]
    v1 = publish_delivery(
        work_id,
        content="full-v1",
        summary="v1",
        sources=[],
        execution_id="e1",
        qualified=False,
    )
    v2 = publish_delivery(
        work_id,
        content="full-v2-longer-than-preview",
        summary="v2",
        sources=[],
        execution_id="e2",
        qualified=False,
    )

    listed = client.get(f"/api/work-items/{work_id}/deliveries")
    assert listed.status_code == 200
    bundle = listed.json()
    assert len(bundle["deliveries"]) == 2
    assert bundle["current"]["delivery_id"] == v2["delivery_id"]
    assert bundle["current"]["content"] == "full-v2-longer-than-preview"
    assert bundle["deliveries"][0]["changes_from_previous"] is None
    delta = bundle["current"]["changes_from_previous"]
    assert delta["previous_delivery_id"] == v1["delivery_id"]
    assert delta["previous_version"] == 1
    assert delta["summary_changed"] is True
    assert delta["content_changed"] is True
    assert "full-v1" not in str(delta)
    assert bundle["deliveries"][1]["changes_from_previous"]["content_changed"] is True

    detail = client.get(f"/api/work-items/{work_id}?include=deliveries")
    assert detail.json()["delivery_bundle"]["current"]["version"] == 2

    stale = client.post(
        f"/api/work-items/{work_id}/deliveries/{v1['delivery_id']}/accept",
        json={"idempotency_key": "a1"},
    )
    assert stale.status_code == 409

    first = client.post(
        f"/api/work-items/{work_id}/deliveries/{v2['delivery_id']}/accept",
        json={"idempotency_key": "a2"},
    )
    assert first.status_code == 200
    assert first.json()["replayed"] is False
    second = client.post(
        f"/api/work-items/{work_id}/deliveries/{v2['delivery_id']}/accept",
        json={"idempotency_key": "a2"},
    )
    assert second.status_code == 200
    assert second.json()["replayed"] is True

    opposite = client.post(
        f"/api/work-items/{work_id}/deliveries/{v2['delivery_id']}/rework",
        json={"reason": "再改", "idempotency_key": "r-opposite"},
    )
    assert opposite.status_code == 409

    empty_rework = client.post(
        f"/api/work-items/{work_id}/deliveries/{v2['delivery_id']}/rework",
        json={"reason": ""},
    )
    assert empty_rework.status_code == 400


def test_delivery_reads_include_rework_reason(client):
    created = client.post("/api/work-items/project-brief", json={
        "title": "简报",
        "objective": "列出变化",
    })
    work_id = created.json()["id"]
    v1 = publish_delivery(
        work_id,
        content="full-v1",
        summary="v1",
        sources=[],
        execution_id="e-reason",
    )
    request_rework(work_id, v1["delivery_id"], reason="需要补风险", dispatch=False)

    detail = client.get(f"/api/work-items/{work_id}?include=deliveries")
    assert detail.status_code == 200
    current = detail.json()["delivery_bundle"]["current"]
    assert current["latest_decision"]["reason"] == "需要补风险"
    assert current["review_status"] == "changes_requested"

    listed = client.get(f"/api/work-items/{work_id}/deliveries")
    assert listed.json()["deliveries"][0]["latest_decision"]["reason"] == "需要补风险"

    single = client.get(f"/api/work-items/{work_id}/deliveries/{v1['delivery_id']}")
    assert single.status_code == 200
    assert single.json()["latest_decision"]["reason"] == "需要补风险"
    assert single.json()["latest_decision"]["decision_id"] == current["latest_decision"]["decision_id"]


def test_delivery_reads_include_accept_reason(client):
    created = client.post("/api/work-items/project-brief", json={
        "title": "简报",
        "objective": "列出变化",
    })
    work_id = created.json()["id"]
    v1 = publish_delivery(
        work_id,
        content="full-v1",
        summary="v1",
        sources=[],
        execution_id="e-accept-note",
    )
    accepted = client.post(
        f"/api/work-items/{work_id}/deliveries/{v1['delivery_id']}/accept",
        json={"reason": "  来源齐全  ", "idempotency_key": "accept-note"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["decision"]["reason"] == "来源齐全"
    assert accepted.json()["decision"]["decision"] == "accepted"

    detail = client.get(f"/api/work-items/{work_id}?include=deliveries")
    assert detail.status_code == 200
    current = detail.json()["delivery_bundle"]["current"]
    assert current["latest_decision"]["reason"] == "来源齐全"
    assert current["review_status"] == "accepted"

    listed = client.get(f"/api/work-items/{work_id}/deliveries")
    assert listed.json()["deliveries"][0]["latest_decision"]["reason"] == "来源齐全"

    single = client.get(f"/api/work-items/{work_id}/deliveries/{v1['delivery_id']}")
    assert single.status_code == 200
    assert single.json()["latest_decision"]["reason"] == "来源齐全"
    assert single.json()["latest_decision"]["decision_id"] == current["latest_decision"]["decision_id"]


def test_old_task_without_delivery_endpoints(client):
    created = client.post("/api/work-items/", json={"title": "旧任务", "work_type": "task"})
    work_id = created.json()["id"]
    r = client.get(f"/api/work-items/{work_id}/deliveries")
    assert r.status_code == 200
    assert r.json()["current"] is None
    missing = client.get(f"/api/work-items/{work_id}/deliveries/nope")
    assert missing.status_code == 404


def test_adopt_suggested_action_returns_same_task(client):
    created = client.post("/api/work-items/project-brief", json={
        "title": "简报",
        "objective": "列出变化",
    })
    work_id = created.json()["id"]
    published = publish_delivery(
        work_id,
        content="full",
        summary="v1",
        sources=[],
        suggested_actions=[{"title": "核对排期", "reason": "延期", "source_ids": []}],
        execution_id="e-adopt",
    )
    path = (
        f"/api/work-items/{work_id}/deliveries/{published['delivery_id']}"
        "/actions/0/adopt"
    )
    first = client.post(path, json={"idempotency_key": "adopt-1"})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["replayed"] is False
    assert body["work"]["title"] == "核对排期"
    assert body["bundle"]["current"]["suggested_actions"][0]["adopted_work_id"] == body["work"]["id"]

    second = client.post(path, json={"idempotency_key": "adopt-1"})
    assert second.status_code == 200
    assert second.json()["replayed"] is True
    assert second.json()["work"]["id"] == body["work"]["id"]

    listed = client.get(f"/api/work-items/?parent_work_id={work_id}")
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [body["work"]["id"]]


def test_delivery_metrics_endpoint_reports_project_brief_reviews(client):
    created = client.post("/api/work-items/project-brief", json={
        "title": "指标简报", "objective": "列出变化",
    }).json()
    delivery = publish_delivery(
        created["id"], content="full", summary="v1", sources=[],
        execution_id="metric-api",
    )
    accepted = client.post(
        f"/api/work-items/{created['id']}/deliveries/{delivery['delivery_id']}/accept",
        json={"idempotency_key": "metric-api-accept"},
    )
    assert accepted.status_code == 200

    response = client.get("/api/work-items/delivery-metrics?days=30")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reviewed_tasks"] == 1
    assert body["first_version_acceptance_rate"] == 1.0
    assert body["items"][0]["work_id"] == created["id"]
    assert body["attribution"]["approval_interventions"] == 0
    assert body["attribution"]["recovery_interventions"] == 0
    assert body["attribution"]["llm_cost"] == 0.0
    assert body["attribution"]["unattributed_project_brief_calls"] == 0
    assert body["attribution"]["unattributed_project_brief_cost"] == 0.0


def test_repeat_timer_stores_the_existing_brief_id(client):
    created = client.post("/api/work-items/project-brief", json={
        "title": "周期简报",
        "objective": "列出变化",
    })
    assert created.status_code == 200, created.text
    work_id = created.json()["id"]
    publish_delivery(
        work_id,
        content="第一期",
        summary="第一期",
        sources=[],
        execution_id="api-repeat-v1",
    )
    read_ports.update_work_item_status(work_id, "completed")

    missing = client.post(
        "/api/work-items/missing-brief/repeat-timer",
        json={"hours": 1},
    )
    assert missing.status_code == 404

    empty = client.post(f"/api/work-items/{work_id}/repeat-timer", json={})
    assert empty.status_code == 400

    scheduled = client.post(
        f"/api/work-items/{work_id}/repeat-timer",
        json={"hours": 2, "minutes": 15},
    )
    assert scheduled.status_code == 200, scheduled.text
    body = scheduled.json()
    assert body["work_id"] == work_id
    timer = read_ports.query_timer(body["timer_id"])
    assert timer is not None
    payload = json.loads(timer["payload_json"])
    assert payload["work_id"] == work_id
    assert read_ports.query_work_item(work_id)["status"] == "completed"


def test_rerun_completed_brief_uses_the_same_work_item(client):
    created = client.post("/api/work-items/project-brief", json={
        "title": "周期简报",
        "objective": "列出变化",
        "source_scope": {"email": {"enabled": True, "query": "项目", "days": 3}},
    })
    assert created.status_code == 200, created.text
    work_id = created.json()["id"]
    delivery = publish_delivery(
        work_id,
        content="第一期",
        summary="第一期",
        sources=[],
        execution_id="api-rerun-v1",
    )
    read_ports.update_work_item_status(work_id, "completed")

    missing = client.post("/api/work-items/missing-brief/rerun")
    assert missing.status_code == 404

    first = client.post(f"/api/work-items/{work_id}/rerun")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["work_id"] == work_id
    assert body["supersedes_delivery_id"] == delivery["delivery_id"]
    assert body["work"]["status"] == "running"
    assert body["work"]["id"] == work_id

    second = client.post(f"/api/work-items/{work_id}/rerun")
    assert second.status_code == 409
