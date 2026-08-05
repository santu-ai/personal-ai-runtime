"""Architecture Contract Gate — enforces the Runtime Algebra concept-compression contract.

Reads the current concept baseline from ``runtime-algebra.md`` §4.4 and
fails if any tracked metric has grown since the last recorded baseline.

This script is the CI enforcement of the Concept Compression Contract
(§5.2). When you intentionally reduce a metric, update the baseline AND
the table in docs/02-concepts/runtime-algebra.md §4.4.

Usage:
    python -m scripts.check_concept_growth            # check against baseline
    python -m scripts.check_concept_growth --snapshot # print current values
    python -m scripts.check_concept_growth --strict   # also fail on non-zero dead_code_files
    python -m scripts.check_concept_growth --ratchet  # preview baseline + docs §4.4 changes (no write)
    python -m scripts.check_concept_growth --ratchet --yes  # apply the reduction
    python -m scripts.check_concept_growth --record   # append JSONL history snapshot
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

# ── Measurers ────────────────────────────────────────────────────────────────

def count_runtime_files() -> int:
    """Count .py files under backend/app/core/runtime/ (recursive)."""
    runtime_dir = ROOT / "backend" / "app" / "core" / "runtime"
    return len(list(runtime_dir.rglob("*.py")))


def count_event_types() -> int:
    """Count individual ``EVENT_* = \"...\"`` string assignments in constants.py."""
    constants = ROOT / "backend" / "app" / "core" / "runtime" / "kernel" / "constants.py"
    text = constants.read_text(encoding="utf-8")
    # Only match string-valued EVENT_* = "..." — exclude frozenset/set assignments
    return len(re.findall(r"EVENT_[A-Z_]+\s*=\s*\"", text))


def count_query_state_selectors() -> int:
    """Count ``if selector ==`` branches in kernel_query_state.py."""
    query_state = ROOT / "backend" / "app" / "core" / "runtime" / "kernel" / "kernel_query_state.py"
    text = query_state.read_text(encoding="utf-8")
    return len(re.findall(r'if\s+selector\s*==\s*"', text))


def count_fragments() -> int:
    """Count fragment class registrations in fragments/register.py."""
    reg = ROOT / "backend" / "app" / "fragments" / "register.py"
    text = reg.read_text(encoding="utf-8")
    # Count class names in _ALL_FRAGMENT_CLASSES list
    match = re.search(r"_ALL_FRAGMENT_CLASSES\s*=\s*\[(.*?)\]", text, re.DOTALL)
    if not match:
        return -1
    return len(re.findall(r"\b\w+Fragment\b", match.group(1)))


def count_governed_tables() -> int:
    """Count tables in GOVERNED_SCHEMA dictionary declaration."""
    table_reg = ROOT / "backend" / "app" / "store" / "table_registry.py"
    text = table_reg.read_text(encoding="utf-8")
    # Match the schema dictionary: GOVERNED_SCHEMA: dict[...] = {...}
    # Matches everything until the closing brace at the start of a line.
    match = re.search(
        r"GOVERNED_SCHEMA.*?=\s*\{(.*?)\n\}", text, re.DOTALL
    )
    if not match:
        return -1
    # Count quoted keys (table names) followed by : frozenset
    return len(re.findall(r'"([^"]+)"\s*:\s*frozenset', match.group(1)))


def count_projector_files() -> int:
    """Count projector_*.py files under kernel/."""
    kernel_dir = ROOT / "backend" / "app" / "core" / "runtime" / "kernel"
    return len(list(kernel_dir.glob("projectors_*.py")))


def _loc(*paths: Path) -> int:
    total = 0
    for p in paths:
        if p.exists():
            total += len(p.read_text(encoding="utf-8").splitlines())
    return total


def count_god_object_max_loc() -> int:
    """Return the max LOC of known God Object candidates.

    Measures Kernel (core + query/sovereignty mixins), Brain (core + mixin), and
    MCPHub. Returns the LOC of the largest one.

    SQL / sovereignty / MCP registry bulk are tracked separately via
    ``SUBSYSTEM_LOC_BUDGETS`` (G2) so they cannot escape the façade budget by
    file-split alone without updating the locked file lists below.
    """
    kernel_dir = ROOT / "backend" / "app" / "core" / "runtime" / "kernel"

    kernel_loc = _loc(
        kernel_dir / "kernel.py",
        kernel_dir / "kernel_query_state.py",
        kernel_dir / "kernel_sovereignty.py",
    )
    brain_loc = _loc(
        ROOT / "backend" / "app" / "core" / "agents" / "brain.py",
        ROOT / "backend" / "app" / "core" / "agents" / "brain_llm_client.py",
    )
    hub_loc = _loc(
        ROOT / "backend" / "app" / "core" / "harness" / "mcp_hub.py",
    )
    return max(kernel_loc, brain_loc, hub_loc)


# Locked subsystem file sets (G2). Adding a sibling file without updating this
# map is an intentional budget change — update BASELINE docs §4.4 subsystem note.
SUBSYSTEM_LOC_FILES: dict[str, tuple[Path, ...]] = {
    "read_model_sql": (
        ROOT / "backend/app/core/runtime/kernel/query_builder.py",
    ),
    "sovereignty": (
        ROOT / "backend/app/core/runtime/kernel/sovereignty_ops.py",
    ),
    "mcp_registry": (
        ROOT / "backend/app/core/harness/builtin_registration/__init__.py",
        ROOT / "backend/app/core/harness/builtin_registration/common.py",
        ROOT / "backend/app/core/harness/builtin_registration/register.py",
        ROOT / "backend/app/core/harness/builtin_registration/specs_core.py",
        ROOT / "backend/app/core/harness/builtin_registration/specs_domain.py",
    ),
    "agent_scheduler": (
        ROOT / "backend/app/core/runtime/agent_scheduler.py",
    ),
    "mcp_mesh": (
        ROOT / "backend/app/core/harness/mcp_mesh.py",
    ),
    "fastapi_main": (
        ROOT / "backend/app/main.py",
    ),
    "inbox_product": (
        ROOT / "backend/app/product/inbox.py",
    ),
    "read_ports_work": (
        ROOT / "backend/app/core/runtime/read_ports/work.py",
    ),
}

SUBSYSTEM_LOC_BUDGETS: dict[str, int] = {
    "read_model_sql": 900,
    "sovereignty": 850,
    "mcp_registry": 1200,
    # Headroom above current LOC so intentional growth is visible but not blocked
    # by the first edit. Raise only with an accompanying split/delete plan.
    "agent_scheduler": 850,
    "mcp_mesh": 800,
    "fastapi_main": 800,
    "inbox_product": 600,
    "read_ports_work": 600,
}


def measure_subsystem_locs() -> dict[str, int]:
    return {
        name: _loc(*paths) for name, paths in SUBSYSTEM_LOC_FILES.items()
    }


def check_subsystem_budgets(verbose: bool = True) -> int:
    """Fail when locked subsystem LOC exceeds G2 budgets."""
    current = measure_subsystem_locs()
    violations = 0
    for name, limit in SUBSYSTEM_LOC_BUDGETS.items():
        cur = current.get(name, 0)
        if cur > limit:
            violations += 1
            if verbose:
                print(f"  [FAIL] subsystem {name}: {cur} > {limit}")
        elif verbose:
            print(f"  [OK] subsystem {name}: {cur} (<= {limit})")
    return 1 if violations else 0


# Tracked unused files (zero runtime callers).
# When a file is deleted, also remove its entry here.
_KNOWN_DEAD_FILES: list[str] = []


def count_dead_code_files() -> int:
    """Count how many of the tracked unused files still exist on disk."""
    return sum(1 for p in _KNOWN_DEAD_FILES if (ROOT / p).exists())


# ── Baseline (sourced from runtime-algebra.md §4.4) ──────────────────────

# When you *reduce* a metric, update these baselines AND
# the table in docs/02-concepts/runtime-algebra.md §4.4.

BASELINE = {
    # read_ports/ domain-scoped package — same Read Port concept.
    # Aligned to measured tree after domain split (handlers/governance/egress/read_ports).
    # Ratcheted 2026-08: INV-W5 leftovers closed (runtime_files 63→62, fragments 10→9,
    # god_object_max_loc 633→612). Use --ratchet after intentional reductions.
    # (same read_model_sql concept; +2 files).
    "runtime_files": 61,
    "event_types": 50,  # +4: MemoryDecayed/ClaimRatified/Rejected/Contested were live but undeclared
    "query_state_selectors": 17,  # INV-W5: dropped background_tasks selector
    "fragments": 9,
    # 15: INV-W5 merged background_tasks into work_items
    "governed_tables": 15,
    "projector_files": 6,              # telemetry in projectors_governance
    # god_object_max_loc: E-3/E-4 execution reliability ABI thin wrappers on Kernel;
    # bodies live in execution_repository (not counted in façade). Was 604.
    "god_object_max_loc": 594,
    "dead_code_files": 0,
}

# Doc §4.4 row label → BASELINE key (CI is the single authority).
_DOC_SECTION_4_4_KEYS: dict[str, str] = {
    "runtime_files": "runtime_files",
    "event_types": "event_types",
    "query_state_selectors": "query_state_selectors",
    "fragments": "fragments",
    "governed_tables": "governed_tables",
    "projector_files": "projector_files",
    "god_object_max_loc": "god_object_max_loc",
}


def check_docs_baseline_sync(verbose: bool = True) -> int:
    """Fail when docs/02-concepts/runtime-algebra.md §4.4 drifts from BASELINE.

    Parses the markdown table column ``对应 BASELINE 键`` and the limit column.
    """
    doc = ROOT / "docs" / "02-concepts" / "runtime-algebra.md"
    text = doc.read_text(encoding="utf-8")
    # Rows like: | `core/runtime/` 文件数 | 63 | `runtime_files` |
    row_re = re.compile(
        r"^\|\s*[^|]+\|\s*(\d+)\s*\|\s*`([a-z_]+)`\s*\|",
        re.MULTILINE,
    )
    section = text.split("### 4.4", 1)
    if len(section) < 2:
        if verbose:
            print("  [FAIL] docs missing ### 4.4 section")
        return 1
    body = section[1].split("\n---", 1)[0].split("\n## ", 1)[0]
    found: dict[str, int] = {}
    for m in row_re.finditer(body):
        limit, key = int(m.group(1)), m.group(2)
        if key in _DOC_SECTION_4_4_KEYS:
            found[key] = limit
    violations = 0
    for key, expected in BASELINE.items():
        if key == "dead_code_files":
            continue
        if key not in found:
            violations += 1
            if verbose:
                print(f"  [FAIL] docs §4.4 missing BASELINE key `{key}`")
            continue
        if found[key] != expected:
            violations += 1
            if verbose:
                print(
                    f"  [FAIL] docs §4.4 `{key}`={found[key]} "
                    f"!= BASELINE {expected}"
                )
    if verbose and not violations:
        print("  [OK] docs §4.4 synced with BASELINE")
    return 1 if violations else 0



def measure_all() -> dict[str, int]:
    return {
        "runtime_files": count_runtime_files(),
        "event_types": count_event_types(),
        "query_state_selectors": count_query_state_selectors(),
        "fragments": count_fragments(),
        "governed_tables": count_governed_tables(),
        "projector_files": count_projector_files(),
        "god_object_max_loc": count_god_object_max_loc(),
        "dead_code_files": count_dead_code_files(),
    }


def check(verbose: bool = True, strict: bool = False) -> int:
    """Return 0 when safe, 1 when any metric exceeds baseline without
    a corresponding reduction elsewhere.

    In strict mode, dead_code_files must be 0 (i.e. all known dead files
    deleted).  Non-strict (default) only requires no *new* dead files.
    """
    current = measure_all()
    violations = 0

    for key, baseline_val in BASELINE.items():
        cur = current[key]
        limit = baseline_val

        # In strict mode, dead_code_files must reach 0.
        if strict and key == "dead_code_files":
            limit = 0

        if cur > limit:
            violations += 1
            if verbose:
                print(
                    f"  [FAIL] {key}: {cur} > {limit} "
                    f"(+{cur - limit})"
                )
        elif verbose:
            status = "  [OK]"
            print(f"  {status} {key}: {cur} (<= {limit})")
            if key != "dead_code_files" and cur < baseline_val:
                print(
                    f"         hint: {key} is below baseline "
                    f"({cur} < {baseline_val}) — run "
                    "`python -m scripts.check_concept_growth --ratchet` "
                    "to lock the reduction"
                )

    if verbose:
        print()
        if violations:
            print(
                f"FAIL: {violations} metric(s) exceed baseline.\n"
                "If this increase is intentional (e.g. a new concept), the PR must\n"
                "also DELETE an existing concept so the net change is ≤ 0.\n"
                "See docs/02-concepts/runtime-algebra.md §3.2 (Concept Addition Cost)."
            )
        else:
            print("PASS: all metrics within baseline.")

    return 1 if violations > 0 else 0


def _record_snapshot():
    """Append current metrics to the architecture history file (JSONL).

    Used by CI and `make architecture-record` to build the trend timeline
    consumed by `health_dashboard.py`.
    """
    import json
    from datetime import UTC, datetime

    current: dict[str, int | str] = dict(measure_all())
    current["ts"] = datetime.now(UTC).isoformat()

    data_dir = ROOT / "backend" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    history = data_dir / "architecture_history.jsonl"

    with open(history, "a") as f:
        f.write(json.dumps(current) + "\n")

    print(f"Snapshot recorded ({len(list(open(history)))} total): {current['ts']}")
    # Also run check so the record step gates on the same baseline
    code = check(verbose=False)
    if code != 0:
        print("WARNING: current metrics exceed baseline — snapshot recorded but check would fail.")


def snapshot():
    """Print current measurements as a markdown table for the baseline doc."""
    current = measure_all()
    print("Current Architecture Contract baseline:")
    print()
    print("| 指标 | 当前值 | 1 年目标 |")
    print("|---|---|---|")
    print(f"| `core/runtime/` 文件数 | {current['runtime_files']} | ≤ {max(current['runtime_files'] - 16, 45)} |")
    print(f"| `constants.py` 事件类型数 | {current['event_types']} | ≤ {max(current['event_types'] - 12, 55)} |")
    print(f"| `query_state` selector 分支数 | {current['query_state_selectors']} | ≤ {max(current['query_state_selectors'] - 5, 10)} |")
    print(f"| Fragment 注册数 | {current['fragments']} | ≤ {max(current['fragments'] - 3, 10)} |")
    print(f"| Governed 表数 | {current['governed_tables']} | ≤ {max(current['governed_tables'] - 2, 13)} |")
    print(f"| Projector 文件数 | {current['projector_files']} | ≤ {max(current['projector_files'] - 3, 7)} |")
    print(f"| God Object 最大 LOC | {current['god_object_max_loc']} | ≤ {max(current['god_object_max_loc'] - 500, 1500)} |")
    print(f"| Dead Code 文件数 | {current['dead_code_files']} | 0 |")


def _ratchet_baseline() -> int:
    """Lower BASELINE (and docs §4.4) to match current measurements.

    Only decreases values — never raises a ceiling. Refuses to write anything
    unless ``--yes`` is passed; run without it to preview the exact edits.
    Returns 0 on success, 1 when guarded or a rewrite failed.
    """
    current = measure_all()
    script_path = Path(__file__).resolve()
    text = script_path.read_text(encoding="utf-8")
    lowered: list[str] = []

    for key, baseline_val in list(BASELINE.items()):
        if key == "dead_code_files":
            continue
        cur = current[key]
        if cur >= baseline_val:
            continue
        # Replace the integer assigned to this key inside BASELINE = {...}.
        pattern = re.compile(
            rf'(BASELINE\s*=\s*\{{[\s\S]*?"{re.escape(key)}"\s*:\s*){baseline_val}\b'
        )
        new_text, n = pattern.subn(rf"\g<1>{cur}", text, count=1)
        if n != 1:
            print(f"  [FAIL] could not rewrite BASELINE[{key}] in {script_path.name}")
            return 1
        text = new_text
        lowered.append(f"{key}: {baseline_val} → {cur}")
        BASELINE[key] = cur

    if not lowered:
        print("No baselines to ratchet (current >= baseline for all metrics).")
        return 0

    # Compute the docs §4.4 rewrite as well; only write files when confirmed.
    doc = ROOT / "docs" / "02-concepts" / "runtime-algebra.md"
    doc_text = doc.read_text(encoding="utf-8")
    section_parts = doc_text.split("### 4.4", 1)
    if len(section_parts) < 2:
        print("  [FAIL] docs missing ### 4.4 section")
        return 1
    head, rest = section_parts
    body_end_markers = ["\n---", "\n## "]
    body = rest
    tail = ""
    for marker in body_end_markers:
        if marker in rest:
            body, tail_rest = rest.split(marker, 1)
            tail = marker + tail_rest
            break

    def repl_row(m: re.Match[str]) -> str:
        limit_s, key = m.group(1), m.group(2)
        if key in BASELINE and key != "dead_code_files":
            return m.group(0).replace(f"| {limit_s} |", f"| {BASELINE[key]} |", 1)
        return m.group(0)

    row_re = re.compile(
        r"^\|\s*[^|]+\|\s*(\d+)\s*\|\s*`([a-z_]+)`\s*\|",
        re.MULTILINE,
    )
    new_doc = head + "### 4.4" + row_re.sub(repl_row, body) + tail

    if "--yes" not in sys.argv:
        print("Would ratchet the following — pass --yes to apply:")
        for line in lowered:
            print(f"  {line}")
        print(f"  docs §4.4 → {doc.relative_to(ROOT)}")
        return 1

    script_path.write_text(text, encoding="utf-8", newline="\n")
    print("Ratcheted BASELINE:")
    for line in lowered:
        print(f"  {line}")
    doc.write_text(new_doc, encoding="utf-8", newline="\n")
    print(f"Synced docs §4.4 → {doc.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    if "--snapshot" in sys.argv:
        snapshot()
    elif "--record" in sys.argv:
        _record_snapshot()
    elif "--ratchet" in sys.argv:
        sys.exit(_ratchet_baseline())
    else:
        strict = "--strict" in sys.argv
        code = check(strict=strict)
        if code == 0:
            code = check_docs_baseline_sync(verbose=True)
        if code == 0:
            code = check_subsystem_budgets(verbose=True)
        sys.exit(code)
