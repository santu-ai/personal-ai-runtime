"""Structured logging configuration for the backend.

Routes both structlog and stdlib ``logging`` through the same
``ProcessorFormatter`` pipeline so request_id / timestamps stay consistent.
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import re
import sys
import threading
from collections import deque
from collections.abc import Mapping, MutableMapping
from pathlib import Path
from typing import Any

import structlog

from app.core.request_context import request_id_var

# Marker so reconfigure only removes handlers we installed.
_OWNED_HANDLER_ATTR = "_par_structlog_handler"
_LOG_RING_LIMIT = 80
_LOG_LINE_LIMIT = 240
_LOG_MAX_BYTES = 256 * 1024
_LOG_BACKUPS = 2
_LOG_RING: deque[str] = deque(maxlen=_LOG_RING_LIMIT)
_LOG_RING_LOCK = threading.Lock()

# Secrets and mailbox addresses only. Error text stays so a bug report is usable.
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_REDACTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"enc:v1:[A-Za-z0-9_\-+/=]+"), "enc:v1:[redacted]"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{6,}\b"), "sk-[redacted]"),
    (
        re.compile(
            r"(?i)\b(api[_-]?key|password|passwd|secret|authorization|token)\b\s*[=:]\s*\S+"
        ),
        r"\1=[redacted]",
    ),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-+/=]{6,}"), "Bearer [redacted]"),
    (re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"), "[email]"),
)


def redact_text(text: str) -> str:
    """Drop secrets and mailbox addresses, and keep one line short."""
    cleaned = _ANSI.sub("", text or "")
    for pattern, repl in _REDACTIONS:
        cleaned = pattern.sub(repl, cleaned)
    if len(cleaned) > _LOG_LINE_LIMIT:
        cleaned = cleaned[:_LOG_LINE_LIMIT] + "…"
    return cleaned


def recent_log_lines(*, limit: int = 40) -> list[str]:
    """Newest redacted lines kept in memory. The disk log is rotated separately."""
    count = max(0, int(limit))
    with _LOG_RING_LOCK:
        lines = list(_LOG_RING)
    if count == 0:
        return []
    return lines[-count:]


class _RingHandler(logging.Handler):
    """Bounded in-process copy of the formatted log line."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            line = self.format(record)
        except Exception:
            return
        with _LOG_RING_LOCK:
            _LOG_RING.append(line)


def configure_logging(
    level: int = logging.INFO,
    *,
    json_logs: bool | None = None,
    log_dir: str | None = None,
    max_bytes: int = _LOG_MAX_BYTES,
    backup_count: int = _LOG_BACKUPS,
) -> None:
    """Configure structlog + stdlib logging with a shared processor chain.

    ``json_logs`` defaults from ``LOG_JSON=1|true|yes`` when omitted.
    Only replaces handlers previously installed by this function.
    ``log_dir`` adds a rotating file (``runtime.log`` plus ``backup_count``
    older files, each capped at ``max_bytes``).
    """
    if json_logs is None:
        json_logs = os.environ.get("LOG_JSON", "").strip().lower() in {
            "1",
            "true",
            "yes",
        }

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        _request_id_processor,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=False),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    renderer: Any = (
        structlog.processors.JSONRenderer()
        if json_logs
        else structlog.dev.ConsoleRenderer()
    )

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    def _owned(handler: logging.Handler) -> logging.Handler:
        handler.setFormatter(_RedactingFormatter(formatter))
        setattr(handler, _OWNED_HANDLER_ATTR, True)
        return handler

    handlers: list[logging.Handler] = [
        _owned(logging.StreamHandler(sys.stderr)),
        _owned(_RingHandler()),
    ]
    if log_dir:
        directory = Path(log_dir)
        directory.mkdir(parents=True, exist_ok=True)
        rotating = logging.handlers.RotatingFileHandler(
            directory / "runtime.log",
            maxBytes=max(1024, int(max_bytes)),
            backupCount=max(1, int(backup_count)),
            encoding="utf-8",
        )
        handlers.append(_owned(rotating))

    with _LOG_RING_LOCK:
        _LOG_RING.clear()

    root = logging.getLogger()
    for existing in list(root.handlers):
        if getattr(existing, _OWNED_HANDLER_ATTR, False):
            root.removeHandler(existing)
            existing.close()
    for handler in handlers:
        root.addHandler(handler)
    root.setLevel(level)


class _RedactingFormatter(logging.Formatter):
    """Format first, then drop secrets. The structlog formatter stays inside."""

    def __init__(self, inner: logging.Formatter) -> None:
        super().__init__()
        self.inner = inner

    def format(self, record: logging.LogRecord) -> str:
        return redact_text(self.inner.format(record))


def _request_id_processor(
    _logger: object,
    _method_name: str,
    event_dict: MutableMapping[str, Any],
) -> Mapping[str, Any]:
    """Attach the current request id (if any) to every structured log line."""
    rid = request_id_var.get()
    if rid:
        event_dict["request_id"] = rid
    return event_dict
