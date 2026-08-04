#!/usr/bin/env python
"""Verify docs contain no ``.py:NNN`` line-number references.

Line numbers in doc links drift every refactor (function moves, file grows,
lines renumber). The repo uses function-name references for stability.
This guard blocks new line-number references from creeping back into docs.

Scope: only ``.py:NNN`` (and ``.py:NNN-NNN``) inside markdown links or inline
code. Bare digits in tables (e.g. a hand-written ``行`` column) are NOT
validated here — those tables must be auto-generated without line numbers
(see ``scripts/gen_api_docs.py``). Do not extend this guard to bare digits;
generate the docs instead.

Exit codes:
  0 — no line-number refs found
  1 — drift detected
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from scripts._cli import report_failures, report_ok, run_as_main

_ROOT = Path(__file__).resolve().parent.parent.parent
_DOCS = _ROOT / "docs"

# Files exempt from the line-ref guard. Architecture review snapshots are
# point-in-time evidence records whose value depends on citing exact line
# numbers; rewriting them to function-name refs would destroy that precision.
# Add only documents that are explicitly historical (not living docs).
_ALLOWLIST: frozenset[str] = frozenset()

# Match a markdown link whose label is a backtick-quoted path ending in
# .py:NNN or .py:NNN-NNN. Examples that fail:
#   [`kernel.py:42`](path)
#   [`backend/app/foo.py:108-188`](path)
# Also catches line refs in inline code outside links:
#   see `kernel.py:42-94` for details
LINK_PATTERN = re.compile(r"\[`[^`]+?\.py:\d+(?:-\d+)?`\]")
INLINE_PATTERN = re.compile(r"`[^`]+?\.py:\d+(?:-\d+)?`")


def main() -> int:
    if not _DOCS.is_dir():
        print(f"ERROR: {_DOCS} not found", file=sys.stderr)
        return 2

    violations: list[str] = []

    for md_file in sorted(_DOCS.rglob("*.md")):
        rel = md_file.relative_to(_ROOT)
        if rel.as_posix() in _ALLOWLIST:
            continue
        for lineno, line in enumerate(md_file.read_text(encoding="utf-8").splitlines(), start=1):
            for pat in (LINK_PATTERN, INLINE_PATTERN):
                for m in pat.finditer(line):
                    violations.append(f"{rel}:{lineno}: {m.group(0)}")

    code = report_failures(
        "DOC LINE-REF GUARD FAILED — line-number refs drift on refactor",
        violations,
        hint="Use function-name references instead: [`foo.py`](path) or `ClassName.method`",
    )
    if code:
        return code
    return report_ok("DOC LINE-REF GUARD OK — no line-number references in docs/")


if __name__ == "__main__":
    run_as_main(main)
