"""Egress locality is re-checked on provider switch and fallback."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.core.agents.brain_llm_ops import complete_text_with_failover, create_stream


def _provider(name: str, base_url: str, provider_type: str = "ollama"):
    return SimpleNamespace(
        name=name,
        base_url=base_url,
        provider_type=provider_type,
        model="qwen",
        price_per_prompt_token=0.0,
        price_per_completion_token=0.0,
    )


class _Completions:
    def __init__(self):
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        message = SimpleNamespace(content="ok")
        choice = SimpleNamespace(message=message)
        return SimpleNamespace(choices=[choice])


class _Client:
    def __init__(self):
        self.chat = SimpleNamespace(completions=_Completions())

    @property
    def calls(self) -> list[dict]:
        return self.chat.completions.calls


def _silence_kernel(monkeypatch):
    kernel = MagicMock()
    kernel.list_capability_definitions.return_value = []
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.kernel_instance.kernel",
        kernel,
    )
    monkeypatch.setattr("app.core.agents.brain_telemetry.kernel", kernel)
    monkeypatch.setattr("app.core.agents.brain_llm_ops.kernel", kernel)
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.settings.allow_cloud_personal_data_egress",
        False,
    )
    return kernel


@pytest.mark.asyncio
async def test_fallback_skips_remote_ollama_and_uses_loopback(monkeypatch):
    _silence_kernel(monkeypatch)
    remote_client = _Client()
    local_client = _Client()
    remote = _provider("ollama-remote", "https://remote.example.invalid")
    local = _provider("ollama-local", "http://127.0.0.1:11434/v1")

    class _Router:
        def get_client(self, provider_name=None):
            del provider_name
            return remote_client, remote

        def get_fallback_clients(self):
            return [(local_client, local)]

    monkeypatch.setattr("app.core.agents.brain_llm_ops.llm_router", _Router())
    content, used = await complete_text_with_failover(
        [{"role": "user", "content": "周五的预算还没定"}],
        purpose="inbox_summary",
        actor="api",
        data_sources=["email"],
    )
    assert content == "ok"
    assert used == "ollama-local"
    assert remote_client.calls == []
    assert len(local_client.calls) == 1
    assert "data_sources" not in local_client.calls[0]["messages"][0]


@pytest.mark.asyncio
async def test_pinned_remote_ollama_does_not_fall_through(monkeypatch):
    _silence_kernel(monkeypatch)
    remote_client = _Client()
    remote = _provider("ollama-remote", "https://remote.example.invalid")

    class _Router:
        def get_client(self, provider_name=None):
            assert provider_name == "ollama-remote"
            return remote_client, remote

        def get_fallback_clients(self):
            raise AssertionError("a pinned provider must not fall back")

    monkeypatch.setattr("app.core.agents.brain_llm_ops.llm_router", _Router())
    with pytest.raises(RuntimeError, match="ollama-remote"):
        await complete_text_with_failover(
            [{"role": "user", "content": "笔记正文"}],
            purpose="project_brief",
            provider_name="ollama-remote",
            data_sources=["file"],
        )
    assert remote_client.calls == []


@pytest.mark.asyncio
async def test_model_switch_rechecks_the_new_target(monkeypatch):
    """The same payload is local on loopback and refused after switching URL."""
    _silence_kernel(monkeypatch)
    local_client = _Client()
    remote_client = _Client()
    local = _provider("ollama", "http://localhost:11434/v1")
    remote = _provider("ollama", "https://remote.example.invalid")
    selected = {"provider": local, "client": local_client}

    class _Router:
        def get_client(self, provider_name=None):
            del provider_name
            return selected["client"], selected["provider"]

        def get_fallback_clients(self):
            return []

    monkeypatch.setattr("app.core.agents.brain_llm_ops.llm_router", _Router())
    messages = [{"role": "user", "content": "普通邮件正文", "data_sources": ["email"]}]
    content, used = await complete_text_with_failover(messages, purpose="inbox_classify")
    assert content == "ok"
    assert used == "ollama"
    assert len(local_client.calls) == 1

    selected["provider"] = remote
    selected["client"] = remote_client
    with pytest.raises(RuntimeError, match="ollama"):
        await complete_text_with_failover(messages, purpose="inbox_classify")
    assert remote_client.calls == []


@pytest.mark.asyncio
async def test_create_stream_audits_each_candidate(monkeypatch):
    _silence_kernel(monkeypatch)
    remote_client = _Client()
    local_client = _Client()
    remote = _provider("ollama-remote", "https://remote.example.invalid")
    local = _provider("ollama-local", "http://[::1]:11434/v1")
    llm = SimpleNamespace(client=remote_client, provider=remote)

    class _Router:
        def get_fallback_clients(self):
            return [(local_client, local)]

    monkeypatch.setattr("app.core.agents.brain_llm_ops.llm_router", _Router())
    messages = [{
        "role": "tool",
        "tool_call_id": "tc",
        "content": "本地文件正文",
        "data_sources": ["file"],
    }]
    _response, client, provider = await create_stream(llm, messages)
    assert client is local_client
    assert provider.name == "ollama-local"
    assert remote_client.calls == []
    sent = local_client.calls[0]["messages"][0]
    assert sent["content"] == "本地文件正文"
    assert "data_sources" not in sent


def test_history_replay_labels_email_and_file_tools():
    from unittest.mock import MagicMock

    from app.core.agents.brain_history_builder import build_messages

    conv = MagicMock()
    conv.load_recorded_messages.return_value = []
    conv.get_history.return_value = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"id": "c1", "function": {"name": "check_inbox", "arguments": "{}"}},
                {"id": "c2", "function": {"name": "read_file", "arguments": "{}"}},
                {"id": "c3", "function": {"name": "web_search", "arguments": "{}"}},
            ],
            "tool_call_id": None,
        },
        {"role": "tool", "content": "主题列表", "tool_calls": None, "tool_call_id": "c1"},
        {"role": "tool", "content": "文件正文", "tool_calls": None, "tool_call_id": "c2"},
        {"role": "tool", "content": "网页", "tool_calls": None, "tool_call_id": "c3"},
    ]
    messages = build_messages(conv, "继续", system_prompt="sys")
    tools = [msg for msg in messages if msg["role"] == "tool"]
    assert tools[0]["data_sources"] == ["email"]
    assert tools[0]["content"] == "主题列表"
    assert tools[1]["data_sources"] == ["file"]
    assert "data_sources" not in tools[2]


def test_approved_tool_checkpoint_keeps_email_label(monkeypatch):
    from app.core.agents.brain_chat_stream import append_approved_tool_to_checkpoint

    saved: dict = {}

    monkeypatch.setattr(
        "app.core.agents.brain_chat_stream.load_chat_checkpoint",
        lambda *_a, **_k: {"messages": [], "pending_tool_call_ids": ["tc"]},
    )

    def _record(_cid, ckpt, kernel=None):
        del kernel
        saved["ckpt"] = ckpt

    monkeypatch.setattr(
        "app.core.agents.brain_chat_stream.record_chat_checkpoint",
        _record,
    )
    updated = append_approved_tool_to_checkpoint(
        "corr",
        tool_call_id="tc",
        tool_name="read_inbox_email",
        result_str="邮件正文没有特殊标记",
    )
    assert updated is not None
    message = updated["messages"][0]
    assert message["content"] == "邮件正文没有特殊标记"
    assert message["data_sources"] == ["email"]
    assert saved["ckpt"]["messages"][0]["data_sources"] == ["email"]
