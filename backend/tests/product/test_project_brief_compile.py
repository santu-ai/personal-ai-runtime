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
