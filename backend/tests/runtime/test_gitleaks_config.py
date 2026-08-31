"""Guard .gitleaks.toml against re-introducing a whole-directory tests allowlist."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GITLEAKS = ROOT.parent / ".gitleaks.toml"


def test_gitleaks_does_not_allowlist_entire_backend_tests_tree():
    text = GITLEAKS.read_text(encoding="utf-8")
    forbidden = re.compile(
        r"paths\s*=\s*\[[^\]]*(backend/tests/\.\*|backend\\\\tests\\\\.\*)[^\]]*\]",
        re.DOTALL,
    )
    assert not forbidden.search(text), (
        ".gitleaks.toml must not allowlist the entire backend/tests/ tree; "
        "keep placeholder regexes and fingerprints instead"
    )
    assert "backend/tests/.*" not in text
