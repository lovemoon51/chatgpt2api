from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from api.support import extract_bearer_token, require_admin, require_identity, resolve_image_base_url
from services.account_service import account_service
from services.auth_audit_service import auth_audit_service, key_hint, source_hint
from services.backup_service import BackupError, backup_service
from services.config import config
from services.image_service import (
    delete_images,
    download_images_zip,
    get_image_download_response,
    get_thumbnail_response,
    list_images,
    list_public_discover_images,
)
from services.image_tags_service import delete_tag, get_all_tags, set_tags
from services.log_service import log_service
from services.proxy_service import test_proxy
from services.auth_service import auth_service
from services.register_service import register_service
from services.signed_url_service import verify_signed_url
from services.system_status_service import dashboard_payload, healthz_payload, livez_payload, readyz_payload


class AIReviewSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    prompt: str | None = None


class BackupIncludeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    config: bool | None = None
    register_: bool | None = Field(default=None, alias="register")
    cpa: bool | None = None
    sub2api: bool | None = None
    logs: bool | None = None
    image_tasks: bool | None = None
    accounts_snapshot: bool | None = None
    auth_keys_snapshot: bool | None = None
    images: bool | None = None


class BackupSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool | None = None
    provider: str | None = None
    account_id: str | None = None
    access_key_id: str | None = None
    secret_access_key: str | None = None
    bucket: str | None = None
    prefix: str | None = None
    interval_minutes: int | str | None = None
    rotation_keep: int | str | None = None
    encrypt: bool | None = None
    passphrase: str | None = None
    include: BackupIncludeRequest | None = None


class AutoRegisterSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool | None = None
    min_available: int | str | None = None
    target_available: int | str | None = None
    check_interval_seconds: int | str | None = None
    cooldown_seconds: int | str | None = None


class AccountPoolSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    max_total_accounts: int | str | None = None


class AuthSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    username_login_enabled: bool | None = None


class SettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    proxy: str | None = None
    base_url: str | None = None
    global_system_prompt: str | None = None
    sensitive_words: list[str] | None = None
    ai_review: AIReviewSettingsRequest | None = None
    refresh_account_interval_minute: int | str | None = None
    image_retention_days: int | str | None = None
    image_poll_timeout_secs: int | str | None = None
    image_account_concurrency: int | str | None = None
    auto_remove_invalid_accounts: bool | None = None
    auto_remove_rate_limited_accounts: bool | None = None
    log_levels: list[str] | None = None
    backup: BackupSettingsRequest | None = None
    auto_register: AutoRegisterSettingsRequest | None = None
    account_pool: AccountPoolSettingsRequest | None = None
    auth: AuthSettingsRequest | None = None


class ProxyTestRequest(BaseModel):
    url: str = ""


class LoginRequest(BaseModel):
    login: str = ""


class ImageDeleteRequest(BaseModel):
    paths: list[str] = []
    start_date: str = ""
    end_date: str = ""
    all_matching: bool = False

class ImageDownloadRequest(BaseModel):
    paths: list[str]

class ImageTagsRequest(BaseModel):
    path: str
    tags: list[str]

class LogDeleteRequest(BaseModel):
    ids: list[str] = []
class BackupDeleteRequest(BaseModel):
    key: str = ""


AUDITED_SETTING_FIELDS = {
    "proxy",
    "base_url",
    "global_system_prompt",
    "sensitive_words",
    "ai_review.enabled",
    "ai_review.base_url",
    "ai_review.api_key",
    "ai_review.model",
    "ai_review.prompt",
    "auto_remove_invalid_accounts",
    "auto_remove_rate_limited_accounts",
    "backup.enabled",
    "backup.account_id",
    "backup.access_key_id",
    "backup.secret_access_key",
    "backup.bucket",
    "backup.prefix",
    "backup.encrypt",
    "backup.passphrase",
    "auto_register.enabled",
    "auto_register.min_available",
    "auto_register.target_available",
    "account_pool.max_total_accounts",
    "auth.username_login_enabled",
}

SECRET_SETTING_FIELDS = {
    "ai_review.api_key",
    "backup.secret_access_key",
    "backup.passphrase",
}


def _flatten_settings(value: object, prefix: str = "") -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    flattened: dict[str, object] = {}
    for key, item in value.items():
        path = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(item, dict):
            flattened.update(_flatten_settings(item, path))
        else:
            flattened[path] = item
    return flattened


def _audit_setting_changes(before: dict[str, object], after: dict[str, object], authorization: str | None) -> None:
    before_flat = _flatten_settings(before)
    after_flat = _flatten_settings(after)
    changed: list[dict[str, object]] = []
    for field in sorted(AUDITED_SETTING_FIELDS):
        if before_flat.get(field) == after_flat.get(field):
            continue
        item: dict[str, object] = {"field": field}
        if field in SECRET_SETTING_FIELDS:
            item["secret_changed"] = True
        else:
            item["before"] = before_flat.get(field)
            item["after"] = after_flat.get(field)
        changed.append(item)
    if not changed:
        return
    token = extract_bearer_token(authorization)
    auth_audit_service.record_event(
        source=source_hint(token),
        interface="management",
        subject_role="admin",
        reason="settings_changed",
        key_hint=key_hint(token),
        detail={"changes": changed},
    )


def _image_task_service():
    from services.image_task_service import image_task_service

    return image_task_service


def create_router(app_version: str) -> APIRouter:
    router = APIRouter()

    @router.post("/auth/login")
    async def login(body: LoginRequest | None = None, authorization: str | None = Header(default=None)):
        login_value = str(body.login if body else "").strip()
        bearer_token = extract_bearer_token(authorization)
        if login_value:
            identity = None
            if login_value == str(config.auth_key or "").strip():
                identity = {"id": "admin", "name": "管理员", "role": "admin"}
            if identity is None:
                identity = auth_service.authenticate(login_value)
            if identity is None:
                identity = auth_service.authenticate_session_token(login_value)
            if identity is None and bool(config.get_auth_settings().get("username_login_enabled")):
                identity = auth_service.authenticate_user_name(login_value)
            if identity is None:
                raise HTTPException(status_code=401, detail={"error": "密钥或用户名称无效，请重新输入"})
        else:
            identity = require_identity(authorization)
        credential = bearer_token or login_value
        access_token = credential
        if identity.get("role") == "user":
            access_token = auth_service.create_session_token(identity)
        payload = {
            "ok": True,
            "version": app_version,
            "role": identity.get("role"),
            "subject_id": identity.get("id"),
            "name": identity.get("name"),
            "access_token": access_token,
        }
        if identity.get("role") == "user":
            payload["limits"] = identity.get("limits") or {}
        return payload

    @router.get("/version")
    async def get_version():
        return {"version": app_version}

    @router.get("/livez")
    async def livez():
        return livez_payload(app_version)

    @router.get("/readyz")
    async def readyz():
        payload = readyz_payload(
            app_version,
            config,
            backup_service=backup_service,
            image_task_service=_image_task_service(),
        )
        if payload["status"] == "unhealthy":
            return JSONResponse(content=payload, status_code=503)
        return payload

    @router.get("/healthz")
    async def healthz():
        payload = healthz_payload(app_version, config)
        if not payload["storage"]["ok"]:
            return JSONResponse(content=payload, status_code=503)
        return payload

    @router.get("/api/dashboard")
    async def get_dashboard(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return dashboard_payload(
            app_version=app_version,
            account_service=account_service,
            log_service=log_service,
            backup_service=backup_service,
            config=config,
            image_task_service=_image_task_service(),
            register_service=register_service,
        )

    @router.get("/api/settings")
    async def get_settings(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        diagnostics = config.diagnostics() if hasattr(config, "diagnostics") else {"items": []}
        return {"config": config.get(), "diagnostics": diagnostics}

    @router.post("/api/settings")
    async def save_settings(body: SettingsUpdateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        before = config.get()
        updates = body.model_dump(mode="python", exclude_unset=True, by_alias=True)
        updated = config.update(updates)
        _audit_setting_changes(before, updated, authorization)
        diagnostics = config.diagnostics() if hasattr(config, "diagnostics") else {"items": []}
        return {"config": updated, "diagnostics": diagnostics}

    @router.get("/api/images")
    async def get_images(
        request: Request,
        start_date: str = "",
        end_date: str = "",
        page: int = 1,
        page_size: int = 0,
        search: str = "",
        q: str = "",
        tag: str = "",
        tags: str = "",
        owner: str = "",
        mode: str = "",
        model: str = "",
        sort: str = "",
        order: str = "",
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        search_value = search.strip() or q.strip()
        tag_values = [
            item.strip()
            for item in ",".join(part for part in (tag, tags) if part).split(",")
            if item.strip()
        ]
        sort_value = sort.strip()
        order_value = order.strip().lower()
        if sort_value and not sort_value.startswith(("+", "-")) and order_value in {"asc", "desc"}:
            sort_value = f"+{sort_value}" if order_value == "asc" else f"-{sort_value}"
        return list_images(
            resolve_image_base_url(request),
            start_date=start_date.strip(),
            end_date=end_date.strip(),
            identity=identity,
            page=page,
            page_size=page_size,
            search=search_value,
            tag=",".join(dict.fromkeys(tag_values)),
            owner=owner.strip(),
            mode=mode.strip(),
            model=model.strip(),
            sort=sort_value,
        )

    @router.get("/api/public/discover/images")
    async def get_public_discover_images(request: Request, page: int = 1, page_size: int = 12):
        return list_public_discover_images(
            resolve_image_base_url(request),
            page=page,
            page_size=page_size,
        )

    @router.get("/image-thumbnails/{image_path:path}", include_in_schema=False)
    async def get_image_thumbnail(image_path: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        return get_thumbnail_response(image_path, identity)

    @router.get("/images/{image_path:path}", include_in_schema=False)
    async def get_protected_image(image_path: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        return get_image_download_response(image_path, identity)

    @router.get("/public-images/{image_path:path}", include_in_schema=False)
    async def get_public_image(image_path: str, expires: int = 0, signature: str = ""):
        """
        公开图片访问端点（带签名验证）

        允许通过签名 URL 临时访问图片，无需认证。
        签名和过期时间由后端生成，确保安全性。
        """
        if not signature or not expires:
            raise HTTPException(status_code=400, detail="missing signature or expires parameter")

        if not verify_signed_url(image_path, expires, signature):
            raise HTTPException(status_code=403, detail="invalid or expired signature")

        # 签名验证通过，返回图片（无需身份验证）
        return get_image_download_response(image_path, identity=None)

    @router.post("/api/images/delete")
    async def delete_images_endpoint(body: ImageDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return delete_images(body.paths, start_date=body.start_date.strip(), end_date=body.end_date.strip(), all_matching=body.all_matching)

    @router.post("/api/images/download")
    async def download_images_endpoint(body: ImageDownloadRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        buf = download_images_zip(body.paths)
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="images.zip"'},
        )

    @router.get("/api/images/download/{image_path:path}")
    async def download_single_image_endpoint(image_path: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        return get_image_download_response(image_path, identity)

    @router.get("/api/images/url/{image_path:path}")
    async def get_image_url_endpoint(image_path: str, request: Request, authorization: str | None = Header(default=None)):
        """
        获取图片的签名 URL

        返回包含原始 URL 和签名 URL 的 JSON 对象，
        前端可以优先使用签名 URL 进行快速访问。
        """
        from services.signed_url_service import generate_signed_image_url

        identity = require_identity(authorization)
        # 验证用户有权限访问这张图片
        from services.image_service import require_image_access
        require_image_access(identity, image_path)

        # 生成签名 URL
        base_url = resolve_image_base_url(request)
        signed_url = generate_signed_image_url(image_path, base_url, expires_in=3600)

        return {
            "url": f"/images/{image_path}",
            "signed_url": signed_url,
            "expires_in": 3600
        }

    @router.get("/api/logs")
    async def get_logs(type: str = "", start_date: str = "", end_date: str = "", authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"items": log_service.list(type=type.strip(), start_date=start_date.strip(), end_date=end_date.strip())}

    @router.post("/api/logs/delete")
    async def delete_logs(body: LogDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return log_service.delete(body.ids)

    @router.post("/api/proxy/test")
    async def test_proxy_endpoint(body: ProxyTestRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        candidate = (body.url or "").strip() or config.get_proxy_settings()
        if not candidate:
            raise HTTPException(status_code=400, detail={"error": "proxy url is required"})
        return {"result": await run_in_threadpool(test_proxy, candidate)}

    @router.get("/api/storage/info")
    async def get_storage_info(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        storage = config.get_storage_backend()
        return {
            "backend": storage.get_backend_info(),
            "health": storage.health_check(),
        }

    @router.post("/api/backup/test")
    async def test_backup_connection(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"result": await run_in_threadpool(backup_service.test_connection)}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/backups")
    async def get_backups(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {
                "items": await run_in_threadpool(backup_service.list_backups),
                "state": backup_service.get_status(),
                "settings": backup_service.get_settings(),
            }
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/backups/run")
    async def run_backup_endpoint(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"result": await run_in_threadpool(backup_service.run_backup)}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/backups/delete")
    async def delete_backup_endpoint(body: BackupDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            await run_in_threadpool(backup_service.delete_backup, body.key)
            return {"ok": True}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/backups/detail")
    async def get_backup_detail(key: str = "", authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"item": await run_in_threadpool(backup_service.get_backup_detail, key)}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/backups/verify")
    async def verify_backup_endpoint(body: BackupDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"report": await run_in_threadpool(backup_service.verify_backup, body.key)}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/backups/download")
    async def download_backup_endpoint(key: str = "", authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            item = await run_in_threadpool(backup_service.download_backup, key)
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        filename = str(item.get("name") or "backup.bin")
        quoted = quote(filename)
        headers = {
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
            "Content-Length": str(int(item.get("size") or 0)),
        }
        return Response(
            content=bytes(item.get("payload") or b""),
            media_type=str(item.get("content_type") or "application/octet-stream"),
            headers=headers,
        )


    @router.get("/api/images/tags")
    async def list_image_tags(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"tags": get_all_tags()}

    @router.post("/api/images/tags")
    async def update_image_tags(body: ImageTagsRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        rel = body.path.strip().lstrip("/")
        if not rel:
            raise HTTPException(status_code=400, detail={"error": "path is required"})
        tags = set_tags(rel, body.tags)
        return {"ok": True, "tags": tags}

    @router.delete("/api/images/tags/{tag}")
    async def delete_image_tag(tag: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        count = delete_tag(tag)
        return {"ok": True, "removed_from": count}

    return router
