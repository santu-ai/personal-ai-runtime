"""Compile project-brief results into an event-sourced delivery."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.product.project_brief import compile_project_brief_delivery, create_project_brief_work
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
