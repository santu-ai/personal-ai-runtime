"""Runtime validation benchmarks — real Kernel + real tools, no fake success."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.chat.prompt_compiler import CompileContext, PromptCompiler
from app.config import BASE_DIR
from app.core.agents.memory_engine import MemoryEngine
from app.core.harness.builtin_tools.filesystem import filesystem_server
from app.core.harness.mcp_hub import ToolDef, mcp_hub
from app.core.runtime.handlers.plan_runner import run_plan_steps
from app.core.runtime.kernel.kernel import Kernel
from app.core.runtime.plan_resume import (
    configure_plan_resume_db,
    load_plan_progress,
)
from app.core.runtime.read_ports.events import reconstruct_execution_trace
from app.store.database import Database
from tests.eval.harness import EvalClock, EvalRecord

REPO = str(BASE_DIR.resolve())


@pytest.fixture
def kernel(isolated_kernel):
    k, _db = isolated_kernel
    return k


def _allow_tmp(tmp_path: Path):
    old = list(filesystem_server.allowed_dirs)
    filesystem_server.allowed_dirs = old + [str(tmp_path.resolve())]
    return old


# ── 01 Tool Use ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_benchmark_01_tool_use_reads_real_file(kernel):
    clock = EvalClock()
    cid = "bm01"
    target = Path(REPO) / "backend" / "app" / "core" / "harness" / "mcp_hub.py"
    result = await kernel.invoke_capability(
        "read_file",
        {"path": str(target), "max_lines": 40},
        actor="user",
        correlation_id=cid,
    )
    rec = EvalRecord(
        task_id="bm01_tool_use",
        input=str(target),
        expected_behavior="read_file success; first lines include ToolInvokeError",
        actual_behavior=str(result.get("status")),
        success=result.get("status") == "success" and "ToolInvokeError" in str(result.get("result", "")),
        failure_reason=None if result.get("status") == "success" else result.get("error"),
        tool_calls=["read_file"],
        duration_s=clock.elapsed(),
        trace_id=cid,
    )
    assert rec.success, rec.as_dict()
    trace = reconstruct_execution_trace(cid)
    assert any(t["name"] == "read_file" and t["success"] for t in trace["tools"])


# ── 02 Multi-step ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_benchmark_02_multistep_git_then_read(kernel):
    clock = EvalClock()
    cid = "bm02"
    log = await kernel.invoke_capability(
        "git_log",
        {"repo_path": REPO, "max_count": 5},
        actor="user",
        correlation_id=cid,
    )
    status = await kernel.invoke_capability(
        "git_status",
        {"repo_path": REPO},
        actor="user",
        correlation_id=cid,
    )
    read = await kernel.invoke_capability(
        "read_file",
        {"path": str(Path(REPO) / "AGENTS.md"), "max_lines": 20},
        actor="user",
        correlation_id=cid,
    )
    ok = all(r.get("status") == "success" for r in (log, status, read))
    log_body = str(log.get("result") or "")
    rec = EvalRecord(
        task_id="bm02_multistep",
        input="git_log + git_status + read AGENTS.md",
        expected_behavior="three successful tool calls; log is git output not access-denied",
        actual_behavior=f"ok={ok} log_has_error={'error' in log_body[:80]}",
        success=ok and "Not a git repository" not in log_body and "Access denied" not in log_body,
        failure_reason=None if ok else "a step failed",
        tool_calls=["git_log", "git_status", "read_file"],
        duration_s=clock.elapsed(),
        trace_id=cid,
    )
    assert rec.success, rec.as_dict()
    trace = reconstruct_execution_trace(cid)
    assert len([t for t in trace["tools"] if t["success"]]) >= 3


# ── 03 Tool Failure ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_benchmark_03_tool_failure_is_visible(kernel, monkeypatch, tmp_path):
    clock = EvalClock()
    cid = "bm03"

    def boom() -> str:
        raise RuntimeError("forced boom")

    async def slow() -> str:
        await asyncio.sleep(2)
        return "nope"

    mcp_hub.register_tool(ToolDef(
        name="bm03_boom", description="x",
        parameters={"type": "object", "properties": {}}, handler=boom,
    ))
    mcp_hub.register_tool(ToolDef(
        name="bm03_slow", description="x",
        parameters={"type": "object", "properties": {}},
        handler=slow, is_async=True,
    ))
    monkeypatch.setattr("app.config.settings.tool_timeout_seconds", 0.05)
    try:
        missing = await kernel.invoke_capability(
            "bm03_no_such", {}, actor="user", correlation_id=cid,
        )
        crashed = await kernel.invoke_capability(
            "bm03_boom", {}, actor="user", correlation_id=cid,
        )
        timed = await kernel.invoke_capability(
            "bm03_slow", {}, actor="user", correlation_id=cid,
        )
        monkeypatch.setattr("app.config.settings.tool_timeout_seconds", 30)
        absent = tmp_path / "bm03-absent.txt"
        old = _allow_tmp(tmp_path)
        try:
            missing_file = await kernel.invoke_capability(
                "read_file",
                {"path": str(absent)},
                actor="user",
                correlation_id=cid,
            )
        finally:
            filesystem_server.allowed_dirs = old
    finally:
        mcp_hub.unregister_tool("bm03_boom")
        mcp_hub.unregister_tool("bm03_slow")

    outcomes = {
        "missing": missing.get("outcome"),
        "crashed": crashed.get("outcome"),
        "timed": timed.get("outcome"),
        "missing_file": missing_file.get("outcome"),
    }
    rec = EvalRecord(
        task_id="bm03_tool_failure",
        input="missing + exception + timeout + absent file",
        expected_behavior="tool_not_found / tool_execution_failure / tool_timeout / missing file failed",
        actual_behavior=str(outcomes),
        success=(
            outcomes["missing"] == "tool_not_found"
            and outcomes["crashed"] == "tool_execution_failure"
            and outcomes["timed"] == "tool_timeout"
            and outcomes["missing_file"] == "tool_execution_failure"
            and missing_file.get("status") == "error"
        ),
        failure_reason=None,
        tool_failures=list(outcomes.values()),
        duration_s=clock.elapsed(),
        trace_id=cid,
    )
    assert rec.success, rec.as_dict()
    invoked = [e for e in kernel.read_events(correlation_id=cid) if e.type == "CapabilityInvoked"]
    assert invoked == []


# ── 04 Approval ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_benchmark_04_approval_then_real_write(kernel, tmp_path):
    clock = EvalClock()
    cid = "bm04"
    old = _allow_tmp(tmp_path)
    target = tmp_path / "approved.txt"
    args = {"path": str(target), "content": "approved-by-human-sim"}
    try:
        pending = await kernel.invoke_capability(
            "write_file", args, actor="user", correlation_id=cid,
        )
        assert pending.get("status") == "pending"
        assert pending.get("outcome") == "approval_required"
        assert not target.exists()

        granted = await kernel.invoke_capability(
            "write_file",
            args,
            actor="user",
            correlation_id=cid + "_exec",
            pre_approved=True,
            approval_id=pending["approval_id"],
        )
        rec = EvalRecord(
            task_id="bm04_approval",
            input=str(target),
            expected_behavior="pending then write after grant; file exists",
            actual_behavior=f"{pending.get('status')} -> {granted.get('status')} exists={target.exists()}",
            success=granted.get("status") == "success" and target.exists(),
            failure_reason=granted.get("error"),
            tool_calls=["write_file"],
            duration_s=clock.elapsed(),
            trace_id=cid,
        )
        assert rec.success, rec.as_dict()
        assert "approved-by-human-sim" in target.read_text(encoding="utf-8")
    finally:
        filesystem_server.allowed_dirs = old


# ── 05 Denial ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_benchmark_05_forbidden_has_no_side_effect(kernel):
    clock = EvalClock()
    cid = "bm05"
    touched = {"n": 0}

    def side() -> str:
        touched["n"] += 1
        return "should-not-run"

    mcp_hub.register_tool(ToolDef(
        name="bm05_side", description="x",
        parameters={"type": "object", "properties": {}}, handler=side,
    ))
    kernel.emit_event(
        "PolicyCreated", "policy", "policy_bm05_side",
        payload={"capability": "bm05_side", "risk_level": "forbidden"},
        actor="user",
    )
    try:
        result = await kernel.invoke_capability(
            "bm05_side", {}, actor="user", correlation_id=cid,
        )
    finally:
        mcp_hub.unregister_tool("bm05_side")

    rec = EvalRecord(
        task_id="bm05_denial",
        input="forbidden bm05_side",
        expected_behavior="authorization_failure and handler never runs",
        actual_behavior=f"status={result.get('status')} n={touched['n']}",
        success=(
            result.get("status") == "error"
            and result.get("outcome") == "authorization_failure"
            and touched["n"] == 0
        ),
        failure_reason=result.get("error"),
        duration_s=clock.elapsed(),
        trace_id=cid,
    )
    assert rec.success, rec.as_dict()
    assert not any(
        e.type == "CapabilityInvoked"
        for e in kernel.read_events(correlation_id=cid)
    )


# ── 06 Memory ────────────────────────────────────────────────────────────


def test_benchmark_06_memory_recall_changes_retrieval(kernel):
    """Two-phase: store a fact, then recall. No live LLM — measures retrieval only.

    Isolated Kernel has no Chroma; attach a real in-process index so write→read
    is exercised. Embedding quality is NOT MEASURED.
    """
    clock = EvalClock()

    class _Index:
        def __init__(self) -> None:
            self.docs: dict[str, str] = {}

        def index_memory(self, content, metadata=None, memory_id=None):
            mid = memory_id or "m"
            self.docs[mid] = content
            return mid

        def search_memories(self, query, n_results=5):
            return [
                {"id": mid, "content": text, "metadata": {}, "distance": 0.1}
                for mid, text in list(self.docs.items())[:n_results]
            ]

        def delete_memory(self, memory_id):
            self.docs.pop(memory_id, None)

    kernel._memory_index = _Index()
    engine = MemoryEngine()
    before = engine.recall_for_context("What is the favorite runtime color?", max_memories=3)
    before_hit = any("ultraviolet-green" in (h.get("content") or "") for h in before)

    engine.store_memory(
        "The user's favorite runtime color is ultraviolet-green.",
        category="fact",
        actor="user",
        confidence=0.9,
    )
    hits = engine.recall_for_context("What is the favorite runtime color?", max_memories=3)
    contents = " ".join(h.get("content", "") for h in hits)
    found = "ultraviolet-green" in contents
    rec = EvalRecord(
        task_id="bm06_memory",
        input="store color fact then recall",
        expected_behavior="empty before store; hit after store",
        actual_behavior=f"before_hit={before_hit} after={contents[:200] or '(empty)'}",
        success=(not before_hit) and found,
        failure_reason=None if found else "memory did not change retrieval",
        duration_s=clock.elapsed(),
        notes="In-process index (not Chroma). Agent behavior NOT MEASURED (no live LLM).",
    )
    assert rec.success, rec.as_dict()


# ── 07 Context ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_benchmark_07_context_selection_vs_noise(isolated_kernel):
    """Chat-stage selection for a math question must not pull mail fragments.

    Does not assert brief<=chat length: brief always injects calendar and can
    be larger when chat has no memories. LLM task success is measured by
    ``tests/e2e_live/test_live_context_eval.py`` (opt-in live LLM).
    """
    clock = EvalClock()
    compiler = PromptCompiler()
    full = await compiler.compile(
        CompileContext(
            conversation_id="bm07",
            execution_id="ex",
            user_message="What is 2+2?",
            stage="chat",
        ),
        budget=8000,
    )
    from app.core.runtime.governance.context_pipeline import context_pipeline

    plan = context_pipeline.last_compile_plan()
    ids = list(plan.selected_fragment_ids) if plan else []
    mail_in_math = any(i.startswith("mail.") for i in ids)
    rec = EvalRecord(
        task_id="bm07_context",
        input="What is 2+2?",
        expected_behavior="chat stage for a math question does not select mail fragments",
        actual_behavior=f"ids={ids} chat_len={len(full)}",
        success=not mail_in_math and len(full) > 0,
        failure_reason=None,
        duration_s=clock.elapsed(),
        notes="Task success vs relevance is measured by live_bm07_context_ab; this measures selection.",
    )
    assert rec.success, rec.as_dict()


@pytest.mark.asyncio
async def test_benchmark_07b_mail_fragment_content_vs_offtopic(isolated_kernel):
    """Seeded inbox nonce is assembled for a mail question and omitted for math.

    Does not call an LLM. Live task-success is ``live_bm07_context_ab``.
    """
    from datetime import UTC, datetime

    from app.core.runtime.kernel import constants

    k, _db = isolated_kernel
    nonce = "QX-7N-MIRROR"
    k.emit_event(
        constants.EVENT_INBOX_EMAIL_RECORDED,
        constants.AGGREGATE_INBOX_EMAIL,
        "bm07b-mail",
        payload={
            "sender": "ops@example.test",
            "subject": f"Runtime passphrase {nonce}",
            "preview": f"Passphrase: {nonce}. Ignore other mail.",
            "received_at": datetime.now(UTC).isoformat(),
            "category": "important",
            "importance": 0.99,
            "reason": "bm07b",
        },
        actor="test",
    )

    clock = EvalClock()
    compiler = PromptCompiler()
    from app.core.runtime.governance.context_pipeline import context_pipeline

    math_prompt = await compiler.compile(
        CompileContext(
            conversation_id="bm07b-math",
            execution_id="bm07b-math-ex",
            user_message="What is 2+2?",
            stage="chat",
        ),
        budget=8000,
    )
    math_ids = list(context_pipeline.last_compile_plan().selected_fragment_ids)
    math_ok = (not any(i.startswith("mail.") for i in math_ids)) and (nonce not in math_prompt)

    mail_prompt = await compiler.compile(
        CompileContext(
            conversation_id="bm07b-mail",
            execution_id="bm07b-mail-ex",
            user_message="What passphrase is in my latest email?",
            stage="chat",
        ),
        budget=8000,
    )
    mail_ids = list(context_pipeline.last_compile_plan().selected_fragment_ids)
    mail_ok = ("mail.recent_emails" in mail_ids) and (nonce in mail_prompt)

    rec = EvalRecord(
        task_id="bm07b_context_content",
        input="mail question vs 2+2 after seeding inbox nonce",
        expected_behavior="mail compile contains nonce; math compile does not select mail or leak nonce",
        actual_behavior=f"math_ids={math_ids} mail_ids={mail_ids} math_has={nonce in math_prompt} mail_has={nonce in mail_prompt}",
        success=math_ok and mail_ok,
        failure_reason=None if math_ok and mail_ok else "mail fragment assembly/selection mismatch",
        duration_s=clock.elapsed(),
        notes="Compile-only. Live LLM A/B is tests/e2e_live/test_live_context_eval.py.",
    )
    assert rec.success, rec.as_dict()


# ── 08 Restart / Recovery ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_benchmark_08_plan_survives_kernel_restart(tmp_path):
    clock = EvalClock()
    db_path = str(tmp_path / "bm08.db")
    db = Database(db_path=db_path)
    k1 = Kernel(db=db)
    configure_plan_resume_db(db)

    seen = {"n": 0}

    def step_tool() -> str:
        seen["n"] += 1
        return f"step-ok-{seen['n']}"

    mcp_hub.register_tool(ToolDef(
        name="bm08_step", description="x",
        parameters={"type": "object", "properties": {}}, handler=step_tool,
    ))
    action_id = "bm08_action"
    steps = [
        {"tool": "bm08_step", "params": {}},
        {"tool": "bm08_step", "params": {}},
    ]
    try:
        first = await run_plan_steps(
            steps=steps[:1],
            kernel=k1,
            actor="user",
            execution_id=None,
            correlation_id="bm08a",
            action_id=action_id,
        )
        assert first.stopped_reason == "completed"
        progress = load_plan_progress(action_id, kernel=k1)
        assert progress is not None
        assert progress.resume_from == 1

        # Simulate process restart: new Kernel, same sqlite.
        k2 = Kernel(db=Database(db_path=db_path))
        configure_plan_resume_db(k2._db)
        resumed = load_plan_progress(action_id, kernel=k2)
        assert resumed is not None
        second = await run_plan_steps(
            steps=steps,
            kernel=k2,
            actor="user",
            execution_id=None,
            correlation_id="bm08b",
            resume_from=resumed.resume_from,
            action_id=action_id,
        )
        rec = EvalRecord(
            task_id="bm08_restart",
            input="two-step plan, restart after step 0",
            expected_behavior="second kernel resumes at step 1; handler runs twice total",
            actual_behavior=f"resume_from={resumed.resume_from} second={second.stopped_reason} n={seen['n']}",
            success=second.stopped_reason == "completed" and seen["n"] == 2,
            failure_reason=None,
            duration_s=clock.elapsed(),
        )
        assert rec.success, rec.as_dict()
    finally:
        mcp_hub.unregister_tool("bm08_step")
        configure_plan_resume_db(None)


# ── 09 Long-running work ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_benchmark_09_work_item_state_and_tools(kernel):
    clock = EvalClock()
    cid = "bm09"
    kernel.emit_event(
        "WorkItemCreated",
        "work_item",
        "bm09_wi",
        payload={
            "title": "long work",
            "work_type": "task",
            "status": "pending",
            "executable_plan": json.dumps({
                "steps": [
                    {"tool": "get_current_time", "params": {}},
                    {"tool": "git_status", "params": {"repo_path": REPO}},
                ],
            }),
        },
        actor="user",
        correlation_id=cid,
    )
    kernel.emit_event(
        "WorkItemStatusChanged", "work_item", "bm09_wi",
        payload={"status": "running"}, actor="user", correlation_id=cid,
    )
    outcome = await run_plan_steps(
        steps=[
            {"tool": "get_current_time", "params": {}},
            {"tool": "git_status", "params": {"repo_path": REPO}},
        ],
        kernel=kernel,
        actor="user",
        execution_id=None,
        correlation_id=cid,
        action_id="bm09_wi",
    )
    kernel.emit_event(
        "WorkItemStatusChanged", "work_item", "bm09_wi",
        payload={"status": "completed" if outcome.stopped_reason == "completed" else "failed"},
        actor="user",
        correlation_id=cid,
    )
    trace = reconstruct_execution_trace(cid)
    rec = EvalRecord(
        task_id="bm09_long_work",
        input="work_item + two tools + status transitions",
        expected_behavior="plan completed; trace has work + tools + transitions",
        actual_behavior=f"{outcome.stopped_reason} tools={len(trace['tools'])} transitions={len(trace['state_transitions'])}",
        success=(
            outcome.stopped_reason == "completed"
            and len(trace["tools"]) >= 2
            and len(trace["state_transitions"]) >= 2
            and trace["work_items"]
        ),
        failure_reason=None,
        tool_calls=[t["name"] for t in trace["tools"]],
        duration_s=clock.elapsed(),
        trace_id=cid,
    )
    assert rec.success, rec.as_dict()


# ── 10 Dogfood ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_benchmark_10_dogfood_repo_via_runtime(kernel):
    clock = EvalClock()
    cid = "bm10"
    log = await kernel.invoke_capability(
        "git_log", {"repo_path": REPO, "max_count": 8}, actor="user", correlation_id=cid,
    )
    diff = await kernel.invoke_capability(
        "git_diff", {"repo_path": REPO}, actor="user", correlation_id=cid,
    )
    agents = await kernel.invoke_capability(
        "read_file",
        {"path": str(Path(REPO) / "AGENTS.md"), "max_lines": 80},
        actor="user",
        correlation_id=cid,
    )
    hub = await kernel.invoke_capability(
        "read_file",
        {"path": str(Path(REPO) / "backend" / "app" / "core" / "harness" / "mcp_hub.py"), "max_lines": 80},
        actor="user",
        correlation_id=cid,
    )
    results = [log, diff, agents, hub]
    ok = all(r.get("status") == "success" for r in results)
    hub_text = str(hub.get("result") or "")
    rec = EvalRecord(
        task_id="bm10_dogfood",
        input="inspect this repo via Runtime tools",
        expected_behavior="git_log/diff + AGENTS.md + mcp_hub.py readable; hub mentions ToolInvokeError",
        actual_behavior=f"ok={ok} has_ToolInvokeError={'ToolInvokeError' in hub_text}",
        success=ok and "ToolInvokeError" in hub_text,
        failure_reason=None if ok else "tool step failed",
        tool_calls=["git_log", "git_diff", "read_file"],
        duration_s=clock.elapsed(),
        trace_id=cid,
        notes="Coding Agent applies the code fix; this benchmark proves Runtime can inspect the repo.",
    )
    assert rec.success, rec.as_dict()
    trace = reconstruct_execution_trace(cid)
    assert len(trace["tools"]) >= 4
