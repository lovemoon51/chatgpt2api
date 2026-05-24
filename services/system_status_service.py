from __future__ import annotations

import tempfile
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from services.config import CONFIG_FILE, DATA_DIR
from services.log_service import LOG_TYPE_CALL, LOG_TYPE_TEXT


UNAVAILABLE_STATUSES = {"禁用", "限流", "异常"}
IMAGE_ENDPOINTS = {
    "/v1/images/generations",
    "/v1/images/edits",
    "/api/image-tasks/generations",
    "/api/image-tasks/edits",
}
BACKGROUND_WORKERS = {
    "limited-account-watcher",
    "auto-register-watcher",
    "backup",
}

_WORKER_LOCK = threading.RLock()
_WORKERS: dict[str, dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def _worker_entry(name: str) -> dict[str, Any]:
    clean_name = str(name or "").strip()
    if not clean_name:
        clean_name = "unknown"
    current = _WORKERS.get(clean_name)
    if current is None:
        current = {
            "name": clean_name,
            "running": False,
            "started_at": None,
            "last_heartbeat": None,
            "last_error": None,
        }
        _WORKERS[clean_name] = current
    return current


def worker_started(name: str) -> None:
    now = _now_iso()
    with _WORKER_LOCK:
        entry = _worker_entry(name)
        entry.update({
            "running": True,
            "started_at": entry.get("started_at") or now,
            "last_heartbeat": now,
        })


def worker_heartbeat(name: str) -> None:
    with _WORKER_LOCK:
        entry = _worker_entry(name)
        entry["running"] = True
        entry["last_heartbeat"] = _now_iso()


def worker_error(name: str, exc: BaseException | str) -> None:
    with _WORKER_LOCK:
        entry = _worker_entry(name)
        entry["running"] = True
        entry["last_heartbeat"] = _now_iso()
        entry["last_error"] = (str(exc) or exc.__class__.__name__) if isinstance(exc, BaseException) else str(exc)


def worker_stopped(name: str, exc: BaseException | str | None = None) -> None:
    with _WORKER_LOCK:
        entry = _worker_entry(name)
        entry["running"] = False
        entry["last_heartbeat"] = _now_iso()
        if exc is not None:
            entry["last_error"] = (str(exc) or exc.__class__.__name__) if isinstance(exc, BaseException) else str(exc)


def get_registered_worker_statuses() -> list[dict[str, Any]]:
    with _WORKER_LOCK:
        return [dict(item) for item in sorted(_WORKERS.values(), key=lambda value: str(value.get("name") or ""))]


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


def _writable_check(path: Path, label: str) -> dict[str, Any]:
    try:
        path.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(prefix=".health-", dir=path, delete=True) as handle:
            handle.write(b"ok")
            handle.flush()
        return {"ok": True, "path": str(path), "label": label}
    except Exception as exc:
        return {"ok": False, "path": str(path), "label": label, "error": str(exc)}


def writable_health() -> dict[str, Any]:
    checks = {
        "data_dir": _writable_check(DATA_DIR, "data_dir"),
        "config_dir": _writable_check(CONFIG_FILE.parent, "config_dir"),
    }
    return {
        "ok": all(bool(item.get("ok")) for item in checks.values()),
        "checks": checks,
    }


def livez_payload(app_version: str) -> dict[str, Any]:
    return {
        "status": "ok",
        "version": app_version,
    }


def healthz_payload(app_version: str, config: Any) -> dict[str, Any]:
    storage = storage_health(config)
    return {
        "status": "ok" if storage["ok"] else "degraded",
        "version": app_version,
        "storage": storage,
    }


def _status_by_name(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(item.get("name") or ""): item for item in items if str(item.get("name") or "")}


def background_worker_health(*, backup_service: Any | None = None, image_task_service: Any | None = None) -> dict[str, Any]:
    items = get_registered_worker_statuses()
    if backup_service is not None:
        get_worker_status = getattr(backup_service, "get_worker_status", None)
        if callable(get_worker_status):
            items.append(get_worker_status())
    if image_task_service is not None:
        get_worker_statuses = getattr(image_task_service, "get_worker_statuses", None)
        if callable(get_worker_statuses):
            items.extend(get_worker_statuses())

    by_name = _status_by_name(items)
    expected = set(BACKGROUND_WORKERS)
    if image_task_service is not None:
        expected.update(
            str(item.get("name") or "")
            for item in by_name.values()
            if str(item.get("name") or "").startswith("image-task-worker-")
        )
    missing = sorted(name for name in expected if name not in by_name)
    stopped = sorted(name for name, item in by_name.items() if name in expected and not bool(item.get("running")))
    errors = [
        {"name": name, "error": item.get("last_error")}
        for name, item in sorted(by_name.items())
        if name in expected and item.get("last_error")
    ]
    return {
        "ok": not missing and not stopped,
        "status": "unhealthy" if missing or stopped else "degraded" if errors else "ok",
        "items": sorted(by_name.values(), key=lambda item: str(item.get("name") or "")),
        "missing": missing,
        "stopped": stopped,
        "errors": errors,
    }


def readyz_payload(
    app_version: str,
    config: Any,
    *,
    backup_service: Any | None = None,
    image_task_service: Any | None = None,
) -> dict[str, Any]:
    storage = storage_health(config)
    writable = writable_health()
    workers = background_worker_health(backup_service=backup_service, image_task_service=image_task_service)
    unhealthy = []
    if not storage.get("ok"):
        unhealthy.append("storage")
    if not writable.get("ok"):
        unhealthy.append("writable")
    if not workers.get("ok"):
        unhealthy.append("workers")
    status = "unhealthy" if unhealthy else "degraded" if workers.get("status") == "degraded" else "ok"
    return {
        "status": status,
        "version": app_version,
        "storage": storage,
        "writable": writable,
        "workers": workers,
        "unhealthy": unhealthy,
    }


def _is_available_account(account: dict[str, Any]) -> bool:
    return str(account.get("status") or "").strip() == "正常"


def _is_image_available_account(account: dict[str, Any]) -> bool:
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
    image_available = 0
    limited = 0
    error = 0
    disabled = 0

    for item in accounts:
        account = item if isinstance(item, dict) else {}
        status = str(account.get("status") or "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
        if _is_available_account(account):
            available += 1
        if _is_image_available_account(account):
            image_available += 1
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
        "image_available": image_available,
        "image_quota": {
            "total": None if quota_unknown else total_quota,
            "unknown": quota_unknown,
        },
    }


def _is_call_log(item: Any) -> bool:
    return isinstance(item, dict) and item.get("type") in {LOG_TYPE_CALL, LOG_TYPE_TEXT}


def _call_detail(item: dict[str, Any]) -> dict[str, Any]:
    detail = item.get("detail")
    return detail if isinstance(detail, dict) else {}


def _call_status(item: dict[str, Any]) -> str:
    return str(_call_detail(item).get("status") or "").lower()


def _call_endpoint(item: dict[str, Any]) -> str:
    return str(_call_detail(item).get("endpoint") or "")


def _is_image_call(item: dict[str, Any]) -> bool:
    endpoint = _call_endpoint(item)
    if endpoint in IMAGE_ENDPOINTS:
        return True
    summary = str(item.get("summary") or "")
    return summary.startswith(("文生图", "图生图"))


def _is_failed_call(item: dict[str, Any]) -> bool:
    return _call_status(item) == "failed"


def _classify_failure_reason(error: object) -> str:
    text = str(error or "").lower()
    if "usage_limit" in text or "rate limit" in text or "限流" in text:
        return "账号限流"
    if "checkout" in text:
        return "Checkout 阻断"
    if "no available image quota" in text or "无可用图片账号" in text:
        return "图片号池不足"
    if "timeout" in text or "timed out" in text:
        return "请求超时"
    if "401" in text or "invalid token" in text:
        return "认证或 Token 失效"
    return "上游调用失败"


def _failure_reasons(calls: list[dict[str, Any]], *, limit: int = 5) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for item in calls:
        if not _is_failed_call(item):
            continue
        detail = _call_detail(item)
        endpoint = _call_endpoint(item) or "unknown"
        reason = _classify_failure_reason(detail.get("error"))
        key = (reason, endpoint)
        current = grouped.get(key)
        if current is None:
            grouped[key] = {
                "reason": reason,
                "endpoint": endpoint,
                "count": 1,
                "last_at": item.get("time"),
            }
            continue
        current["count"] += 1
        if str(item.get("time") or "") > str(current.get("last_at") or ""):
            current["last_at"] = item.get("time")

    return sorted(
        grouped.values(),
        key=lambda entry: (int(entry.get("count") or 0), str(entry.get("last_at") or "")),
        reverse=True,
    )[:limit]


def _summarize_calls(calls: list[dict[str, Any]]) -> dict[str, Any]:
    success = 0
    failed = 0
    durations: list[int] = []
    last_at = None

    for item in calls:
        if last_at is None:
            last_at = item.get("time")
        detail = _call_detail(item)
        status = _call_status(item)
        if status == "failed":
            failed += 1
        elif status == "success" or status:
            success += 1
        duration = detail.get("duration_ms")
        try:
            durations.append(max(0, int(duration)))
        except (TypeError, ValueError):
            pass

    durations.sort()
    average_duration_ms = round(sum(durations) / len(durations), 2) if durations else None
    return {
        "total": len(calls),
        "success": success,
        "failed": failed,
        "average_duration_ms": average_duration_ms,
        "p90_duration_ms": _percentile(durations, 90),
        "p99_duration_ms": _percentile(durations, 99),
        "last_at": last_at,
    }


def _percentile(values: list[int], percentile: int) -> int | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    rank = (len(values) - 1) * max(0, min(100, percentile)) / 100
    lower = int(rank)
    upper = min(lower + 1, len(values) - 1)
    if lower == upper:
        return values[lower]
    fraction = rank - lower
    return round(values[lower] + (values[upper] - values[lower]) * fraction)


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
    summary["image"] = _summarize_calls([item for item in calls if _is_image_call(item)])
    summary["failure_reasons"] = _failure_reasons(calls)
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


def auto_register_summary(config: Any, *, account_service: Any | None = None, register_service: Any | None = None) -> dict[str, Any]:
    try:
        settings = config.get_auto_register_settings()
    except AttributeError:
        settings = {}
    try:
        pool_settings = config.get_account_pool_settings()
    except AttributeError:
        pool_settings = {}
    current_available = None
    current_accounts = None
    if account_service is not None:
        try:
            current_available = int(account_service.available_account_count())
        except Exception:
            current_available = None
        try:
            current_accounts = len(account_service.list_accounts())
        except Exception:
            current_accounts = None
    register_state: dict[str, Any] = {}
    if register_service is not None:
        try:
            raw_state = register_service.get()
            register_state = raw_state if isinstance(raw_state, dict) else {}
        except Exception as exc:
            register_state = {"stats": {"last_error": str(exc) or exc.__class__.__name__}}
    register_stats = register_state.get("stats") if isinstance(register_state.get("stats"), dict) else {}
    success = int(register_stats.get("success") or 0)
    fail = int(register_stats.get("fail") or 0)
    done = int(register_stats.get("done") or success + fail)
    running = int(register_stats.get("running") or 0)
    total = max(done, success + fail)
    failure_rate = (fail / total * 100) if total > 0 else 0.0
    return {
        "enabled": bool(settings.get("enabled")),
        "min_available": int(settings.get("min_available") or 50),
        "target_available": int(settings.get("target_available") or settings.get("min_available") or 50),
        "max_total_accounts": int(pool_settings.get("max_total_accounts") or settings.get("target_available") or 50),
        "check_interval_seconds": int(settings.get("check_interval_seconds") or 30),
        "cooldown_seconds": int(settings.get("cooldown_seconds") or 300),
        "current_available": current_available,
        "current_accounts": current_accounts,
        "running": running,
        "in_flight": running,
        "pending": running,
        "success": success,
        "failed": fail,
        "fail": fail,
        "done": done,
        "total": total,
        "failure_rate": round(failure_rate, 1),
        "last_error": register_stats.get("last_error"),
        "last_checked_at": register_stats.get("updated_at"),
    }


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value[:26], fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _failure_rate(calls: dict[str, Any]) -> float:
    total = int(calls.get("total") or 0)
    if total <= 0:
        return 0.0
    return int(calls.get("failed") or 0) / total


def dashboard_health(accounts: dict[str, Any], calls: dict[str, Any], backup: dict[str, Any], storage: dict[str, Any]) -> dict[str, Any]:
    critical: list[str] = []
    warnings: list[str] = []

    image_available_value = accounts.get("image_available")
    if image_available_value is None:
        image_available_value = accounts.get("available")
    image_available = int(image_available_value or 0)
    recent = calls.get("recent") if isinstance(calls.get("recent"), dict) else calls
    recent_total = int(recent.get("total") or 0)
    recent_failure_rate = _failure_rate(recent)

    if not storage.get("ok"):
        critical.append("存储健康检查失败")
    if image_available == 0:
        critical.append("当前无可用图片账号")
    if recent_total >= 5 and recent_failure_rate >= 0.3:
        critical.append(f"最近调用失败率 {recent_failure_rate:.0%}")
    if backup.get("enabled") and str(backup.get("last_status") or "").lower() in {"failed", "error"}:
        critical.append("最近一次备份失败")

    if 0 < image_available <= 3:
        warnings.append(f"可用图片账号偏低：{image_available} 个")
    if recent_total >= 5 and recent_failure_rate >= 0.1:
        warnings.append(f"最近调用失败率 {recent_failure_rate:.0%}")
    if backup.get("enabled"):
        last_finished = _parse_time(backup.get("last_finished_at"))
        if last_finished is None or datetime.now() - last_finished > timedelta(hours=24):
            warnings.append("备份已启用但 24 小时内没有成功完成记录")
    image_quota = accounts.get("image_quota") if isinstance(accounts.get("image_quota"), dict) else {}
    if image_quota.get("unknown"):
        warnings.append("存在图片额度未知账号")

    level = "critical" if critical else "warning" if warnings else "normal"
    reasons = (critical or warnings or ["系统运行正常"])[:4]
    return {
        "level": level,
        "reasons": reasons,
        "refreshed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def dashboard_payload(
    *,
    app_version: str,
    account_service: Any,
    log_service: Any,
    backup_service: Any,
    config: Any,
    image_task_service: Any | None = None,
    register_service: Any | None = None,
) -> dict[str, Any]:
    storage = storage_health(config)
    accounts = account_pool_summary(account_service)
    calls = recent_call_summary(log_service)
    backup = backup_summary(backup_service)
    auto_register = auto_register_summary(
        config,
        account_service=account_service,
        register_service=register_service,
    )
    workers = background_worker_health(backup_service=backup_service, image_task_service=image_task_service)
    image_tasks: dict[str, Any] = {}
    if image_task_service is not None:
        queue_overview = getattr(image_task_service, "queue_overview", None)
        if callable(queue_overview):
            try:
                image_tasks = queue_overview()
            except Exception as exc:
                image_tasks = {"error": str(exc) or exc.__class__.__name__}
    health = dashboard_health(accounts, calls, backup, storage)
    return {
        "status": "ok" if storage["ok"] else "degraded",
        "version": app_version,
        "accounts": accounts,
        "calls": calls,
        "backup": backup,
        "auto_register": auto_register,
        "image_tasks": image_tasks,
        "workers": workers,
        "storage": storage,
        "health": health,
    }
