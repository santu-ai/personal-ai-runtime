"""Monitors API — inbox filters + URL diff monitors (APP_STORAGE, no Kernel events)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.product import inbox_monitors as inbox_mon
from app.product import url_monitors as url_mon

router = APIRouter(tags=["monitors"])


# ── Inbox filters ────────────────────────────────────────────────────────────


class InboxFilterCreate(BaseModel):
    name: str = ""
    sender_contains: str = ""
    subject_contains: str = ""
    enabled: bool = True


class InboxFilterUpdate(BaseModel):
    name: str | None = None
    sender_contains: str | None = None
    subject_contains: str | None = None
    enabled: bool | None = None


@router.get("/inbox-filters")
async def list_inbox_filters():
    return {"filters": inbox_mon.list_inbox_filters()}


@router.post("/inbox-filters")
async def create_inbox_filter(body: InboxFilterCreate):
    try:
        row = inbox_mon.create_inbox_filter(
            name=body.name,
            sender_contains=body.sender_contains,
            subject_contains=body.subject_contains,
            enabled=body.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return row


@router.patch("/inbox-filters/{filter_id}")
async def update_inbox_filter(filter_id: str, body: InboxFilterUpdate):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        return inbox_mon.update_inbox_filter(filter_id, **updates)
    except KeyError:
        raise HTTPException(status_code=404, detail="Filter not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/inbox-filters/{filter_id}")
async def delete_inbox_filter(filter_id: str):
    try:
        inbox_mon.delete_inbox_filter(filter_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Filter not found") from None
    return {"status": "ok"}


# ── URL monitors ─────────────────────────────────────────────────────────────


class UrlMonitorCreate(BaseModel):
    name: str = ""
    url: str = ""
    enabled: bool = True
    check_interval_minutes: int = Field(
        default=url_mon.DEFAULT_INTERVAL_MINUTES,
        ge=url_mon.MIN_INTERVAL_MINUTES,
        le=url_mon.MAX_INTERVAL_MINUTES,
    )


class UrlMonitorUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    enabled: bool | None = None
    check_interval_minutes: int | None = Field(
        default=None,
        ge=url_mon.MIN_INTERVAL_MINUTES,
        le=url_mon.MAX_INTERVAL_MINUTES,
    )


@router.get("/url-monitors")
async def list_url_monitors():
    return {"monitors": url_mon.list_url_monitors()}


@router.post("/url-monitors")
async def create_url_monitor(body: UrlMonitorCreate):
    try:
        return url_mon.create_url_monitor(
            name=body.name,
            url=body.url,
            enabled=body.enabled,
            check_interval_minutes=body.check_interval_minutes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/url-monitors/check")
async def check_url_monitors(force: bool = True):
    """Run due (or all, when force=True) URL monitors once — dogfood / manual.

    Caps forced runs at 5 pages so the HTTP request cannot hang for minutes.
    """
    max_checks = 5 if force else None
    notified = await url_mon.evaluate_url_monitors(force=force, max_checks=max_checks)
    return {"notified": notified, "force": force, "max_checks": max_checks}


@router.patch("/url-monitors/{monitor_id}")
async def update_url_monitor(monitor_id: str, body: UrlMonitorUpdate):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        return url_mon.update_url_monitor(monitor_id, **updates)
    except KeyError:
        raise HTTPException(status_code=404, detail="URL monitor not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/url-monitors/{monitor_id}")
async def delete_url_monitor(monitor_id: str):
    try:
        url_mon.delete_url_monitor(monitor_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="URL monitor not found") from None
    return {"status": "ok"}
