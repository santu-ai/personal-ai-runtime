"""Capability 双写窗口（P0）——调用意图持久化 + 启动清扫。

write-class 工具在外部副作用发生前先把调用意图写入 APP_STORAGE
``plan_resumes``（键 ``cap_intent:{id}``），审计事件落库后清除；进程在
「副作用 → 审计事件」窗口内死亡时，RuntimeLoop 启动清扫为遗留意图补发
``CapabilityFailed(error=interrupted_before_audit)``，保证审计闭合。
"""

from __future__ import annotations

import pytest

from app.core.runtime.plan_resume import (
    CAPABILITY_INTENT_PREFIX,
    clear_plan_resumes,
    configure_plan_resume_db,
    record_capability_intent,
    take_stale_capability_intents,
)


@pytest.fixture(autouse=True)
def _plan_resume_db(isolated_kernel):
    """plan_resumes 绑定隔离 DB，避免污染全局 store。"""
    _k, db = isolated_kernel
    configure_plan_resume_db(db)
    clear_plan_resumes()
    yield
    clear_plan_resumes()
    configure_plan_resume_db(None)


def _intent_rows(db) -> list[str]:
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT approval_id FROM plan_resumes WHERE approval_id LIKE ?",
            (f"{CAPABILITY_INTENT_PREFIX}%",),
        ).fetchall()
    return [r["approval_id"] for r in rows]


@pytest.mark.asyncio
async def test_write_class_invoke_clears_intent_after_audit(isolated_kernel, allow_tmp_fs):
    """成功路径：CapabilityInvoked 落库后意图行必须清除。"""
    k, db = isolated_kernel
    args = {"path": str(allow_tmp_fs / "x.txt"), "content": "hi"}

    cap = await k.invoke_capability("write_file", args, actor="user")
    assert cap["status"] == "pending"

    cap2 = await k.invoke_capability(
        "write_file",
        args,
        actor="user",
        correlation_id="intent-corr",
        pre_approved=True,
        approval_id=cap["approval_id"],
    )
    assert cap2["status"] == "success"

    assert _intent_rows(db) == []
    invoked = k.read_events(type="CapabilityInvoked")
    assert any(e.payload.get("name") == "write_file" for e in invoked)


@pytest.mark.asyncio
async def test_read_class_invoke_writes_no_intent(isolated_kernel):
    """读类工具不产生意图行（避免热路径双倍写放大）。"""
    k, db = isolated_kernel

    recorded: list[str] = []

    async def _spy_invoke(name, args):
        recorded.append(name)
        return "now"

    from app.core.harness.mcp_hub import mcp_hub

    original = mcp_hub.invoke_tool
    mcp_hub.invoke_tool = _spy_invoke  # type: ignore[method-assign]
    try:
        cap = await k.invoke_capability("get_current_time", {}, actor="user")
    finally:
        mcp_hub.invoke_tool = original  # type: ignore[method-assign]

    assert cap["status"] == "success"
    assert recorded == ["get_current_time"]
    assert _intent_rows(db) == []


def test_stale_intent_reconciled_on_startup(isolated_kernel):
    """崩溃窗口：遗留意图行由启动清扫补发 CapabilityFailed 并清除。"""
    from app.core.runtime import runtime_loop as rl_mod

    k, db = isolated_kernel
    record_capability_intent(
        "dead-1",
        name="send_email",
        args_summary="{'to': 'a@b.c'}",
        actor="brain",
        correlation_id="corr-dead",
        kernel=k,
    )
    assert _intent_rows(db) == [f"{CAPABILITY_INTENT_PREFIX}dead-1"]

    loop = rl_mod.RuntimeLoop()
    assert loop._reconcile_interrupted_capability_intents() == 1

    failed = k.read_events(type="CapabilityFailed")
    matched = [
        e for e in failed
        if e.payload.get("error") == "interrupted_before_audit"
        and e.payload.get("name") == "send_email"
    ]
    assert len(matched) == 1
    assert matched[0].actor == "brain"
    assert matched[0].correlation_id == "corr-dead"

    # 行已消费——二次清扫幂等为 0。
    assert _intent_rows(db) == []
    assert loop._reconcile_interrupted_capability_intents() == 0


def test_take_stale_capability_intents_returns_payload(isolated_kernel):
    """清扫返回的意图 payload 携带补发审计事件所需的全部字段。"""
    k, _db = isolated_kernel
    record_capability_intent(
        "dead-2",
        name="shell_exec",
        args_summary="{'command': 'ls'}",
        actor="user",
        correlation_id=None,
        kernel=k,
    )
    intents = take_stale_capability_intents(kernel=k)
    assert len(intents) == 1
    intent = intents[0]
    assert intent["name"] == "shell_exec"
    assert intent["args_summary"] == "{'command': 'ls'}"
    assert intent["actor"] == "user"
    assert intent["correlation_id"] == ""
    assert intent["intent_key"] == f"{CAPABILITY_INTENT_PREFIX}dead-2"
    # 已被取走。
    assert take_stale_capability_intents(kernel=k) == []
