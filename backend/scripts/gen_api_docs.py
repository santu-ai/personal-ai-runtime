#!/usr/bin/env python
"""Generate docs/06-reference/api-endpoints.md from the FastAPI OpenAPI schema.

Code is the single source of truth. Regenerating this file abolishes hand-maintained
line-number columns that drift on every refactor.

Usage:
    cd backend && python -m scripts.gen_api_docs
    cd backend && python -m scripts.gen_api_docs --check   # fail if stale
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

from scripts._bootstrap import prepare_script_env

ROOT = prepare_script_env()
REPO = ROOT.parent
OUT = REPO / "docs" / "06-reference" / "api-endpoints.md"

HEADER = """\
# API 端点参考

> **自动生成** — 由 [`scripts/gen_api_docs.py`](../../backend/scripts/gen_api_docs.py) 从 FastAPI OpenAPI schema 生成。
> 不要手工编辑本文件的端点表。重新生成：`cd backend && python -m scripts.gen_api_docs`。

全端点签名表。认证说明：所有端点（除标 `public`）在 `AUTH_TOKEN` 配置时经全局 `AuthMiddleware` Bearer 校验；**没有任何端点用 FastAPI Depends 式 AUTH_TOKEN 依赖**。

跳过认证路径见 [`main.py`](../../backend/app/main.py) 的 `SKIP_AUTH_EXACT` / `SKIP_AUTH_PREFIXES`（生成时直接引用这两个常量，避免手工清单漂移）。

另有 WebSocket：`WS /ws`（[`main.py`](../../backend/app/main.py)）—— OpenAPI 不收录 WebSocket，此处手工列出。

"""


_AUTH_SKIP: tuple[frozenset, tuple] | None = None


def _auth_skip() -> tuple[frozenset, tuple]:
    """Lazily import the auth-exempt constants from main.py (single source)."""
    global _AUTH_SKIP
    if _AUTH_SKIP is None:
        from app.main import SKIP_AUTH_EXACT, SKIP_AUTH_PREFIXES

        _AUTH_SKIP = (SKIP_AUTH_EXACT, SKIP_AUTH_PREFIXES)
    return _AUTH_SKIP


def _auth_label(path: str) -> str:
    exact, prefixes = _auth_skip()
    if path in exact or path.startswith(prefixes):
        return "public"
    return "auth"


def _group_key(path: str) -> str:
    parts = [p for p in path.strip("/").split("/") if p]
    if len(parts) >= 2 and parts[0] == "api":
        return parts[1]
    return parts[0] if parts else "root"


_TAG_TO_MODULE = {
    "chat": "chat",
    "dashboard": "dashboard",
    "system": "system",
    "settings": "settings_api",
    "memory": "memory",
    "notifications": "notifications",
    "telemetry": "telemetry_api",
    "approvals": "approvals",
    "triggers": "triggers",
    "inbox": "inbox",
    "connectors": "connectors",
    "timeline": "timeline",
    "work-items": "work_items",
}


def _module_link_from_tags(tags: list) -> str:
    if not tags:
        return "[`main.py`](../../backend/app/main.py)"
    tag = tags[0]
    mod = _TAG_TO_MODULE.get(tag, tag.replace("-", "_"))
    candidate = ROOT / "app" / "api" / f"{mod}.py"
    if candidate.is_file():
        return f"[`api/{mod}.py`](../../backend/app/api/{mod}.py)"
    return f"`{tag}`"


def _surface_from_description(description: str | None, summary: str | None) -> str:
    """Extract @public / @internal contract tag from OpenAPI description/summary."""
    blob = f"{description or ''}\n{summary or ''}"
    if "**@public**" in blob or "@public" in blob:
        return "public"
    if "**@internal**" in blob or "@internal" in blob:
        return "internal"
    return "—"


def collect_routes() -> list[dict]:
    from app.main import app

    schema = app.openapi()
    rows: list[dict] = []
    for path, methods in sorted(schema.get("paths", {}).items()):
        if path.startswith("/docs") or path.startswith("/redoc") or path == "/openapi.json":
            continue
        for method, op in methods.items():
            if method.lower() in {"head", "options", "parameters"}:
                continue
            if not isinstance(op, dict):
                continue
            summary = (op.get("summary") or op.get("operationId") or "—").strip()
            tags = op.get("tags") or []
            module = _module_link_from_tags(tags)
            rows.append({
                "group": _group_key(path),
                "methods": [method.upper()],
                "path": path,
                "auth": _auth_label(path),
                "surface": _surface_from_description(op.get("description"), summary),
                "summary": summary,
                "module": module,
            })

    # WebSocket is outside OpenAPI.
    rows.append({
        "group": "websocket",
        "methods": ["WEBSOCKET"],
        "path": "/ws",
        "auth": "auth",
        "surface": "—",
        "summary": "Real-time notification push",
        "module": "[`main.py`](../../backend/app/main.py)",
    })
    rows.sort(key=lambda r: (r["group"], r["path"], ",".join(r["methods"])))
    return rows


def render(rows: list[dict]) -> str:
    by_group: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_group[row["group"]].append(row)

    parts = [HEADER]
    for group in sorted(by_group.keys()):
        group_rows = by_group[group]
        # Prefer a concrete module link if any row has one.
        module = next((r["module"] for r in group_rows if r["module"].startswith("[")), group_rows[0]["module"])
        if group == "websocket":
            parts.append(f"## websocket — `/ws`（{module}）\n\n")
        elif group == "root":
            parts.append(f"## root — `/`（{module}）\n\n")
        else:
            prefix = f"/api/{group}"
            parts.append(f"## {group} — `{prefix}`（{module}）\n\n")
        parts.append("| 方法 | 路径 | 认证 | 契约 | 摘要 |\n|---|---|---|---|---|\n")
        for row in group_rows:
            methods = ", ".join(row["methods"])
            summary = row["summary"].replace("|", "\\|").replace("\n", " ")
            parts.append(
                f"| {methods} | `{row['path']}` | {row['auth']} | "
                f"{row['surface']} | {summary} |\n"
            )
        parts.append("\n")
    return "".join(parts).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if generated content differs from on-disk file")
    args = parser.parse_args()

    content = render(collect_routes())
    if args.check:
        if not OUT.is_file():
            print(f"MISSING: {OUT}", file=sys.stderr)
            return 1
        existing = OUT.read_text(encoding="utf-8")
        if existing != content:
            print(f"STALE: {OUT} — run: python -m scripts.gen_api_docs", file=sys.stderr)
            return 1
        print(f"OK: {OUT.relative_to(REPO)} is up to date ({content.count(chr(10))} lines)")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(content, encoding="utf-8", newline="\n")
    print(f"Wrote {OUT.relative_to(REPO)} ({content.count(chr(10))} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
