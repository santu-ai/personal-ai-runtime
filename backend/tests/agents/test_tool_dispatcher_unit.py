"""Unit tests for ToolDispatcher message building and dispatch."""

from __future__ import annotations

import json

import pytest


class MockConversation:
    def __init__(self):
        self.saved: list[tuple[str, str]] = []

    def save_tool_result(self, result, call_id):
        self.saved.append((call_id, result))


class MockKernel:
    def __init__(self, responses: dict[str, dict] | None = None):
        self.calls: list[dict] = []
        self._responses = responses or {}

    async def invoke_capability(self, name, args, actor, correlation_id, execution_id):
        self.calls.append(
            {
                "name": name,
                "args": args,
                "actor": actor,
                "correlation_id": correlation_id,
                "execution_id": execution_id,
            }
        )
        if name in self._responses:
            return self._responses[name]
        return {"status": "success", "result": '{"ok": true}'}


async def _collect(dispatcher, tool_calls, **kwargs):
    events = []
    async for evt in dispatcher.dispatch(tool_calls, **kwargs):
        events.append(evt)
    return events


class TestToolDispatcherMessages:
    def test_build_tool_call_messages(self):
        from app.core.agents.tool_dispatcher import ToolDispatcher

        conv = MockConversation()
        td = ToolDispatcher(kernel=MockKernel(), conversation=conv)
        tc_data = [
            {"id": "tc1", "function_name": "read_file", "arguments": '{"path": "/tmp/x"}'},
            {"id": "tc2", "function_name": "web_search", "arguments": '{"q": "test"}'},
        ]
        msgs = td.build_tool_call_messages("some content", tc_data)
        assert len(msgs) == 1
        assert msgs[0]["role"] == "assistant"
        assert msgs[0]["content"] == "some content"
        assert len(msgs[0]["tool_calls"]) == 2
        assert msgs[0]["tool_calls"][0]["function"]["name"] == "read_file"

    def test_build_tool_call_messages_empty(self):
        from app.core.agents.tool_dispatcher import ToolDispatcher

        td = ToolDispatcher(kernel=MockKernel(), conversation=MockConversation())
        msgs = td.build_tool_call_messages("", [])
        assert len(msgs) == 1
        assert msgs[0]["role"] == "assistant"
        assert msgs[0]["content"] is None


class TestToolDispatcherDispatch:
    @pytest.mark.asyncio
    async def test_dispatch_success(self):
        from app.core.agents.tool_dispatcher import ToolDispatcher

        kernel = MockKernel({"read_file": {"status": "success", "result": '{"data": 1}'}})
        conv = MockConversation()
        td = ToolDispatcher(kernel=kernel, conversation=conv)
        events = await _collect(
            td,
            [{"id": "tc1", "function_name": "read_file", "arguments": '{"path": "a.txt"}'}],
            correlation_id="corr-1",
            execution_id="exec-1",
        )

        assert kernel.calls[0]["args"] == {"path": "a.txt"}
        assert kernel.calls[0]["execution_id"] == "exec-1"
        assert kernel.calls[0]["correlation_id"] == "corr-1"
        assert events[0]["type"] == "tool_result"
        assert events[0]["tool_name"] == "read_file"
        assert events[-1]["type"] == "_dispatcher_done"
        assert len(events[-1]["results"]) == 1
        assert len(events[-1]["tool_messages"]) == 1
        assert events[-1]["tool_messages"][0]["role"] == "tool"
        assert conv.saved == [("tc1", '{"data": 1}')]

    @pytest.mark.asyncio
    async def test_dispatch_pending_suspends_but_keeps_batch(self):
        from app.core.agents.tool_dispatcher import ToolDispatcher

        kernel = MockKernel({
            "write_file": {
                "status": "pending",
                "approval_id": "ap-1",
            },
            "read_file": {"status": "success", "result": "ok"},
        })
        conv = MockConversation()
        td = ToolDispatcher(kernel=kernel, conversation=conv)
        events = await _collect(
            td,
            [
                {"id": "tc1", "function_name": "write_file", "arguments": '{"path": "x"}'},
                {"id": "tc2", "function_name": "read_file", "arguments": "{}"},
            ],
        )

        # The pending tool suspends, but the rest of the batch still runs.
        assert [e["type"] for e in events] == [
            "confirmation_required",
            "tool_result",
            "done",
            "_dispatcher_done",
        ]
        assert events[0]["approval_id"] == "ap-1"
        assert events[0]["tool_call_id"] == "tc1"
        assert len(kernel.calls) == 2  # read_file still invoked
        assert conv.saved == [("tc2", "ok")]
        assert events[-1]["results"] == [{"tool_name": "read_file", "tool_call_id": "tc2", "content": "ok"}]

    @pytest.mark.asyncio
    async def test_dispatch_failure_yields_error_json(self):
        from app.core.agents.tool_dispatcher import ToolDispatcher

        kernel = MockKernel({
            "shell_exec": {"status": "error", "error": "denied"},
        })
        conv = MockConversation()
        td = ToolDispatcher(kernel=kernel, conversation=conv)
        events = await _collect(
            td,
            [{"id": "tc1", "function_name": "shell_exec", "arguments": "{}"}],
        )

        assert events[0]["type"] == "tool_result"
        payload = json.loads(events[0]["content"])
        assert payload["status"] == "error"
        assert payload["error"] == "denied"
        assert events[-1]["type"] == "_dispatcher_done"
        assert conv.saved[0][0] == "tc1"

    @pytest.mark.asyncio
    async def test_dispatch_bad_json_args_become_empty_dict(self):
        from app.core.agents.tool_dispatcher import ToolDispatcher

        kernel = MockKernel()
        td = ToolDispatcher(kernel=kernel, conversation=MockConversation())
        await _collect(
            td,
            [{"id": "tc1", "function_name": "read_file", "arguments": "{not-json"}],
        )
        assert kernel.calls[0]["args"] == {}

    @pytest.mark.asyncio
    async def test_dispatch_empty_arguments_string(self):
        from app.core.agents.tool_dispatcher import ToolDispatcher

        kernel = MockKernel()
        td = ToolDispatcher(kernel=kernel, conversation=MockConversation())
        await _collect(
            td,
            [{"id": "tc1", "function_name": "read_file", "arguments": ""}],
        )
        assert kernel.calls[0]["args"] == {}


class TestToolDispatcherIdempotency:
    """chat 工具环合成幂等键——中断重放不得重复 write-class 副作用。"""

    @pytest.fixture(autouse=True)
    def _plan_resume_db(self, tmp_path):
        from app.core.runtime.plan_resume import (
            clear_plan_resumes,
            configure_plan_resume_db,
        )
        from app.store.database import Database

        db = Database(db_path=str(tmp_path / "chat_idem.db"))
        configure_plan_resume_db(db)
        clear_plan_resumes()
        yield
        clear_plan_resumes()
        configure_plan_resume_db(None)

    @pytest.mark.asyncio
    async def test_write_class_replay_uses_cached_result(self):
        from app.core.agents.tool_dispatcher import ToolDispatcher

        kernel = MockKernel({"send_email": {"status": "success", "result": "sent-1"}})
        td = ToolDispatcher(kernel=kernel, conversation=MockConversation())
        tc = [{"id": "tc1", "function_name": "send_email", "arguments": '{"to": "a@b.c"}'}]
        await _collect(td, tc, correlation_id="corr-idem", execution_id="")
        assert len(kernel.calls) == 1

        # 中断重放：同 correlation、同工具、同参数（LLM 重新生成 tool_call_id）
        # —— 不得再次触发外部副作用，直接复用已记录的结果。
        td2 = ToolDispatcher(kernel=kernel, conversation=MockConversation())
        tc2 = [{"id": "tc9", "function_name": "send_email", "arguments": '{"to": "a@b.c"}'}]
        events = await _collect(td2, tc2, correlation_id="corr-idem", execution_id="")
        assert len(kernel.calls) == 1  # 未重复调用
        assert events[0]["type"] == "tool_result"
        assert events[0]["content"] == "sent-1"

    @pytest.mark.asyncio
    async def test_different_args_or_correlation_invoke_again(self):
        from app.core.agents.tool_dispatcher import ToolDispatcher

        kernel = MockKernel({"send_email": {"status": "success", "result": "sent"}})
        td = ToolDispatcher(kernel=kernel, conversation=MockConversation())
        await _collect(
            td,
            [{"id": "t1", "function_name": "send_email", "arguments": '{"to": "a@b.c"}'}],
            correlation_id="corr-a",
        )
        # 参数不同 → 新调用。
        await _collect(
            td,
            [{"id": "t2", "function_name": "send_email", "arguments": '{"to": "x@y.z"}'}],
            correlation_id="corr-a",
        )
        # correlation 不同（新的一轮）→ 新调用。
        await _collect(
            td,
            [{"id": "t3", "function_name": "send_email", "arguments": '{"to": "a@b.c"}'}],
            correlation_id="corr-b",
        )
        assert len(kernel.calls) == 3

    @pytest.mark.asyncio
    async def test_read_class_tools_never_cached(self):
        from app.core.agents.tool_dispatcher import ToolDispatcher

        kernel = MockKernel({"read_file": {"status": "success", "result": "v1"}})
        td = ToolDispatcher(kernel=kernel, conversation=MockConversation())
        tc = [{"id": "t1", "function_name": "read_file", "arguments": '{"path": "a"}'}]
        await _collect(td, tc, correlation_id="corr-read")
        await _collect(td, tc, correlation_id="corr-read")
        # 读类工具每次都真实执行（同轮「写后读」不得返回陈旧内容）。
        assert len(kernel.calls) == 2
