"""Compile project-brief results into an event-sourced delivery."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.product.project_brief import (
    brief_compile_failure,
    compile_project_brief_delivery,
    create_project_brief_work,
)
from app.product.work_delivery import fold_delivery_history


@pytest.mark.asyncio
async def test_compile_publishes_full_content(isolated_kernel):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "query": "", "days": 30}},
    )
    outcome = SimpleNamespace(results=[
        SimpleNamespace(
            tool="check_inbox",
            status="success",
            result=json.dumps({
                "emails": [{
                    "message_id": "m1",
                    "subject": "项目变化",
                    "from": "a@b.c",
                    "date": "2099-01-01T00:00:00+00:00",
                    "preview": "进度延期",
                }],
            }),
        ),
    ])

    async def fake_llm(_prompt: str) -> str:
        return json.dumps({
            "summary": "有延期风险",
            "content": "全文" + ("x" * 1200),
            "findings": [{
                "text": "进度延期",
                "kind": "risk",
                "source_ids": ["email:m1"],
            }],
            "suggested_actions": [{"title": "核对排期", "reason": "延期", "source_ids": ["email:m1"]}],
            "limitations": [],
        })

    compiled = await compile_project_brief_delivery(
        item["id"],
        outcome,
        execution_id="exec-full",
        llm_complete=fake_llm,
    )
    assert compiled["ok"] is True
    delivery = compiled["delivery"]
    assert "进度延期" in delivery["content"]
    assert delivery["quality_structure"] == "passed"
    assert delivery["quality_evidence"] == "pending"
    assert delivery["retrieval"]["email"]["enabled"] is True
    assert "检索范围" in delivery["content"]
    evidence = delivery["findings"][0]["evidence"][0]
    assert evidence["source_id"] == "email:m1"
    assert "进度延期" in evidence["snippet"]
    folded = fold_delivery_history(item["id"])
    assert folded["current"]["content"] == delivery["content"]
    assert folded["current"]["quality_structure"] == "passed"
    assert folded["current"]["sources"][0]["id"] == "email:m1"
    assert "进度延期" in delivery["content"]
    assert "`email:m1`" in delivery["content"]


@pytest.mark.asyncio
async def test_compile_rejects_forged_model_output(isolated_kernel):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    outcome = SimpleNamespace(results=[
        SimpleNamespace(
            tool="check_inbox",
            status="success",
            result=json.dumps({
                "emails": [{
                    "message_id": "m1",
                    "subject": "项目",
                    "from": "a@b.c",
                    "date": "2099-01-01T00:00:00+00:00",
                    "preview": "ok",
                }],
            }),
        ),
    ])

    async def fake_llm(_prompt: str) -> str:
        return json.dumps({
            "summary": "s",
            "content": "c",
            "findings": [{"text": "x", "source_ids": ["email:forged"]}],
        })

    compiled = await compile_project_brief_delivery(
        item["id"],
        outcome,
        execution_id="exec-bad",
        llm_complete=fake_llm,
    )
    assert compiled["ok"] is False
    assert fold_delivery_history(item["id"])["current"] is None


@pytest.mark.asyncio
async def test_compile_source_failure_is_unqualified(isolated_kernel):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 3}},
    )
    outcome = SimpleNamespace(results=[
        SimpleNamespace(
            tool="check_inbox",
            status="failed",
            result="Email credentials not configured",
        ),
    ])
    compiled = await compile_project_brief_delivery(
        item["id"],
        outcome,
        execution_id="exec-fail",
    )
    assert compiled["ok"] is True
    assert compiled["qualified"] is False
    current = fold_delivery_history(item["id"])["current"]
    assert current is not None
    assert "失败" in current["summary"] or current["qualified"] is False


@pytest.mark.asyncio
async def test_compile_links_llm_call_to_execution(isolated_kernel, monkeypatch):
    kernel, _db = isolated_kernel
    kernel.emit_event(
        "ExecutionRequested",
        "execution",
        "exec-llm",
        payload={"execution_id": "exec-llm", "correlation_id": "corr-llm"},
        correlation_id="corr-llm",
    )
    item = create_project_brief_work(title="A", objective="列出变化", source_scope={})
    seen: list[dict] = []

    async def fake_complete(_messages, **kwargs):
        seen.append(kwargs)
        return '{"summary":"s"}', "fake"

    monkeypatch.setattr(
        "app.core.agents.brain_llm_ops.complete_text_with_failover",
        fake_complete,
    )
    await compile_project_brief_delivery(
        item["id"],
        SimpleNamespace(results=[]),
        execution_id="exec-llm",
    )
    assert seen
    assert seen[0]["caused_by"] == "exec-llm"
    assert seen[0]["correlation_id"] == "corr-llm"
    assert seen[0]["purpose"] == "project_brief"
    assert seen[0]["data_sources"] is None


@pytest.mark.asyncio
async def test_compile_declares_email_and_file_sources(isolated_kernel, monkeypatch):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={
            "email": {"enabled": True, "query": "", "days": 30},
            "files": [{"path": "/tmp/notes.txt", "label": "笔记"}],
        },
    )
    outcome = SimpleNamespace(results=[
        SimpleNamespace(
            tool="check_inbox",
            status="success",
            result=json.dumps({
                "emails": [{
                    "message_id": "m1",
                    "subject": "项目变化",
                    "from": "a@b.c",
                    "date": "2099-01-01T00:00:00+00:00",
                    "preview": "只是普通进度，没有特殊标记",
                }],
            }),
        ),
        SimpleNamespace(
            tool="read_file",
            status="success",
            step=1,
            result="本地笔记：下周三评审",
        ),
    ])
    seen: list[dict] = []

    async def fake_complete(messages, **kwargs):
        seen.append({"messages": messages, **kwargs})
        return json.dumps({
            "summary": "有评审",
            "content": "全文",
            "findings": [{
                "text": "下周三评审",
                "kind": "change",
                "source_ids": ["email:m1"],
            }],
            "suggested_actions": [],
            "limitations": [],
        }), "fake"

    monkeypatch.setattr(
        "app.core.agents.brain_llm_ops.complete_text_with_failover",
        fake_complete,
    )
    await compile_project_brief_delivery(item["id"], outcome, execution_id="exec-src")
    assert seen[0]["data_sources"] == ["email", "file"]
    body = seen[0]["messages"][1]["content"]
    assert "只是普通进度，没有特殊标记" in body
    assert "本地笔记：下周三评审" in body


def _inbox_outcome() -> SimpleNamespace:
    return SimpleNamespace(results=[
        SimpleNamespace(
            tool="check_inbox",
            status="success",
            result=json.dumps({
                "emails": [{
                    "message_id": "m1",
                    "subject": "项目变化",
                    "from": "a@b.c",
                    "date": "2099-01-01T00:00:00+00:00",
                    "preview": "进度延期",
                }],
            }),
        ),
    ])


def test_create_project_brief_stores_a_non_negative_cost_cap(isolated_kernel):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        cost_cap_usd=0.05,
    )
    plan = json.loads(item["executable_plan"])
    assert plan["contract"]["cost_cap_usd"] == 0.05
    with pytest.raises(ValueError, match="非负"):
        create_project_brief_work(title="A", objective="列出变化", cost_cap_usd=-1)


@pytest.mark.asyncio
async def test_compile_stops_when_the_cost_cap_would_be_exceeded(isolated_kernel, monkeypatch):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
        cost_cap_usd=0,
    )
    monkeypatch.setattr(
        "app.product.project_brief._provider_token_prices",
        lambda: (1.0, 1.0, "test-model"),
    )
    called = False

    async def fake_llm(_prompt: str) -> str:
        nonlocal called
        called = True
        return "{}"

    compiled = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-cap",
        llm_complete=fake_llm,
    )
    assert called is False
    assert compiled["ok"] is True
    assert compiled["qualified"] is False
    assert compiled["cost_capped"] is True
    assert compiled["delivery"]["quality_structure"] == "failed"
    assert any("单次费用上限" in note for note in compiled["delivery"]["limitations"])
    assert "没有再调用模型" in compiled["delivery"]["content"]


@pytest.mark.asyncio
async def test_compile_calls_the_model_when_the_estimate_fits_the_cap(isolated_kernel, monkeypatch):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
        cost_cap_usd=10,
    )
    monkeypatch.setattr(
        "app.product.project_brief._provider_token_prices",
        lambda: (0.0, 0.0, "test-model"),
    )
    called = False

    async def fake_llm(_prompt: str) -> str:
        nonlocal called
        called = True
        return json.dumps({
            "summary": "有延期风险",
            "content": "全文",
            "findings": [{
                "text": "进度延期",
                "kind": "risk",
                "source_ids": ["email:m1"],
            }],
            "suggested_actions": [],
            "limitations": [],
        })

    compiled = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-fit",
        llm_complete=fake_llm,
    )
    assert called is True
    assert compiled["ok"] is True
    assert compiled.get("cost_capped") is not True


@pytest.mark.asyncio
async def test_compile_stops_when_attributed_cost_cannot_be_read(isolated_kernel, monkeypatch):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
        cost_cap_usd=1,
    )
    monkeypatch.setattr(
        "app.product.project_brief.model_cost_for_delivery",
        lambda _execution_id: {"llm_cost": "unavailable", "recovery_interventions": "unavailable"},
    )

    async def fake_llm(_prompt: str) -> str:
        raise AssertionError("model should not be called")

    compiled = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-unread",
        llm_complete=fake_llm,
    )
    assert compiled["cost_capped"] is True
    assert any("读不全" in note for note in compiled["delivery"]["limitations"])


def _remembered(monkeypatch, hits):
    def recall(query: str, *, max_memories: int = 3):
        recall.calls.append((query, max_memories))
        if isinstance(hits, Exception):
            raise hits
        return hits

    recall.calls = []
    monkeypatch.setattr(
        "app.product.project_brief.read_ports.recall_memories_for_context",
        recall,
    )
    return recall


@pytest.mark.asyncio
async def test_compile_cites_a_ratified_memory_with_its_snippet(isolated_kernel, monkeypatch):
    from app.core.runtime.egress.egress_gate import MEMORY_CONTEXT_MARKER, classify_llm_payload

    item = create_project_brief_work(
        title="A",
        objective="项目预算口径",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    recall = _remembered(monkeypatch, [{
        "id": "mem-1",
        "content": "预算口径是 RATIFIED-100",
        "created_at": "2026-09-01 10:00:00",
        "confidence": 0.9,
    }])
    seen: list[str] = []

    async def fake_llm(prompt: str) -> str:
        seen.append(prompt)
        return json.dumps({
            "summary": "预算口径已确认",
            "content": "沿用已确认口径",
            "findings": [{
                "text": "预算口径是 100",
                "kind": "risk",
                "source_ids": ["memory:mem-1"],
                "quote": "预算口径是 RATIFIED-100",
            }],
            "suggested_actions": [],
            "limitations": [],
        })

    compiled = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-memory",
        llm_complete=fake_llm,
    )
    assert compiled["ok"] is True
    assert recall.calls == [("项目预算口径", 3)]
    assert MEMORY_CONTEXT_MARKER in seen[0]
    assert "memory_context" in classify_llm_payload([{"role": "user", "content": seen[0]}])["categories"]
    delivery = compiled["delivery"]
    assert delivery["retrieval"]["memories"] == {
        "queried": True,
        "included": 1,
        "unavailable": False,
    }
    memory = next(src for src in delivery["sources"] if src["id"] == "memory:mem-1")
    assert memory["type"] == "memory"
    assert memory["locator"] == "2026-09-01"
    evidence = delivery["findings"][0]["evidence"][0]
    assert evidence["quote_in_source"] is True
    assert evidence["snippet"] == "预算口径是 RATIFIED-100"
    assert "已确认记忆：纳入 1 条" in delivery["content"]
    assert "`memory:mem-1`" in delivery["content"]


@pytest.mark.asyncio
async def test_compile_continues_when_memory_recall_fails(isolated_kernel, monkeypatch):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    _remembered(monkeypatch, RuntimeError("chroma down"))

    async def fake_llm(_prompt: str) -> str:
        return json.dumps({
            "summary": "有延期风险",
            "content": "全文",
            "findings": [{
                "text": "进度延期",
                "kind": "risk",
                "source_ids": ["email:m1"],
            }],
            "suggested_actions": [],
            "limitations": [],
        })

    compiled = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-memory-down",
        llm_complete=fake_llm,
    )
    assert compiled["ok"] is True
    delivery = compiled["delivery"]
    assert all(src["type"] != "memory" for src in delivery["sources"])
    assert delivery["retrieval"]["memories"]["unavailable"] is True
    assert "已确认记忆暂时读不到" in delivery["content"]


@pytest.mark.asyncio
async def test_compile_records_when_no_ratified_memory_matches(isolated_kernel, monkeypatch):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    _remembered(monkeypatch, [])

    async def fake_llm(_prompt: str) -> str:
        return json.dumps({
            "summary": "有延期风险",
            "content": "全文",
            "findings": [{
                "text": "进度延期",
                "kind": "risk",
                "source_ids": ["email:m1"],
            }],
            "suggested_actions": [],
            "limitations": [],
        })

    compiled = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-memory-empty",
        llm_complete=fake_llm,
    )
    assert compiled["ok"] is True
    assert compiled["delivery"]["retrieval"]["memories"]["included"] == 0
    assert "已确认记忆：纳入 0 条" in compiled["delivery"]["content"]
    assert "memory:" not in seen_ids(compiled["delivery"])


def seen_ids(delivery: dict) -> str:
    return " ".join(str(src.get("id") or "") for src in delivery["sources"])


def test_brief_compile_failure_tells_the_user_what_to_do():
    from app.core.runtime.egress.egress_gate import EgressDeniedError

    denied = brief_compile_failure(
        EgressDeniedError("Cloud egress denied for classified personal context"),
        retryable=True,
    )
    assert "没有发出" in denied
    assert "127.0.0.1:11434" in denied
    assert "重新执行" in denied
    assert "ALLOW_CLOUD_PERSONAL_DATA_EGRESS" in denied
    assert "模型输出非法" not in denied

    wrapped = brief_compile_failure(
        RuntimeError(
            "All LLM providers failed for project_brief: "
            "cloud(EgressDeniedError: Cloud egress denied for classified personal context)"
        ),
        retryable=True,
    )
    assert wrapped == denied

    offline = brief_compile_failure(
        RuntimeError("local(APIConnectionError: Connection error.)"),
        retryable=True,
    )
    assert offline.startswith("连不上当前模型")
    assert "重新执行" in offline
    assert "模型输出非法" not in offline

    reentry = brief_compile_failure(
        RuntimeError(
            "DeepSeek 的 API Key需要重新填写。它是用桌面的 safeStorage 包过的，"
            "当前这个后端进程打不开。重新填写并保存之后就能用。"
        ),
        retryable=True,
    )
    assert reentry.startswith("DeepSeek 的 API Key需要重新填写")
    assert "safeStorage" in reentry
    assert "没有本地模型" not in reentry
    assert "模型输出非法" not in reentry

    other = brief_compile_failure(ValueError("missing summary"), retryable=True)
    assert other.startswith("模型输出非法或不可用，可重试：")
    quiet = brief_compile_failure(ValueError("missing summary"), retryable=False)
    assert quiet.startswith("模型不可用或输出非法：")


@pytest.mark.asyncio
async def test_compile_returns_egress_denial_without_a_delivery(isolated_kernel):
    from app.core.runtime.egress.egress_gate import EgressDeniedError

    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )

    async def deny(_prompt: str) -> str:
        raise EgressDeniedError("Cloud egress denied")

    compiled = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-egress",
        llm_complete=deny,
    )
    assert compiled["ok"] is False
    assert "没有发出" in compiled["error"]
    assert "delivery" not in compiled


def _emails_outcome(*emails: tuple[str, str, str]) -> SimpleNamespace:
    return SimpleNamespace(results=[
        SimpleNamespace(
            tool="check_inbox",
            status="success",
            result=json.dumps({
                "emails": [
                    {
                        "message_id": mid,
                        "subject": subject,
                        "from": "a@b.c",
                        "date": "2099-01-01T00:00:00+00:00",
                        "preview": preview,
                    }
                    for mid, subject, preview in emails
                ],
            }),
        ),
    ])


def _finding(text: str, source_id: str) -> dict:
    return {
        "text": text,
        "kind": "change",
        "source_ids": [source_id],
        "quote": text,
    }


@pytest.mark.asyncio
async def test_identical_rerun_skips_the_model(isolated_kernel, monkeypatch):
    import time

    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    outcome = _emails_outcome(("m1", "项目变化", "进度延期"))
    calls: list[str] = []
    stages: list[str] = []

    def _capture(event: dict) -> None:
        stages.append(str(event.get("stage") or ""))

    monkeypatch.setattr(
        "app.product.project_brief.read_ports.broadcast_event",
        _capture,
    )

    async def fake_llm(prompt: str) -> str:
        calls.append(prompt)
        time.sleep(0.2)
        return json.dumps({
            "summary": "有延期",
            "findings": [_finding("进度延期", "email:m1")],
        })

    started = time.perf_counter()
    first = await compile_project_brief_delivery(
        item["id"],
        outcome,
        execution_id="exec-first",
        llm_complete=fake_llm,
    )
    model_s = time.perf_counter() - started
    assert first["ok"] is True
    assert first.get("reused") is not True
    skipped = time.perf_counter()
    second = await compile_project_brief_delivery(
        item["id"],
        outcome,
        execution_id="exec-second",
        llm_complete=fake_llm,
    )
    skip_s = time.perf_counter() - skipped
    assert len(calls) == 1
    assert second["ok"] is True
    assert second["reused"] is True
    assert "进度延期" in second["delivery"]["content"]
    assert "来源没有变化，沿用上一版简报。" in second["delivery"]["content"]
    assert "来源没有变化，沿用上一版简报。" in second["delivery"]["limitations"]
    assert second["delivery"]["version"] == 2
    assert skip_s < model_s
    assert skip_s < 0.15
    assert "正在读取来源" in stages
    assert "正在写简报" in stages
    assert "来源没有变化，沿用上一版" in stages


@pytest.mark.asyncio
async def test_partial_rerun_reuses_unchanged_findings(isolated_kernel):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    first_outcome = _emails_outcome(
        ("m1", "西仓", "西仓已出库三箱"),
        ("m2", "东闸", "东闸阀门待更换"),
    )
    calls: list[str] = []

    async def fake_llm(prompt: str) -> str:
        calls.append(prompt)
        if len(calls) == 1:
            return json.dumps({
                "summary": "两处都有变化",
                "findings": [
                    _finding("西仓已出库三箱", "email:m1"),
                    _finding("东闸阀门待更换", "email:m2"),
                ],
            })
        assert "西仓已出库三箱" not in prompt
        assert "东闸阀门已更换完毕" in prompt
        assert "email:m1" not in prompt
        return json.dumps({
            "summary": "东闸已更换",
            "findings": [_finding("东闸阀门已更换完毕", "email:m2")],
        })

    first = await compile_project_brief_delivery(
        item["id"],
        first_outcome,
        execution_id="exec-both",
        llm_complete=fake_llm,
    )
    assert first["ok"] is True
    second = await compile_project_brief_delivery(
        item["id"],
        _emails_outcome(
            ("m1", "西仓", "西仓已出库三箱"),
            ("m2", "东闸", "东闸阀门已更换完毕"),
        ),
        execution_id="exec-one-changed",
        llm_complete=fake_llm,
    )
    assert len(calls) == 2
    assert second["ok"] is True
    assert second.get("reused") is not True
    body = second["delivery"]["content"]
    assert "西仓已出库三箱" in body
    assert "东闸阀门已更换完毕" in body
    assert "未变化的来源沿用上一版结论。" in second["delivery"]["limitations"]


@pytest.mark.asyncio
async def test_removed_source_keeps_remaining_findings_without_a_model(isolated_kernel):
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    calls: list[str] = []

    async def fake_llm(prompt: str) -> str:
        calls.append(prompt)
        return json.dumps({
            "summary": "两处都有变化",
            "findings": [
                _finding("西仓已出库三箱", "email:m1"),
                _finding("东闸阀门待更换", "email:m2"),
            ],
        })

    await compile_project_brief_delivery(
        item["id"],
        _emails_outcome(
            ("m1", "西仓", "西仓已出库三箱"),
            ("m2", "东闸", "东闸阀门待更换"),
        ),
        execution_id="exec-both",
        llm_complete=fake_llm,
    )
    second = await compile_project_brief_delivery(
        item["id"],
        _emails_outcome(("m1", "西仓", "西仓已出库三箱")),
        execution_id="exec-dropped",
        llm_complete=fake_llm,
    )
    assert len(calls) == 1
    assert second["reused"] is True
    body = second["delivery"]["content"]
    assert "西仓已出库三箱" in body
    assert "东闸阀门待更换" not in body
    assert "有来源已不在本次范围内，仍沿用未变化来源上的结论。" in body


@pytest.mark.asyncio
async def test_rework_notes_force_a_full_model_call(isolated_kernel):
    kernel, _db = isolated_kernel
    from app.core.runtime import read_ports
    from app.core.runtime.kernel.constants import (
        AGGREGATE_WORK_ITEM,
        EVENT_WORK_ITEM_UPDATED,
    )

    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    outcome = _emails_outcome(("m1", "项目变化", "进度延期"))
    calls: list[str] = []

    async def fake_llm(_prompt: str) -> str:
        calls.append(_prompt)
        return json.dumps({
            "summary": "有延期",
            "findings": [_finding("进度延期", "email:m1")],
        })

    await compile_project_brief_delivery(
        item["id"],
        outcome,
        execution_id="exec-first",
        llm_complete=fake_llm,
    )
    stored = read_ports.query_work_item(item["id"])
    assert stored is not None
    plan = json.loads(stored["executable_plan"])
    plan["rework_notes"] = [{"reason": "请改写延期那条"}]
    kernel.emit_event(
        EVENT_WORK_ITEM_UPDATED,
        AGGREGATE_WORK_ITEM,
        item["id"],
        payload={"executable_plan": json.dumps(plan, ensure_ascii=False)},
        actor="user",
    )
    second = await compile_project_brief_delivery(
        item["id"],
        outcome,
        execution_id="exec-rework",
        llm_complete=fake_llm,
    )
    assert len(calls) == 2
    assert second["ok"] is True
    assert second.get("reused") is not True
    assert "请改写延期那条" in calls[1]


def test_file_stat_marker_keeps_the_previous_hash():
    from app.product.project_brief import collect_allowed_sources

    raw = json.dumps({
        "unchanged": True,
        "path": "/tmp/n.txt",
        "size": 4,
        "mtime_ns": 9,
    })
    sources, bodies, _notes, coverage = collect_allowed_sources(
        contract={
            "source_scope": {
                "timezone": "UTC",
                "email": {},
                "files": [{"path": "/tmp/n.txt", "label": "n"}],
            },
        },
        step_results=[SimpleNamespace(
            tool="read_file", status="success", step=0, result=raw,
        )],
        retrieved_at="2026-01-01T00:00:00+00:00",
        plan_steps=[{
            "tool": "read_file",
            "params": {
                "path": "/tmp/n.txt",
                "known_size": 4,
                "known_mtime_ns": 9,
                "known_hash": "abc123abc123abcd",
            },
        }],
    )
    assert sources[0]["content_hash"] == "abc123abc123abcd"
    assert "unchanged" not in bodies[0]
    assert sources[0]["id"] in coverage["_cheap_ids"]


@pytest.mark.asyncio
async def test_skipped_bodies_reuse_the_previous_hash(isolated_kernel):
    from app.core.harness.builtin_tools.email import _message_id_digest
    from app.core.runtime import read_ports

    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    digest = _message_id_digest(["m1"])
    calls: list[str] = []

    def outcome(*, skipped: bool) -> SimpleNamespace:
        email = {
            "message_id": "m1",
            "subject": "项目变化",
            "from": "a@b.c",
            "date": "2099-01-01T00:00:00+00:00",
            "preview": "" if skipped else "进度延期",
            "body": "" if skipped else "进度延期",
        }
        payload: dict = {
            "emails": [email],
            "uid_validity": "42",
            "id_digest": digest,
            "modseq": "7",
            "scoped": True,
            "search": {"matched": 1, "truncated": False},
        }
        if skipped:
            payload["bodies_skipped"] = True
        return SimpleNamespace(results=[SimpleNamespace(
            tool="check_inbox",
            status="success",
            step=0,
            result=json.dumps(payload),
        )])

    async def fake_llm(prompt: str) -> str:
        calls.append(prompt)
        return json.dumps({
            "summary": "有延期",
            "findings": [_finding("进度延期", "email:m1")],
        })

    first = await compile_project_brief_delivery(
        item["id"],
        outcome(skipped=False),
        execution_id="exec-bodies-1",
        llm_complete=fake_llm,
    )
    assert first["ok"] is True
    stored = read_ports.query_work_item(item["id"])
    assert stored is not None
    plan = json.loads(stored["executable_plan"])
    params = plan["steps"][0]["params"]
    assert params["known_uid_validity"] == "42"
    assert params["known_id_digest"] == digest
    assert params["known_modseq"] == "7"
    assert params["known_source_hashes"]["email:m1"]
    assert params["known_messages"][0]["message_id"] == "m1"
    assert "body" not in params["known_messages"][0]

    second = await compile_project_brief_delivery(
        item["id"],
        outcome(skipped=True),
        execution_id="exec-bodies-2",
        llm_complete=fake_llm,
    )
    assert len(calls) == 1
    assert second["reused"] is True
    assert "进度延期" in second["delivery"]["content"]


def test_rework_drops_skip_tokens(isolated_kernel):
    from app.core.runtime import read_ports
    from app.core.runtime.kernel.constants import (
        AGGREGATE_WORK_ITEM,
        EVENT_WORK_ITEM_UPDATED,
    )
    from app.product.work_delivery import publish_delivery, request_rework

    kernel, _db = isolated_kernel
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    published = publish_delivery(
        item["id"],
        content="有延期",
        summary="有延期",
        sources=[{"id": "email:m1", "type": "email", "content_hash": "abc"}],
        findings=[{
            "text": "进度延期",
            "kind": "change",
            "source_ids": ["email:m1"],
            "quote": "进度延期",
        }],
        execution_id="exec-rework-skip",
    )
    stored = read_ports.query_work_item(item["id"])
    assert stored is not None
    plan = json.loads(stored["executable_plan"])
    plan["steps"][0]["params"]["known_id_digest"] = "deadbeef"
    plan["steps"][0]["params"]["known_source_hashes"] = {"email:m1": "abc"}
    kernel.emit_event(
        EVENT_WORK_ITEM_UPDATED,
        AGGREGATE_WORK_ITEM,
        item["id"],
        payload={"executable_plan": json.dumps(plan, ensure_ascii=False)},
        actor="user",
    )
    request_rework(
        item["id"],
        published["delivery_id"],
        reason="请重读来源",
        dispatch=True,
    )
    updated = read_ports.query_work_item(item["id"])
    assert updated is not None
    params = json.loads(updated["executable_plan"])["steps"][0]["params"]
    assert "known_id_digest" not in params
    assert "known_source_hashes" not in params
    assert "请重读来源" in updated["executable_plan"]


@pytest.mark.asyncio
async def test_retry_does_not_call_the_model_or_replace_the_delivery(isolated_kernel):
    """一次执行里已经记过成功调用时，重试不再调用，也不另写一版交付。"""
    from app.core.runtime.kernel.constants import EVENT_LLM_CALL_RECORDED
    from app.product.project_brief import ALREADY_BILLED_BRIEF
    from app.product.work_delivery import model_cost_for_delivery, publish_delivery

    kernel, _db = isolated_kernel
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    first = publish_delivery(
        item["id"],
        content="上一版还在",
        summary="上一版",
        sources=[{"id": "email:m1", "type": "email"}],
        findings=[],
        execution_id="exec-old",
    )
    kernel.emit_event(
        EVENT_LLM_CALL_RECORDED,
        "llm_call",
        "llm-once",
        payload={
            "provider": "ollama",
            "model": "qwen2.5:3b",
            "prompt_tokens": 10,
            "completion_tokens": 8,
            "latency_ms": 1,
            "cost": 0.4,
            "success": True,
            "purpose": "project_brief",
        },
        actor="executor",
        caused_by="exec-new",
    )

    async def fake_llm(_prompt: str) -> str:
        raise AssertionError("retry must not call the model")

    compiled = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-new",
        llm_complete=fake_llm,
    )
    assert compiled["ok"] is False
    assert compiled["error"] == ALREADY_BILLED_BRIEF
    folded = fold_delivery_history(item["id"])
    assert folded["current"]["delivery_id"] == first["delivery_id"]
    assert folded["current"]["content"] == "上一版还在"
    assert model_cost_for_delivery("exec-new")["llm_cost"] == 0.4
    again = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-new",
        llm_complete=fake_llm,
    )
    assert again["error"] == ALREADY_BILLED_BRIEF
    recorded = [
        event
        for event in kernel.read_events(type=EVENT_LLM_CALL_RECORDED)
        if getattr(event, "caused_by", None) == "exec-new"
    ]
    assert len(recorded) == 1


@pytest.mark.asyncio
async def test_failed_model_record_does_not_block_or_charge(isolated_kernel):
    from app.core.runtime.kernel.constants import EVENT_LLM_CALL_RECORDED
    from app.product.work_delivery import model_cost_for_delivery

    kernel, _db = isolated_kernel
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    kernel.emit_event(
        EVENT_LLM_CALL_RECORDED,
        "llm_call",
        "llm-fail",
        payload={
            "provider": "ollama",
            "model": "qwen2.5:3b",
            "cost": 9,
            "success": False,
            "purpose": "project_brief",
            "error_message": "Timeout",
        },
        actor="executor",
        caused_by="exec-fail",
    )
    called = False

    async def fake_llm(_prompt: str) -> str:
        nonlocal called
        called = True
        return json.dumps({
            "summary": "有延期风险",
            "content": "全文",
            "findings": [{
                "text": "进度延期",
                "kind": "risk",
                "source_ids": ["email:m1"],
            }],
            "suggested_actions": [],
            "limitations": [],
        })

    compiled = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-fail",
        llm_complete=fake_llm,
    )
    assert called is True
    assert compiled["ok"] is True
    assert model_cost_for_delivery("exec-fail")["llm_cost"] == 0.0


@pytest.mark.asyncio
async def test_same_execution_does_not_publish_a_second_delivery(isolated_kernel):
    from app.core.runtime.kernel.constants import EVENT_WORK_ITEM_UPDATED

    kernel, _db = isolated_kernel
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    calls = 0

    async def fake_llm(_prompt: str) -> str:
        nonlocal calls
        calls += 1
        return json.dumps({
            "summary": "有延期风险",
            "content": "全文",
            "findings": [{
                "text": "进度延期",
                "kind": "risk",
                "source_ids": ["email:m1"],
            }],
            "suggested_actions": [],
            "limitations": [],
        })

    first = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-once",
        llm_complete=fake_llm,
    )
    second = await compile_project_brief_delivery(
        item["id"],
        _inbox_outcome(),
        execution_id="exec-once",
        llm_complete=fake_llm,
    )
    assert calls == 1
    assert second["already_published"] is True
    assert second["delivery"]["delivery_id"] == first["delivery"]["delivery_id"]
    published = [
        event
        for event in kernel.read_events(
            type=EVENT_WORK_ITEM_UPDATED,
            aggregate_id=item["id"],
        )
        if isinstance(event.payload, dict) and "delivery_published" in event.payload
    ]
    assert len(published) == 1


def test_cancel_running_brief_keeps_the_delivery(isolated_kernel):
    from app.core.runtime import read_ports
    from app.product.work_delivery import cancel_project_brief, publish_delivery

    kernel, _db = isolated_kernel
    item = create_project_brief_work(
        title="A",
        objective="列出变化",
        source_scope={"email": {"enabled": True, "days": 30}},
    )
    published = publish_delivery(
        item["id"],
        content="上一版还在",
        summary="上一版",
        sources=[],
        findings=[],
        execution_id="exec-old",
    )
    read_ports.update_work_item_status(item["id"], "running")
    updated = cancel_project_brief(item["id"])
    assert updated["status"] == "completed"
    folded = fold_delivery_history(item["id"])
    assert folded["current"]["delivery_id"] == published["delivery_id"]
    assert folded["current"]["content"] == "上一版还在"
    status_events = kernel.read_events(
        type="WorkItemStatusChanged",
        aggregate_id=item["id"],
    )
    assert status_events[-1].payload["status"] == "completed"
    assert status_events[-1].payload["reason"] == "brief_cancel"


def test_cancel_running_brief_without_delivery_can_run_again(isolated_kernel):
    from app.core.runtime import read_ports
    from app.product.work_delivery import DeliveryConflictError, cancel_project_brief

    item = create_project_brief_work(title="A", objective="列出变化")
    read_ports.update_work_item_status(item["id"], "running")
    updated = cancel_project_brief(item["id"])
    assert updated["status"] == "failed"
    assert fold_delivery_history(item["id"])["current"] is None
    with pytest.raises(DeliveryConflictError):
        cancel_project_brief(item["id"])
