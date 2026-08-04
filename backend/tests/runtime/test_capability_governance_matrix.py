"""CapabilityGovernance decide() matrix — forbidden / auto_allow / needs_user."""

from __future__ import annotations

from unittest.mock import patch

import pytest


@pytest.fixture
def kernel(isolated_kernel):
    k, _db = isolated_kernel
    return k


@pytest.fixture(autouse=True)
def _reset_governance():
    from app.core.runtime.capability_governance import capability_governance

    capability_governance.reset()
    yield
    capability_governance.reset()


def test_decide_matrix_forbidden_denies(kernel):
    from app.core.runtime.capability_governance import capability_governance
    from app.core.runtime.execution import Principal

    kernel.emit_event(
        "PolicyCreated",
        "policy",
        "policy_forbidden_shell_exec",
        payload={"capability": "shell_exec", "risk_level": "forbidden"},
        actor="test",
    )
    decision = capability_governance.decide(
        Principal.user(), "shell_exec", {"cmd": "echo"}, kernel,
    )
    assert decision.decision == "deny"
    assert decision.reason == "forbidden_by_policy"


def test_decide_matrix_auto_allow_allows_low_risk(kernel):
    from app.core.runtime.capability_governance import capability_governance
    from app.core.runtime.execution import Principal

    with patch(
        "app.core.harness.mcp_hub.mcp_hub.needs_confirmation",
        return_value=False,
    ):
        decision = capability_governance.decide(
            Principal.user(), "get_current_time", {}, kernel,
        )
    assert decision.decision == "allow"
    assert decision.reason in {"approved", "pre_approved"}


def test_decide_matrix_high_risk_defers_for_user(kernel):
    from app.core.runtime.capability_governance import capability_governance
    from app.core.runtime.execution import Principal

    kernel.emit_event(
        "PolicyCreated",
        "policy",
        "policy_high_write_file",
        payload={"capability": "write_file", "risk_level": "high"},
        actor="test",
    )
    with patch(
        "app.core.harness.mcp_hub.mcp_hub.needs_confirmation",
        return_value=True,
    ):
        decision = capability_governance.decide(
            Principal.user(),
            "write_file",
            {"path": "x.txt", "content": "hi"},
            kernel,
        )
    assert decision.decision == "defer"
    assert decision.approval_id


def test_decide_matrix_high_risk_system_auto_denies(kernel):
    from app.core.runtime.capability_governance import capability_governance
    from app.core.runtime.execution import Principal

    kernel.emit_event(
        "PolicyCreated",
        "policy",
        "policy_high_write_file_sys",
        payload={"capability": "write_file", "risk_level": "high"},
        actor="test",
    )
    with patch(
        "app.core.harness.mcp_hub.mcp_hub.needs_confirmation",
        return_value=True,
    ):
        decision = capability_governance.decide(
            Principal.system(),
            "write_file",
            {"path": "x.txt", "content": "hi"},
            kernel,
        )
    assert decision.decision == "deny"
    assert "auto_denied" in decision.reason


def test_external_tool_risk_registration_roundtrip():
    from app.core.runtime.capability_governance import capability_governance

    capability_governance.register_external_tool("ext.foo", risk="forbidden")
    assert capability_governance.is_forbidden("ext.foo")
    capability_governance.register_external_tool("ext.bar", risk="high")
    assert capability_governance.risk_for("ext.bar") == "high"
    capability_governance.register_external_tool("ext.baz", risk="low")
    assert capability_governance.risk_for("ext.baz") == "low"
    capability_governance.clear_external_tools(persist=False)
    assert not capability_governance.is_forbidden("ext.foo")
    assert capability_governance.risk_for("ext.bar") != "high" or "ext.bar" not in (
        capability_governance.all_registered_tools()
    )
