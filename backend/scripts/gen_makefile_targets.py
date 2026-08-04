#!/usr/bin/env python
"""Generate docs/06-reference/makefile-targets.md from the root Makefile.

Usage:
    cd backend && python -m scripts.gen_makefile_targets
    cd backend && python -m scripts.gen_makefile_targets --check
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from scripts._bootstrap import prepare_script_env

ROOT = prepare_script_env()
REPO = ROOT.parent
MAKEFILE = REPO / "Makefile"
OUT = REPO / "docs" / "06-reference" / "makefile-targets.md"

TARGET_RE = re.compile(r"^([a-zA-Z0-9][a-zA-Z0-9_-]*):(.*)$")


def parse_makefile(text: str) -> list[tuple[str, str]]:
    """Return ordered (target, recipe_summary) pairs for real targets."""
    lines = text.splitlines()
    targets: list[tuple[str, str]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = TARGET_RE.match(line)
        if not m or line.startswith("\t") or line.startswith("."):
            i += 1
            continue
        name = m.group(1)
        if name == "PHONY" or name.startswith("."):
            i += 1
            continue
        recipes: list[str] = []
        i += 1
        while i < len(lines) and (lines[i].startswith("\t") or lines[i].startswith("#")):
            raw = lines[i]
            if raw.startswith("\t"):
                recipes.append(raw[1:].strip())
            i += 1
        summary = recipes[0] if recipes else "(no recipe / meta target)"
        # Collapse noisy cd prefixes for readability.
        summary = re.sub(r"^cd \$\(BACKEND_DIR\) &&\s*", "", summary)
        summary = re.sub(r"^cd \$\(FRONTEND_DIR\) &&\s*", "frontend: ", summary)
        summary = re.sub(r"^cd \$\(DESKTOP_DIR\) &&\s*", "desktop: ", summary)
        if len(summary) > 100:
            summary = summary[:97] + "..."
        targets.append((name, summary))
    return targets


def render(targets: list[tuple[str, str]]) -> str:
    parts = [
        "# Makefile 目标参考\n\n",
        "> **自动生成** — 由 [`scripts/gen_makefile_targets.py`](../../backend/scripts/gen_makefile_targets.py) "
        "从根 [`Makefile`](../../Makefile) 解析。不要手工编辑目标表。\n"
        "> 重新生成：`cd backend && python -m scripts.gen_makefile_targets`。\n\n",
        "Windows 子集见 [`Makefile.ps1`](../../Makefile.ps1)。\n\n",
        "| 目标 | 首条命令摘要 |\n|---|---|\n",
    ]
    for name, summary in targets:
        safe = summary.replace("|", "\\|")
        parts.append(f"| `{name}` | `{safe}` |\n")
    parts.append(
        "\n完整配方以根 `Makefile` 为准；本表仅作索引。\n"
    )
    return "".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    targets = parse_makefile(MAKEFILE.read_text(encoding="utf-8"))
    content = render(targets)
    if args.check:
        if not OUT.is_file() or OUT.read_text(encoding="utf-8") != content:
            print(f"STALE: {OUT} — run: python -m scripts.gen_makefile_targets", file=sys.stderr)
            return 1
        print(f"OK: {OUT.relative_to(REPO)} is up to date ({len(targets)} targets)")
        return 0

    OUT.write_text(content, encoding="utf-8", newline="\n")
    print(f"Wrote {OUT.relative_to(REPO)} ({len(targets)} targets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
