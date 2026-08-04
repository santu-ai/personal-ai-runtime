#!/usr/bin/env python
"""Generate capability / MCP catalog snippets from JSON configs.

Sources of truth:
  - backend/capability_policy.json
  - backend/mcp_registry.json
  - backend/mcp_config.json

Writes docs/06-reference/tool-catalog.md (auto-generated). Narrative docs such as
docs/03-subsystems/mcp-harness.md should link here instead of duplicating tables.

Usage:
    cd backend && python -m scripts.gen_tool_catalog
    cd backend && python -m scripts.gen_tool_catalog --check
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from scripts._bootstrap import prepare_script_env

ROOT = prepare_script_env()
REPO = ROOT.parent
OUT = REPO / "docs" / "06-reference" / "tool-catalog.md"

POLICY = ROOT / "capability_policy.json"
REGISTRY = ROOT / "mcp_registry.json"
CONFIG = ROOT / "mcp_config.json"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _md_list(items: list[str]) -> str:
    if not items:
        return "—"
    return ", ".join(f"`{x}`" for x in items)


def render() -> str:
    policy = _load(POLICY)
    registry = _load(REGISTRY)
    config = _load(CONFIG)

    auto_allow = list(policy.get("auto_allow") or [])
    needs_user = list(policy.get("needs_user") or [])
    external_ingestion = list(policy.get("external_ingestion") or [])
    forbidden = list(policy.get("forbidden") or [])

    # mcp_config.json uses external_servers: [...]
    if isinstance(config, dict) and "external_servers" in config:
        config_rows = list(config["external_servers"] or [])
    elif isinstance(config, dict) and "mcpServers" in config:
        servers_cfg = config["mcpServers"]
        if isinstance(servers_cfg, dict):
            config_rows = [{"name": k, **v} for k, v in servers_cfg.items()]
        else:
            config_rows = list(servers_cfg)
    elif isinstance(config, dict) and "servers" in config:
        config_rows = list(config["servers"])
    elif isinstance(config, list):
        config_rows = config
    else:
        config_rows = []

    registry_rows = registry if isinstance(registry, list) else list(registry.get("servers") or [])

    parts: list[str] = [
        "# 工具与能力目录\n\n",
        "> **自动生成** — 由 [`scripts/gen_tool_catalog.py`](../../backend/scripts/gen_tool_catalog.py) "
        "从 `capability_policy.json` / `mcp_registry.json` / `mcp_config.json` 生成。\n"
        "> 不要手工编辑。重新生成：`cd backend && python -m scripts.gen_tool_catalog`。\n\n",
        "## 内建能力策略（`capability_policy.json`）\n\n",
        "| 门 | 工具 |\n|---|---|\n",
        f"| `auto_allow` | {_md_list(auto_allow)} |\n",
        f"| `needs_user` | {_md_list(needs_user)} |\n",
        f"| `external_ingestion` | {_md_list(external_ingestion)} |\n",
        f"| `forbidden` | {_md_list(forbidden)} |\n\n",
        "## 外部 MCP 配置（`mcp_config.json`）\n\n",
        "| Server | policy_default | enabled_tools | needs_user_tools | required_env |\n",
        "|---|---|---|---|---|\n",
    ]

    cfg_by_name = {str(s.get("name") or s.get("id") or ""): s for s in config_rows}
    for name in sorted(cfg_by_name.keys()):
        s = cfg_by_name[name]
        parts.append(
            "| {name} | `{policy}` | {enabled} | {needs} | {env} |\n".format(
                name=name,
                policy=s.get("policy_default") or "—",
                enabled=_md_list(list(s.get("enabled_tools") or [])),
                needs=_md_list(list(s.get("needs_user_tools") or [])),
                env=_md_list(list(s.get("required_env") or [])),
            )
        )

    parts.append("\n## MCP Marketplace 元数据（`mcp_registry.json`）\n\n")
    parts.append("| Server | category | description | install |\n|---|---|---|---|\n")
    for s in registry_rows:
        name = s.get("name") or "—"
        cat = s.get("category") or "—"
        desc = (s.get("description") or "—").replace("|", "\\|").replace("\n", " ")
        cmd = s.get("install_command") or ""
        args = " ".join(s.get("install_args") or [])
        install = f"`{cmd} {args}`".strip() if cmd else "—"
        parts.append(f"| {name} | `{cat}` | {desc} | {install} |\n")

    parts.append(
        "\n叙事与集成细节见 [mcp-harness.md](../03-subsystems/mcp-harness.md)。\n"
    )
    return "".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    content = render()
    if args.check:
        if not OUT.is_file() or OUT.read_text(encoding="utf-8") != content:
            print(f"STALE: {OUT} — run: python -m scripts.gen_tool_catalog", file=sys.stderr)
            return 1
        print(f"OK: {OUT.relative_to(REPO)} is up to date")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(content, encoding="utf-8", newline="\n")
    print(f"Wrote {OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
