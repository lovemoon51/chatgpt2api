from __future__ import annotations

from datetime import datetime
from typing import Any

from services.log_service import LOG_TYPE_CALL, LOG_TYPE_TEXT


UNAVAILABLE_STATUSES = {"禁用", "限流", "异常"}


def storage_health(config: Any) -> dict[str, Any]:
    storage = config.get_storage_backend()
    try:
        backend = storage.get_backend_info()
    except Exception as exc:
        backend = {"error": str(exc)}
    try:
        health = storage.health_check()
    except Exception as exc:
        health = {"status": "unhealthy", "error": str(exc)}
    health_status = str(health.get("status") or "").lower() if isinstance(health, dict) else ""
    return {
        "ok": health_status in {"healthy", "ok"},
        "backend": backend,
        "health": health if isinstance(health, dict) else {"status": "unknown"},
    }


def healthz_payload(app_version: str, config: Any) -> dict[str, Any]:
    storage = storage_health(config)
    return {
        "status": "ok" if storage["ok"] else "degraded",
        "version": app_version,
        "storage": storage,
    }


def _is_available_account(account: dict[str, Any]) -> bool:
    if str(account.get("image_blocked_reason") or "").strip():
        return False
    if account.get("status") in UNAVAILABLE_STATUSES:
        return False
    if bool(account.get("image_quota_unknown")):
        return True
    try:
        return int(account.get("quota") or 0) > 0
    except (TypeError, ValueError):
        return False


def account_pool_summary(account_service: Any) -> dict[str, Any]:
    accounts = account_service.list_accounts()
    total_quota = 0
    quota_unknown = False
    status_counts: dict[str, int] = {}
    available = 0
    limited = 0
    error = 0
    disabled = 0

    for item in accounts:
        account = item if isinstance(item, dict) else {}
        status = str(account.get("status") or "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
        if _is_available_account(account):
            available += 1
        if status == "限流":
            limited += 1
        elif status == "异常":
            error += 1
        elif status == "禁用":
            disabled += 1
        if bool(account.get("image_quota_unknown")):
            quota_unknown = True
        else:
            try:
                total_quota += max(0, int(account.get("quota") or 0))
            except (TypeError, ValueError):
                pass

    return {
        "total": len(accounts),
        "available": available,
        "limited": limited,
        "error": error,
        "disabled": disabled,
        "unavailable": limited + error + disabled,
        "status_counts": status_counts,
        "image_quota": {
            "total": None if quota_unknown else total_quota,
            "unknown": quota_unknown,
        },
    }


def _is_call_log(item: Any) -> bool:
    return isinstance(item, dict) and item.get("type") in {LOG_TYPE_CALL, LOG_TYPE_TEXT}


def _summarize_calls(calls: list[dict[str, Any]]) -> dict[str, Any]:
    success = 0
    failed = 0
    durations: list[int] = []
    last_at = None

    for item in calls:
        if last_at is None:
            last_at = item.get("time")
        detail = item.get("detail")
        detail = detail if isinstance(detail, dict) else {}
        status = str(detail.get("status") or "").lower()
        if status == "failed":
            failed += 1
        elif status == "success" or status:
            success += 1
        duration = detail.get("duration_ms")
        try:
            durations.append(max(0, int(duration)))
        except (TypeError, ValueError):
            pass

    average_duration_ms = round(sum(durations) / len(durations), 2) if durations else None
    return {
        "total": len(calls),
        "success": success,
        "failed": failed,
        "average_duration_ms": average_duration_ms,
        "last_at": last_at,
    }


def _log_day(item: dict[str, Any]) -> str:
    return str(item.get("time") or "")[:10]


def recent_call_summary(log_service: Any, *, limit: int = 200) -> dict[str, Any]:
    logs = log_service.list(limit=limit)
    calls = [item for item in logs if _is_call_log(item)]
    today = datetime.now().strftime("%Y-%m-%d")
    summary = _summarize_calls(calls)
    summary["window"] = {"last_logs": limit}
    summary["today"] = _summarize_calls([item for item in calls if _log_day(item) == today])
    summary["recent"] = _summarize_calls(calls)
    return summary


def backup_summary(backup_service: Any) -> dict[str, Any]:
    state = backup_service.get_status()
    settings = backup_service.get_settings()
    try:
        configured = bool(backup_service.is_configured())
    except AttributeError:
        configured = bool(settings.get("enabled"))
    return {
        "configured": configured,
        "enabled": bool(settings.get("enabled")),
        "provider": settings.get("provider"),
        "running": bool(state.get("running")),
        "last_status": state.get("last_status"),
        "last_started_at": state.get("last_started_at"),
        "last_finished_at": state.get("last_finished_at"),
        "last_error": state.get("last_error"),
        "last_object_key": state.get("last_object_key"),
    }


def dashboard_payload(
    *,
    app_version: str,
    account_service: Any,
    log_service: Any,
    backup_service: Any,
    config: Any,
) -> dict[str, Any]:
    storage = storage_health(config)
    return {
        "status": "ok" if storage["ok"] else "degraded",
        "version": app_version,
        "accounts": account_pool_summary(account_service),
        "calls": recent_call_summary(log_service),
        "backup": backup_summary(backup_service),
        "storage": storage,
    }
