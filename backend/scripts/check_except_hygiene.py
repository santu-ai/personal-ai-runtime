#!/usr/bin/env python
"""Verify `except Exception` blocks do not silently swallow errors.

Not every broad except is a smell: maintenance loops and resource-cleanup
paths intentionally catch ``Exception`` to keep the process alive. But a
handler whose body is only ``pass`` (or ``continue``) discards the failure
with no log, no fallback, and no re-raise — that is the actual bug.

This guard only flags *silent* handlers, so legitimate fault-isolation and
cleanup code keeps passing. New silent ``except Exception: pass`` code is
rejected in CI while existing intentional catches stay untouched.

Exit codes:
  0 — no silent except handlers found
  1 — drift detected
"""
from __future__ import annotations

import re
import sys

from scripts._bootstrap import BACKEND_ROOT

_APP = BACKEND_ROOT / "app"

# Matches `except Exception:` / `except Exception as e:` (with any whitespace).
_EXCEPT_RE = re.compile(r"^\s*except\s+Exception(?:\s+as\s+\w+)?\s*:")

# Body statements that count as "silent" when the whole body is just these.
_SILENT_STMTS = {"pass", "continue"}


def _is_silent_body(body: list[str]) -> bool:
    """True when every non-comment line in the block is pass/continue."""
    meaningful = [
        line.strip()
        for line in body
        if line.strip() and not line.strip().startswith("#")
    ]
    return bool(meaningful) and all(s in _SILENT_STMTS for s in meaningful)


def main() -> int:
    if not _APP.is_dir():
        print(f"ERROR: {_APP} not found", file=sys.stderr)
        return 2

    violations: list[str] = []

    for py_file in sorted(_APP.rglob("*.py")):
        lines = py_file.read_text(encoding="utf-8").splitlines()
        i = 0
        while i < len(lines):
            if _EXCEPT_RE.match(lines[i]):
                # Collect the indented body that follows.
                indent = len(lines[i]) - len(lines[i].lstrip())
                j = i + 1
                body: list[str] = []
                while j < len(lines):
                    if not lines[j].strip():
                        j += 1
                        continue
                    cur_indent = len(lines[j]) - len(lines[j].lstrip())
                    if cur_indent <= indent:
                        break
                    body.append(lines[j])
                    j += 1
                if _is_silent_body(body):
                    rel = py_file.relative_to(BACKEND_ROOT)
                    violations.append(
                        f"{rel}:{i + 1}: silent `except Exception` swallows error"
                    )
                i = j
            else:
                i += 1

    if violations:
        print("EXCEPT HYGIENE FAILED — silent except handlers detected", file=sys.stderr)
        print(
            "Add a log line, a fallback, or re-raise. If the catch is intentional, "
            "log at debug level so the failure is observable.",
            file=sys.stderr,
        )
        print()
        for v in violations:
            print(f"  {v}", file=sys.stderr)
        return 1

    print("EXCEPT HYGIENE OK — no silent `except Exception` handlers in app/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
