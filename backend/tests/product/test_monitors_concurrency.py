"""Concurrent monitor config writes must not drop sibling lists."""

from __future__ import annotations

import threading

from app.product import inbox_monitors as mon
from app.product import url_monitors as um


def test_concurrent_inbox_filter_and_url_monitor_writes(product_kernel):
    _ = product_kernel
    mon.save_monitors_config({"inbox_filters": [], "url_monitors": []})
    errors: list[Exception] = []

    def add_filter(idx: int) -> None:
        try:
            mon.create_inbox_filter(name=f"Filter {idx}", sender_contains=f"user{idx}@")
        except Exception as exc:
            errors.append(exc)

    def touch_url_monitor() -> None:
        try:
            row = um.create_url_monitor(name="Site", url="https://example.com")
            um.update_url_monitor(row["id"], enabled=False)
        except Exception as exc:
            errors.append(exc)

    threads = [
        threading.Thread(target=add_filter, args=(i,))
        for i in range(5)
    ]
    threads.append(threading.Thread(target=touch_url_monitor))
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors, errors
    cfg = mon.load_monitors_config()
    assert len(cfg.get("inbox_filters") or []) == 5
    assert len(cfg.get("url_monitors") or []) == 1
