from __future__ import annotations

from pathlib import Path
from contextlib import contextmanager
from threading import Event, Thread
from typing import Callable, Iterator
import time

from fastapi import HTTPException, Request
from starlette.responses import JSONResponse, StreamingResponse

from services.account_service import account_service
from services.auth_audit_service import auth_audit_service, key_hint, source_hint
from services.auth_service import auth_service
from services.config import config
from services.log_service import LOG_TYPE_ACCOUNT, log_service
from services.system_status_service import worker_error, worker_heartbeat, worker_started, worker_stopped
from services.usage_limit_service import UsageLimitError, usage_limit_service

BASE_DIR = Path(__file__).resolve().parents[1]
WEB_DIST_DIR = BASE_DIR / "web_dist"
REFRESH_ALL_ACCOUNTS_LOG_TITLE = "一键刷新所有账号信息和额度"


def extract_bearer_token(authorization: str | None) -> str:
    scheme, _, value = str(authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return ""
    return value.strip()


def _legacy_admin_identity(token: str) -> dict[str, object] | None:
    auth_key = str(config.auth_key or "").strip()
    if auth_key and token == auth_key:
        return {"id": "admin", "name": "管理员", "role": "admin"}
    return None


def require_identity(
    authorization: str | None,
    *,
    source: str = "",
    interface: str = "api",
    subject_role: str = "identity",
) -> dict[str, object]:
    token = extract_bearer_token(authorization)
    auth_source = source_hint(token, source)
    blocked, retry_after = auth_audit_service.is_blocked(auth_source)
    if blocked:
        raise HTTPException(
            status_code=429,
            detail={"error": "认证失败次数过多，请稍后再试"},
            headers={"Retry-After": str(retry_after)},
        )
    identity = _legacy_admin_identity(token) or auth_service.authenticate(token) or auth_service.authenticate_session_token(token)
    if identity is None:
        reason = "missing_bearer_token" if not token else "invalid_or_disabled_key"
        blocked, retry_after = auth_audit_service.record_failure(
            source=auth_source,
            interface=interface,
            subject_role=subject_role,
            reason=reason,
            key_hint=key_hint(token),
        )
        if blocked:
            raise HTTPException(
                status_code=429,
                detail={"error": "认证失败次数过多，请稍后再试"},
                headers={"Retry-After": str(retry_after)},
            )
        raise HTTPException(status_code=401, detail={"error": "密钥无效或已失效，请重新登录"})
    auth_audit_service.clear_failures(auth_source)
    return identity


def require_auth_key(authorization: str | None) -> None:
    require_identity(authorization)


def require_admin(authorization: str | None, *, source: str = "", interface: str = "management") -> dict[str, object]:
    identity = require_identity(authorization, source=source, interface=interface, subject_role="admin")
    if identity.get("role") != "admin":
        token = extract_bearer_token(authorization)
        auth_audit_service.record_failure(
            source=source_hint(token, source),
            interface=interface,
            subject_role="admin",
            reason="admin_required",
            key_hint=key_hint(token),
        )
        raise HTTPException(status_code=403, detail={"error": "需要管理员权限才能执行这个操作"})
    return identity


def openai_error_detail(
    message: str,
    *,
    type: str = "invalid_request_error",
    param: str | None = None,
    code: str | None = None,
) -> dict[str, dict[str, str | None]]:
    return {
        "error": {
            "message": str(message),
            "type": type,
            "param": param,
            "code": code,
        }
    }


def openai_error_response(
    message: str,
    *,
    status_code: int = 400,
    type: str = "invalid_request_error",
    param: str | None = None,
    code: str | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=openai_error_detail(message, type=type, param=param, code=code),
        headers=headers,
    )


def openai_http_exception(
    message: str,
    *,
    status_code: int = 400,
    type: str = "invalid_request_error",
    param: str | None = None,
    code: str | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=openai_error_detail(message, type=type, param=param, code=code),
    )


def openai_usage_limit_exception(exc: UsageLimitError) -> HTTPException:
    error_type = "permission_error" if exc.status_code == 403 else "rate_limit_error"
    error_code = "model_not_allowed" if exc.status_code == 403 else "usage_limit_exceeded"
    return openai_http_exception(
        str(exc),
        status_code=exc.status_code,
        type=error_type,
        code=error_code,
    )


def openai_response_from_http_exception(exc: Exception) -> JSONResponse:
    status_code = int(getattr(exc, "status_code", 500) or 500)
    detail = getattr(exc, "detail", str(exc))
    headers = getattr(exc, "headers", None)
    if isinstance(detail, dict):
        error = detail.get("error")
        if isinstance(error, dict):
            return JSONResponse(status_code=status_code, content=detail, headers=headers)
        if error is not None:
            return openai_error_response(str(error), status_code=status_code, type=_openai_error_type(status_code), headers=headers)
    return openai_error_response(str(detail), status_code=status_code, type=_openai_error_type(status_code), headers=headers)


def _openai_error_type(status_code: int) -> str:
    if status_code == 401:
        return "authentication_error"
    if status_code == 403:
        return "permission_error"
    if status_code == 429:
        return "rate_limit_error"
    if status_code >= 500:
        return "server_error"
    return "invalid_request_error"


def _raise_usage_limit(exc: UsageLimitError) -> None:
    raise openai_usage_limit_exception(exc) from exc


@contextmanager
def enforce_usage_limits(identity: dict[str, object], endpoint: str, model: str, kind: str) -> Iterator[None]:
    try:
        with usage_limit_service.reserve(identity, model=model, kind=kind):
            yield
    except UsageLimitError as exc:
        _raise_usage_limit(exc)


async def _release_after_stream(body_iterator, release: Callable[[], None]) -> Iterator[object]:
    try:
        async for chunk in body_iterator:
            yield chunk
    finally:
        release()


@contextmanager
def usage_limited_call(identity: dict[str, object], endpoint: str, model: str, kind: str) -> Iterator[Callable[[], None]]:
    try:
        limiter = usage_limit_service.reserve(identity, model=model, kind=kind)
        limiter.__enter__()
    except UsageLimitError as exc:
        _raise_usage_limit(exc)

    released = False

    def release() -> None:
        nonlocal released
        if released:
            return
        released = True
        limiter.__exit__(None, None, None)

    try:
        yield release
    except Exception:
        release()
        raise


def release_usage_limit_after_response(response, release):
    if isinstance(response, StreamingResponse):
        response.body_iterator = _release_after_stream(response.body_iterator, release)
        return response
    release()
    return response


def resolve_image_base_url(request: Request) -> str:
    return config.base_url or f"{request.url.scheme}://{request.headers.get('host', request.url.netloc)}"


def raise_image_quota_error(exc: Exception) -> None:
    message = str(exc)
    if "no available image quota" in message.lower():
        raise openai_http_exception(
            "no available image quota",
            status_code=429,
            type="insufficient_quota",
            code="insufficient_quota",
        ) from exc
    raise openai_http_exception(message, status_code=502, type="server_error", code="upstream_error") from exc


def sanitize_cpa_pool(pool: dict | None) -> dict | None:
    if not isinstance(pool, dict):
        return None
    return {key: value for key, value in pool.items() if key != "secret_key"}


def sanitize_cpa_pools(pools: list[dict]) -> list[dict]:
    return [sanitized for pool in pools if (sanitized := sanitize_cpa_pool(pool)) is not None]


def sanitize_sub2api_server(server: dict | None) -> dict | None:
    if not isinstance(server, dict):
        return None
    sanitized = {key: value for key, value in server.items() if key not in {"password", "api_key"}}
    sanitized["has_api_key"] = bool(str(server.get("api_key") or "").strip())
    return sanitized


def sanitize_sub2api_servers(servers: list[dict]) -> list[dict]:
    return [sanitized for server in servers if (sanitized := sanitize_sub2api_server(server)) is not None]


def start_limited_account_watcher(stop_event: Event) -> Thread:
    interval_seconds = config.refresh_account_interval_minute * 60
    worker_name = "limited-account-watcher"

    def worker() -> None:
        worker_started(worker_name)
        try:
            while not stop_event.is_set():
                worker_heartbeat(worker_name)
                try:
                    limited_tokens = account_service.list_limited_tokens(
                        due_only=True,
                        limit=account_service.limited_refresh_batch_size(),
                    )
                    if limited_tokens:
                        print(f"[account-limited-watcher] checking {len(limited_tokens)} limited accounts")
                        account_service.refresh_accounts(limited_tokens)
                except Exception as exc:
                    worker_error(worker_name, exc)
                    print(f"[account-limited-watcher] fail {exc}")
                stop_event.wait(interval_seconds)
        except Exception as exc:
            worker_stopped(worker_name, exc)
            raise
        finally:
            if stop_event.is_set():
                worker_stopped(worker_name)

    thread = Thread(target=worker, name=worker_name, daemon=True)
    thread.start()
    return thread


def _add_account_log(summary: str, detail: dict) -> None:
    try:
        log_service.add(LOG_TYPE_ACCOUNT, summary, detail)
    except Exception:
        pass


def refresh_all_accounts_for_watcher(account_pool=None) -> dict[str, object]:
    if account_pool is None:
        from services.account_service import account_service as account_pool
    tokens = account_pool.list_tokens()
    if not tokens:
        list_accounts = getattr(account_pool, "list_accounts", None)
        return {
            "refreshed": 0,
            "errors": [],
            "items": list_accounts() if callable(list_accounts) else [],
        }
    return account_pool.refresh_accounts(tokens, REFRESH_ALL_ACCOUNTS_LOG_TITLE)


def _account_pool_total_count(account_pool) -> int:
    list_tokens = getattr(account_pool, "list_tokens", None)
    if callable(list_tokens):
        try:
            return len(list_tokens())
        except Exception:
            pass
    list_accounts = getattr(account_pool, "list_accounts", None)
    if callable(list_accounts):
        try:
            return len(list_accounts())
        except Exception:
            pass
    return 0


def run_auto_register_check(
    last_triggered_at: float = 0.0,
    *,
    now: float | None = None,
    account_pool=None,
    registrar=None,
) -> tuple[float, bool]:
    settings = config.get_auto_register_settings()
    if not settings.get("enabled"):
        return last_triggered_at, False

    if account_pool is None:
        from services.account_service import account_service as account_pool
    if registrar is None:
        from services.register_service import register_service as registrar

    min_available = int(settings.get("min_available") or 50)
    target_available = int(settings.get("target_available") or min_available)
    try:
        pool_settings = config.get_account_pool_settings()
    except AttributeError:
        pool_settings = {}
    max_total_accounts = int(pool_settings.get("max_total_accounts") or target_available)
    min_available = min(min_available, target_available, max_total_accounts)
    register_state = registrar.get()
    current_time = time.time() if now is None else now
    available = int(account_pool.available_account_count())
    total_accounts = _account_pool_total_count(account_pool)
    detail = {
        "available": available,
        "total_accounts": total_accounts,
        "min_available": min_available,
        "target_available": target_available,
        "max_total_accounts": max_total_accounts,
        "check_interval_seconds": int(settings.get("check_interval_seconds") or 30),
        "cooldown_seconds": int(settings.get("cooldown_seconds") or 300),
        "refresh": {"refreshed": 0, "errors": 0},
        "triggered": False,
        "reason": "",
    }
    refresh_result = refresh_all_accounts_for_watcher(account_pool)
    available = int(account_pool.available_account_count())
    total_accounts = _account_pool_total_count(account_pool)
    detail.update({
        "available": available,
        "total_accounts": total_accounts,
        "refresh": {
            "refreshed": int(refresh_result.get("refreshed") or 0) if isinstance(refresh_result, dict) else 0,
            "errors": len(refresh_result.get("errors") or []) if isinstance(refresh_result, dict) else 0,
        },
    })
    if total_accounts >= max_total_accounts:
        detail["reason"] = "account_limit_reached"
        _add_account_log("图片健康号池巡检", detail)
        return last_triggered_at, False

    if available >= min_available:
        detail["reason"] = "enough_available_accounts"
        _add_account_log("图片健康号池巡检", detail)
        return last_triggered_at, False
    if register_state.get("enabled"):
        detail["reason"] = "register_already_running"
        _add_account_log("图片健康号池巡检", detail)
        return last_triggered_at, False

    cooldown_seconds = int(settings.get("cooldown_seconds") or 300)
    if last_triggered_at and current_time - last_triggered_at < cooldown_seconds:
        detail["reason"] = "cooldown"
        detail["last_triggered_at"] = last_triggered_at
        _add_account_log("图片健康号池巡检", detail)
        return last_triggered_at, False

    print(f"[auto-register-watcher] available={available}, target={target_available}, max_total={max_total_accounts}, starting register")
    total = max(1, max_total_accounts - total_accounts)
    registrar.update({
        "mode": "available",
        "target_available": max_total_accounts,
        "total": total,
    })
    registrar.start()
    detail["triggered"] = True
    detail["reason"] = "below_min_available"
    detail["total"] = total
    _add_account_log("图片健康号池巡检触发补池", detail)
    return current_time, True


def start_auto_register_watcher(stop_event: Event) -> Thread:
    last_triggered_at = 0.0
    worker_name = "auto-register-watcher"

    def worker() -> None:
        nonlocal last_triggered_at
        worker_started(worker_name)
        try:
            while not stop_event.is_set():
                worker_heartbeat(worker_name)
                try:
                    settings = config.get_auto_register_settings()
                    interval_seconds = int(settings.get("check_interval_seconds") or 30)
                    last_triggered_at, _triggered = run_auto_register_check(last_triggered_at)
                except Exception as exc:
                    worker_error(worker_name, exc)
                    print(f"[auto-register-watcher] fail {exc}")
                    _add_account_log("图片健康号池巡检失败", {"error": str(exc), "triggered": False})
                    interval_seconds = int(config.get_auto_register_settings().get("check_interval_seconds") or 30)
                stop_event.wait(interval_seconds)
        except Exception as exc:
            worker_stopped(worker_name, exc)
            raise
        finally:
            if stop_event.is_set():
                worker_stopped(worker_name)

    thread = Thread(target=worker, name=worker_name, daemon=True)
    thread.start()
    return thread


def resolve_web_asset(requested_path: str) -> Path | None:
    if not WEB_DIST_DIR.exists():
        return None
    clean_path = requested_path.strip("/")
    base_dir = WEB_DIST_DIR.resolve()
    candidates = [base_dir / "index.html"] if not clean_path else [
        base_dir / Path(clean_path),
        base_dir / clean_path / "index.html",
        base_dir / f"{clean_path}.html",
    ]
    for candidate in candidates:
        try:
            candidate.resolve().relative_to(base_dir)
        except ValueError:
            continue
        if candidate.is_file():
            return candidate
    return None
