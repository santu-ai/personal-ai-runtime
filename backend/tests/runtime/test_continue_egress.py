"""continue_after_tool_result must not send denied personal context."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.agents.brain_llm_ops import continue_after_tool_result
from app.core.runtime.egress.egress_gate import EgressDeniedError


def _completion(text: str) -> MagicMock:
    response = MagicMock()
    response.choices = [MagicMock(message=MagicMock(content=text))]
    return response


def _llm(*, provider_type: str, base_url: str, create: AsyncMock) -> SimpleNamespace:
    client = MagicMock()
    client.chat.completions.create = create

    def build_messages(conversation, user_message="", *, system_prompt):
        del conversation, user_message
        return [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": "memory_id: private-note\npassword=placeholder-not-a-secret",
            },
        ]

    return SimpleNamespace(
        MAX_CONTINUE_DEPTH=3,
        client=client,
        provider=SimpleNamespace(
            name="under-test",
            provider_type=provider_type,
            base_url=base_url,
            model="test-model",
        ),
        build_messages=build_messages,
    )


class _Conversation:
    conversation_id = "conv_continue_egress"
    saved: list[str]

    def __init__(self) -> None:
        self.saved = []

    def get_history(self) -> list[dict[str, str]]:
        return [{"role": "user", "content": "继续"}]

    def save_assistant_message(self, content: str, tool_calls=None) -> dict[str, str]:
        del tool_calls
        self.saved.append(content)
        return {"content": content}


@pytest.fixture
def _quiet_egress(monkeypatch):
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.kernel_instance.kernel",
        MagicMock(),
    )
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.settings.allow_cloud_personal_data_egress",
        False,
    )
    monkeypatch.setattr(
        "app.chat.prompt_compiler.prompt_compiler.compile",
        AsyncMock(return_value="compiled-prompt"),
    )


@pytest.mark.asyncio
async def test_continue_denies_personal_context_before_calling_remote(_quiet_egress):
    create = AsyncMock(return_value=_completion("不应发出"))
    llm = _llm(
        provider_type="openai_compatible",
        base_url="https://api.openai.com/v1",
        create=create,
    )
    conversation = _Conversation()

    with pytest.raises(EgressDeniedError):
        await continue_after_tool_result(llm, conversation)

    create.assert_not_awaited()
    assert conversation.saved == []


@pytest.mark.asyncio
async def test_continue_retry_stays_on_the_audited_client(_quiet_egress):
    create = AsyncMock(side_effect=[_completion(""), _completion("已继续")])
    llm = _llm(
        provider_type="openai_compatible",
        base_url="http://127.0.0.1:11434/v1",
        create=create,
    )
    conversation = _Conversation()

    result = await continue_after_tool_result(llm, conversation)

    assert result == "已继续"
    assert conversation.saved == ["已继续"]
    assert create.await_count == 2
    first_messages = create.await_args_list[0].kwargs["messages"]
    second_messages = create.await_args_list[1].kwargs["messages"]
    assert "placeholder-not-a-secret" not in str(first_messages)
    assert "[REDACTED]" in str(first_messages)
    assert second_messages[-1]["content"] == "请只用文字回复，不要调用任何工具。"
    assert "placeholder-not-a-secret" not in str(second_messages)
    assert llm.provider.base_url == "http://127.0.0.1:11434/v1"
