#!/usr/bin/env python
"""Database schema + Alembic revision-chain verification.

Uses an ephemeral SQLite DB so parallel CI jobs never touch the developer's
default ``personal_ai.db``. Table inventory is sourced from
``app.store.table_registry.ALL_CLASSIFIED_TABLES``.

Also checks:
- Alembic versions form a single linear chain to one head
- ``versions/__pycache__`` has no orphan ``.pyc`` for deleted revisions
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

_BACKEND = str(Path(__file__).resolve().parents[1])
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from scripts._bootstrap import ephemeral_db_path, prepare_script_env  # noqa: E402

prepare_script_env()

from app.store.table_registry import ALL_CLASSIFIED_TABLES  # noqa: E402

REQUIRED_TABLES = tuple(sorted(ALL_CLASSIFIED_TABLES))

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_REVISION_RE = re.compile(
    r"^revision\s*:\s*str\s*=\s*['\"]([^'\"]+)['\"]",
    re.MULTILINE,
)
_DOWN_RE = re.compile(
    r"^down_revision\s*:\s*[^=]*=\s*(.+)$",
    re.MULTILINE,
)


def _parse_down_revision(raw: str) -> str | None:
    value = raw.strip()
    if value in {"None", "none"}:
        return None
    # Union[...] annotations may wrap the literal; pull first quoted token.
    m = re.search(r"['\"]([^'\"]+)['\"]", value)
    if m:
        return m.group(1)
    if value.startswith("(") or value.startswith("["):
        raise ValueError(f"branched down_revision not allowed: {value}")
    raise ValueError(f"unparseable down_revision: {value}")


def check_revision_chain(*, verbose: bool = True) -> int:
    """Ensure versions/*.py form one linear chain with a single head."""
    files = sorted(VERSIONS_DIR.glob("*.py"))
    if not files:
        if verbose:
            print("FAIL: no alembic version files", file=sys.stderr)
        return 1

    nodes: dict[str, str | None] = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        rev_m = _REVISION_RE.search(text)
        down_m = _DOWN_RE.search(text)
        if not rev_m or not down_m:
            if verbose:
                print(f"FAIL: cannot parse revision fields in {path.name}", file=sys.stderr)
            return 1
        rev = rev_m.group(1)
        try:
            down = _parse_down_revision(down_m.group(1))
        except ValueError as exc:
            if verbose:
                print(f"FAIL: {path.name}: {exc}", file=sys.stderr)
            return 1
        if rev in nodes:
            if verbose:
                print(f"FAIL: duplicate revision id {rev!r}", file=sys.stderr)
            return 1
        nodes[rev] = down

    roots = [r for r, d in nodes.items() if d is None]
    if len(roots) != 1:
        if verbose:
            print(f"FAIL: expected exactly one root revision, got {roots}", file=sys.stderr)
        return 1

    children: dict[str | None, list[str]] = {}
    for rev, down in nodes.items():
        children.setdefault(down, []).append(rev)

    for parent, kids in children.items():
        if len(kids) > 1:
            if verbose:
                print(
                    f"FAIL: branched revisions under {parent!r}: {kids}",
                    file=sys.stderr,
                )
            return 1

    # Walk root → head; every node must appear exactly once.
    order: list[str] = []
    cur: str | None = roots[0]
    seen: set[str] = set()
    while cur is not None:
        if cur in seen:
            if verbose:
                print(f"FAIL: cycle detected at {cur!r}", file=sys.stderr)
            return 1
        if cur not in nodes:
            if verbose:
                print(f"FAIL: dangling down_revision → {cur!r}", file=sys.stderr)
            return 1
        seen.add(cur)
        order.append(cur)
        kids = children.get(cur, [])
        cur = kids[0] if kids else None

    missing = set(nodes) - seen
    if missing:
        if verbose:
            print(f"FAIL: unreachable revisions: {sorted(missing)}", file=sys.stderr)
        return 1

    if verbose:
        print(f"OK: alembic chain linear, {len(order)} revision(s), head={order[-1]}")
    return 0


def check_orphan_pycache(*, verbose: bool = True) -> int:
    """Refuse stale ``.pyc`` left after deleting a revision module."""
    cache = VERSIONS_DIR / "__pycache__"
    if not cache.is_dir():
        if verbose:
            print("OK: no versions/__pycache__")
        return 0

    live = {p.stem for p in VERSIONS_DIR.glob("*.py")}
    orphans: list[str] = []
    for pyc in cache.glob("*.pyc"):
        # e.g. 0001_consolidated.cpython-313.pyc → 0001_consolidated
        stem = pyc.name.split(".", 1)[0]
        if stem not in live:
            orphans.append(pyc.name)

    if orphans:
        if verbose:
            print(
                "FAIL: orphan alembic __pycache__ entries "
                f"(delete them): {sorted(orphans)}",
                file=sys.stderr,
            )
        return 1
    if verbose:
        print("OK: versions/__pycache__ matches live revisions")
    return 0


def check_required_tables(*, verbose: bool = True) -> int:
    from app.store.database import Database

    with ephemeral_db_path("verify_alembic.db", prepare=False) as db_path:
        db = Database(db_path=str(db_path))
        try:
            with db.get_db() as conn:
                tables = {
                    row["name"]
                    for row in conn.execute(
                        'SELECT name FROM sqlite_master WHERE type="table"'
                    ).fetchall()
                }
                missing = [name for name in REQUIRED_TABLES if name not in tables]
                if missing:
                    if verbose:
                        print(f"FAIL: missing tables: {missing}", file=sys.stderr)
                    return 1

                fk_on = conn.execute("PRAGMA foreign_keys").fetchone()[0]
                if fk_on != 1:
                    if verbose:
                        print("FAIL: foreign keys are OFF", file=sys.stderr)
                    return 1
        finally:
            close = getattr(db, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass

    if verbose:
        print(f"OK: {len(REQUIRED_TABLES)} tables, FK=ON")
    return 0


def main() -> int:
    rc = 0
    if check_revision_chain() != 0:
        rc = 1
    if check_orphan_pycache() != 0:
        rc = 1
    if check_required_tables() != 0:
        rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
