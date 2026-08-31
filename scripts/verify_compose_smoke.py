"""Smoke-check the Compose same-origin entry (Caddy on 127.0.0.1:5173).

Usage (after `docker compose up --build -d`):
    python scripts/verify_compose_smoke.py

Checks:
  - GET / returns HTML
  - GET /api/system/live returns HTTP 200 through the Caddy reverse proxy
  - /ws completes a WebSocket upgrade (101) or a backend auth close — not 404
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from http.client import HTTPConnection

BASE = "http://127.0.0.1:5173"


def _get(path: str) -> tuple[int, bytes, str]:
    req = urllib.request.Request(BASE + path, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = resp.read()
            ctype = resp.headers.get("Content-Type", "")
            return resp.status, body, ctype
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), exc.headers.get("Content-Type", "")


def _ws_upgrade() -> tuple[int, str]:
    conn = HTTPConnection("127.0.0.1", 5173, timeout=8)
    try:
        conn.request(
            "GET",
            "/ws",
            headers={
                "Host": "127.0.0.1:5173",
                "Connection": "Upgrade",
                "Upgrade": "websocket",
                "Sec-WebSocket-Version": "13",
                "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            },
        )
        resp = conn.getresponse()
        return resp.status, resp.reason
    finally:
        conn.close()


def main() -> int:
    errors: list[str] = []

    status, body, ctype = _get("/")
    if status != 200:
        errors.append(f"GET / -> {status}, expected 200")
    elif b"<html" not in body.lower() and "text/html" not in ctype.lower():
        errors.append(f"GET / did not look like HTML (content-type={ctype!r})")

    status, body, _ctype = _get("/api/system/live")
    if status != 200:
        errors.append(f"GET /api/system/live -> {status}, expected 200")
    else:
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            errors.append("GET /api/system/live body is not JSON")
        else:
            if not isinstance(payload, dict):
                errors.append("GET /api/system/live JSON is not an object")

    ws_status, ws_reason = _ws_upgrade()
    if ws_status in (404, 405):
        errors.append(
            f"GET /ws -> {ws_status} {ws_reason}; Caddy is not proxying WebSocket"
        )

    if errors:
        print("COMPOSE SMOKE FAILED:", file=sys.stderr)
        for item in errors:
            print(f"  - {item}", file=sys.stderr)
        return 1
    print("COMPOSE SMOKE OK — / , /api/system/live, /ws via 127.0.0.1:5173")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
