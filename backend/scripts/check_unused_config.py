"""Fail when a Settings field in config.py has no consumer outside config.py.

Prevents dead Settings fields from accumulating (OPENAI_API_KEY-style drift
where env is read via os.getenv elsewhere while an unused Settings field
lingers).

Usage:
    python -m scripts.check_unused_config
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

from scripts._bootstrap import prepare_script_env

prepare_script_env()

ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG = ROOT / "backend" / "app" / "config.py"
APP_ROOT = ROOT / "backend" / "app"
SCRIPTS_ROOT = ROOT / "backend" / "scripts"
TESTS_ROOT = ROOT / "backend" / "tests"

# Fields that are consumed only via pydantic env wiring / settings.<name>
# dynamically and therefore hard to detect with static text search.
ALLOWLIST: frozenset[str] = frozenset({
    # Bound at process start; mkdir/log use them via settings.<name>
    # but the attribute access pattern is already covered below.
})


def _settings_fields() -> list[str]:
    tree = ast.parse(CONFIG.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "Settings":
            fields: list[str] = []
            for item in node.body:
                if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    fields.append(item.target.id)
                elif isinstance(item, ast.Assign):
                    for target in item.targets:
                        if isinstance(target, ast.Name):
                            fields.append(target.id)
            return fields
    raise RuntimeError("Settings class not found in config.py")


def _scan_consumers(field: str) -> int:
    """Count references outside config.py (settings.<field> or bare field name in
    non-definition contexts is too noisy — require ``settings.<field>`` or
    ``Settings.<field>`` or getattr patterns).
    """
    patterns = [
        re.compile(rf"\bsettings\.{re.escape(field)}\b"),
        re.compile(rf'\bgetattr\(\s*settings\s*,\s*[\'"]{re.escape(field)}[\'"]'),
        re.compile(rf'\bgetattr\(\s*Settings\s*,\s*[\'"]{re.escape(field)}[\'"]'),
    ]
    hits = 0
    for root in (APP_ROOT, SCRIPTS_ROOT, TESTS_ROOT):
        for path in root.rglob("*.py"):
            if path.resolve() == CONFIG.resolve():
                continue
            if "__pycache__" in str(path):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for pat in patterns:
                hits += len(pat.findall(text))
    return hits


def check(*, verbose: bool = True) -> int:
    unused: list[str] = []
    for field in _settings_fields():
        if field in ALLOWLIST:
            continue
        if field.startswith("_"):
            continue
        if field in {"model_config"}:
            continue
        if _scan_consumers(field) == 0:
            unused.append(field)

    if unused:
        if verbose:
            print("  [FAIL] Settings fields with no settings.<name> consumer:")
            for name in unused:
                print(f"    {name}")
            print(
                "    Remove the field, or wire a real consumer. "
                "Env-only keys should use os.getenv, not Settings."
            )
        return 1
    if verbose:
        print(f"UNUSED CONFIG OK — all Settings fields have consumers")
    return 0


def main(argv: list[str] | None = None) -> int:
    return check(verbose=True)


if __name__ == "__main__":
    sys.exit(main())
