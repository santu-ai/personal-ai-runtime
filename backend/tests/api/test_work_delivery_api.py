"""API contract for project-brief create / delivery accept / rework."""

from __future__ import annotations

from app.product.work_delivery import publish_delivery


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


def test_old_task_without_delivery_endpoints(client):
    created = client.post("/api/work-items/", json={"title": "旧任务", "work_type": "task"})
    work_id = created.json()["id"]
    r = client.get(f"/api/work-items/{work_id}/deliveries")
    assert r.status_code == 200
    assert r.json()["current"] is None
    missing = client.get(f"/api/work-items/{work_id}/deliveries/nope")
    assert missing.status_code == 404
