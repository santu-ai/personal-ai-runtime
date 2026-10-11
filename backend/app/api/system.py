"""System API — health checks, LLM providers, data sovereignty, and system info."""

import asyncio
import json
import platform
import secrets
from collections.abc import Callable
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app.api.models import (
    DestroyDataRequest,
    EncryptedExportRequest,
    EncryptedImportRequest,
    ExportRequest,
    ImportRequest,
)
from app.config import settings
from app.core.agents.llm_failover import llm_router
from app.core.logging_config import recent_log_lines, redact_text
from app.core.runtime.kernel_instance import kernel
from app.core.startup_health import sanitize_startup_for_public
from app.version import VERSION

_TRIAL_STAT_KEYS = (
    "window_days",
    "reviewed_tasks",
    "accepted_tasks",
    "success_rate",
    "first_reviewed_tasks",
    "first_version_accepted_tasks",
    "first_version_acceptance_rate",
    "cost_per_accepted_delivery",
    "rework_count",
    "adopted_action_count",
    "average_review_latency_hours",
    "review_time_trend",
    "self_reported_time_saved",
    "capped",
)

router = APIRouter(tags=["system"])


def _request_has_valid_auth(request: Request) -> bool:
    expected = settings.auth_token
    if not expected:
        return False
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return False
    return secrets.compare_digest(auth_header[7:], expected)


def _require_auth_when_configured(request: Request, action: str) -> None:
    """Enforce Bearer auth only when AUTH_TOKEN is configured.

    Local-first default leaves AUTH_TOKEN empty; destructive operations are then
    gated solely by confirm codes. When AUTH_TOKEN is set, AuthMiddleware already
    rejects unauthenticated callers — this is defense-in-depth for those routes.
    """
    if not settings.auth_token:
        return
    if not _request_has_valid_auth(request):
        raise HTTPException(
            status_code=403,
            detail=f"{action} requires AUTH_TOKEN to be set and provided",
        )


EXPORT_CONFIRM = "EXPORT_ALL_DATA"
DESTROY_CONFIRM = "DESTROY_ALL_DATA"
IMPORT_CONFIRM = "DESTROY_AND_IMPORT"


@router.get("/health")
async def health_check(request: Request):
    """Health check endpoint with startup diagnostics.

    Use /live for liveness probes (no DB dependency).
    """
    startup = getattr(request.app.state, "startup_health", None)
    if startup and not _request_has_valid_auth(request):
        startup = sanitize_startup_for_public(startup)
    return {
        "status": startup.get("status", "ok") if startup else "ok",
        "service": "personal-ai-runtime",
        "version": VERSION,
        "auth_required": bool(settings.auth_token),
        "startup": startup,
    }


def _support_settings() -> dict:
    """Model and mailbox flags. No key, password, address, or message."""
    from app.core.runtime.runtime_config import runtime_config

    llm = runtime_config.get_llm_config(masked=True)
    email = runtime_config.get_email_config(masked=True)
    providers = []
    for item in llm.get("providers") or []:
        if not isinstance(item, dict):
            continue
        providers.append({
            "id": item.get("id"),
            "name": item.get("name"),
            "type": item.get("type"),
            "model": item.get("model"),
            "base_url": redact_text(str(item.get("base_url") or "")),
            "enabled": bool(item.get("enabled")),
            "has_api_key": bool(item.get("has_api_key")),
            "needs_reentry": bool(item.get("needs_reentry")),
            "reentry_reason": redact_text(str(item.get("reentry_reason") or "")),
        })
    return {
        "default_provider": llm.get("default_provider"),
        "providers": providers,
        "email": {
            "configured": bool(email.get("configured")),
            "needs_reentry": bool(email.get("needs_reentry")),
            "reentry_reason": redact_text(str(email.get("reentry_reason") or "")),
        },
    }


def _support_errors(*, limit: int = 8) -> list[dict]:
    from app.core.runtime.read_ports.events import query_execution_trust_summary

    summary = query_execution_trust_summary(recent_limit=limit)
    rows: list[dict] = []
    for bucket in ("failed", "dead_letter", "in_retry"):
        for item in summary.get(bucket) or []:
            if not isinstance(item, dict):
                continue
            rows.append({
                "bucket": bucket,
                "status": item.get("status"),
                "handler_name": item.get("handler_name"),
                "event_type": item.get("event_type"),
                "error": redact_text(str(item.get("error") or "")),
                "dead_letter": bool(item.get("dead_letter")),
                "created_at": item.get("created_at"),
            })
            if len(rows) >= limit:
                return rows
    return rows


def _support_trial() -> dict:
    from app.product.work_delivery import summarize_delivery_metrics

    metrics = summarize_delivery_metrics(days=14)
    return {key: metrics.get(key) for key in _TRIAL_STAT_KEYS}


def _support_eval() -> dict:
    from app.core.runtime import read_ports

    return {
        "stored_case_scores": False,
        "llm": read_ports.summarize_llm_calls(days=14),
        "by_model": read_ports.summarize_llm_calls_by_model(days=14),
        "failures": read_ports.summarize_call_failure_rates(days=14),
    }


def build_support_bundle() -> dict:
    """Redacted bug-report bundle. No mail, file body, or secret."""
    sections: dict[str, Callable[[], object]] = {
        "settings": _support_settings,
        "recent_errors": _support_errors,
        "trial": _support_trial,
        "eval": _support_eval,
    }
    body: dict[str, object] = {
        "kind": "support-bundle",
        "generated_at": datetime.now(UTC).isoformat(),
        "versions": {
            "app": VERSION,
            "python": platform.python_version(),
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "logs": recent_log_lines(limit=40),
    }
    for name, builder in sections.items():
        try:
            body[name] = builder()
        except Exception as exc:
            body[name] = {"unavailable": True, "reason": redact_text(str(exc))}
    return body


@router.get("/diagnostics")
async def diagnostics_bundle(request: Request):
    """One-click redacted bundle an owner can attach to a bug report."""
    _require_auth_when_configured(request, "export diagnostics")
    payload = build_support_bundle()
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    day = datetime.now(UTC).date().isoformat()
    return Response(
        content=raw,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="diagnostics-{day}.json"',
        },
    )


@router.get("/live")
async def liveness():
    """Liveness probe — returns 200 as long as the process is running.

    No DB or LLM dependencies. Safe for Docker healthcheck.
    """
    return {"status": "ok", "service": "personal-ai-runtime"}


@router.get("/ready")
async def readiness(request: Request):
    """Readiness probe — checks DB is initialised and writable.

    Safe for k8s readiness probes; Docker healthcheck can use /live instead.
    """
    try:
        kernel.table_counts(("event_log",))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database not ready") from exc
    return {"status": "ok", "service": "personal-ai-runtime"}


@router.get("/llm-providers")
async def list_llm_providers():
    """List all configured LLM providers."""
    return {
        "providers": llm_router.list_providers(),
        "default": llm_router.get_default_model(),
    }


class PullLocalModelRequest(BaseModel):
    name: str


def _local_model_base() -> str:
    """Prefer a configured Ollama address, then the settings default."""
    from app.core.agents.llm_failover import is_ollama_endpoint
    from app.core.runtime.runtime_config import runtime_config

    base = settings.ollama_base_url
    try:
        llm = runtime_config.get_llm_config(masked=True)
    except Exception:
        return base
    for provider in llm.get("providers") or []:
        provider_base = str(provider.get("base_url") or "")
        if is_ollama_endpoint(str(provider.get("type") or ""), provider_base) and provider_base:
            return provider_base
    return base


@router.get("/local-models")
async def local_models():
    """Installed Ollama models and the recommended local model."""
    from app.core.agents.llm_failover import describe_local_models, fetch_installed_model_names

    base = _local_model_base()
    installed = fetch_installed_model_names(base)
    described = describe_local_models(base, installed)
    described.pop("base_url", None)
    return described


@router.post("/local-models/pull")
async def pull_local_model(body: PullLocalModelRequest):
    """Pull the recommended local model and stream progress."""
    from app.core.agents.llm_failover import RECOMMENDED_LOCAL_MODEL, iter_recommended_pull

    if body.name != RECOMMENDED_LOCAL_MODEL:
        raise HTTPException(
            status_code=400,
            detail=f"只能拉取推荐模型 {RECOMMENDED_LOCAL_MODEL}",
        )
    base = _local_model_base()
    return StreamingResponse(
        iter_recommended_pull(base, body.name),
        media_type="application/x-ndjson",
    )


@router.get("/info")
async def system_info():
    """Get system information."""
    counts = kernel.table_counts(
        ("conversations", "messages", "event_log", "memories")
    )

    # goals table was dropped in v06; goal count comes from work_items now.
    from app.core.runtime import read_ports
    goal_count = read_ports.count_goals()

    return {
        "conversations": counts["conversations"],
        "messages": counts["messages"],
        "goals": goal_count,
        "event_log": counts["event_log"],
        "memories": counts["memories"],
        "llm_providers": len(llm_router.list_providers()),
    }


@router.get("/mcp-status")
async def mcp_status():
    """Return external MCP server connection status."""
    from app.core.harness.mcp_mesh import mcp_mesh

    return mcp_mesh.get_server_status()


@router.post("/morning-brief/test")
async def morning_brief_test(persist: bool = False):
    """Manually run morning-brief generation for diagnostics.

    Returns the assembled brief text plus per-step timings / errors so we can
    tell whether a missed 08:00 fire was a data issue or a scheduler miss.
    Defaults to ``persist=False`` to avoid spamming the notification center
    during diagnosis; pass ``?persist=true`` to also push a real notification.
    """
    from app.product.morning_brief import (
        generate_morning_brief,
        notification_dedup_key,
        notification_title,
    )

    try:
        result = generate_morning_brief()
        if persist:
            from app.core.runtime import read_ports

            read_ports.push_notification(
                "morning_brief",
                notification_title(result.date_local),
                result.brief,
                dedup_key=notification_dedup_key(result.date_local),
            )
        return {
            "ok": True,
            "persisted": persist,
            **result.to_dict(),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "ok": False,
                "persisted": False,
                "error": f"{type(exc).__name__}: {exc}",
            },
        ) from exc


@router.post("/export")
async def export_all_data(body: ExportRequest | None = None):
    """Export governed personal data snapshot as streamed JSON.

    Includes ``event_log`` and governed projections rebuildable from it.
    """
    payload = body or ExportRequest()
    if payload.confirm != EXPORT_CONFIRM:
        raise HTTPException(
            status_code=400,
            detail=f"Set confirm='{EXPORT_CONFIRM}' to export",
        )
    filename = f"personal-ai-backup-{datetime.now(UTC).strftime('%Y-%m-%d')}.json"
    return StreamingResponse(
        kernel.iter_snapshot_json_chunks(),
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )

@router.post("/import")
async def import_all_data(body: ImportRequest, request: Request):
    """Import personal data snapshot. Requires confirm code when not read_only."""
    read_only = body.read_only
    if not read_only:
        _require_auth_when_configured(request, "Write import")
        if body.confirm != IMPORT_CONFIRM:
            raise HTTPException(
                status_code=400,
                detail=f"Set confirm='{IMPORT_CONFIRM}' for write import",
            )
    data = dict(body.data)
    settings_blob = data.pop("app_settings", None)
    result = await asyncio.to_thread(
        kernel.restore,
        data,
        read_only=read_only,
    )
    if not read_only and _apply_imported_settings(settings_blob):
        if isinstance(result, dict):
            result = {**result, "settings_restored": True}
    return result


@router.delete("/data")
async def destroy_all_data(body: DestroyDataRequest, request: Request):
    """Destroy all local data. Requires confirm code in body; AUTH_TOKEN when configured.

    Usage: DELETE /api/system/data with JSON body ``{"confirm": "DESTROY_ALL_DATA"}``.
    Body is used (not query params) so the confirm code stays out of access logs.
    When AUTH_TOKEN is unset (local-first default), confirm code alone is sufficient.
    """
    _require_auth_when_configured(request, "Destroy")
    if body.confirm != DESTROY_CONFIRM:
        raise HTTPException(
            status_code=400,
            detail=f"Set confirm='{DESTROY_CONFIRM}' in request body",
        )
    return await asyncio.to_thread(kernel.erase)


def _settings_for_export() -> dict:
    """Plain settings for a backup blob. The blob's own passphrase protects them."""
    from app.core.runtime.runtime_config import runtime_config

    return {
        "llm": runtime_config.get_llm_config(masked=False),
        "email": runtime_config.get_email_config(masked=False),
    }


def _apply_imported_settings(blob: object) -> bool:
    if not isinstance(blob, dict):
        return False
    from app.core.runtime.runtime_config import runtime_config

    llm = blob.get("llm")
    email = blob.get("email")
    applied = False
    if isinstance(llm, dict):
        runtime_config.update_llm_config(llm)
        applied = True
    if isinstance(email, dict):
        runtime_config.update_email_config(email)
        applied = True
    return applied


# --- Encrypted Sync ---

@router.post("/export/encrypted")
async def export_encrypted(body: EncryptedExportRequest):
    """Export with AES-GCM encryption using a user-provided passphrase.

    Password is read from the request body (not query) to keep it out of
    access logs and shell history. Returns a base64-encoded encrypted blob
    suitable for cross-device transfer. Use /api/system/import/encrypted to
    restore.
    """
    if body.confirm != EXPORT_CONFIRM:
        raise HTTPException(
            status_code=400,
            detail=f"Set confirm='{EXPORT_CONFIRM}' to export",
        )

    from app.product.encrypted_sync import (
        BLOB_FORMAT,
        EncryptedSyncError,
        encrypt_snapshot,
    )

    snapshot = kernel.snapshot()
    snapshot["app_settings"] = _settings_for_export()

    try:
        blob = await encrypt_snapshot(snapshot, body.password)
    except EncryptedSyncError as exc:
        raise HTTPException(status_code=400, detail="Encryption failed — check password and data integrity") from exc

    return {"format": BLOB_FORMAT, "data": blob, "size_bytes": len(blob)}


@router.post("/import/encrypted")
async def import_encrypted(body: EncryptedImportRequest, request: Request):
    """Import previously encrypted export blob.

    Requires the same confirm code as plaintext write import, because the
    underlying path rewrites event_log (drops append-only triggers, clears,
    reinserts). Password is read from the request body. AUTH_TOKEN is required
    only when configured.
    """
    _require_auth_when_configured(request, "Encrypted import")
    if body.confirm != IMPORT_CONFIRM:
        raise HTTPException(
            status_code=400,
            detail=f"Set confirm='{IMPORT_CONFIRM}' for encrypted write import",
        )

    from app.product.encrypted_sync import EncryptedSyncError, decrypt_snapshot

    try:
        snapshot = await decrypt_snapshot(body.data, body.password)
    except EncryptedSyncError as exc:
        raise HTTPException(status_code=400, detail="Decryption failed — check password and data integrity") from exc

    settings_blob = snapshot.pop("app_settings", None) if isinstance(snapshot, dict) else None
    result = await asyncio.to_thread(kernel.restore, snapshot, read_only=False)
    settings_restored = await asyncio.to_thread(_apply_imported_settings, settings_blob)
    return {
        "status": "ok",
        "events_imported": result.get("events_imported", 0),
        "settings_restored": settings_restored,
    }


# --- Demo endpoint (Model Continuity Demo) ---

@router.get("/demo/model-continuity")
async def model_continuity_demo():
    """Return current model & memory stats for the model-switch demo."""
    counts = kernel.table_counts(("memories", "event_log"))
    return {
        "model": settings.llm_model,
        "base_url": settings.llm_base_url,
        "total_memories": counts.get("memories", 0),
        "total_events": counts.get("event_log", 0),
        "message": "你的记忆已安全存储。切换到任何模型，记忆都不会丢失。",
    }
