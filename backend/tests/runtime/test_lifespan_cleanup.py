"""Lifespan cleanup must isolate failures and still release the instance lock."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_shutdown_continues_when_mcp_and_loop_raise(monkeypatch):
    from app.main import shutdown_runtime_resources

    calls: list[str] = []

    async def boom_mcp() -> None:
        calls.append("mcp")
        raise RuntimeError("mcp down")

    async def boom_loop() -> None:
        calls.append("loop")
        raise RuntimeError("loop down")

    def cron_ok() -> None:
        calls.append("cron")

    class FakeWs:
        async def close(self) -> None:
            calls.append("ws")

    monkeypatch.setattr("app.core.harness.mcp_lifecycle.stop_mcp_mesh", boom_mcp)
    monkeypatch.setattr("app.main.runtime_loop.stop", boom_loop)
    monkeypatch.setattr("app.core.runtime.cron_registry.shutdown_scheduler", cron_ok)
    monkeypatch.setattr("app.main._ws_connections", [FakeWs()])
    monkeypatch.setattr("app.main._ws_reserved_slots", 3)

    await shutdown_runtime_resources()
    assert calls == ["mcp", "loop", "cron", "ws"]


@pytest.mark.asyncio
async def test_finalize_releases_lock_when_shutdown_raises(monkeypatch):
    from app.main import finalize_lifespan

    async def boom_shutdown(**_kwargs) -> None:
        raise RuntimeError("cleanup exploded")

    released = {"n": 0}

    def fake_release(_db_path=None) -> None:
        released["n"] += 1

    monkeypatch.setattr("app.main.shutdown_runtime_resources", boom_shutdown)
    monkeypatch.setattr("app.store.database.release_instance_lock", fake_release)

    await finalize_lifespan()
    assert released["n"] == 1
