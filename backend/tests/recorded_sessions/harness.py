"""Replay a recorded Brain turn: scripted model, real Kernel + tools.

Fixtures live beside this module as ``*.json``. The LLM is the only mock;
capability dispatch, MessageAppended projection, and the filesystem are real.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

from app.core.agents.brain import Brain
from app.core.agents.brain_stream_assemble import AssembledStream
from app.core.agents.conversation import ConversationManager
from app.core.runtime.capability_governance import capability_governance
from app.core.runtime.plan_resume import configure_plan_resume_db

FIXTURES_DIR = Path(__file__).resolve().parent


def interpolate(value: Any, workspace: Path) -> Any:
    """Replace ``{workspace}`` in strings nested in dict/list payloads."""
    token = "{workspace}"
    root = str(workspace)
    if isinstance(value, str):
        return value.replace(token, root)
    if isinstance(value, list):
        return [interpolate(item, workspace) for item in value]
    if isinstance(value, dict):
        return {key: interpolate(item, workspace) for key, item in value.items()}
    return value


def load_fixture(path: Path, workspace: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return interpolate(raw, workspace)


def _scripted_stream(steps: list[dict[str, Any]]):
    calls = {"n": 0}

    async def fake_iter(_response):
        i = calls["n"]
        calls["n"] += 1
        if i >= len(steps):
            raise AssertionError(
                f"scripted model exhausted after {len(steps)} step(s)"
            )
        step = steps[i]
        text = str(step.get("text") or "")
        tool_calls = []
        for j, call in enumerate(step.get("tool_calls") or []):
            args = call.get("arguments") or {}
            tool_calls.append({
                "id": str(call.get("id") or f"call_{i}_{j}"),
                "function_name": call["name"],
                "arguments": json.dumps(args),
            })
        if text:
            yield {"type": "text_delta", "content": text}
        yield {
            "type": "_stream_assembled",
            "result": AssembledStream(visible_text=text, tool_calls=tool_calls),
        }

    return fake_iter


@dataclass
class ReplayResult:
    events: list[dict[str, Any]]
    conv_id: str
    correlation_id: str
    workspace: Path
    text: str = ""
    confirmation: dict[str, Any] | None = None
    extras: dict[str, Any] = field(default_factory=dict)


async def replay_fixture(
    fixture: dict[str, Any],
    *,
    kernel,
    db,
    workspace: Path,
    monkeypatch,
) -> ReplayResult:
    """Run one fixture through ``Brain.chat_stream`` with a scripted model."""
    configure_plan_resume_db(db)
    capability_governance.seed_from_json(kernel)
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    monkeypatch.setattr("app.core.agents.brain_chat_stream.kernel", kernel)
    monkeypatch.setattr(
        "app.core.agents.brain_chat_stream.record_llm_call",
        lambda *a, **k: 0,
    )
    monkeypatch.setattr(
        "app.core.agents.brain_chat_stream.iter_assembled_stream",
        _scripted_stream(list(fixture.get("model_steps") or [])),
    )

    for rel, content in (fixture.get("workspace_files") or {}).items():
        dest = workspace / str(rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(str(content), encoding="utf-8")

    conv_id = str(fixture.get("conversation_id") or f"rs-{fixture['id']}")
    correlation_id = str(fixture.get("correlation_id") or f"rs-{fixture['id']}")
    kernel.emit_event(
        "ConversationCreated",
        "conversation",
        conv_id,
        payload={"title": fixture["id"]},
        actor="user",
    )
    conv = ConversationManager(conversation_id=conv_id, kernel=kernel)

    brain = Brain()
    provider = brain.llm.provider
    brain.llm.create_stream = AsyncMock(  # type: ignore[method-assign]
        return_value=("resp", None, provider),
    )
    brain.llm.complete_text_only = AsyncMock(return_value="")  # type: ignore[method-assign]
    brain.llm.synthesize_from_tool_results = AsyncMock(return_value="")  # type: ignore[method-assign]

    events: list[dict[str, Any]] = []
    text_parts: list[str] = []
    confirmation: dict[str, Any] | None = None
    async for evt in brain.chat_stream(
        conv,
        str(fixture["user_message"]),
        system_prompt=str(fixture.get("system_prompt") or "You are a test assistant."),
        correlation_id=correlation_id,
    ):
        events.append(evt)
        if evt.get("type") == "text_delta" and evt.get("content"):
            text_parts.append(str(evt["content"]))
        elif evt.get("type") == "confirmation_required":
            confirmation = evt

    return ReplayResult(
        events=events,
        conv_id=conv_id,
        correlation_id=correlation_id,
        workspace=workspace,
        text="".join(text_parts),
        confirmation=confirmation,
    )
