"""Tests for submit_command timeout configuration."""

def test_default_timeout_values():
    """Default per-call-site timeouts are sensible."""
    from app.config import Settings

    s = Settings()
    assert s.submit_command_timeout_approval == 60.0
    assert s.submit_command_timeout_background_task == 300.0
    assert s.submit_command_timeout_inbox == 300.0


def test_timeout_values_overridable_via_env(monkeypatch):
    """Env vars override the per-call-site defaults."""
    monkeypatch.setenv("SUBMIT_COMMAND_TIMEOUT_APPROVAL", "15")
    monkeypatch.setenv("SUBMIT_COMMAND_TIMEOUT_BACKGROUND_TASK", "600")

    from app.config import Settings

    s = Settings()
    assert s.submit_command_timeout_approval == 15.0
    assert s.submit_command_timeout_background_task == 600.0
    # Unset ones keep defaults
    assert s.submit_command_timeout_inbox == 300.0


def test_chat_endpoint_uses_configured_timeout():
    """Approval submit helper sources timeout from settings (shared by chat)."""
    import inspect

    from app.api import approve_submit

    src = inspect.getsource(approve_submit)
    assert "submit_command_timeout_approval" in src, \
        "approve_submit.py must source approval timeout from settings, not hardcode"


def test_approvals_endpoint_uses_configured_timeout():
    """Shared approve helper is the single timeout binding for approvals/chat."""
    import inspect

    from app.api import approve_submit, approvals, chat

    helper_src = inspect.getsource(approve_submit)
    assert "submit_command_timeout_approval" in helper_src
    assert "submit_approve_requested" in inspect.getsource(approvals)
    assert "submit_approve_requested" in inspect.getsource(chat)


def test_runtime_loop_uses_configured_timeout():
    """runtime_loop background-task path uses config."""
    import inspect

    from app.core.runtime import runtime_loop

    src = inspect.getsource(runtime_loop)
    assert "submit_command_timeout_background_task" in src


def test_inbox_uses_configured_timeout():
    """inbox.py inbox poll path uses config."""
    import inspect

    from app.product import inbox

    src = inspect.getsource(inbox)
    assert "submit_command_timeout_inbox" in src
