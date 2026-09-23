"""Repeat one existing project brief from a timer payload work_id."""

from __future__ import annotations

import asyncio
import json

import pytest

from app.core.agents.handlers.timer_trigger_handler import (
    _handle_reminder,
    explicit_timer_work_id,
)
from app.core.harness.builtin_tools.timer import _writer_set_timer
from app.core.harness.mcp_hub import ToolInvokeError
from app.core.runtime import read_ports
from app.product.work_delivery import (
    fold_delivery_history,
    publish_delivery,
    schedule_brief_repeat,
)


def _completed_brief(title: str = "项目简报") -> dict:
    return read_ports.create_work_item(
        title,
        description="整理最近变化",
        work_type="task",
        executable_plan=(
            '{"kind":"project_brief","contract":{"contract_version":1,'
            '"output_kind":"project_brief"},'
            '"steps":[{"tool":"echo","params":{"t":"1"}}]}'
        ),
        status="completed",
    )


def _work_ids() -> set[str]:
    return {str(row["id"]) for row in read_ports.query_work_items(limit=20)}


def test_explicit_timer_work_id_ignores_other_keys():
    assert explicit_timer_work_id({"action_id": "brief_1"}) is None
    assert explicit_timer_work_id({"work_id": "  ", "action_id": "brief_1"}) is None
    assert explicit_timer_work_id({"work_id": 12, "action_id": "brief_1"}) is None
    assert explicit_timer_work_id({"work_id": " brief_1 "}) == "brief_1"


def test_set_timer_writes_only_an_existing_work_id(isolated_kernel):
    item = _completed_brief()
    work_id = item["id"]

    plain = json.loads(_writer_set_timer(minutes=5, message="喝水"))
    plain_payload = json.loads(read_ports.query_timer(plain["timer_id"])["payload_json"])
    assert plain_payload == {"message": "喝水"}

    blank = json.loads(_writer_set_timer(minutes=5, message="喝水", work_id="  "))
    blank_payload = json.loads(read_ports.query_timer(blank["timer_id"])["payload_json"])
    assert "work_id" not in blank_payload

    linked = json.loads(_writer_set_timer(minutes=5, message="再次运行", work_id=work_id))
    linked_payload = json.loads(read_ports.query_timer(linked["timer_id"])["payload_json"])
    assert linked_payload["work_id"] == work_id
    assert "action_id" not in linked_payload
    assert read_ports.query_work_item(work_id)["status"] == "completed"

    with pytest.raises(ToolInvokeError, match="does not exist"):
        _writer_set_timer(minutes=5, message="再次运行", work_id="missing-brief")
    assert _work_ids() == {work_id}


def test_schedule_brief_repeat_stores_the_same_work_id(isolated_kernel):
    item = _completed_brief("周期简报")
    work_id = item["id"]
    published = publish_delivery(
        work_id,
        content="第一期",
        summary="第一期",
        sources=[],
        execution_id="schedule-v1",
    )

    scheduled = asyncio.run(schedule_brief_repeat(work_id, hours=1))
    payload = json.loads(read_ports.query_timer(scheduled["timer_id"])["payload_json"])
    assert payload["work_id"] == work_id
    assert scheduled["work_id"] == work_id
    assert read_ports.query_work_item(work_id)["status"] == "completed"
    assert fold_delivery_history(work_id)["current"]["delivery_id"] == published["delivery_id"]
    assert _work_ids() == {work_id}


def test_timer_fire_reruns_the_same_completed_brief(isolated_kernel):
    item = _completed_brief()
    work_id = item["id"]
    published = publish_delivery(
        work_id,
        content="第一期",
        summary="第一期",
        sources=[],
        execution_id="fire-v1",
    )

    asyncio.run(_handle_reminder(
        {"message": "再次运行：项目简报", "work_id": work_id},
        "t_repeat",
    ))

    stored = read_ports.query_work_item(work_id)
    assert stored is not None
    assert stored["status"] == "running"
    assert _work_ids() == {work_id}
    assert fold_delivery_history(work_id)["current"]["delivery_id"] == published["delivery_id"]
    notes = read_ports.query_notifications(type="reminder", limit=10)
    assert len(notes) == 1
    assert notes[0]["related_id"] == work_id
    assert notes[0]["related_type"] == "work_item"
    assert "已再次运行这一份任务" in notes[0]["content"]


def test_timer_fire_opens_when_the_same_task_cannot_rerun(isolated_kernel):
    other = read_ports.create_work_item(
        "普通任务",
        work_type="task",
        executable_plan='{"steps":[{"tool":"echo","params":{}}]}',
        status="completed",
    )
    asyncio.run(_handle_reminder(
        {"message": "看看", "work_id": other["id"], "action_id": "invented"},
        "t_open",
    ))
    assert read_ports.query_work_item(other["id"])["status"] == "completed"
    assert _work_ids() == {other["id"]}
    notes = read_ports.query_notifications(type="reminder", limit=10)
    assert notes[0]["related_id"] == other["id"]
    assert "打开的仍是它" in notes[0]["content"]
    assert "invented" not in notes[0]["content"]


def test_timer_fire_does_not_invent_a_task_for_a_missing_or_blank_id(isolated_kernel):
    item = _completed_brief()
    work_id = item["id"]
    publish_delivery(
        work_id,
        content="第一期",
        summary="第一期",
        sources=[],
        execution_id="fire-blank",
    )

    asyncio.run(_handle_reminder(
        {"message": "空白", "work_id": "  ", "action_id": work_id},
        "t_blank",
    ))
    asyncio.run(_handle_reminder(
        {"message": "没有这份任务", "work_id": "missing-brief"},
        "t_missing",
    ))

    assert read_ports.query_work_item(work_id)["status"] == "completed"
    assert _work_ids() == {work_id}
    notes = read_ports.query_notifications(type="reminder", limit=10)
    assert {note.get("related_id") for note in notes} == {None}
    assert all(work_id not in (note.get("content") or "") for note in notes)
