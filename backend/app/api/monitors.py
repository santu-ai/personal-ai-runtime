"""Monitors API — inbox filter CRUD (APP_STORAGE settings, no Kernel events)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.product import inbox_monitors as monitors

router = APIRouter(tags=["monitors"])


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
    return {"filters": monitors.list_inbox_filters()}


@router.post("/inbox-filters")
async def create_inbox_filter(body: InboxFilterCreate):
    try:
        row = monitors.create_inbox_filter(
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
        return monitors.update_inbox_filter(filter_id, **updates)
    except KeyError:
        raise HTTPException(status_code=404, detail="Filter not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/inbox-filters/{filter_id}")
async def delete_inbox_filter(filter_id: str):
    try:
        monitors.delete_inbox_filter(filter_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Filter not found") from None
    return {"status": "ok"}
