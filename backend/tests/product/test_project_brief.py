"""Project-brief source collection and model-output validation."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.product.project_brief import (
    collect_allowed_sources,
    validate_model_brief,
)


def test_validate_rejects_forged_sources():
    with pytest.raises(ValueError, match="out-of-scope"):
        validate_model_brief(
            {
                "summary": "s",
                "content": "c",
                "findings": [{"text": "x", "source_ids": ["email:forged"]}],
            },
            allowed_ids={"email:real"},
            criteria=["每条关键结论附来源"],
            source_notes=[],
        )


def test_validate_requires_citations_when_sources_exist():
    result = validate_model_brief(
        {
            "summary": "s",
            "content": "c",
            "findings": [{"text": "change happened", "source_ids": []}],
        },
        allowed_ids={"email:1"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
    )
    assert result["qualified"] is False
    assert any(c["result"] == "fail" for c in result["checks"])


def test_collect_sources_filters_query_and_keeps_file_hash():
    results = [
        SimpleNamespace(
            tool="check_inbox",
            status="success",
            result=(
                '{"emails":['
                '{"message_id":"m1","subject":"项目A 进度","from":"a@b.c",'
                '"date":"2099-01-01T00:00:00+00:00","preview":"ok"},'
                '{"message_id":"m2","subject":"无关","from":"x@y.z",'
                '"date":"2099-01-01T00:00:00+00:00","preview":"no"}'
                "]}"
            ),
        ),
        SimpleNamespace(
            tool="read_file",
            status="success",
            result="file body long enough",
        ),
        SimpleNamespace(
            tool="check_inbox",
            status="failed",
            result='{"error":"not used"}',
        ),
    ]
    sources, bodies, notes = collect_allowed_sources(
        contract={
            "source_scope": {
                "timezone": "UTC",
                "email": {"enabled": True, "query": "项目a", "days": 3},
                "files": [{"path": "C:/tmp/a.md", "label": "notes"}],
            }
        },
        step_results=results,
        retrieved_at="t0",
    )
    ids = {s["id"] for s in sources}
    assert "email:m1" in ids
    assert "email:m2" not in ids
    assert any(s["type"] == "file" for s in sources)
    assert any("Email email:m1" in block for block in bodies)
    assert any("失败" in note for note in notes)


def test_collect_sources_records_unconfigured_failure():
    results = [
        SimpleNamespace(
            tool="check_inbox",
            status="failed",
            result="Email credentials not configured",
        ),
    ]
    sources, _bodies, notes = collect_allowed_sources(
        contract={"source_scope": {"email": {"enabled": True, "days": 3}, "files": []}},
        step_results=results,
        retrieved_at="t0",
    )
    assert sources == []
    assert any("失败" in note for note in notes)


def test_collect_sources_maps_file_by_original_step_index():
    results = [
        SimpleNamespace(
            step=2,
            tool="read_file",
            status="success",
            result="second file body",
        ),
    ]
    sources, _bodies, _notes = collect_allowed_sources(
        contract={
            "source_scope": {
                "files": [
                    {"path": "C:/tmp/first.md", "label": "first"},
                    {"path": "C:/tmp/second.md", "label": "second"},
                ],
            }
        },
        step_results=results,
        retrieved_at="t0",
        plan_steps=[
            {"tool": "check_inbox"},
            {"tool": "read_file", "params": {"path": "C:/tmp/first.md"}},
            {"tool": "read_file", "params": {"path": "C:/tmp/second.md"}},
        ],
    )
    assert len(sources) == 1
    assert sources[0]["title"] == "second"
    assert sources[0]["locator"] == "C:/tmp/second.md"


def test_validate_rejects_forged_ids_in_body_even_without_findings():
    with pytest.raises(ValueError, match="out-of-scope"):
        validate_model_brief(
            {
                "summary": "s",
                "content": "Critical claim [email:forged]",
                "findings": [],
            },
            allowed_ids={"email:real"},
            criteria=["每条关键结论附来源", "不编造来源"],
            source_notes=[],
        )


def test_validate_accepts_source_id_before_chinese_punctuation():
    result = validate_model_brief(
        {
            "summary": "排期变化（来源：file:a28233aad0de）。",
            "content": "支付联调延期（file:a28233aad0de），需重新确认排期。",
            "findings": [{
                "text": "支付联调延期",
                "source_ids": ["file:a28233aad0de"],
            }],
        },
        allowed_ids={"file:a28233aad0de"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
    )
    assert result["qualified"] is True


def test_validate_empty_findings_with_sources_is_unqualified():
    result = validate_model_brief(
        {
            "summary": "看起来完整",
            "content": "没有任何引用的结论",
            "findings": [],
        },
        allowed_ids={"email:real"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
    )
    assert result["qualified"] is False
    assert any(c["result"] == "fail" for c in result["checks"])
    assert "结构化结论" in result["content"]


def test_validate_custom_criterion_needs_review():
    result = validate_model_brief(
        {
            "summary": "s",
            "content": "c",
            "findings": [{"text": "change happened", "source_ids": ["email:1"]}],
        },
        allowed_ids={"email:1"},
        criteria=["每条关键结论附来源", "语气必须让老板满意"],
        source_notes=[],
    )
    assert result["qualified"] is False
    assert any(
        c["criterion"] == "语气必须让老板满意" and c["result"] == "needs_review"
        for c in result["checks"]
    )
    assert "change happened" in result["content"]
    assert "`email:1`" in result["content"]
