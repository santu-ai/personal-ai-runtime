"""LLM router fallback clients."""

from app.core.agents.llm_failover import (
    LLMProvider,
    LLMRouter,
    choose_local_model,
    describe_local_models,
    iter_recommended_pull,
    pull_status_line,
)


def _router(*providers: LLMProvider) -> LLMRouter:
    router = LLMRouter.__new__(LLMRouter)
    router.providers = list(providers)
    router._clients = {}
    return router


def _cloud() -> LLMProvider:
    return LLMProvider(
        name="deepseek",
        api_key="k",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        provider_type="openai_compatible",
        is_default=True,
    )


def _ollama(model: str = "qwen2.5:7b", *, default: bool = False) -> LLMProvider:
    return LLMProvider(
        name="ollama",
        api_key="ollama",
        base_url="http://127.0.0.1:11434/v1",
        model=model,
        provider_type="ollama",
        is_default=default,
    )


def test_fallback_clients_excludes_default():
    from app.core.agents.llm_failover import llm_router

    fallbacks = llm_router.get_fallback_clients()
    for _, provider in fallbacks:
        assert not provider.is_default


def test_choose_local_model_uses_only_installed_names():
    assert choose_local_model(["qwen2.5:7b", "qwen2.5:3b"], "qwen2.5:7b") == "qwen2.5:3b"
    assert choose_local_model(["qwen2.5:7b"], "qwen2.5:7b") == "qwen2.5:7b"
    assert choose_local_model(["llama3.2:3b"], "qwen2.5:7b", explicit=True) == "llama3.2:3b"
    assert choose_local_model(["qwen2.5:3b"], "llama3.2:3b", explicit=True) == "qwen2.5:3b"
    assert choose_local_model([], "qwen2.5:7b") is None


def test_missing_stock_model_is_replaced_by_an_installed_one(monkeypatch):
    monkeypatch.setattr(
        "app.core.agents.llm_failover.fetch_installed_model_names",
        lambda base_url, timeout=1.5: ["qwen2.5:3b"],
    )
    fallbacks = _router(_cloud(), _ollama()).get_fallback_clients()
    assert len(fallbacks) == 1
    assert fallbacks[0][1].model == "qwen2.5:3b"


def test_the_same_installed_model_is_not_a_second_call(monkeypatch):
    monkeypatch.setattr(
        "app.core.agents.llm_failover.fetch_installed_model_names",
        lambda base_url, timeout=1.5: ["qwen2.5:3b"],
    )
    primary = LLMProvider(
        name="deepseek",
        api_key="ollama",
        base_url="http://127.0.0.1:11434/v1",
        model="qwen2.5:7b",
        provider_type="openai_compatible",
        is_default=True,
    )
    candidates = _router(primary, _ollama()).callable_candidates()
    assert len(candidates) == 1
    assert candidates[0][1].model == "qwen2.5:3b"


def test_unreachable_stock_model_is_not_called(monkeypatch):
    monkeypatch.setattr(
        "app.core.agents.llm_failover.fetch_installed_model_names",
        lambda base_url, timeout=1.5: None,
    )
    assert _router(_ollama(default=True)).callable_candidates() == []


def test_explicit_model_is_kept_when_tags_are_down(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "qwen2.5:3b")
    monkeypatch.setattr(
        "app.core.agents.llm_failover.fetch_installed_model_names",
        lambda base_url, timeout=1.5: None,
    )
    candidates = _router(_ollama("qwen2.5:3b", default=True)).callable_candidates()
    assert len(candidates) == 1
    assert candidates[0][1].model == "qwen2.5:3b"


def test_empty_install_explains_the_recommended_pull():
    described = describe_local_models("http://127.0.0.1:11434/v1", [])
    assert described["reachable"] is True
    assert described["selected"] is None
    assert "qwen2.5:3b" in described["message"]
    assert "还没有模型" in described["message"]


def test_daemon_down_does_not_invent_a_model():
    described = describe_local_models("http://127.0.0.1:11434/v1", None)
    assert described["reachable"] is False
    assert described["selected"] is None
    assert "还没连上 Ollama" in described["message"]


def test_pull_progress_is_a_percent():
    assert pull_status_line({"completed": 25, "total": 100}, "qwen2.5:3b") == "正在下载 qwen2.5:3b（25%）"
    assert pull_status_line({"status": "success"}, "qwen2.5:3b") == "已安装 qwen2.5:3b"


def test_pull_says_when_ollama_is_down(monkeypatch):
    def boom(*_args, **_kwargs):
        raise OSError("down")

    monkeypatch.setattr("app.core.agents.llm_failover.urllib.request.urlopen", boom)
    text = b"".join(iter_recommended_pull("http://127.0.0.1:11434/v1", "qwen2.5:3b")).decode()
    assert "连不上 Ollama" in text


def test_missing_local_model_message_reaches_the_brief():
    from app.core.agents.llm_failover import LOCAL_MODEL_MISSING_MESSAGE
    from app.product.project_brief import brief_compile_failure

    message = brief_compile_failure(RuntimeError(LOCAL_MODEL_MISSING_MESSAGE), retryable=True)
    assert message == LOCAL_MODEL_MISSING_MESSAGE
    assert "qwen2.5:3b" in message
