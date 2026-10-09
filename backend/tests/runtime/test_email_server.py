"""Unit tests for email MCP server helpers."""

import email
import json
from types import SimpleNamespace

import pytest

from app.core.harness.builtin_tools.email import (
    EmailServer,
    _format_date,
    _imap_since_token,
    _stable_message_id,
)
from app.core.harness.mcp_hub import ToolInvokeError


def test_format_date_converts_to_local_timezone():
  # 06:38 UTC -> 14:38 in UTC+8
  raw = "Wed, 10 Jun 2026 06:38:12 +0000"
  formatted = _format_date(raw)
  assert "2026-06-10" in formatted
  assert formatted.endswith(":38") or formatted.endswith(":38:12") is False


def test_message_id_from_header_bytes_matches_full_message():
    header = (
        b"Message-ID: <test@example.com>\r\n"
        b"From: Alice <alice@example.com>\r\n"
        b"Subject: Hello\r\n"
        b"Date: Wed, 10 Jun 2026 06:38:12 +0000\r\n"
    )
    from_header = EmailServer._message_id_from_header_bytes(header)
    full = email.message_from_bytes(header + b"\r\nbody")
    from_full = _stable_message_id(
        full,
        "Alice <alice@example.com>",
        "Hello",
        full.get("Date"),
    )
    assert from_header == from_full


def test_check_inbox_unread_only_includes_all_unread_emails(monkeypatch):
    server = EmailServer()
    monkeypatch.setattr(server, "_connect_inbox", lambda: object())
    monkeypatch.setattr(
        server,
        "_fetch_unread_emails_connected",
        lambda _mail: [
            {"message_id": "<id-1@example.com>", "from": "u1", "subject": "s1", "date": "d1"},
            {"message_id": "<id-2@example.com>", "from": "u2", "subject": "s2", "date": "d2"},
        ],
    )
    monkeypatch.setattr(
        server,
        "_fetch_sorted_emails_connected",
        lambda _mail, limit, unread_only, body_max=300: [
            {
                "message_id": "<id-2@example.com>",
                "from": "user2@example.com",
                "subject": "Mail 2",
                "date": "2026-06-10 14:38",
                "preview": "preview",
            }
        ],
    )

    data = json.loads(server.check_inbox(limit=1, unread_only=True))
    assert data["count"] == 1
    assert data["all_unread_emails"] == [
        {"message_id": "<id-1@example.com>"},
        {"message_id": "<id-2@example.com>"},
    ]


def test_check_inbox_recent_mail_still_includes_unseen_index(monkeypatch):
    server = EmailServer()
    monkeypatch.setattr(server, "_connect_inbox", lambda: object())
    monkeypatch.setattr(
        server,
        "_fetch_unread_emails_connected",
        lambda _mail: [{"message_id": "<unseen@example.com>", "from": "u", "subject": "s", "date": "d"}],
    )
    monkeypatch.setattr(
        server,
        "_fetch_sorted_emails_connected",
        lambda _mail, limit, unread_only, body_max=300: [
            {
                "message_id": "<seen@example.com>",
                "from": "user@example.com",
                "subject": "Already read",
                "date": "2026-08-17 15:00",
                "preview": "preview",
            }
        ],
    )

    data = json.loads(server.check_inbox(limit=1, unread_only=False))
    assert data["unread_only"] is False
    assert data["emails"][0]["message_id"] == "<seen@example.com>"
    assert data["all_unread_emails"] == [{"message_id": "<unseen@example.com>"}]


def test_check_inbox_uses_uid_cursor_when_mailbox_is_stable(monkeypatch):
    server = EmailServer()
    mail = SimpleNamespace(
        response=lambda name: ("OK", [b"uid-validity-7"]),
        uid=lambda *args: ("OK", [b"11 12"]),
        logout=lambda: None,
    )
    monkeypatch.setattr(server, "_connect_inbox", lambda: mail)
    monkeypatch.setattr(server, "_fetch_unread_emails_connected", lambda _mail: [])

    calls = []

    def fetch_since(_mail, limit, unread_only, after_uid, body_max=300):
        calls.append((limit, unread_only, after_uid, body_max))
        return ([{"message_id": "<new@example.com>", "subject": "New"}], 12)

    monkeypatch.setattr(server, "_fetch_sorted_emails_since_uid_connected", fetch_since)

    data = json.loads(
        server.check_inbox(
            limit=2,
            after_uid=10,
            uid_validity="uid-validity-7",
        )
    )

    assert calls == [(2, False, 10, 300)]
    assert data["next_uid"] == 12
    assert data["uid_validity"] == "uid-validity-7"
    assert data["cursor_reset"] is False


def test_check_inbox_resets_cursor_when_uidvalidity_changes(monkeypatch):
    server = EmailServer()
    mail = SimpleNamespace(
        response=lambda name: ("OK", [b"uid-validity-new"]),
        uid=lambda *args: ("OK", [b"20"]),
        logout=lambda: None,
    )
    monkeypatch.setattr(server, "_connect_inbox", lambda: mail)
    monkeypatch.setattr(server, "_fetch_unread_emails_connected", lambda _mail: [])
    monkeypatch.setattr(
        server,
        "_fetch_sorted_emails_connected",
        lambda _mail, limit, unread_only, body_max=300: [],
    )

    data = json.loads(
        server.check_inbox(
            limit=2,
            after_uid=10,
            uid_validity="uid-validity-old",
        )
    )

    assert data["cursor_reset"] is True
    assert data["uid_validity"] == "uid-validity-new"
    assert data["next_uid"] == 20


def test_read_inbox_email_by_message_id(monkeypatch):
    """message_id 直查路径 — 供治理面（inbox summary）取全文正文。"""
    server = EmailServer()
    monkeypatch.setattr(server, "read_email_body", lambda mid: f"full body of {mid}")

    data = json.loads(server.read_inbox_email(message_id="<msg-1@example.com>"))
    assert data == {
        "message_id": "<msg-1@example.com>",
        "body": "full body of <msg-1@example.com>",
    }


def test_read_inbox_email_by_message_id_not_found(monkeypatch):
    from app.core.harness.mcp_hub import ToolInvokeError

    server = EmailServer()
    monkeypatch.setattr(server, "read_email_body", lambda mid: None)

    with pytest.raises(ToolInvokeError, match="未找到 Message-ID"):
        server.read_inbox_email(message_id="<missing@example.com>")


def test_read_inbox_email_empty_inbox_raises(monkeypatch):
    from app.core.harness.mcp_hub import ToolInvokeError

    server = EmailServer()
    monkeypatch.setattr(server, "_fetch_sorted_emails", lambda *a, **k: [])
    with pytest.raises(ToolInvokeError, match="收件箱中没有邮件"):
        server.read_inbox_email(index=1)


def test_read_inbox_email_by_message_id_imap_failure_raises(monkeypatch):
    from app.core.harness.builtin_tools.email import EmailFetchError
    from app.core.harness.mcp_hub import ToolInvokeError

    server = EmailServer()

    def boom(_mid):
        raise EmailFetchError("IMAP login failed")

    monkeypatch.setattr(server, "read_email_body", boom)
    with pytest.raises(ToolInvokeError, match="IMAP login failed"):
        server.read_inbox_email(message_id="<msg-1@example.com>")


def test_mark_inbox_email_read_by_message_id(monkeypatch):
    server = EmailServer()
    store_calls: list[tuple] = []

    mail = SimpleNamespace(
        search=lambda charset, criterion: ("OK", [b""]), # Return empty to test fallback
        store=lambda seq, op, flags: store_calls.append((seq, op, flags)) or ("OK", [b"OK"]),
        logout=lambda: None,
    )
    monkeypatch.setattr(server, "_connect_inbox", lambda: mail)
    monkeypatch.setattr(
        server,
        "_fetch_sorted_emails_connected",
        lambda _mail, limit, unread_only, body_max=0: [
            {
                "seq_num": 42,
                "message_id": "<msg-1@example.com>",
                "from": "alice@example.com",
                "subject": "Hello",
                "date": "2026-06-10 14:38",
                "preview": "preview",
            }
        ],
    )

    data = json.loads(
        server.mark_inbox_email_read(message_id="<msg-1@example.com>")
    )
    assert data["success"] is True
    assert data["message_id"] == "<msg-1@example.com>"
    assert store_calls == [("42", "+FLAGS", "\\Seen")]


def test_mark_inbox_email_read_requires_selector():
    from app.core.harness.mcp_hub import ToolInvokeError

    server = EmailServer()
    with pytest.raises(ToolInvokeError, match="message_id or index"):
        server.mark_inbox_email_read()


def test_mark_inbox_email_read_by_mid_alias(monkeypatch):
    server = EmailServer()
    store_calls: list[tuple] = []

    mail = SimpleNamespace(
        search=lambda charset, criterion: ("OK", [b"100"]),
        store=lambda seq, op, flags: store_calls.append((seq, op, flags)) or ("OK", [b"OK"]),
        logout=lambda: None,
    )
    monkeypatch.setattr(server, "_connect_inbox", lambda: mail)

    # Use 'mid' instead of 'message_id' to test alias and search logic
    data = json.loads(server.mark_inbox_email_read(mid="<msg-1@example.com>"))
    assert data["success"] is True
    assert data.get("method") == "imap_search"
    assert store_calls == [("100", "+FLAGS", "\\Seen")]


def test_imap_since_token_uses_english_months():
    assert _imap_since_token("2026-01-01") == "01-Jan-2026"
    assert _imap_since_token("2026-10-09T00:00:00") == "09-Oct-2026"
    with pytest.raises(ToolInvokeError, match="YYYY-MM-DD"):
        _imap_since_token("01/01/2026")


def test_check_inbox_scoped_search_keeps_body_and_reports_truncation(monkeypatch):
    server = EmailServer()
    seen: dict = {}

    def search(_mail, *, query, since, unread_only):
        seen["search"] = (query, since, unread_only)
        return [b"1", b"2", b"3"]

    def fetch(_mail, limit, unread_only, body_max=300, sequence_ids=None):
        seen["fetch"] = (limit, body_max, sequence_ids)
        return [
            {
                "message_id": "a",
                "from": "a@b.c",
                "subject": "预算",
                "date": "d",
                "preview": "p",
                "body": "full body about 预算",
            },
            {
                "message_id": "b",
                "from": "b@b.c",
                "subject": "其他",
                "date": "d",
                "preview": "p2",
                "body": "other",
            },
        ]

    monkeypatch.setattr(server, "_connect_inbox", lambda: object())
    monkeypatch.setattr(server, "_mailbox_uid_validity", lambda _mail: "1")
    monkeypatch.setattr(server, "_fetch_unread_emails_connected", lambda _mail: [])
    monkeypatch.setattr(server, "_highest_uid_connected", lambda _mail: 9)
    monkeypatch.setattr(server, "_search_scope_ids", search)
    monkeypatch.setattr(server, "_fetch_sorted_emails_connected", fetch)

    payload = json.loads(server.check_inbox(limit=2, query="预算", since="2026-01-01"))
    assert payload["scoped"] is True
    assert payload["search"]["matched"] == 3
    assert payload["search"]["returned"] == 2
    assert payload["search"]["truncated"] is True
    assert payload["search"]["query"] == "预算"
    assert payload["search"]["since"] == "2026-01-01"
    assert payload["emails"][0]["body"] == "full body about 预算"
    assert seen["search"] == ("预算", "2026-01-01", False)
    assert seen["fetch"][0] == 2
    assert seen["fetch"][1] == 8000
    assert seen["fetch"][2] == [b"1", b"2", b"3"]


def test_email_config_refresh_is_ttl_cached(monkeypatch):
    server = EmailServer()
    calls = {"n": 0}

    def fake_creds():
        calls["n"] += 1
        return {
            "imap_host": "imap.example.com",
            "smtp_host": "smtp.example.com",
            "smtp_port": "465",
            "user": "u",
            "password": "p",
        }

    monkeypatch.setattr(
        "app.core.runtime.runtime_config.runtime_config.get_email_credentials",
        fake_creds,
    )
    server._refresh_config(force=True)
    server._refresh_config()
    server._get_credentials()
    assert calls["n"] == 1
    # Force bypasses TTL.
    server._refresh_config(force=True)
    assert calls["n"] == 2
