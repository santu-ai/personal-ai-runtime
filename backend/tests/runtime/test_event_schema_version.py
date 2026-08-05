"""Event payload schema_version stamping + CI contract."""

from __future__ import annotations

import json

import pytest

from app.core.runtime.kernel import constants as schema_constants
from app.core.runtime.kernel.constants import (
    EVENT_SCHEMA_VERSION_DEFAULT,
    EVENT_WORK_ITEM_CREATED,
    PAYLOAD_SCHEMA_VERSION_KEY,
    declared_event_types,
    event_schema_version,
    stamp_event_payload,
    upcast_event_payload,
)
from app.core.runtime.kernel.kernel import Kernel
from app.store.database import Database
from scripts import check_event_schema as check_event_schema_mod


def test_declared_event_types_match_constants_count():
    types = declared_event_types()
    assert len(types) == 50
    assert EVENT_WORK_ITEM_CREATED in types
    assert "ClaimRatified" in types
    assert "MemoryDecayed" in types
    assert "schema_version" not in types


def test_work_item_schema_versions_explicitly_registered():
    """WorkItem* events must stay in EVENT_SCHEMA_VERSION_OVERRIDES (mechanism live)."""
    from app.core.runtime.kernel.constants import (
        EVENT_SCHEMA_VERSION_OVERRIDES,
        EVENT_WORK_ITEM_STATUS_CHANGED,
        EVENT_WORK_ITEM_UPDATED,
    )

    assert EVENT_WORK_ITEM_CREATED in EVENT_SCHEMA_VERSION_OVERRIDES
    assert EVENT_WORK_ITEM_UPDATED in EVENT_SCHEMA_VERSION_OVERRIDES
    assert EVENT_WORK_ITEM_STATUS_CHANGED in EVENT_SCHEMA_VERSION_OVERRIDES
    assert event_schema_version(EVENT_WORK_ITEM_CREATED) >= 1


def test_declared_event_types_match_ci_parser():
    """Runtime globals scan and CI regex must stay in lockstep."""
    assert declared_event_types() == frozenset(
        check_event_schema_mod.parse_declared_event_types()
    )


def test_stamp_event_payload_sets_version():
    stamped = stamp_event_payload(EVENT_WORK_ITEM_CREATED, {"title": "x"})
    assert stamped["title"] == "x"
    assert stamped[PAYLOAD_SCHEMA_VERSION_KEY] == EVENT_SCHEMA_VERSION_DEFAULT
    assert event_schema_version(EVENT_WORK_ITEM_CREATED) == 1


def test_emit_event_stamps_schema_version(tmp_path):
    k = Kernel(db=Database(str(tmp_path / "sv.db")))
    ev = k.emit_event(
        EVENT_WORK_ITEM_CREATED,
        "work_item",
        "wi_sv_1",
        payload={"title": "stamp-me", "work_type": "task", "status": "pending"},
        actor="test",
    )
    assert ev.payload[PAYLOAD_SCHEMA_VERSION_KEY] == 1
    rows = k.read_events(id=ev.id, limit=1)
    assert rows[0].payload[PAYLOAD_SCHEMA_VERSION_KEY] == 1


def test_check_event_schema_script_passes():
    assert check_event_schema_mod.BASELINE_PATH.exists()
    assert check_event_schema_mod.check(verbose=False) == 0


def test_upcast_identity_when_versions_match():
    payload = {"title": "x", PAYLOAD_SCHEMA_VERSION_KEY: 1}
    out = upcast_event_payload(EVENT_WORK_ITEM_CREATED, payload)
    assert out == payload


def test_upcast_fills_missing_schema_version():
    out = upcast_event_payload(EVENT_WORK_ITEM_CREATED, {"title": "legacy"})
    assert out[PAYLOAD_SCHEMA_VERSION_KEY] == 1
    assert out["title"] == "legacy"


def test_upcast_rejects_forward_incompatible():
    with pytest.raises(ValueError, match="forward-incompatible"):
        upcast_event_payload(
            EVENT_WORK_ITEM_CREATED,
            {"title": "x", PAYLOAD_SCHEMA_VERSION_KEY: 99},
        )


def test_upcast_applies_registered_step(monkeypatch):
    def _v1_to_v2(payload: dict) -> dict:
        out = dict(payload)
        out["title"] = str(out.get("title", "")) + "!"
        return out

    monkeypatch.setitem(
        schema_constants.EVENT_SCHEMA_VERSION_OVERRIDES, EVENT_WORK_ITEM_CREATED, 2
    )
    monkeypatch.setitem(
        schema_constants.EVENT_PAYLOAD_UPCASTERS,
        (EVENT_WORK_ITEM_CREATED, 1),
        _v1_to_v2,
    )
    out = schema_constants.upcast_event_payload(
        EVENT_WORK_ITEM_CREATED,
        {"title": "hi", PAYLOAD_SCHEMA_VERSION_KEY: 1},
    )
    assert out["title"] == "hi!"
    assert out[PAYLOAD_SCHEMA_VERSION_KEY] == 2


def test_upcast_missing_step_raises(monkeypatch):
    monkeypatch.setitem(
        schema_constants.EVENT_SCHEMA_VERSION_OVERRIDES, EVENT_WORK_ITEM_CREATED, 2
    )
    with pytest.raises(ValueError, match="missing payload upcaster"):
        schema_constants.upcast_event_payload(
            EVENT_WORK_ITEM_CREATED,
            {"title": "x", PAYLOAD_SCHEMA_VERSION_KEY: 1},
        )


def test_from_row_upcasts_payload(tmp_path, monkeypatch):
    def _v1_to_v2(payload: dict) -> dict:
        out = dict(payload)
        out["migrated"] = True
        return out

    monkeypatch.setitem(
        schema_constants.EVENT_PAYLOAD_UPCASTERS,
        (EVENT_WORK_ITEM_CREATED, 1),
        _v1_to_v2,
    )

    monkeypatch.setitem(
        schema_constants.EVENT_SCHEMA_VERSION_OVERRIDES, EVENT_WORK_ITEM_CREATED, 1
    )
    k = Kernel(db=Database(str(tmp_path / "up.db")))
    ev = k.emit_event(
        EVENT_WORK_ITEM_CREATED,
        "work_item",
        "wi_up_1",
        payload={"title": "stamp-me", "work_type": "task", "status": "pending"},
        actor="test",
    )
    assert ev.payload[PAYLOAD_SCHEMA_VERSION_KEY] == 1

    monkeypatch.setitem(
        schema_constants.EVENT_SCHEMA_VERSION_OVERRIDES, EVENT_WORK_ITEM_CREATED, 2
    )
    rows = k.read_events(id=ev.id, limit=1)
    assert rows[0].payload.get("migrated") is True
    assert rows[0].payload[PAYLOAD_SCHEMA_VERSION_KEY] == 2


def test_check_upcasters_requires_chain(monkeypatch):
    monkeypatch.setitem(
        schema_constants.EVENT_SCHEMA_VERSION_OVERRIDES, EVENT_WORK_ITEM_CREATED, 2
    )
    assert check_event_schema_mod.check_upcasters(verbose=False) == 1

    monkeypatch.setitem(
        schema_constants.EVENT_PAYLOAD_UPCASTERS,
        (EVENT_WORK_ITEM_CREATED, 1),
        lambda p: dict(p),
    )
    assert check_event_schema_mod.check_upcasters(verbose=False) == 0


def test_check_event_schema_detects_drift(monkeypatch):
    monkeypatch.setattr(
        check_event_schema_mod,
        "compute_versions",
        lambda: {"WorkItemCreated": 1, "OnlyInCurrent": 1},
    )
    monkeypatch.setattr(
        check_event_schema_mod,
        "load_baseline",
        lambda: {
            "versions": {"WorkItemCreated": 1, "OnlyInBaseline": 1},
        },
    )
    assert check_event_schema_mod.check(verbose=False) == 1


def test_record_rejects_downgrade(monkeypatch, tmp_path):
    baseline_file = tmp_path / "event_schema_versions.json"
    monkeypatch.setattr(check_event_schema_mod, "BASELINE_PATH", baseline_file)
    monkeypatch.setattr(
        check_event_schema_mod,
        "load_baseline",
        lambda: {"versions": {"WorkItemCreated": 2}},
    )
    monkeypatch.setattr(
        check_event_schema_mod,
        "compute_versions",
        lambda: {"WorkItemCreated": 1},
    )
    assert check_event_schema_mod.record_baseline(
        {"WorkItemCreated": 1}, verbose=False
    ) == 1
    assert not baseline_file.exists()


def test_record_allow_downgrade(monkeypatch, tmp_path):
    baseline_file = tmp_path / "event_schema_versions.json"
    monkeypatch.setattr(check_event_schema_mod, "BASELINE_PATH", baseline_file)
    monkeypatch.setattr(
        check_event_schema_mod,
        "load_baseline",
        lambda: {"versions": {"WorkItemCreated": 2}},
    )
    assert (
        check_event_schema_mod.record_baseline(
            {"WorkItemCreated": 1},
            allow_downgrade=True,
            verbose=False,
        )
        == 0
    )
    saved = json.loads(baseline_file.read_text(encoding="utf-8"))
    assert saved["versions"]["WorkItemCreated"] == 1
