"""Fixed brief evals: misses, contradictions, truncation, unknown dates, budgets."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.product.project_brief import (
    BRIEF_FILE_MAX_LINES,
    build_project_brief_plan,
    collect_allowed_sources,
    validate_model_brief,
)


def _email(
    message_id: str,
    *,
    subject: str = "进度",
    sender: str = "a@b.c",
    date: str = "2099-01-02T00:00:00+00:00",
    preview: str = "",
    body: str = "",
) -> dict[str, str]:
    return {
        "message_id": message_id,
        "subject": subject,
        "from": sender,
        "date": date,
        "preview": preview,
        "body": body,
    }


def _inbox(
    emails: list[dict[str, str]],
    *,
    scoped: bool = False,
    matched: int | None = None,
    limit: int = 30,
    truncated: bool = False,
    query: str = "",
    since: str = "",
) -> SimpleNamespace:
    payload: dict = {"emails": emails}
    if scoped:
        payload["scoped"] = True
        payload["search"] = {
            "query": query,
            "since": since,
            "limit": limit,
            "matched": len(emails) if matched is None else matched,
            "returned": len(emails),
            "truncated": truncated,
        }
    return SimpleNamespace(tool="check_inbox", status="success", result=json.dumps(payload))


def _file(body: str, step: int | None = None) -> SimpleNamespace:
    result = SimpleNamespace(tool="read_file", status="success", result=body)
    if step is not None:
        result.step = step
    return result


def prepare_case(case: dict):
    """Collect one fixed eval case the same way the deterministic suite does."""
    scope: dict = {
        "timezone": "UTC",
        "email": {
            "enabled": True,
            "query": case.get("query") or "",
            "days": case.get("days", 30),
            "since": case.get("since") or "2099-01-01",
            "limit": 30,
        },
    }
    if case.get("files") is not None:
        scope["files"] = case["files"]
    return collect_allowed_sources(
        contract={"source_scope": scope, "objective": "整理进度、风险和待办"},
        step_results=case["results"],
        retrieved_at="t0",
        plan_steps=case.get("plan_steps"),
    )


def _collect(
    results: list[SimpleNamespace],
    *,
    query: str = "",
    days: int = 30,
    files: list[dict] | None = None,
    plan_steps: list[dict] | None = None,
    since: str = "2099-01-01",
):
    sources, _bodies, notes, coverage = prepare_case({
        "query": query,
        "days": days,
        "files": files,
        "plan_steps": plan_steps,
        "since": since,
        "results": results,
    })
    return sources, notes, coverage


def _ids(sources: list[dict]) -> set[str]:
    return {str(item["id"]) for item in sources}


# Each row is one fixed case. Gaps are the exact sentences the brief records.
CASES: list[dict] = [
    {
        "id": "miss-scoped-body-keyword",
        "query": "预算",
        "results": [_inbox([
            _email("m1", subject="周报", preview="普通进度", body="本周预算 100元"),
        ], scoped=True, query="预算")],
        "included": {"email:m1"},
        "gaps": [],
        "absent": ["检索范围内没有看到预算金额"],
    },
    {
        "id": "miss-unscoped-body-only",
        "query": "预算",
        "results": [_inbox([
            _email("m1", subject="周报", preview="普通进度", body="本周预算 100元"),
        ])],
        "included": set(),
        "gaps": ["检索范围内没有看到预算金额"],
    },
    {
        "id": "miss-unscoped-preview-hit",
        "query": "预算",
        "results": [_inbox([
            _email("m1", preview="预算 100元", body=""),
        ])],
        "included": {"email:m1"},
        "gaps": [],
        "absent": ["检索范围内没有看到预算金额"],
    },
    {
        "id": "miss-scoped-ignores-preview-filter",
        "query": "上线",
        "results": [_inbox([
            _email("m1", subject="无关", preview="没有关键词", body="上线窗口改到下周三"),
        ], scoped=True, query="上线")],
        "included": {"email:m1"},
    },
    {
        "id": "miss-scoped-drops-mail-before-cutoff",
        "query": "",
        "results": [_inbox([
            _email("old", date="2000-01-01T00:00:00+00:00", body="旧邮件"),
        ], scoped=True)],
        "included": set(),
    },
    {
        "id": "miss-keeps-mail-inside-window",
        "query": "",
        "results": [_inbox([_email("m1", preview="在窗口内")])],
        "included": {"email:m1"},
    },
    {
        "id": "miss-search-truncated-is-visible",
        "query": "预算",
        "results": [_inbox(
            [_email("m1", body="预算 100元")],
            scoped=True,
            matched=5,
            truncated=True,
            query="预算",
        )],
        "included": {"email:m1"},
        "gaps": ["邮箱命中超过上限 30 封，只读了返回的部分"],
    },
    {
        "id": "miss-empty-scope-says-so",
        "query": "",
        "results": [_inbox([], scoped=True)],
        "included": set(),
        "notes": ["邮箱已配置，但检索范围内没有邮件"],
    },
    {
        "id": "contra-two-emails",
        "query": "",
        "results": [_inbox([
            _email("a", body="报价 100元"),
            _email("b", body="报价 200元"),
        ], scoped=True)],
        "included": {"email:a", "email:b"},
        "gaps": ["来源中的金额不一致，需人工核对"],
    },
    {
        "id": "contra-same-amount-once",
        "query": "",
        "results": [_inbox([
            _email("a", body="报价 100元"),
            _email("b", body="确认 100 元"),
        ], scoped=True)],
        "included": {"email:a", "email:b"},
        "absent": ["来源中的金额不一致，需人工核对"],
    },
    {
        "id": "contra-file-and-email",
        "query": "",
        "files": [{"path": "budget.md", "label": "预算表"}],
        "results": [
            _inbox([_email("a", body="邮件写 100元")], scoped=True),
            _file("表上是 300元"),
        ],
        "included_has": {"email:a"},
        "has_file": True,
        "gaps": ["来源中的金额不一致，需人工核对"],
    },
    {
        "id": "contra-single-amount",
        "query": "",
        "results": [_inbox([_email("a", body="只有 100元")], scoped=True)],
        "absent": ["来源中的金额不一致，需人工核对"],
    },
    {
        "id": "contra-three-amounts",
        "query": "",
        "results": [_inbox([
            _email("a", body="1元"),
            _email("b", body="2元"),
            _email("c", body="3元"),
        ], scoped=True)],
        "gaps": ["来源中的金额不一致，需人工核对"],
    },
    {
        "id": "contra-currency-mix",
        "query": "",
        "results": [_inbox([
            _email("a", body="100元"),
            _email("b", body="80USD"),
        ], scoped=True)],
        "gaps": ["来源中的金额不一致，需人工核对"],
    },
    {
        "id": "trunc-line-window",
        "query": "",
        "files": [{"path": "a.md", "label": "笔记"}],
        "results": [
            _inbox([], scoped=True),
            _file("开头\n... [showing 10/40 lines]"),
        ],
        "file_truncated": True,
        "gaps_contains": "只显示 10/40 行",
    },
    {
        "id": "trunc-char-cap",
        "query": "",
        "files": [{"path": "a.md", "label": "笔记"}],
        "results": [
            _inbox([], scoped=True),
            _file("很长\n... [content truncated]"),
        ],
        "file_truncated": True,
        "gaps_contains": "正文超过 10000 字被截断",
    },
    {
        "id": "trunc-both-markers",
        "query": "",
        "files": [{"path": "a.md", "label": "笔记"}],
        "results": [
            _inbox([], scoped=True),
            _file("...\n... [showing 2000/9000 lines]\n... [content truncated]"),
        ],
        "file_truncated": True,
        "gaps_contains": "只显示 2000/9000 行",
    },
    {
        "id": "trunc-complete-file",
        "query": "",
        "files": [{"path": "a.md", "label": "笔记"}],
        "results": [_inbox([], scoped=True), _file("完整短文")],
        "file_truncated": False,
        "absent": ["被截断"],
    },
    {
        "id": "trunc-records-requested-window",
        "query": "",
        "files": [{"path": "a.md", "label": "笔记"}],
        "plan_steps": [
            {"tool": "check_inbox", "params": {}},
            {"tool": "read_file", "params": {"path": "a.md", "max_lines": 2000}},
        ],
        "results": [
            _inbox([], scoped=True),
            _file("完整短文", step=1),
        ],
        "file_max_lines": 2000,
        "file_truncated": False,
    },
    {
        "id": "trunc-read-failure",
        "query": "",
        "files": [{"path": "a.md", "label": "笔记"}],
        "results": [
            _inbox([], scoped=True),
            SimpleNamespace(tool="read_file", status="failed", result="denied"),
        ],
        "notes": ["资料读取失败（笔记）"],
        "included_types_exclude_file": True,
    },
    {
        "id": "date-missing-kept",
        "query": "",
        "results": [_inbox([_email("m1", date="", preview="无日期")], scoped=True)],
        "included": {"email:m1"},
        "unknown_date": 1,
        "gaps": ["1 封邮件日期无法解析，仍保留在本次范围内"],
    },
    {
        "id": "date-unparseable-kept",
        "query": "",
        "results": [_inbox([
            _email("m1", date="not-a-date", preview="坏日期"),
        ], scoped=True)],
        "included": {"email:m1"},
        "unknown_date": 1,
    },
    {
        "id": "date-valid-not-unknown",
        "query": "",
        "results": [_inbox([_email("m1", preview="正常")], scoped=True)],
        "unknown_date": 0,
        "absent": ["无法解析"],
    },
    {
        "id": "date-two-unknown",
        "query": "",
        "results": [_inbox([
            _email("a", date="", preview="一"),
            _email("b", date="yesterday", preview="二"),
        ], scoped=True)],
        "included": {"email:a", "email:b"},
        "gaps": ["2 封邮件日期无法解析，仍保留在本次范围内"],
    },
    {
        "id": "date-old-mail-not-counted-unknown",
        "query": "",
        "results": [_inbox([
            _email("old", date="2000-01-01T00:00:00+00:00", preview="旧"),
        ], scoped=True)],
        "included": set(),
        "unknown_date": 0,
    },
    {
        "id": "date-scoped-unknown-kept-with-body",
        "query": "排期",
        "results": [_inbox([
            _email("m1", date="", preview="无", body="排期改到周五"),
        ], scoped=True, query="排期")],
        "included": {"email:m1"},
        "unknown_date": 1,
    },
    {
        "id": "budget-missing-chinese",
        "query": "预算",
        "results": [_inbox([
            _email("m1", preview="预算还没写", body="预算还没写"),
        ], scoped=True, query="预算")],
        "gaps": ["检索范围内没有看到预算金额"],
    },
    {
        "id": "budget-missing-english",
        "query": "budget",
        "results": [_inbox([
            _email("m1", body="budget not stated"),
        ], scoped=True, query="budget")],
        "gaps": ["检索范围内没有看到预算金额"],
    },
    {
        "id": "budget-present",
        "query": "预算",
        "results": [_inbox([
            _email("m1", body="预算 100元"),
        ], scoped=True, query="预算")],
        "included": {"email:m1"},
        "absent": ["检索范围内没有看到预算金额"],
    },
    {
        "id": "budget-ignored-for-other-query",
        "query": "进度",
        "results": [_inbox([
            _email("m1", preview="进度正常", body="进度正常"),
        ], scoped=True, query="进度")],
        "absent": ["检索范围内没有看到预算金额", "来源中的金额不一致，需人工核对"],
    },
    {
        "id": "budget-and-contradiction",
        "query": "预算",
        "results": [_inbox([
            _email("a", body="预算 100元"),
            _email("b", body="预算 200元"),
        ], scoped=True, query="预算")],
        "gaps": ["来源中的金额不一致，需人工核对"],
        "absent": ["检索范围内没有看到预算金额"],
    },
    {
        "id": "budget-query-capitalized",
        "query": "Budget",
        "results": [_inbox([
            _email("m1", body="no number here"),
        ], scoped=True, query="Budget")],
        "gaps": ["检索范围内没有看到预算金额"],
    },
    {
        "id": "preview-only-scoped-is-a-gap",
        "query": "预算",
        "results": [_inbox([
            _email("m1", preview="预算 100元", body=""),
        ], scoped=True, query="预算")],
        "gaps": ["1 封命中邮件没有全文，简报只用了预览"],
        "absent": ["检索范围内没有看到预算金额"],
    },
    {
        "id": "holdout-owner-name",
        "query": "负责人",
        "results": [_inbox([
            _email("m1", subject="分工", preview="本周安排", body="负责人 林晚"),
        ], scoped=True, query="负责人")],
        "included": {"email:m1"},
        "gaps": [],
    },
    {
        "id": "holdout-review-deadline",
        "query": "截止",
        "results": [_inbox([
            _email("m1", subject="日程", preview="会议安排", body="材料截止 3月12日"),
        ], scoped=True, query="截止")],
        "included": {"email:m1"},
        "gaps": [],
    },
]


@pytest.mark.parametrize("case", CASES, ids=[item["id"] for item in CASES])
def test_brief_retrieval_eval(case: dict):
    sources, notes, coverage = _collect(
        case["results"],
        query=case.get("query", ""),
        files=case.get("files"),
        plan_steps=case.get("plan_steps"),
    )
    found = _ids(sources)
    if "included" in case:
        assert found == case["included"]
    if "included_has" in case:
        assert case["included_has"] <= found
    if case.get("has_file"):
        assert any(item["type"] == "file" for item in sources)
    joined = "\n".join(notes)
    gaps = list(coverage["gaps"])
    for gap in case.get("gaps") or []:
        assert gap in gaps
    for gap in case.get("absent") or []:
        assert gap not in joined
    for note in case.get("notes") or []:
        assert note in joined
    if "gaps_contains" in case:
        assert any(case["gaps_contains"] in gap for gap in gaps)
    if "unknown_date" in case:
        assert coverage["email"]["unknown_date"] == case["unknown_date"]
    if "file_truncated" in case:
        assert coverage["files"][0]["truncated"] is case["file_truncated"]
    if "file_max_lines" in case:
        assert coverage["files"][0]["max_lines"] == case["file_max_lines"]
    if case.get("included_types_exclude_file"):
        assert all(item["type"] != "file" for item in sources)
    assert "检索范围" in _rendered_scope(coverage)


def _rendered_scope(coverage: dict) -> str:
    from app.product.project_brief import _retrieval_lines

    return "\n".join(_retrieval_lines(coverage))


def test_eval_set_covers_required_themes():
    ids = [item["id"] for item in CASES]
    assert len(ids) >= 30
    assert len(ids) == len(set(ids))
    assert any(item.startswith("miss-") for item in ids)
    assert any(item.startswith("contra-") for item in ids)
    assert any(item.startswith("trunc-") for item in ids)
    assert any(item.startswith("date-") for item in ids)
    assert any(item.startswith("budget-") for item in ids)
    assert any(item.startswith("holdout-") for item in ids)


def test_plan_searches_mailbox_before_limit_and_widens_files():
    plan = build_project_brief_plan(
        objective="看预算",
        source_scope={
            "timezone": "UTC",
            "email": {"enabled": True, "query": "预算", "days": 3, "since": "2026-01-01"},
            "files": [{"path": "notes.md", "label": "notes", "max_lines": 800}],
        },
        timezone="UTC",
    )
    email_step = plan["steps"][0]
    assert email_step["tool"] == "check_inbox"
    assert email_step["params"]["query"] == "预算"
    assert email_step["params"]["since"] == "2026-01-01"
    assert email_step["params"]["unread_only"] is False
    assert email_step["params"]["include_unread_index"] is False
    file_step = plan["steps"][1]
    assert file_step["params"]["max_lines"] == 800
    assert BRIEF_FILE_MAX_LINES > 500


def test_plan_defaults_file_window_above_500():
    plan = build_project_brief_plan(
        objective="看笔记",
        source_scope={"files": [{"path": "notes.md", "label": "notes"}]},
        timezone="UTC",
    )
    assert plan["steps"][0]["params"]["max_lines"] == BRIEF_FILE_MAX_LINES


def test_quote_miss_does_not_fail_structure():
    result = validate_model_brief(
        {
            "summary": "有预算",
            "content": "正文",
            "findings": [{
                "text": "预算是一百",
                "source_ids": ["email:m1"],
                "quote": "完全编造的句子",
            }],
        },
        allowed_ids={"email:m1"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
        source_catalog={
            "email:m1": {"text": "本周预算 100元", "locator": "a@b.c", "title": "预算"},
        },
    )
    assert result["qualified"] is True
    assert result["quality_structure"] == "passed"
    assert result["quality_evidence"] == "unsupported"
    evidence = result["findings"][0]["evidence"][0]
    assert evidence["quote_in_source"] is False
    assert evidence["locator"] == "a@b.c"
    assert "100元" in evidence["snippet"]
    assert any("摘录对不上" in note for note in result["limitations"])
    assert "证据未支持" in result["content"]
    assert "a@b.c" in result["content"]


def test_quote_found_stays_pending():
    result = validate_model_brief(
        {
            "summary": "有预算",
            "content": "正文",
            "findings": [{
                "text": "预算是一百",
                "source_ids": ["email:m1"],
                "quote": "本周预算 100元",
            }],
        },
        allowed_ids={"email:m1"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
        source_catalog={
            "email:m1": {"text": "本周预算 100元", "locator": "a@b.c", "title": "预算"},
        },
    )
    assert result["qualified"] is True
    assert result["quality_structure"] == "passed"
    assert result["quality_evidence"] == "pending"
    evidence = result["findings"][0]["evidence"][0]
    assert evidence["quote_in_source"] is True
    assert evidence["snippet"] == "本周预算 100元"
    assert "证据待核对" in result["content"]
    assert "摘录对不上" not in "\n".join(result["limitations"])


def _quote_case(quote: str, text: str) -> dict:
    return validate_model_brief(
        {
            "summary": "有结论",
            "content": "正文",
            "findings": [{
                "text": "来源里有这句话",
                "source_ids": ["email:m1"],
                "quote": quote,
            }],
        },
        allowed_ids={"email:m1"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
        source_catalog={
            "email:m1": {"text": text, "locator": "a@b.c", "title": "进度"},
        },
    )


def test_wrapped_source_line_stays_pending_and_shows_the_line():
    result = _quote_case("邮件写着本周预算 100元。", "本周预算 100元")
    assert result["quality_evidence"] == "pending"
    evidence = result["findings"][0]["evidence"][0]
    assert evidence["quote_in_source"] is True
    assert evidence["snippet"] == "本周预算 100元"


def test_rewritten_amount_without_the_source_words_stays_unsupported():
    result = _quote_case("在会上说预算为100元。", "预算 100元")
    assert result["quality_evidence"] == "unsupported"
    assert result["findings"][0]["evidence"][0]["quote_in_source"] is False


def test_same_amount_in_a_different_sentence_stays_unsupported():
    result = _quote_case("报价 100元", "确认 100元")
    assert result["quality_evidence"] == "unsupported"
    assert result["findings"][0]["evidence"][0]["quote_in_source"] is False


def test_different_amount_does_not_inherit_a_shared_suffix():
    result = _quote_case("报价 500元", "报价 100元")
    assert result["quality_evidence"] == "unsupported"
    evidence = result["findings"][0]["evidence"][0]
    assert evidence["quote_in_source"] is False
    assert "100元" in evidence["snippet"]


def test_glued_digits_do_not_count_as_the_source_amount():
    result = _quote_case("5100元", "100元")
    assert result["quality_evidence"] == "unsupported"
    assert result["findings"][0]["evidence"][0]["quote_in_source"] is False


def test_two_character_overlap_stays_unsupported():
    result = _quote_case("已经确定预算", "预算 100元")
    assert result["quality_evidence"] == "unsupported"
    assert result["findings"][0]["evidence"][0]["quote_in_source"] is False


def test_full_source_line_wins_over_a_longer_partial_span():
    text = "注意注意\n本周预算 100元请确认"
    result = _quote_case("注意注意。本周预算 100元", text)
    assert result["quality_evidence"] == "pending"
    assert result["findings"][0]["evidence"][0]["snippet"] == "注意注意"
