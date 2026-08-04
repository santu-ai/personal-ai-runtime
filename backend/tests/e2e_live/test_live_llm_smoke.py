"""Live LLM smoke — proves the configured provider answers a one-shot prompt.

Default CI / ``make test-backend`` excludes these via ``-m "not live_llm"``.
Enable explicitly:

    RUN_LIVE_LLM=1 make test-live

Requires a real ``LLM_API_KEY`` (and optional ``LLM_BASE_URL`` / ``LLM_MODEL``)
in the environment or ``.env``. Uses the OpenAI-compatible chat completions API.
"""

from __future__ import annotations

import os

import pytest

pytestmark = [
    pytest.mark.live_llm,
    pytest.mark.skipif(
        os.environ.get("RUN_LIVE_LLM", "").strip() not in {"1", "true", "yes"},
        reason="Set RUN_LIVE_LLM=1 to enable live LLM smoke tests",
    ),
]


@pytest.mark.asyncio
async def test_live_llm_one_shot_completion():
    """Provider must return a non-empty assistant message for a trivial prompt."""
    from openai import AsyncOpenAI

    from app.config import settings

    api_key = (settings.llm_api_key or os.environ.get("LLM_API_KEY", "")).strip()
    if not api_key or api_key in {"test-key", "demo-seed"}:
        pytest.skip("LLM_API_KEY is missing or is a placeholder test key")

    base_url = (settings.llm_base_url or "").strip() or None
    model = (settings.llm_model or "deepseek-chat").strip()
    timeout = max(int(settings.llm_timeout_seconds or 60), 30)

    client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Reply with exactly one short word."},
                {"role": "user", "content": "Say ping"},
            ],
            max_tokens=16,
            temperature=0,
        )
    finally:
        await client.close()

    assert resp.choices, "LLM returned no choices"
    content = (resp.choices[0].message.content or "").strip()
    assert content, "LLM returned empty content"
