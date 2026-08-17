"""Tests for logging configuration.

These tests exercise production ``configure_logging()`` only. Business-logger
capture (inbox poll warnings, etc.) lives in the owning handler tests and
must restore logger/handler/propagate itself so suite order cannot leak.
"""

import logging

import pytest

from app.core.logging_config import configure_logging
from app.core.request_context import request_id_var


@pytest.fixture(autouse=True)
def _restore_root_logging():
    root = logging.getLogger()
    prev_handlers = list(root.handlers)
    prev_level = root.level
    yield
    for handler in list(root.handlers):
        if handler not in prev_handlers:
            root.removeHandler(handler)
            handler.close()
    for handler in prev_handlers:
        if handler not in root.handlers:
            root.addHandler(handler)
    root.setLevel(prev_level)


def test_configure_logging_smoke():
    configure_logging()
    import structlog

    log = structlog.get_logger("test")
    log.info("structured log smoke test", component="logging_config")

    # Verify structlog is usable — must not raise
    logger = structlog.get_logger(__name__)
    assert logger is not None


def test_stdlib_and_structlog_share_handler():
    configure_logging()
    root = logging.getLogger()
    owned = [
        h
        for h in root.handlers
        if getattr(h, "_par_structlog_handler", False)
    ]
    assert owned, "root logger should have a ProcessorFormatter handler"
    formatter = owned[0].formatter
    assert formatter is not None
    assert formatter.__class__.__name__ == "ProcessorFormatter"

    stdlib_logger = logging.getLogger("app.core.test_logging_bridge")
    stdlib_logger.info("stdlib bridge smoke")


def test_configure_logging_preserves_foreign_handlers():
    root = logging.getLogger()
    foreign = logging.StreamHandler()
    foreign.set_name("foreign-test-handler")
    root.addHandler(foreign)
    try:
        configure_logging()
        configure_logging()
        assert foreign in root.handlers
        owned = [
            h
            for h in root.handlers
            if getattr(h, "_par_structlog_handler", False)
        ]
        assert len(owned) == 1
    finally:
        root.removeHandler(foreign)
        foreign.close()


def test_request_id_processor_reads_context_module():
    configure_logging()
    import structlog

    token = request_id_var.set("rid-from-context")
    try:
        log = structlog.get_logger("test.request_id")
        log.info("with request id")
    finally:
        request_id_var.reset(token)
