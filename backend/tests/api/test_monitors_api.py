"""API tests for /api/monitors/inbox-filters."""


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
