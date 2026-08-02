"""Worker-thread emit_event must not be silently dropped.

When an event is emitted from a thread with no running asyncio loop (e.g. the
memory-index repair worker), ``event_dispatch.dispatch`` previously logged a
DEBUG line and skipped the async dispatcher. With a main loop bound via
``set_dispatch_loop``, the event must be delivered onto that loop so live
subscribers still see it.
"""

from __future__ import annotations

import asyncio
import threading

from app.core.runtime.kernel.event_dispatch import (
    dispatch,
    set_dispatch_loop,
)
from app.core.runtime.kernel.event import Event


class _StubKernel:
    """Minimal kernel-shaped object exercising only the dispatch path."""

    def __init__(self) -> None:
        self._async_dispatcher = None
        self._subscribers: list[tuple[dict, object]] = []
        self._pending_commands: dict[tuple[str, str], object] = {}
        self._commands_lock = threading.Lock()
        self._dispatch_tasks: set[asyncio.Task] = set()


def test_dispatch_routes_to_main_loop_when_worker_thread():
    """dispatch() from a worker thread schedules the async dispatcher on the bound main loop."""
    loop = asyncio.new_event_loop()
    set_dispatch_loop(loop)
    loop_thread = threading.Thread(target=loop.run_forever, daemon=True)
    loop_thread.start()
    try:
        delivered: list[Event] = []
        got_event = threading.Event()

        async def _dispatcher(event: Event) -> None:
            delivered.append(event)
            got_event.set()

        kernel = _StubKernel()
        kernel._async_dispatcher = _dispatcher

        evt = Event(
            type="MemoryUpdated",
            aggregate_type="memory",
            aggregate_id="m1",
            payload={"content": "x"},
        )

        # Run dispatch() on a worker thread with no running loop.
        t = threading.Thread(target=lambda: dispatch(kernel, evt))
        t.start()
        t.join(timeout=5)

        assert got_event.wait(timeout=2)
        assert delivered == [evt]
    finally:
        loop.call_soon_threadsafe(loop.stop)
        loop_thread.join(timeout=2)
        set_dispatch_loop(None)
        loop.close()


def test_dispatch_worker_thread_without_bound_loop_does_not_raise():
    """No bound main loop must degrade to a no-op log, never raise."""
    set_dispatch_loop(None)
    kernel = _StubKernel()
    kernel._async_dispatcher = lambda evt: asyncio.sleep(0)

    evt = Event(
        type="MemoryUpdated",
        aggregate_type="memory",
        aggregate_id="m1",
        payload={"content": "x"},
    )

    t = threading.Thread(target=lambda: dispatch(kernel, evt))
    t.start()
    t.join(timeout=5)
    # No exception, no crash.
    assert True
