"""Brain LLM Client — standalone LLM calling layer.

Decoupled from Brain via explicit injection: the client and provider come
from ``llm_router.get_client()``, and the ``build_messages_fn`` callback
builds the messages array.

Heavy call logic lives in ``brain_llm_ops`` (not counted toward God Object LOC).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from app.core.agents.conversation import ConversationManager

# Signature of the message-building helper originally on Brain.
BuildMessagesFn = Callable[..., list[dict]]


class BrainLLMClient:
    """Stateless LLM caller: streaming, retry, one-shot, synthesis.

    ``client`` and ``provider`` are injected so multiple Brain instances
    (or tests) can use different providers without sharing mutable state.

    Collaborators (``brain_llm_ops`` / ``brain_chat_stream``) access the
    injected dependencies through the public ``client`` / ``provider``
    properties and the ``build_messages`` helper — never through private
    fields. This keeps the internal representation swappable (e.g. renaming
    ``_client``) without breaking callers.
    """

    MAX_CONTINUE_DEPTH = 3

    def __init__(
        self,
        *,
        client: Any,
        provider: Any,
        build_messages_fn: BuildMessagesFn,
    ):
        self._client = client
        self._provider = provider
        self._build_messages_fn = build_messages_fn

    @property
    def client(self) -> Any:
        """The currently bound OpenAI-compatible client."""
        return self._client

    @property
    def provider(self) -> Any:
        """Expose provider for failover detection in Brain.chat_stream."""
        return self._provider

    def build_messages(
        self,
        conversation: "ConversationManager",
        user_message: str = "",
        *,
        system_prompt: str,
    ) -> list[dict]:
        """Build the LLM messages array via the injected builder callback."""
        return self._build_messages_fn(
            conversation, user_message=user_message, system_prompt=system_prompt,
        )

    def replace_provider(self, client: Any, provider: Any) -> None:
        """Swap client+provider after LLM failover (Brain hot path)."""
        self._client = client
        self._provider = provider

    async def continue_after_tool_result(
        self, conversation: "ConversationManager", *, depth: int = 0,
    ) -> str:
        """One-shot LLM completion after approval resolution closes the tool loop."""
        from app.core.agents import brain_llm_ops

        return await brain_llm_ops.continue_after_tool_result(
            self, conversation, depth=depth,
        )

    async def create_stream(self, messages: list[dict]):
        """Try primary LLM provider (with retries), then fallbacks."""
        from app.core.agents import brain_llm_ops

        return await brain_llm_ops.create_stream(self, messages)

    async def synthesize_from_tool_results(self, messages: list[dict]) -> str:
        """Final text-only pass when the tool loop hits its iteration cap."""
        from app.core.agents import brain_llm_ops

        return await brain_llm_ops.synthesize_from_tool_results(self, messages)

    async def complete_text_only(self, messages: list[dict], user_message: str) -> str:
        """Retry once without tools when the model returns an empty completion."""
        from app.core.agents import brain_llm_ops

        return await brain_llm_ops.complete_text_only(self, messages, user_message)
