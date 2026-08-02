#!/usr/bin/env python
"""Verify narrative numbers in docs/ match the current codebase.

Guard scripts (check_doc_links / check_doc_line_refs / check_doc_table_sync)
only validate structured references — links, line numbers, table names.
Numbers written inside prose (table counts, router counts, verify-script
counts, endpoint counts, needs_user tool counts) are not covered, and drift
when the code evolves. This guard closes that gap for the numbers we know
rotate most often.

The values are sourced live from the codebase (not hardcoded) so the guard
cannot itself go stale:
  - total governed + app_storage tables  -> table_registry.py
  - mounted API routers                  -> main.py include_router calls
  - verify_*.py / check_*.py script count-> scripts/ directory
  - needs_user tools                     -> capability_policy.json
  - total API endpoint decorators        -> app/api @router.* count

Exit codes:
  0 — all narrative numbers match code
  1 — drift detected
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from scripts._bootstrap import BACKEND_ROOT

_DOCS = BACKEND_ROOT.parent / "docs"

# Matches "N 张表", "N 张 governed", "N 个 router", "N 个 verify 脚本",
# "N 个 check 脚本", "N 个脚本", "N 个端点", "needs_user（N 个写工具）",
# "N 个写工具" in prose.
_PATTERNS = (
    re.compile(r"(\d+)\s*张\s*表"),
    re.compile(r"(\d+)\s*张\s*governed"),
    re.compile(r"(\d+)\s*个\s*router"),
    re.compile(r"(\d+)\s*个\s*verify\s*脚本"),
    re.compile(r"(\d+)\s*个\s*check\s*脚本"),
    re.compile(r"(\d+)\s*个\s*脚本"),
    re.compile(r"(\d+)\s*个\s*端点"),
    re.compile(r"needs_user[（(](\d+)\s*个\s*写工具[)）]"),
    re.compile(r"(\d+)\s*个\s*写工具"),
)


def _count_mounted_routers() -> int:
    """Count include_router calls in main.py."""
    main_py = BACKEND_ROOT / "app" / "main.py"
    text = main_py.read_text(encoding="utf-8")
    return len(re.findall(r"app\.include_router\(", text))


def _count_endpoint_decorators() -> int:
    """Count @router.get/post/put/patch/delete/websocket across app/api."""
    total = 0
    for py_file in sorted((BACKEND_ROOT / "app" / "api").glob("*.py")):
        text = py_file.read_text(encoding="utf-8")
        total += len(
            re.findall(
                r"@router\.(?:get|post|put|delete|patch|websocket)\(",
                text,
            )
        )
    return total


def _count_needs_user_tools() -> int:
    policy_path = BACKEND_ROOT / "capability_policy.json"
    data = json.loads(policy_path.read_text(encoding="utf-8"))
    return len(data.get("needs_user", []))


def _count_governed_tables() -> int:
    from app.store.table_registry import APP_STORAGE_TABLES, GOVERNED_TABLES

    return len(GOVERNED_TABLES) + len(APP_STORAGE_TABLES)


def _count_governed_only() -> int:
    from app.store.table_registry import GOVERNED_TABLES

    return len(GOVERNED_TABLES)


def main() -> int:
    if not _DOCS.is_dir():
        print(f"ERROR: {_DOCS} not found", file=sys.stderr)
        return 2

    # (pattern, expected, tolerance, description). tolerance is used for
    # numbers that legitimately drift with code growth (endpoints) where docs
    # write an approximate figure ("约 100 个端点"); exact numbers use 0.
    checks = [
        (_PATTERNS[0], _count_governed_tables(), 0, "表总数"),
        (_PATTERNS[1], _count_governed_only(), 0, "governed 表数"),
        (_PATTERNS[2], _count_mounted_routers(), 0, "router 数"),
        (_PATTERNS[3], len(list((BACKEND_ROOT / "scripts").glob("verify_*.py"))), 0, "verify 脚本数"),
        (_PATTERNS[4], len(list((BACKEND_ROOT / "scripts").glob("check_*.py"))), 0, "check 脚本数"),
        # Bare "N 个脚本" in prose refers to the verify suite (verify_rebuild.py 等).
        (_PATTERNS[5], len(list((BACKEND_ROOT / "scripts").glob("verify_*.py"))), 0, "脚本数"),
        (_PATTERNS[6], _count_endpoint_decorators(), 5, "端点数"),
        (_PATTERNS[7], _count_needs_user_tools(), 0, "needs_user 写工具数"),
        (_PATTERNS[8], _count_needs_user_tools(), 0, "写工具数"),
    ]

    violations: list[str] = []

    for md_file in sorted(_DOCS.rglob("*.md")):
        rel = md_file.relative_to(BACKEND_ROOT.parent)
        for lineno, line in enumerate(
            md_file.read_text(encoding="utf-8").splitlines(), start=1
        ):
            for pattern, expected, tolerance, label in checks:
                for m in pattern.finditer(line):
                    doc_value = int(m.group(1))
                    if abs(doc_value - expected) > tolerance:
                        violations.append(
                            f"{rel}:{lineno}: {label} 文档写 {doc_value}, 代码实测 {expected}"
                        )

    if violations:
        print("DOC NUMBERS GUARD FAILED — narrative numbers drifted from code", file=sys.stderr)
        print(
            "Update the prose in docs/ to match the current codebase, or "
            "drop the precise number and use a range (e.g. 150+).",
            file=sys.stderr,
        )
        print()
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        return 1

    print(
        "DOC NUMBERS GUARD OK — narrative numbers in docs/ match code"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
