"""Shared CLI helpers for backend guard / verify scripts.

Keeps exit codes, failure formatting, and optional ``--quiet`` consistent
across ``check_*.py`` without forcing every script into one mega-framework.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable, Iterable, Sequence
from typing import TextIO


def build_parser(
    description: str,
    *,
    add_quiet: bool = False,
) -> argparse.ArgumentParser:
    """Return an ArgumentParser with a standard description and optional --quiet."""
    parser = argparse.ArgumentParser(description=description)
    if add_quiet:
        parser.add_argument(
            "--quiet",
            action="store_true",
            help="Only print failures, not progress / success chatter.",
        )
    return parser


def report_failures(
    title: str,
    violations: Sequence[str],
    *,
    hint: str | None = None,
    stream: TextIO = sys.stderr,
) -> int:
    """Print a failure block and return exit code 1 (or 0 when empty)."""
    if not violations:
        return 0
    print(title, file=stream)
    if hint:
        print(hint, file=stream)
        print(file=stream)
    for item in violations:
        print(f"  {item}", file=stream)
    return 1


def report_ok(message: str, *, quiet: bool = False, stream: TextIO = sys.stdout) -> int:
    """Print a success line unless quiet; always return 0."""
    if not quiet:
        print(message, file=stream)
    return 0


def exit_with(code: int) -> None:
    """sys.exit wrapper for consistent imports."""
    sys.exit(code)


def run_as_main(main: Callable[[], int]) -> None:
    """Invoke ``main`` and exit with its return code."""
    exit_with(main())


def format_count(label: str, items: Iterable[object]) -> str:
    """Human-readable ``label: N`` helper."""
    seq = list(items)
    return f"{label}: {len(seq)}"
