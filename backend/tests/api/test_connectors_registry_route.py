"""Regression: static connector routes must beat /{connector_name}."""

import pytest
from fastapi import HTTPException


def test_connectors_registry_not_captured_as_connector_name(client):
    """GET /api/connectors/registry must hit list_registry, not get_connector."""
    r = client.get("/api/connectors/registry")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "servers" in body
    assert "total" in body
    assert "detail" not in body or "not found" not in str(body.get("detail", "")).lower()


def test_connectors_named_lookup_still_works(client):
    r = client.get("/api/connectors/mail")
    assert r.status_code == 200
    assert r.json()["name"] == "mail"


def test_install_command_rejects_absolute_paths_and_shell_meta():
    from app.api.connectors import _validate_install_launcher

    assert _validate_install_launcher("npx", ["-y", "pkg"]) == ("npx", ["-y", "pkg"])

    with pytest.raises(HTTPException) as abs_exc:
        _validate_install_launcher(r"C:\evil\npx", [])
    assert abs_exc.value.status_code == 400

    with pytest.raises(HTTPException) as meta_exc:
        _validate_install_launcher("npx", ["foo;rm"])
    assert meta_exc.value.status_code == 400
