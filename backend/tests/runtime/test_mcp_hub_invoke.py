"""MCPHub invoke_tool observability and kwargs filtering."""

import json

import pytest

from app.core.harness.mcp_hub import MCPHub, ToolDef, ToolInvokeError


@pytest.mark.asyncio
async def test_invoke_tool_raises_on_failure(monkeypatch):
    from unittest.mock import MagicMock

    import app.core.harness.mcp_hub as hub_mod

    hub = MCPHub(enabled_categories=set())
    logged = MagicMock()
    monkeypatch.setattr(hub_mod.logger, "exception", logged)

    def boom() -> str:
        raise RuntimeError("kaboom")

    hub.register_tool(ToolDef(
        name="boom_tool",
        description="x",
        parameters={"type": "object", "properties": {}},
        handler=boom,
    ))
    with pytest.raises(ToolInvokeError) as ei:
        await hub.invoke_tool("boom_tool", {})
    assert ei.value.reason == "tool_execution_failure"
    assert "kaboom" in str(ei.value)
    logged.assert_called_once()
    assert logged.call_args.args[0] == "Tool %s failed"
    assert logged.call_args.args[1] == "boom_tool"


@pytest.mark.asyncio
async def test_invoke_tool_filters_unexpected_kwargs():
    hub = MCPHub(enabled_categories=set())
    seen: dict = {}

    def echo(path: str) -> str:
        seen["path"] = path
        return path

    hub.register_tool(ToolDef(
        name="echo_path",
        description="x",
        parameters={"type": "object", "properties": {"path": {"type": "string"}}},
        handler=echo,
    ))
    result = await hub.invoke_tool("echo_path", {"path": "/a", "noise": True})
    assert result == "/a"
    assert seen == {"path": "/a"}


@pytest.mark.asyncio
async def test_invoke_tool_keeps_oversized_json_parseable():
    """Inbox poll json.loads the hub result; clipping must not break JSON."""
    from app.core.harness.mcp_hub import TOOL_RESULT_CHAR_LIMIT

    hub = MCPHub(enabled_categories=set())
    payload = {
        "count": 20,
        "unread_only": False,
        "emails": [
            {
                "message_id": f"<msg-{i}.long-id@zhouyao-PF4MWDSJ.al.com>",
                "from": "Test Sender <sender@example.com>",
                "subject": f"这是一封比较长的中文主题 {i}",
                "date": "2026-08-17 15:00",
                "preview": "预览正文" * 40,
            }
            for i in range(20)
        ],
        "all_unread_emails": [
            {"message_id": f"<unseen-{i}@example.com>"}
            for i in range(50)
        ],
    }
    raw = json.dumps(payload, ensure_ascii=False)
    assert len(raw) > TOOL_RESULT_CHAR_LIMIT

    hub.register_tool(ToolDef(
        name="fat_json",
        description="x",
        parameters={"type": "object", "properties": {}},
        handler=lambda: raw,
    ))
    result = await hub.invoke_tool("fat_json", {})
    parsed = json.loads(result)
    assert parsed["count"] == 20
    assert len(parsed["emails"]) == 20
    assert parsed["emails"][0]["message_id"] == "<msg-0.long-id@zhouyao-PF4MWDSJ.al.com>"


def test_clip_replaces_json_over_hard_cap():
    from app.core.harness.mcp_hub import JSON_RESULT_CHAR_LIMIT, _clip_tool_result

    huge = json.dumps({"blob": "a" * (JSON_RESULT_CHAR_LIMIT + 10)})
    out = _clip_tool_result(huge)
    assert json.loads(out) == {"error": "result_too_large", "truncated": True}


@pytest.mark.asyncio
async def test_invoke_tool_still_clips_plain_text():
    from app.core.harness.mcp_hub import TOOL_RESULT_CHAR_LIMIT

    hub = MCPHub(enabled_categories=set())
    hub.register_tool(ToolDef(
        name="fat_text",
        description="x",
        parameters={"type": "object", "properties": {}},
        handler=lambda: "x" * (TOOL_RESULT_CHAR_LIMIT + 50),
    ))
    result = await hub.invoke_tool("fat_text", {})
    assert result.endswith("\n... [output truncated]")
    assert len(result) == TOOL_RESULT_CHAR_LIMIT + len("\n... [output truncated]")


@pytest.mark.asyncio
async def test_get_tool_defs_skips_forbidden():
    from app.core.runtime.capability_governance import capability_governance

    hub = MCPHub(enabled_categories=set())
    hub.register_tool(ToolDef(
        name="ok_tool",
        description="visible",
        parameters={"type": "object", "properties": {}},
        handler=lambda: "ok",
    ))
    hub.register_tool(ToolDef(
        name="deny_tool",
        description="hidden",
        parameters={"type": "object", "properties": {}},
        handler=lambda: "no",
    ))
    capability_governance.register_external_tool("deny_tool", risk="forbidden")
    try:
        names = {t["function"]["name"] for t in hub.get_tool_defs_for_llm()}
        assert "ok_tool" in names
        assert "deny_tool" not in names
    finally:
        capability_governance.clear_external_tools()
