"""Tests for RequestIDMiddleware.

Uses the isolated ``app`` / ``client`` fixtures so lifespan never takes the
production ``personal_ai.db.lock`` (a live uvicorn on :8000 holds that lock).
"""

from fastapi.testclient import TestClient

from app.main import get_request_id


def test_response_has_request_id_header(client):
    """Every response must carry an X-Request-ID header."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert "x-request-id" in {k.lower() for k in resp.headers.keys()}


def test_inbound_request_id_is_preserved(client):
    """An upstream-provided X-Request-ID is echoed back unchanged."""
    resp = client.get("/", headers={"X-Request-ID": "upstream-123"})
    assert resp.headers.get("x-request-id") == "upstream-123"


def test_request_id_contextvar_populated(app):
    """The request_id contextvar is set during request handling."""
    captured: list[str] = []

    @app.get("/__test_rid__")
    def _capture():
        captured.append(get_request_id())
        return {"ok": True}

    # Match the ``client`` fixture: no lifespan, so no instance lock.
    http = TestClient(app)
    resp = http.get("/__test_rid__", headers={"X-Request-ID": "ctx-test"})
    assert resp.status_code == 200
    assert captured == ["ctx-test"]
