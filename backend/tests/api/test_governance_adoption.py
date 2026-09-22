"""Governance summary adoption counts follow user decisions, not command status."""

from fastapi.testclient import TestClient


def test_governance_adoption_ignores_approve_completed_status(client: TestClient):
    from app.core.runtime.kernel_instance import kernel

    kernel.emit_event(
        type="ApprovalGranted",
        aggregate_type="approval",
        aggregate_id="apr_user",
        payload={"action": "write_file", "reason": "pre_approved"},
        actor="user",
    )
    kernel.emit_event(
        type="ApprovalGranted",
        aggregate_type="approval",
        aggregate_id="apr_auto",
        payload={"action": "read_file", "reason": "auto_allow"},
        actor="kernel",
    )
    kernel.emit_event(
        type="ApprovalDenied",
        aggregate_type="approval",
        aggregate_id="apr_no",
        payload={"action": "send_email", "reason": "user_denied"},
        actor="user",
    )
    kernel.emit_event(
        type="ApprovalDenied",
        aggregate_type="approval",
        aggregate_id="apr_exp",
        payload={"action": "shell_exec", "reason": "auto_expired"},
        actor="kernel",
    )
    kernel.emit_event(
        type="ClaimRatified",
        aggregate_type="memory",
        aggregate_id="mem_yes",
        payload={"by": "user"},
        actor="user",
    )
    kernel.emit_event(
        type="ClaimRejected",
        aggregate_type="memory",
        aggregate_id="mem_no",
        payload={"reason": "incorrect"},
        actor="user",
    )
    # Command completion has status, not decision. It must not inflate counts.
    kernel.emit_event(
        type="ApproveCompleted",
        aggregate_type="approval",
        aggregate_id="approve_apr_user",
        payload={"status": "success"},
        actor="system",
    )

    body = client.get("/api/telemetry/governance?days=7").json()

    assert body["approvals_approved"] == 1
    assert body["approvals_rejected"] == 1
    assert body["approvals_expired"] == 1
    adoption = body["adoption"]
    assert adoption["suggestions"]["auto_allowed"] == 1
    assert adoption["suggestions"]["adoption_rate"] == 0.5
    assert adoption["memories"]["ratified"] == 1
    assert adoption["memories"]["rejected"] == 1
    assert adoption["adopted"] == 2
    assert adoption["rejected"] == 2
    assert adoption["adoption_rate"] == 0.5
