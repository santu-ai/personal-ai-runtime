"""Fixed brief evals: misses, contradictions, truncation, unknown dates, budgets."""

from __future__ import annotations

import hashlib
import json
from types import SimpleNamespace

import pytest

from app.product.project_brief import (
    BRIEF_FILE_MAX_LINES,
    _build_prompt,
    _extract_json,
    _source_block,
    build_project_brief_plan,
    collect_allowed_sources,
    default_acceptance_criteria,
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
    {
        "id": "holdout-meeting-room",
        "query": "会议室",
        "results": [_inbox([
            _email("m1", subject="场地", preview="本周安排", body="会议室 在三楼"),
        ], scoped=True, query="会议室")],
        "included": {"email:m1"},
        "gaps": [],
    },
    {
        "id": "holdout-trunc-sample-sent",
        "query": "",
        "files": [{"path": "sample.md", "label": "样品"}],
        "results": [
            _inbox([], scoped=True),
            _file("样品已寄出\n... [showing 4/30 lines]"),
        ],
        "file_truncated": True,
        "gaps_contains": "只显示 4/30 行",
    },
    {
        "id": "holdout-supplier-name",
        "query": "供应商",
        "results": [_inbox([
            _email("m1", subject="供货", preview="本周到货", body="供应商 周宁"),
        ], scoped=True, query="供应商")],
        "included": {"email:m1"},
        "gaps": [],
    },
]


def _file_source_id(path: str) -> str:
    return "file:" + hashlib.sha256(path.encode("utf-8")).hexdigest()[:12]


_MEETING_NOTES = """# 北岸码头周会 2099-03-12

出席：韩雪、梁秋、江澄、Mina
缺席：无
地点：三楼会议室
议程：
1. 上周回顾
2. 护栏
3. 涂料
4. 其他

上周回顾：灯塔修缮已经完成，不在本次范围。
护栏还在等钢材。
涂料供应商报价还没到。
停车位维持现状。
茶水还是自备。

决定：样品柜钥匙交给江澄。

下次会议 4月2日，仍在三楼。
"""

_CSV_EXPORT = """item,owner,status,due
灯塔修缮,韩雪,done,2026-04-01
航标电池,韩雪,open,2026-06-03
栈桥涂料,梁秋,open,2026-05-01
码头护栏,梁秋,open,2026-04-22
潮汐表,江澄,open,2026-04-28
访客证,韩雪,done,2026-03-30
仓库锁,梁秋,open,2026-07-01
夜班灯,江澄,open,2026-08-12
消防栓,韩雪,open,2026-09-01
沙袋,梁秋,done,2026-02-14
警戒线,江澄,open,2026-10-03
备用钥匙,韩雪,open,2026-11-11
雨衣,江澄,open,2026-12-01
对讲机,梁秋,open,2026-12-15
"""

_PIER_SPEC = """# 北岸码头接口

错误码 409 表示泊位占用。
超时重试 2 次。
"""

_LIGHT_SPEC = """# 北岸灯塔接口

错误码 409 表示灯塔离线。
超时重试 3 次。
"""

# Sealed tier. Facts here are not used to tune prompts or grounding.
# fact_any / fact_all score whether the brief kept the newer or distinguishing
# fact, which can fail even when some other real line was quoted.
SEALED_CASES: list[dict] = [
    {
        "id": "sealed-thread-supersede",
        "query": "验收",
        "results": [_inbox([
            _email(
                "old",
                subject="北岸码头周报",
                date="2099-03-01T08:00:00+00:00",
                body="北岸码头验收定在 4月3日。\n负责人暂时未定。",
            ),
            _email(
                "new",
                subject="Re: 北岸码头周报",
                date="2099-03-08T08:00:00+00:00",
                body=(
                    "> 北岸码头验收定在 4月3日。\n"
                    ">\n"
                    "验收改到 4月18日，已经和现场确认。"
                ),
            ),
        ], scoped=True, query="验收")],
        "included": {"email:old", "email:new"},
        "fact_any": ["4月18日"],
    },
    {
        "id": "sealed-forward-chain",
        "query": "",
        "results": [_inbox([
            _email(
                "fwd",
                subject="Fwd: 发版窗口",
                body=(
                    "请看下面的转发。\n"
                    "\n"
                    "---------- Forwarded message ----------\n"
                    "From: old@pier.example\n"
                    "原计划周五发版。\n"
                    "\n"
                    "补充：发版已改到下周二，窗口是 4月21日。"
                ),
            ),
        ], scoped=True)],
        "included": {"email:fwd"},
        "fact_any": ["4月21日"],
    },
    {
        "id": "sealed-mixed-language",
        "query": "",
        "results": [_inbox([
            _email(
                "mix",
                subject="North Pier status",
                body=(
                    "接口冻结 freeze 定在 3月20日。\n"
                    "Owner: Mina Chen.\n"
                    "风险：API 契约还差 sign-off。"
                ),
            ),
        ], scoped=True)],
        "included": {"email:mix"},
        "fact_any": ["sign-off"],
    },
    {
        "id": "sealed-near-duplicate",
        "query": "许可证",
        "results": [_inbox([
            _email(
                "blocked",
                subject="北岸码头进度",
                date="2099-03-02T08:00:00+00:00",
                body="北岸码头进度 80%，阻塞在许可证。",
            ),
            _email(
                "cleared",
                subject="北岸码头进度更新",
                date="2099-03-09T08:00:00+00:00",
                body="北岸码头进度 80% 已解除，许可证昨天批了。",
            ),
        ], scoped=True, query="许可证")],
        "included": {"email:blocked", "email:cleared"},
        "fact_any": ["许可证昨天批了"],
    },
    {
        "id": "sealed-date-conflict",
        "query": "",
        "files": [{"path": "notes/review.md", "label": "评审记录"}],
        "results": [
            _inbox([
                _email("mail", subject="评审日期", body="评审日期写成 5月2日。"),
            ], scoped=True),
            _file("# 评审\n会议记录把评审日期写成 5月9日。\n"),
        ],
        "included": {"email:mail", _file_source_id("notes/review.md")},
        "has_file": True,
        "fact_all": ["5月2日", "5月9日"],
    },
    {
        "id": "sealed-meeting-notes",
        "query": "",
        "files": [{"path": "meetings/north-pier-2099-03-12.md", "label": "周会"}],
        "results": [
            _inbox([], scoped=True),
            _file(_MEETING_NOTES),
        ],
        "included": {_file_source_id("meetings/north-pier-2099-03-12.md")},
        "has_file": True,
        "fact_any": ["样品柜钥匙交给江澄"],
    },
    {
        "id": "sealed-csv-export",
        "query": "",
        "files": [{"path": "exports/pier-tasks.csv", "label": "任务表"}],
        "results": [
            _inbox([], scoped=True),
            _file(_CSV_EXPORT),
        ],
        "included": {_file_source_id("exports/pier-tasks.csv")},
        "has_file": True,
        "fact_any": ["码头护栏,梁秋,open,2026-04-22"],
    },
    {
        "id": "sealed-spec-distractor",
        "query": "",
        "files": [
            {"path": "specs/north-pier-api.md", "label": "北岸码头接口"},
            {"path": "specs/north-lighthouse-api.md", "label": "北岸灯塔接口"},
        ],
        "results": [
            _inbox([], scoped=True),
            _file(_PIER_SPEC),
            _file(_LIGHT_SPEC),
        ],
        "included": {
            _file_source_id("specs/north-pier-api.md"),
            _file_source_id("specs/north-lighthouse-api.md"),
        },
        "has_file": True,
        "fact_all": ["泊位占用", "灯塔离线"],
    },
    {
        "id": "sealed-quoted-reply",
        "query": "预算",
        "results": [_inbox([
            _email(
                "reply",
                subject="Re: 预算",
                body=(
                    "收到，我同意把预算改成 42万元。\n"
                    "\n"
                    "于 2099-03-01 写道：\n"
                    "> 预算先按 18万元报。"
                ),
            ),
        ], scoped=True, query="预算")],
        "included": {"email:reply"},
        "fact_any": ["42万元"],
    },
]

CASES.extend(SEALED_CASES)

def _file_source_id(path: str) -> str:
    return "file:" + hashlib.sha256(path.encode("utf-8")).hexdigest()[:12]


_DEV_EAST_SPEC = "specs/east-pump.md"
_DEV_WEST_SPEC = "specs/west-pump.md"
_DEV_MEETING = "notes/east-lake-review.md"
_DEV_PUMP_CSV = "exports/pump-work.csv"

DEV_CASES: list[dict] = [
    {
        "id": "dev-objective-wrapper",
        "query": "值班",
        "results": [_inbox([
            _email("duty", subject="值班表", preview="本周", body="值班人 陈禾"),
        ], scoped=True, query="值班")],
        "included": {"email:duty"},
        "fact_any": ["陈禾"],
    },
    {
        "id": "dev-thread-reschedule",
        "query": "",
        "results": [_inbox([
            _email(
                "pump",
                subject="东湖泵站检修",
                date="2099-04-02T08:00:00+00:00",
                body=(
                    "> 东湖泵站检修定在 5月20日。\n"
                    ">\n"
                    "值班室确认：检修改到 6月2日。"
                ),
            ),
        ], scoped=True)],
        "included": {"email:pump"},
        "fact_any": ["6月2日"],
    },
    {
        "id": "dev-forward-date",
        "query": "",
        "results": [_inbox([
            _email(
                "filter",
                subject="Fwd: 滤芯",
                date="2099-04-04T08:00:00+00:00",
                body=(
                    "请同事看一下。\n"
                    "\n"
                    "---------- Forwarded message ----------\n"
                    "From: duty@plant.example\n"
                    "原定周三更换滤芯。\n"
                    "\n"
                    "补充：滤芯更换改到 6月9日。"
                ),
            ),
        ], scoped=True)],
        "included": {"email:filter"},
        "fact_any": ["6月9日"],
    },
    {
        "id": "dev-near-duplicate",
        "query": "",
        "results": [_inbox([
            _email(
                "night-old",
                subject="仓库夜巡",
                date="2099-04-01T08:00:00+00:00",
                body="仓库夜巡走南门。\n钥匙在门岗。",
            ),
            _email(
                "night-new",
                subject="仓库夜巡",
                date="2099-04-03T08:00:00+00:00",
                body="仓库夜巡走南门。\n钥匙在门岗。\n夜巡已改走北门。",
            ),
        ], scoped=True)],
        "included": {"email:night-old", "email:night-new"},
        "fact_any": ["北门"],
    },
    {
        "id": "dev-conflicting-dates",
        "query": "",
        "results": [_inbox([
            _email(
                "east-a",
                subject="东湖验收",
                date="2099-05-01T00:00:00+00:00",
                body="东湖验收写的是 7月1日。\n请按邮件执行。",
            ),
            _email(
                "east-b",
                subject="东湖验收",
                date="2099-05-02T00:00:00+00:00",
                body="东湖验收写的是 7月8日。\n请按邮件执行。",
            ),
        ], scoped=True)],
        "included": {"email:east-a", "email:east-b"},
        "fact_all": ["7月1日", "7月8日"],
    },
    {
        "id": "dev-meeting-decision",
        "query": "",
        "results": [_file("\n".join([
            "东湖泵站周会",
            "时间：2099-04-05",
            "出席：周凯",
            "一、上周巡检",
            "泵组运行平稳。",
            "二、备件",
            "库存还够两周。",
            "三、讨论",
            "有人建议再观察。",
            "四、其他",
            "下次仍在周四。",
            "五、记录人",
            "记录人 周凯。",
            "决定：备件库存下限调到 12 件。",
        ]))],
        "files": [{"path": _DEV_MEETING, "label": _DEV_MEETING}],
        "included": {_file_source_id(_DEV_MEETING)},
        "has_file": True,
        "fact_any": ["12 件"],
    },
    {
        "id": "dev-similar-specs",
        "query": "",
        "results": [
            _file("\n".join([
                "适用范围：清水。",
                "电压 380V。",
                "东区泵组报价 27万元。",
            ])),
            _file("\n".join([
                "适用范围：清水。",
                "电压 380V。",
                "西区泵组报价 31万元。",
            ])),
        ],
        "files": [
            {"path": _DEV_EAST_SPEC, "label": _DEV_EAST_SPEC},
            {"path": _DEV_WEST_SPEC, "label": _DEV_WEST_SPEC},
        ],
        "included": {_file_source_id(_DEV_EAST_SPEC), _file_source_id(_DEV_WEST_SPEC)},
        "has_file": True,
        "fact_all": ["27万元", "31万元"],
    },
    {
        "id": "dev-csv-row",
        "query": "",
        "results": [_file("\n".join([
            "设备,编号,状态,日期",
            "阀门,V-1,备用,2026-01-02",
            "泵组,P-17,检修中,2026-06-11",
            "仪表,M-3,在用,2026-02-02",
        ]))],
        "files": [{"path": _DEV_PUMP_CSV, "label": _DEV_PUMP_CSV}],
        "included": {_file_source_id(_DEV_PUMP_CSV)},
        "has_file": True,
        "fact_any": ["泵组,P-17,检修中,2026-06-11"],
    },
    {
        "id": "dev-csv-open-row",
        "query": "",
        "results": [_file("\n".join(
            ["设备,编号,状态,日期"]
            + [f"阀门,V-{index},完成,2026-03-0{index}" for index in range(1, 7)]
            + ["泵组,P-17,检修中,2026-06-11"]
        ))],
        "files": [{"path": "exports/pump-open.csv", "label": "exports/pump-open.csv"}],
        "included": {_file_source_id("exports/pump-open.csv")},
        "has_file": True,
        "fact_any": ["泵组,P-17,检修中,2026-06-11"],
    },
]

CASES.extend(DEV_CASES)


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


def _dev(case_id: str) -> dict:
    return next(item for item in DEV_CASES if item["id"] == case_id)


def _compile_miss(case: dict, finding: dict) -> str:
    sources, _bodies, notes, coverage = prepare_case(case)
    result = validate_model_brief(
        {
            "summary": "模型摘了另一句",
            "content": "模型摘了另一句",
            "findings": [finding],
        },
        allowed_ids={str(item["id"]) for item in sources},
        criteria=default_acceptance_criteria(),
        source_notes=notes,
        source_catalog=dict(coverage["_catalog"]),
        objective="整理进度、风险和待办",
    )
    return "\n".join(str(item.get("text") or "") for item in result["findings"])


def test_prompt_label_suffix_on_a_source_id_is_removed():
    result = validate_model_brief(
        {
            "summary": "值班人 陈禾",
            "content": "值班人 陈禾",
            "findings": [{
                "text": "值班人 陈禾",
                "quote": "值班人 陈禾",
                "source_ids": ["email:duty (a@b.c)"],
                "kind": "change",
            }],
        },
        allowed_ids={"email:duty"},
        criteria=default_acceptance_criteria(),
        source_notes=[],
        source_catalog={
            "email:duty": {"text": "值班人 陈禾", "locator": "a@b.c", "title": "值班表"},
        },
        objective="整理进度、风险和待办",
    )
    assert result["quality_evidence"] == "pending"
    assert result["findings"][0]["source_ids"] == ["email:duty"]


def test_dev_thread_keeps_the_later_date():
    text = _compile_miss(_dev("dev-thread-reschedule"), {
        "text": "东湖泵站检修定在 5月20日",
        "quote": "> 东湖泵站检修定在 5月20日。",
        "source_ids": ["email:pump"],
        "kind": "change",
    })
    assert "6月2日" in text
    assert "5月20日" not in text


def test_dev_forward_keeps_the_date_inside_the_chain():
    text = _compile_miss(_dev("dev-forward-date"), {
        "text": "请同事看一下",
        "quote": "请同事看一下。",
        "source_ids": ["email:filter"],
        "kind": "change",
    })
    assert "6月9日" in text


def test_dev_near_duplicate_keeps_the_newer_line():
    case = _dev("dev-near-duplicate")
    _sources, _bodies, notes, _coverage = prepare_case(case)
    assert any("email:night-old 已被 email:night-new 取代" in note for note in notes)
    text = _compile_miss(case, {
        "text": "仓库夜巡走南门",
        "quote": "仓库夜巡走南门。",
        "source_ids": ["email:night-old"],
        "kind": "change",
    })
    assert "北门" in text


def test_dev_meeting_decision_is_kept_when_the_model_quotes_the_agenda():
    text = _compile_miss(_dev("dev-meeting-decision"), {
        "text": "出席：周凯",
        "quote": "出席：周凯",
        "source_ids": [_file_source_id(_DEV_MEETING)],
        "kind": "change",
    })
    assert "12 件" in text


def test_dev_similar_specs_keep_both_prices():
    text = _compile_miss(_dev("dev-similar-specs"), {
        "text": "适用范围：清水",
        "quote": "适用范围：清水。",
        "source_ids": [_file_source_id(_DEV_EAST_SPEC)],
        "kind": "change",
    })
    assert "27万元" in text
    assert "31万元" in text


def test_dev_conflicting_dates_both_stay():
    case = _dev("dev-conflicting-dates")
    _sources, _bodies, notes, _coverage = prepare_case(case)
    assert not any("取代" in note for note in notes)
    text = _compile_miss(case, {
        "text": "东湖验收写的是 7月1日",
        "quote": "东湖验收写的是 7月1日。",
        "source_ids": ["email:east-a"],
        "kind": "change",
    })
    assert "7月1日" in text
    assert "7月8日" in text


def test_dev_csv_keeps_a_late_open_row():
    text = _compile_miss(_dev("dev-csv-open-row"), {
        "text": "设备,编号,状态,日期",
        "quote": "设备,编号,状态,日期",
        "source_ids": [_file_source_id("exports/pump-open.csv")],
        "kind": "change",
    })
    assert "泵组,P-17,检修中,2026-06-11" in text


def test_dev_csv_keeps_the_status_row():
    text = _compile_miss(_dev("dev-csv-row"), {
        "text": "设备,编号,状态,日期",
        "quote": "设备,编号,状态,日期",
        "source_ids": [_file_source_id(_DEV_PUMP_CSV)],
        "kind": "change",
    })
    assert "泵组,P-17,检修中,2026-06-11" in text


def test_sealed_long_files_do_not_list_every_line():
    notes = _source_block("File file:x (周会)", _MEETING_NOTES)
    assert "Quotable lines" not in notes
    assert "样品柜钥匙交给江澄" in notes
    sheet = _source_block("File file:y (任务表)", _CSV_EXPORT)
    assert "Quotable lines" not in sheet
    assert "码头护栏,梁秋,open,2026-04-22" in sheet


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
    assert any(item.startswith("sealed-") for item in ids)
    assert len([item for item in ids if item.startswith("sealed-")]) >= 8
    assert any(item.startswith("dev-") for item in ids)


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


def test_quote_matching_one_of_two_ids_keeps_only_that_source():
    result = validate_model_brief(
        {
            "summary": "两封邮件报价不同",
            "content": "正文",
            "findings": [{
                "text": "一封写了一百",
                "source_ids": ["email:a", "email:b"],
                "quote": "报价 100元",
            }],
        },
        allowed_ids={"email:a", "email:b"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
        source_catalog={
            "email:a": {"text": "报价 100元", "locator": "a", "title": "甲"},
            "email:b": {"text": "报价 200元", "locator": "b", "title": "乙"},
        },
    )
    assert result["quality_evidence"] == "pending"
    evidence = result["findings"][0]["evidence"]
    assert [row["source_id"] for row in evidence] == ["email:a"]
    assert evidence[0]["quote_in_source"] is True


def test_same_amount_does_not_keep_a_false_inconsistency_claim():
    result = validate_model_brief(
        {
            "summary": "金额互相矛盾",
            "content": "正文",
            "findings": [{
                "text": "两封邮件报价不一致",
                "source_ids": ["email:a"],
                "quote": "报价 100元",
            }],
            "limitations": ["日期矛盾，需要再问"],
        },
        allowed_ids={"email:a", "email:b"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
        source_catalog={
            "email:a": {"text": "报价 100元", "locator": "a", "title": "甲"},
            "email:b": {"text": "确认 100 元", "locator": "b", "title": "乙"},
        },
    )
    visible = "\n".join([
        result["summary"],
        result["content"],
        result["findings"][0]["text"],
        "\n".join(result["limitations"]),
    ])
    assert "不一致" not in visible
    assert "矛盾" not in visible
    assert result["quality_evidence"] == "pending"


def test_meta_limitation_sentence_is_dropped():
    result = validate_model_brief(
        {
            "summary": "北岸码头验收改期",
            "content": "正文",
            "findings": [{
                "text": "验收改到 4月18日",
                "source_ids": ["file:a"],
                "quote": "北岸码头验收改到 4月18日",
            }],
            "limitations": [
                "No limitations are identified in the provided information.",
                "没有发现限制",
                "验收日期只出现在这一份笔记里",
            ],
        },
        allowed_ids={"file:a"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
        source_catalog={
            "file:a": {
                "text": "北岸码头验收改到 4月18日。",
                "locator": "pier.md:1",
                "title": "笔记",
            },
        },
    )
    notes = result["limitations"]
    assert "验收日期只出现在这一份笔记里" in notes
    assert not any("No limitations" in note for note in notes)
    assert not any(note == "没有发现限制" for note in notes)


def test_real_amount_conflict_keeps_the_disagreement():
    result = validate_model_brief(
        {
            "summary": "金额不一致",
            "content": "正文",
            "findings": [{
                "text": "两封邮件金额不一致",
                "source_ids": ["email:a"],
                "quote": "报价 100元",
            }],
        },
        allowed_ids={"email:a", "email:b"},
        criteria=["每条关键结论附来源"],
        source_notes=["来源中的金额不一致，需人工核对"],
        source_catalog={
            "email:a": {"text": "报价 100元", "locator": "a", "title": "甲"},
            "email:b": {"text": "报价 200元", "locator": "b", "title": "乙"},
        },
    )
    assert "不一致" in result["summary"]
    assert "来源中的金额不一致，需人工核对" in result["limitations"]


def test_truncation_note_uses_the_marker_line_as_evidence():
    result = _quote_case("只显示 10/40 行", "开头\n... [showing 10/40 lines]")
    assert result["quality_evidence"] == "pending"
    snippet = result["findings"][0]["evidence"][0]["snippet"]
    assert "showing 10/40" in snippet
    assert result["findings"][0]["evidence"][0]["quote_in_source"] is True


def test_cited_line_surfaces_owner_and_due_date():
    result = validate_model_brief(
        {
            "summary": "有分工",
            "content": "正文",
            "findings": [{
                "text": "材料要交",
                "kind": "action",
                "source_ids": ["email:m1"],
                "quote": "负责人 陈舟，截止 4月2日",
            }],
            "suggested_actions": [{
                "title": "交材料",
                "reason": "会前要齐",
                "source_ids": ["email:m1"],
            }],
        },
        allowed_ids={"email:m1"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
        source_catalog={
            "email:m1": {
                "text": "负责人 陈舟，截止 4月2日",
                "locator": "a@b.c",
                "title": "分工",
            },
        },
    )
    finding = result["findings"][0]
    assert finding["owner"] == "陈舟"
    assert finding["due_on"] == "4月2日"
    assert "负责人 陈舟" in finding["text"]
    assert "截止 4月2日" in finding["text"]
    assert "负责人 陈舟" in result["content"]
    action = result["suggested_actions"][0]
    assert action["owner"] == "陈舟"
    assert action["due_on"] == "4月2日"
    assert "截止 4月2日" in action["title"]


def test_two_owners_on_one_line_are_not_assigned():
    result = validate_model_brief(
        {
            "summary": "有分工",
            "content": "正文",
            "findings": [{
                "text": "两人负责",
                "source_ids": ["email:m1"],
                "quote": "负责人 陈舟 负责人 林晚",
            }],
        },
        allowed_ids={"email:m1"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
        source_catalog={
            "email:m1": {
                "text": "负责人 陈舟 负责人 林晚",
                "locator": "a@b.c",
                "title": "分工",
            },
        },
    )
    assert "owner" not in result["findings"][0]
    assert "负责人 陈舟" not in result["findings"][0]["text"]


def test_blocking_risk_is_listed_before_a_change():
    result = validate_model_brief(
        {
            "summary": "有进度",
            "content": "正文",
            "findings": [
                {
                    "text": "本周进度正常",
                    "kind": "change",
                    "source_ids": ["email:a"],
                    "quote": "本周进度正常",
                },
                {
                    "text": "联调阻塞",
                    "kind": "risk",
                    "source_ids": ["email:b"],
                    "quote": "联调阻塞",
                },
            ],
        },
        allowed_ids={"email:a", "email:b"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
        source_catalog={
            "email:a": {"text": "本周进度正常", "locator": "a", "title": "进度"},
            "email:b": {"text": "联调阻塞", "locator": "b", "title": "风险"},
        },
    )
    assert [item["kind"] for item in result["findings"]] == ["risk", "change"]
    body = result["content"]
    assert body.index("联调阻塞") < body.index("本周进度正常")


def test_repeat_quote_is_kept_once():
    result = validate_model_brief(
        {
            "summary": "有进度",
            "content": "正文",
            "findings": [
                {
                    "text": "进度正常",
                    "kind": "change",
                    "source_ids": ["email:a"],
                    "quote": "本周进度正常",
                },
                {
                    "text": "又说了一遍进度",
                    "kind": "change",
                    "source_ids": ["email:a"],
                    "quote": "本周进度正常",
                },
            ],
        },
        allowed_ids={"email:a"},
        criteria=["每条关键结论附来源"],
        source_notes=[],
        source_catalog={
            "email:a": {"text": "本周进度正常", "locator": "a", "title": "进度"},
        },
    )
    assert len(result["findings"]) == 1
    assert result["findings"][0]["text"] == "进度正常"


def test_full_source_line_wins_over_a_longer_partial_span():
    text = "注意注意\n本周预算 100元请确认"
    result = _quote_case("注意注意。本周预算 100元", text)
    assert result["quality_evidence"] == "pending"
    assert result["findings"][0]["evidence"][0]["snippet"] == "注意注意"


_TASK = "整理进度、风险和待办。来源里没有的金额不要写。金额互相矛盾时要写明。"


def _echo_case(text: str, quote: str, source: str, *, finding: str | None = None) -> dict:
    return validate_model_brief(
        {
            "summary": "有文件",
            "content": "正文",
            "findings": [{
                "text": finding if finding is not None else text,
                "source_ids": ["file:a"],
                "quote": quote,
            }],
        },
        allowed_ids={"file:a"},
        criteria=default_acceptance_criteria(),
        source_notes=[],
        source_catalog={
            "file:a": {"text": source, "locator": "a.md", "title": "笔记"},
        },
        objective=_TASK,
    )


def test_bare_key_and_truncated_array_still_parse():
    bare = _extract_json('{"summary": "有结论", content": "正文", "findings": []}')
    assert bare["content"] == "正文"
    truncated = _extract_json(
        '{"summary":"有","content":"文","findings":['
        '{"text":"负责人 林晚","quote":"负责人 林晚"},'
        '{"text":"还没写完'
    )
    assert truncated["findings"][0]["quote"] == "负责人 林晚"
    assert len(truncated["findings"]) == 1


def test_trailing_period_on_a_source_line_still_matches():
    result = validate_model_brief(
        {
            "summary": "负责人已写明",
            "content": "负责人 林晚",
            "findings": [{
                "text": "负责人 林晚",
                "source_ids": ["email:m1"],
                "quote": "负责人 林晚.",
            }],
        },
        allowed_ids={"email:m1"},
        criteria=default_acceptance_criteria(),
        source_notes=[],
        source_catalog={
            "email:m1": {"text": "负责人 林晚", "locator": "m1", "title": "分工"},
        },
        objective=_TASK,
    )
    assert result["quality_evidence"] == "pending"
    assert result["findings"][0]["evidence"][0]["snippet"] == "负责人 林晚"


def test_collector_note_echo_does_not_sink_a_real_line():
    result = validate_model_brief(
        {
            "summary": "",
            "content": "",
            "findings": [
                {
                    "text": "封命中邮件没有全文，简报只用了预览",
                    "source_ids": ["email:m1"],
                    "quote": "封命中邮件没有全文，简报只用了预览.",
                },
                {
                    "text": "正常",
                    "source_ids": ["email:m1"],
                    "quote": "正常",
                },
            ],
        },
        allowed_ids={"email:m1"},
        criteria=default_acceptance_criteria(),
        source_notes=["1 封命中邮件没有全文，简报只用了预览"],
        source_catalog={"email:m1": {"text": "正常", "locator": "m1", "title": "邮件"}},
        objective=_TASK,
    )
    assert result["quality_evidence"] == "pending"
    assert all(row["evidence"][0]["quote_in_source"] for row in result["findings"])


def test_owner_line_matches_when_the_space_was_dropped():
    result = validate_model_brief(
        {
            "summary": "负责人已写明",
            "content": "负责人 林晚",
            "findings": [{
                "text": "负责人林晚",
                "source_ids": ["email:m1"],
                "quote": "负责人林晚",
            }],
        },
        allowed_ids={"email:m1"},
        criteria=default_acceptance_criteria(),
        source_notes=[],
        source_catalog={
            "email:m1": {"text": "负责人 林晚", "locator": "a@b.c", "title": "分工"},
        },
        objective=_TASK,
    )
    assert result["quality_evidence"] == "pending"
    assert result["findings"][0]["evidence"][0]["snippet"] == "负责人 林晚"


def test_finding_text_that_is_the_source_line_counts_without_a_quote():
    result = validate_model_brief(
        {
            "summary": "样品已寄出",
            "content": "样品已寄出",
            "findings": [{
                "text": "样品已寄出",
                "source_ids": ["file:s"],
            }],
        },
        allowed_ids={"file:s"},
        criteria=default_acceptance_criteria(),
        source_notes=["只显示 4/30 行"],
        source_catalog={
            "file:s": {
                "text": "样品已寄出\n... [showing 4/30 lines]",
                "locator": "sample.md",
                "title": "样品",
            },
        },
        objective=_TASK,
    )
    assert result["quality_evidence"] == "pending"
    assert result["findings"][0]["evidence"][0]["quote_in_source"] is True


def test_prompt_labels_do_not_sink_a_real_owner_line():
    result = validate_model_brief(
        {
            "summary": "负责人已写明",
            "content": "负责人 林晚",
            "findings": [
                {
                    "text": "不编造来源",
                    "source_ids": ["email:m1"],
                    "quote": "不编造来源.",
                },
                {
                    "text": "负责人 林晚",
                    "source_ids": ["email:m1"],
                    "quote": "负责人 林晚.",
                },
                {
                    "text": "Subject: 分工",
                    "source_ids": ["email:m1"],
                    "quote": "Subject: 分工.",
                },
                {
                    "text": "a@b.c",
                    "source_ids": ["email:m1"],
                    "quote": "a@b.c.",
                },
                {
                    "text": "Allowed source ids: email:m1",
                    "source_ids": ["email:m1"],
                    "quote": "Allowed source ids: email:m1.",
                },
            ],
        },
        allowed_ids={"email:m1"},
        criteria=default_acceptance_criteria(),
        source_notes=[],
        source_catalog={
            "email:m1": {
                "text": "负责人 林晚",
                "locator": "a@b.c",
                "title": "分工",
            },
        },
        objective=_TASK,
    )
    assert result["quality_evidence"] == "pending"
    assert all(row["evidence"][0]["quote_in_source"] for row in result["findings"])
    assert any("林晚" in row["text"] for row in result["findings"])
    assert all("Subject" not in row["text"] for row in result["findings"])


def test_echo_without_a_quote_uses_the_real_line():
    result = _echo_case(_TASK, "", "完整短文")
    assert result["quality_evidence"] == "pending"
    evidence = result["findings"][0]["evidence"][0]
    assert evidence["quote_in_source"] is True
    assert evidence["snippet"] == "完整短文"
    assert result["findings"][0]["text"] == "完整短文"


def test_echo_with_a_bogus_source_id_uses_the_real_file():
    result = validate_model_brief(
        {
            "summary": "有文件",
            "content": "正文",
            "findings": [{
                "text": _TASK,
                "source_ids": ["email"],
                "quote": "",
            }],
        },
        allowed_ids={"file:a"},
        criteria=default_acceptance_criteria(),
        source_notes=[],
        source_catalog={
            "file:a": {"text": "完整短文", "locator": "a.md", "title": "笔记"},
        },
        objective=_TASK,
    )
    assert result["quality_evidence"] == "pending"
    assert result["findings"][0]["source_ids"] == ["file:a"]
    assert result["findings"][0]["evidence"][0]["snippet"] == "完整短文"


def test_real_conclusion_without_a_quote_is_not_replaced():
    result = _echo_case("预算增加了", "", "完整短文", finding="预算增加了")
    assert result["findings"][0]["text"] == "预算增加了"
    assert result["findings"][0]["evidence"][0]["quote_in_source"] is False


def test_echo_quoting_the_subject_uses_the_body_line():
    result = validate_model_brief(
        {
            "summary": "有邮件",
            "content": "正文",
            "findings": [{
                "text": _TASK,
                "source_ids": ["email:m1"],
                "quote": " 分工",
            }],
        },
        allowed_ids={"email:m1"},
        criteria=default_acceptance_criteria(),
        source_notes=[],
        source_catalog={
            "email:m1": {
                "text": "负责人 林晚",
                "locator": "a@b.c",
                "title": "分工",
            },
        },
        objective=_TASK,
    )
    assert result["quality_evidence"] == "pending"
    assert result["findings"][0]["text"] == "负责人 林晚"
    assert result["findings"][0]["evidence"][0]["snippet"] == "负责人 林晚"


def test_real_conclusion_quoting_the_subject_stays_unsupported():
    result = validate_model_brief(
        {
            "summary": "有邮件",
            "content": "正文",
            "findings": [{
                "text": "预算增加了",
                "source_ids": ["email:m1"],
                "quote": "分工",
            }],
        },
        allowed_ids={"email:m1"},
        criteria=default_acceptance_criteria(),
        source_notes=[],
        source_catalog={
            "email:m1": {
                "text": "负责人 林晚",
                "locator": "a@b.c",
                "title": "分工",
            },
        },
        objective=_TASK,
    )
    assert result["quality_evidence"] == "unsupported"
    assert result["findings"][0]["text"] == "预算增加了"


def test_wrapped_objective_uses_the_source_line():
    wrapped = "该项目需要整理进度、风险和待办"
    result = _echo_case(wrapped, wrapped, "值班人 陈禾")
    assert result["quality_evidence"] == "pending"
    assert result["findings"][0]["text"] == "值班人 陈禾"
    assert result["findings"][0]["evidence"][0]["snippet"] == "值班人 陈禾"


def test_objective_plus_a_real_claim_is_not_replaced():
    text = "整理进度、风险和待办，另外样品已寄出"
    result = _echo_case(text, text, "值班人 陈禾")
    assert result["findings"][0]["text"] == text
    assert result["quality_evidence"] == "unsupported"
    assert result["findings"][0]["evidence"][0]["quote_in_source"] is False


def test_instruction_echo_on_a_truncated_file_uses_the_real_line():
    result = _echo_case(_TASK, _TASK, "开头\n... [showing 10/40 lines]")
    assert result["quality_evidence"] == "pending"
    evidence = result["findings"][0]["evidence"][0]
    assert evidence["quote_in_source"] is True
    assert evidence["snippet"] == "开头"
    assert result["findings"][0]["text"] == "开头"
    assert _TASK not in result["content"]


def test_instruction_echo_keeps_a_real_conclusion_unsupported():
    result = _echo_case(_TASK, _TASK, "开头\n... [showing 10/40 lines]", finding="预算增加了")
    assert result["quality_evidence"] == "unsupported"
    assert result["findings"][0]["text"] == "预算增加了"
    assert result["findings"][0]["evidence"][0]["quote_in_source"] is False


def test_marker_only_echo_quotes_the_truncation_marker():
    source = "...\n... [showing 2000/9000 lines]\n... [content truncated]"
    result = _echo_case(_TASK, _TASK, source)
    assert result["quality_evidence"] == "pending"
    snippet = result["findings"][0]["evidence"][0]["snippet"]
    assert "showing 2000/9000" in snippet
    assert "只显示 2000/9000 行" in result["findings"][0]["text"]


def test_objective_sentence_stays_when_the_source_contains_it():
    result = _echo_case(_TASK, _TASK, _TASK)
    assert result["quality_evidence"] == "pending"
    assert "整理进度、风险和待办" in result["findings"][0]["text"]
    assert result["findings"][0]["evidence"][0]["snippet"] == _TASK


def test_short_file_lists_quotable_lines_inside_a_data_fence():
    block = _source_block("File file:abc (笔记)", "完整短文")
    prompt = _build_prompt(
        contract={"objective": _TASK, "acceptance_criteria": default_acceptance_criteria()},
        rework_notes=[],
        source_blocks=[block],
        source_notes=[],
        allowed_ids=["file:abc"],
    )
    assert "Quotable lines in File file:abc" in prompt
    assert "Do not copy the objective" in prompt
    assert "at most 6 findings" in prompt
    start = prompt.find("Quotable lines")
    fence = prompt.find("<<<", start)
    close = prompt.find(">>>", fence)
    assert fence >= 0 and close > fence
    assert "完整短文" in prompt[fence:close]


def test_long_file_does_not_repeat_every_line_as_quotable():
    body = "\n".join(f"第{index}行进度正常" for index in range(1, 14))
    block = _source_block("File file:abc (笔记)", body)
    assert "Quotable lines" not in block
    assert "第1行进度正常" in block


def test_blank_summary_uses_the_finding_text():
    result = validate_model_brief(
        {
            "summary": "",
            "content": "",
            "findings": [{
                "text": "本周预算 100元",
                "source_ids": ["email:m1"],
                "quote": "本周预算 100元",
            }],
        },
        allowed_ids={"email:m1"},
        criteria=default_acceptance_criteria(),
        source_notes=[],
        source_catalog={
            "email:m1": {"text": "本周预算 100元", "locator": "a@b.c", "title": "周报"},
        },
    )
    assert result["quality_evidence"] == "pending"
    assert "本周预算 100元" in result["summary"]


def test_blank_brief_uses_one_real_source_line():
    result = validate_model_brief(
        {"summary": "", "content": "", "findings": []},
        allowed_ids={"email:m1"},
        criteria=default_acceptance_criteria(),
        source_notes=[],
        source_catalog={
            "email:m1": {"text": "本周预算 100元", "locator": "a@b.c", "title": "周报"},
        },
    )
    assert result["quality_evidence"] == "pending"
    assert result["findings"][0]["text"] == "本周预算 100元"
    assert result["findings"][0]["evidence"][0]["quote_in_source"] is True


def test_blank_brief_without_sources_still_fails():
    with pytest.raises(ValueError, match="missing summary or content"):
        validate_model_brief(
            {"summary": "", "content": "", "findings": []},
            allowed_ids=set(),
            criteria=default_acceptance_criteria(),
            source_notes=[],
            source_catalog={},
        )
