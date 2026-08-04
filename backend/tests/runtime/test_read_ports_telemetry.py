"""read_ports.telemetry — query/aggregate parameter forwarding and tool-name dedup."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.runtime.read_ports import telemetry as telemetry_port


class FakeKernel:
    def __init__(self):
        self.query_calls: list[tuple] = []
        self.aggregate_calls: list[tuple] = []
        self.read_calls: list[dict] = []
        self._events: list = []

    def query_state(self, selector: str, **filters):
        self.query_calls.append((selector, filters))
        return [{"selector": selector, **filters}]

    def aggregate_state(self, selector: str, **filters):
        self.aggregate_calls.append((selector, filters))
        return {"selector": selector, **filters}

    def read_events(self, **filters):
        self.read_calls.append(filters)
        return list(self._events)


@pytest.fixture
def fake_kernel(monkeypatch):
    k = FakeKernel()
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)
    return k


def test_query_llm_calls_forwards_filters(fake_kernel):
    rows = telemetry_port.query_llm_calls(days=3, limit=10, offset=5)
    assert fake_kernel.query_calls == [
        ("llm_calls", {"limit": 10, "offset": 5, "since_days": 3}),
    ]
    assert rows[0]["since_days"] == 3


def test_query_llm_calls_omits_since_days_when_none(fake_kernel):
    telemetry_port.query_llm_calls(limit=20)
    assert fake_kernel.query_calls[0][1] == {"limit": 20, "offset": 0}


def test_query_tool_calls_forwards_tool_name(fake_kernel):
    telemetry_port.query_tool_calls(days=7, tool_name="read_file", limit=100)
    assert fake_kernel.query_calls == [
        ("tool_calls", {"limit": 100, "since_days": 7, "tool_name": "read_file"}),
    ]


def test_summarize_llm_calls_forwards(fake_kernel):
    result = telemetry_port.summarize_llm_calls(days=14)
    assert fake_kernel.aggregate_calls == [("llm_calls_summary", {"since_days": 14})]
    assert result["selector"] == "llm_calls_summary"


def test_summarize_llm_calls_by_model_forwards(fake_kernel):
    telemetry_port.summarize_llm_calls_by_model(days=2)
    assert fake_kernel.aggregate_calls[0][0] == "llm_calls_by_model"
    assert fake_kernel.aggregate_calls[0][1] == {"since_days": 2}


def test_summarize_tool_calls_forwards(fake_kernel):
    telemetry_port.summarize_tool_calls(days=5)
    assert fake_kernel.aggregate_calls[0] == ("tool_calls_summary", {"since_days": 5})


def test_summarize_call_failure_rates_forwards(fake_kernel):
    telemetry_port.summarize_call_failure_rates(days=1)
    assert fake_kernel.aggregate_calls[0] == ("call_failure_rates", {"since_days": 1})


def test_query_recent_tool_names_dedups_and_limits(fake_kernel):
    fake_kernel._events = [
        SimpleNamespace(payload={"name": "read_file"}),
        SimpleNamespace(payload={"name": "read_file"}),  # dup
        SimpleNamespace(payload={"name": ""}),  # empty skipped
        SimpleNamespace(payload={"name": "write_file"}),
        SimpleNamespace(payload={"name": "shell_exec"}),
        SimpleNamespace(payload={"name": "web_search"}),
    ]
    names = telemetry_port.query_recent_tool_names(limit=3)
    assert names == ["read_file", "write_file", "shell_exec"]
    assert fake_kernel.read_calls[0]["type"] == "CapabilityInvoked"
    assert fake_kernel.read_calls[0]["order"] == "desc"
    # Wider window so dedup still fills limit.
    assert fake_kernel.read_calls[0]["limit"] == max(3 * 5, 3)


def test_query_recent_tool_names_empty(fake_kernel):
    fake_kernel._events = []
    assert telemetry_port.query_recent_tool_names(limit=5) == []
