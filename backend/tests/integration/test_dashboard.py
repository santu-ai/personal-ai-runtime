"""Personal Dashboard integration tests — widget shape beyond api smoke.

Product data access is via Kernel ABI / read_ports (query_state / read_events /
claim-filtered recall); boundary enforcement is covered by ``scripts.check_boundary``,
not re-asserted here.
"""

from fastapi.testclient import TestClient


def test_dashboard_widget_shapes(client: TestClient):
    r = client.get("/api/dashboard")
    assert r.status_code == 200
    data = r.json()

    assert "generated_at" in data

    goals = data["active_goals"]
    assert isinstance(goals["count"], int)
    assert isinstance(goals["top"], list)

    events = data["recent_events"]
    assert isinstance(events["count"], int)
    assert "total_in_window" in events
    assert isinstance(events["items"], list)

    memories = data["recent_memories"]
    assert isinstance(memories["count"], int)
    assert isinstance(memories["items"], list)

    timer = data["timer_status"]
    assert isinstance(timer["active_timers"], int)
    assert isinstance(timer["items"], list)

    gov = data["governance_status"]
    assert isinstance(gov["active_policies"], int)

    trust = data["execution_trust"]
    assert isinstance(trust["by_status"], dict)
    assert isinstance(trust["pending_approvals"], int)
    assert isinstance(trust["failed"], list)
    assert isinstance(trust["retrying"], list)
    assert isinstance(trust["dead_letter"], list)
    assert isinstance(trust["dead_letter_count"], int)
