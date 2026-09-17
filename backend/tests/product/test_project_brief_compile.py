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
    assert len(delivery["content"]) > 1000
    folded = fold_delivery_history(item["id"])
    assert folded["current"]["content"] == delivery["content"]
    assert folded["current"]["sources"][0]["id"] == "email:m1"


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
