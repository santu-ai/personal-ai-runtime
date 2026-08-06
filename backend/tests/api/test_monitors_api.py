"""API tests for /api/monitors (inbox filters + URL monitors)."""


def test_inbox_filter_crud(client):
    r = client.get("/api/monitors/inbox-filters")
    assert r.status_code == 200
    assert r.json()["filters"] == []

    created = client.post("/api/monitors/inbox-filters", json={
        "name": "Acme",
        "sender_contains": "acme.com",
    })
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["name"] == "Acme"
    assert body["sender_contains"] == "acme.com"
    fid = body["id"]

    listed = client.get("/api/monitors/inbox-filters")
    assert len(listed.json()["filters"]) == 1

    patched = client.patch(f"/api/monitors/inbox-filters/{fid}", json={
        "subject_contains": "invoice",
        "enabled": False,
    })
    assert patched.status_code == 200
    assert patched.json()["subject_contains"] == "invoice"
    assert patched.json()["enabled"] is False

    deleted = client.delete(f"/api/monitors/inbox-filters/{fid}")
    assert deleted.status_code == 200
    assert client.get("/api/monitors/inbox-filters").json()["filters"] == []


def test_inbox_filter_requires_match_field(client):
    r = client.post("/api/monitors/inbox-filters", json={"name": "Empty"})
    assert r.status_code == 400


def test_inbox_filter_not_found(client):
    assert client.patch("/api/monitors/inbox-filters/missing", json={"name": "x", "sender_contains": "a"}).status_code == 404
    assert client.delete("/api/monitors/inbox-filters/missing").status_code == 404


def test_url_monitor_crud(client):
    r = client.get("/api/monitors/url-monitors")
    assert r.status_code == 200
    assert r.json()["monitors"] == []

    created = client.post("/api/monitors/url-monitors", json={
        "name": "Example",
        "url": "https://example.com/",
        "check_interval_minutes": 60,
    })
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["name"] == "Example"
    assert body["url"] == "https://example.com/"
    assert body["check_interval_minutes"] == 60
    mid = body["id"]

    listed = client.get("/api/monitors/url-monitors")
    assert len(listed.json()["monitors"]) == 1

    patched = client.patch(f"/api/monitors/url-monitors/{mid}", json={
        "enabled": False,
        "check_interval_minutes": 120,
    })
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False
    assert patched.json()["check_interval_minutes"] == 120

    deleted = client.delete(f"/api/monitors/url-monitors/{mid}")
    assert deleted.status_code == 200
    assert client.get("/api/monitors/url-monitors").json()["monitors"] == []


def test_url_monitor_rejects_bad_url(client):
    r = client.post("/api/monitors/url-monitors", json={
        "name": "Bad",
        "url": "not-a-url",
    })
    assert r.status_code == 400


def test_url_monitor_not_found(client):
    assert client.patch(
        "/api/monitors/url-monitors/missing",
        json={"name": "x", "url": "https://example.com/"},
    ).status_code == 404
    assert client.delete("/api/monitors/url-monitors/missing").status_code == 404


def test_url_monitor_check_endpoint(client, monkeypatch):
    async def fake_eval(*, force: bool = False, max_checks: int | None = None):
        assert force is True
        assert max_checks == 5
        return 2

    monkeypatch.setattr(
        "app.product.url_monitors.evaluate_url_monitors",
        fake_eval,
    )
    r = client.post("/api/monitors/url-monitors/check?force=true")
    assert r.status_code == 200
    assert r.json()["notified"] == 2
    assert r.json()["max_checks"] == 5
