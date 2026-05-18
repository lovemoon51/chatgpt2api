from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.support import require_admin
from services.clash_party_service import ClashPartyError, list_proxy_groups, select_proxy
from services.register_service import register_service


class RegisterConfigRequest(BaseModel):
    mail: dict | None = None
    proxy: str | None = None
    clash: dict | None = None
    total: int | None = None
    threads: int | None = None
    mode: str | None = None
    target_quota: int | None = None
    target_available: int | None = None
    check_interval: int | None = None


class RegisterClashOptionsRequest(BaseModel):
    clash: dict | None = None


class RegisterClashSelectRequest(BaseModel):
    clash: dict | None = None
    group: str
    proxy: str


def create_router() -> APIRouter:
    router = APIRouter()

    def resolve_clash_settings(clash: dict | None) -> dict:
        current = register_service.get()
        current_clash = current.get("clash") if isinstance(current.get("clash"), dict) else {}
        next_clash = {**current_clash, **(clash if isinstance(clash, dict) else {})}
        return next_clash

    @router.get("/api/register")
    async def get_register_config(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"register": register_service.get()}

    @router.post("/api/register")
    async def update_register_config(body: RegisterConfigRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"register": register_service.update(body.model_dump(exclude_none=True))}

    @router.post("/api/register/clash/options")
    async def get_register_clash_options(body: RegisterClashOptionsRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"clash": list_proxy_groups(resolve_clash_settings(body.clash))}
        except ClashPartyError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/register/clash/select")
    async def select_register_clash_proxy(body: RegisterClashSelectRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        settings = resolve_clash_settings(body.clash)
        settings["group"] = body.group
        try:
            selection = select_proxy(settings, body.group, body.proxy)
        except ClashPartyError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        next_clash = {
            **settings,
            "enabled": True,
            "group": str(selection.get("group") or body.group),
            "selected_proxy": str(selection.get("active_proxy") or selection.get("proxy") or body.proxy),
            "proxy": str(selection.get("proxy_url") or settings.get("proxy") or ""),
        }
        register = register_service.update({"clash": next_clash})
        return {"clash": selection, "register": register}

    @router.post("/api/register/start")
    async def start_register(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"register": register_service.start()}

    @router.post("/api/register/stop")
    async def stop_register(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"register": register_service.stop()}

    @router.post("/api/register/reset")
    async def reset_register(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"register": register_service.reset()}

    @router.get("/api/register/events")
    async def register_events(token: str = ""):
        require_admin(f"Bearer {token}")

        async def stream():
            last = ""
            while True:
                payload = json.dumps(register_service.get(), ensure_ascii=False)
                if payload != last:
                    last = payload
                    yield f"data: {payload}\n\n"
                await asyncio.sleep(0.5)

        return StreamingResponse(stream(), media_type="text/event-stream")

    return router
