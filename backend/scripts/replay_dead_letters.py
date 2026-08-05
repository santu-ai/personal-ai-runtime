"""Manually replay dead-lettered handler_executions (E-3).

Usage (from repo root or backend/):
    python -m scripts.replay_dead_letters
    python -m scripts.replay_dead_letters --limit 10
    python -m scripts.replay_dead_letters --dry-run
"""

from __future__ import annotations

import argparse
import sys

from scripts._bootstrap import prepare_script_env

prepare_script_env()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=50, help="Max rows to replay")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List dead letters without replaying",
    )
    args = parser.parse_args(argv)

    from app.core.runtime.kernel_instance import kernel

    items = kernel.list_dead_letter_executions()
    print(f"dead_letter count: {len(items)}")
    for item in items[: args.limit]:
        print(
            f"  {item.id} handler={item.handler_name} "
            f"error={item.error!r} retries={item.retry_count}"
        )
    if args.dry_run:
        return 0
    replayed = kernel.replay_dead_letters(limit=args.limit)
    print(f"replayed: {len(replayed)}")
    for eid in replayed:
        print(f"  {eid}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
