"""Integration tests for data sovereignty system API."""

from fastapi.testclient import TestClient


def test_local_models_lists_only_what_is_installed(client: TestClient, monkeypatch):
    monkeypatch.setattr(
        "app.core.agents.llm_failover.fetch_installed_model_names",
        lambda base_url, timeout=1.5: ["llama3.2:3b"],
    )
    body = client.get("/api/system/local-models").json()
    assert body["reachable"] is True
    assert body["installed"] == ["llama3.2:3b"]
    assert body["recommended"] == "qwen2.5:3b"
    assert body["selected"] == "llama3.2:3b"
    assert "还没有 qwen2.5:3b" in body["message"]


def test_pull_rejects_a_model_other_than_the_recommended_one(client: TestClient):
    response = client.post("/api/system/local-models/pull", json={"name": "qwen2.5:7b"})
    assert response.status_code == 400
    assert "qwen2.5:3b" in response.json()["detail"]


def test_export_requires_confirm(client: TestClient):
    r = client.post("/api/system/export", json={})
    assert r.status_code == 400
    assert "EXPORT_ALL_DATA" in r.json()["detail"]


def test_export_with_confirm(client: TestClient):
    r = client.post(
        "/api/system/export",
        json={"confirm": "EXPORT_ALL_DATA"},
    )
    assert r.status_code == 200
    assert "attachment" in r.headers.get("content-disposition", "")
    data = r.json()
    assert data["format"] == "snapshot"
    assert "event_log" in data


def test_export_stream_matches_snapshot_wire_format(client: TestClient):
    """Streamed plaintext export must parse to the same schema as snapshot()."""
    from app.core.runtime.kernel_instance import kernel

    kernel.emit_event(
        "NotificationCreated",
        "notification",
        "exp_stream_1",
        payload={"title": "stream-me"},
    )
    streamed = client.post(
        "/api/system/export",
        json={"confirm": "EXPORT_ALL_DATA"},
    ).json()
    snap = kernel.snapshot()
    assert streamed["format"] == snap["format"]
    assert streamed["counts"]["event_log"] == snap["counts"]["event_log"]
    assert [e["id"] for e in streamed["event_log"]] == [e["id"] for e in snap["event_log"]]
    assert len(streamed["conversations"]) == len(snap["conversations"])
    assert len(streamed["messages"]) == len(snap["messages"])


def test_import_read_only_validate(client: TestClient):
    export = client.post(
        "/api/system/export",
        json={"confirm": "EXPORT_ALL_DATA"},
    ).json()
    r = client.post(
        "/api/system/import",
        json={"data": export, "read_only": True},
    )
    assert r.status_code == 200


def test_import_write_requires_confirm(authed_client: TestClient):
    export = authed_client.post(
        "/api/system/export",
        json={"confirm": "EXPORT_ALL_DATA"},
    ).json()
    r = authed_client.post(
        "/api/system/import",
        json={"data": export, "read_only": False},
        headers={"Authorization": "Bearer test-secret"},
    )
    assert r.status_code == 400
    assert "DESTROY_AND_IMPORT" in r.json()["detail"]


def test_import_write_without_auth_token_allowed_with_confirm(client: TestClient, monkeypatch):
    """When AUTH_TOKEN is unset, confirm code alone gates write import."""
    seen: dict[str, object] = {}

    def fake_import(snapshot, read_only=True):
        seen["read_only"] = read_only
        return {"status": "imported", "read_only": read_only}

    monkeypatch.setattr("app.api.system.kernel.restore", fake_import)
    r = client.post(
        "/api/system/import",
        json={"data": {}, "read_only": False, "confirm": "DESTROY_AND_IMPORT"},
    )
    assert r.status_code == 200
    assert seen["read_only"] is False


def test_import_write_with_confirm(authed_client: TestClient, monkeypatch):
    export = authed_client.post(
        "/api/system/export",
        json={"confirm": "EXPORT_ALL_DATA"},
    ).json()
    seen: dict[str, object] = {}

    def fake_import(snapshot, read_only=True):
        seen["read_only"] = read_only
        seen["snapshot"] = snapshot
        return {"status": "imported", "read_only": read_only}

    monkeypatch.setattr("app.api.system.kernel.restore", fake_import)
    r = authed_client.post(
        "/api/system/import",
        json={
            "data": export,
            "read_only": False,
            "confirm": "DESTROY_AND_IMPORT",
        },
        headers={"Authorization": "Bearer test-secret"},
    )
    assert r.status_code == 200
    assert seen["read_only"] is False
    assert seen["snapshot"] == export


def test_destroy_requires_confirm(authed_client: TestClient):
    r = authed_client.request(
        "DELETE",
        "/api/system/data",
        json={"confirm": "WRONG"},
        headers={"Authorization": "Bearer test-secret"},
    )
    assert r.status_code == 400
    assert "DESTROY_ALL_DATA" in r.json()["detail"]


def test_destroy_without_auth_token_allowed_with_confirm(client: TestClient, monkeypatch):
    """When AUTH_TOKEN is unset, confirm code alone gates destroy."""
    monkeypatch.setattr(
        "app.api.system.kernel.erase",
        lambda: {"status": "destroyed", "message": "test"},
    )
    r = client.request(
        "DELETE",
        "/api/system/data",
        json={"confirm": "DESTROY_ALL_DATA"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "destroyed"


def test_destroy_success_with_confirm(authed_client: TestClient, monkeypatch):
    monkeypatch.setattr(
        "app.api.system.kernel.erase",
        lambda: {"status": "destroyed", "message": "test"},
    )
    r = authed_client.request(
        "DELETE",
        "/api/system/data",
        json={"confirm": "DESTROY_ALL_DATA"},
        headers={"Authorization": "Bearer test-secret"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "destroyed"


def test_diagnostics_bundle_omits_mail_file_and_secrets(client: TestClient, monkeypatch):
    import logging

    monkeypatch.setattr(
        "app.core.runtime.runtime_config.runtime_config.get_llm_config",
        lambda masked=True: {
            "default_provider": "cloud",
            "providers": [{
                "id": "cloud",
                "name": "Cloud",
                "type": "openai_compatible",
                "model": "x",
                "base_url": "https://example.test/v1",
                "api_key": "sk-live-secret123",
                "has_api_key": True,
                "enabled": True,
            }],
        },
    )
    monkeypatch.setattr(
        "app.core.runtime.runtime_config.runtime_config.get_email_config",
        lambda masked=True: {
            "user": "owner@example.com",
            "password": "app-password",
            "configured": True,
        },
    )

    def _metrics(days: int = 14):
        return {
            "window_days": days,
            "reviewed_tasks": 1,
            "accepted_tasks": 1,
            "success_rate": 1.0,
            "reviews": [{"title": "预算", "note": "西仓已出库三箱"}],
            "items": [{"title": "note.txt", "body": "东闸阀门已关闭"}],
            "capped": False,
        }

    monkeypatch.setattr(
        "app.product.work_delivery.summarize_delivery_metrics",
        _metrics,
    )
    logging.getLogger("diag.bundle").error(
        "password=s3cret mailbox=owner@example.com enc:v1:AAAASECRET"
    )

    response = client.get("/api/system/diagnostics")
    assert response.status_code == 200
    assert "diagnostics-" in response.headers.get("content-disposition", "")
    body = response.json()
    text = response.text
    assert body["kind"] == "support-bundle"
    assert body["versions"]["app"]
    assert body["settings"]["providers"][0]["model"] == "x"
    assert "api_key" not in body["settings"]["providers"][0]
    assert body["settings"]["email"] == {"configured": True, "needs_reentry": False, "reentry_reason": ""}
    assert "user" not in body["settings"]["email"]
    assert body["trial"]["success_rate"] == 1.0
    assert "reviews" not in body["trial"]
    assert "items" not in body["trial"]
    assert body["eval"]["stored_case_scores"] is False
    assert "total_calls" in body["eval"]["llm"]
    assert "sk-live" not in text
    assert "owner@example.com" not in text
    assert "app-password" not in text
    assert "s3cret" not in text
    assert "AAAASECRET" not in text
    assert "西仓已出库" not in text
    assert "东闸阀门" not in text


def test_health_includes_startup_diagnostics(client: TestClient):
    r = client.get("/api/system/health")
    assert r.status_code == 200
    data = r.json()
    assert data["service"] == "personal-ai-runtime"
    startup = data["startup"]
    assert startup is not None
    assert startup["status"] in ("ok", "degraded")
    storage = startup["checks"]["storage"]
    assert storage["data_dir_exists"] is True
    assert "data_dir" not in storage
    assert "warnings" not in startup
    assert "warning_count" in startup


def test_morning_brief_test_endpoint(client: TestClient, monkeypatch):
    """Diagnostic endpoint returns brief text + step timings without persisting."""
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_calendar_today_events",
        lambda: {"count": 0, "events": []},
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_active_goals",
        lambda limit=10: [],
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_inbox_emails",
        lambda **kwargs: [],
    )
    r = client.post("/api/system/morning-brief/test")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["persisted"] is False
    assert "brief" in data
    assert data["brief"].startswith("早安！")
    assert "近 7 日 vs 前 7 日" in data["brief"]
    assert "完成目标" in data["brief"]
    assert "采纳率" in data["brief"]
    assert "steps_ms" in data
    assert "goals" in data["steps_ms"]
    assert "periods" in data["steps_ms"]


def test_morning_brief_test_persist_uses_dated_title(client: TestClient, monkeypatch):
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_calendar_today_events",
        lambda: {"count": 0, "events": []},
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_active_goals",
        lambda limit=10: [],
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_inbox_emails",
        lambda **kwargs: [],
    )
    pushed: list[tuple] = []

    def _fake_push(notif_type, title, content, **kwargs):
        pushed.append((notif_type, title, content, kwargs.get("dedup_key")))
        return {"id": "n1", "title": title}

    monkeypatch.setattr(
        "app.core.runtime.read_ports.push_notification",
        _fake_push,
    )
    r = client.post("/api/system/morning-brief/test?persist=true")
    assert r.status_code == 200
    data = r.json()
    assert data["persisted"] is True
    date_local = data["date_local"]
    assert pushed == [
        (
            "morning_brief",
            f"早安简报 - {date_local}",
            data["brief"],
            f"morning_brief:{date_local}",
        )
    ]


def test_health_full_startup_with_auth(authed_client: TestClient):
    r = authed_client.get(
        "/api/system/health",
        headers={"Authorization": "Bearer test-secret"},
    )
    assert r.status_code == 200
    startup = r.json()["startup"]
    assert startup is not None
    assert "warnings" in startup
    assert "data_dir" in startup["checks"]["storage"]


# --- Encrypted export/import confirm-code enforcement ---

def test_encrypted_export_requires_confirm(client: TestClient):
    r = client.post(
        "/api/system/export/encrypted",
        json={"password": "longpassword"},
    )
    assert r.status_code == 400
    assert "EXPORT_ALL_DATA" in r.json()["detail"]


def test_encrypted_import_requires_confirm(authed_client: TestClient):
    r = authed_client.post(
        "/api/system/import/encrypted",
        json={"data": "blob", "password": "longpassword"},
        headers={"Authorization": "Bearer test-secret"},
    )
    assert r.status_code == 400
    assert "DESTROY_AND_IMPORT" in r.json()["detail"]


def test_encrypted_import_wrong_confirm_rejected(authed_client: TestClient):
    r = authed_client.post(
        "/api/system/import/encrypted",
        json={
            "data": "blob",
            "password": "longpassword",
            "confirm": "WRONG_CODE",
        },
        headers={"Authorization": "Bearer test-secret"},
    )
    assert r.status_code == 400
    assert "DESTROY_AND_IMPORT" in r.json()["detail"]


def test_destructive_ops_rejected_by_middleware_when_auth_configured(authed_client: TestClient):
    """When AUTH_TOKEN is set, missing Bearer is rejected before the handler."""
    from app.core.rate_limit import reset_rate_limits

    r = authed_client.request(
        "DELETE",
        "/api/system/data",
        json={"confirm": "DESTROY_ALL_DATA"},
    )
    assert r.status_code == 401
    reset_rate_limits()
    r2 = authed_client.post(
        "/api/system/import",
        json={"data": {}, "read_only": False, "confirm": "DESTROY_AND_IMPORT"},
    )
    assert r2.status_code == 401
    reset_rate_limits()
    r3 = authed_client.post(
        "/api/system/import/encrypted",
        json={"data": "blob", "password": "longpassword", "confirm": "DESTROY_AND_IMPORT"},
    )
    assert r3.status_code == 401
