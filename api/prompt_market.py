from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from api.support import require_admin, require_identity
from services.prompt_template_service import (
    PromptTemplateNotFound,
    PromptTemplatePermissionError,
    PromptTemplateValidationError,
    prompt_template_service,
)


class PromptTemplatePreviewImageRequest(BaseModel):
    url: str = ""
    thumbnail_url: str | None = None
    source_image_id: str | None = None


class PromptTemplateCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    description: str = ""
    prompt: str = Field(..., min_length=1)
    model: str = "gpt-image-2"
    size: str = "1:1"
    count: int = Field(default=1, ge=1, le=8)
    tags: list[str] = Field(default_factory=list)
    preview_image: PromptTemplatePreviewImageRequest = Field(default_factory=PromptTemplatePreviewImageRequest)
    visibility: str = "private"


class PromptTemplateUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    prompt: str | None = None
    model: str | None = None
    size: str | None = None
    count: int | None = Field(default=None, ge=1, le=8)
    tags: list[str] | None = None
    preview_image: PromptTemplatePreviewImageRequest | None = None
    visibility: str | None = None


class PromptTemplateReviewRequest(BaseModel):
    action: str = Field(..., min_length=1)
    reason: str = ""


def _payload(model: BaseModel) -> dict[str, Any]:
    data = model.model_dump(exclude_none=True)
    preview = data.get("preview_image")
    if isinstance(preview, dict):
        data["preview_image"] = preview
    return data


def _raise_service_error(exc: Exception) -> None:
    if isinstance(exc, PromptTemplateNotFound):
        raise HTTPException(status_code=404, detail={"error": "prompt template not found"}) from exc
    if isinstance(exc, PromptTemplatePermissionError):
        raise HTTPException(status_code=403, detail={"error": str(exc)}) from exc
    if isinstance(exc, PromptTemplateValidationError):
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    raise exc


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/prompt-templates")
    async def list_prompt_templates(
        scope: str = Query(default="public"),
        q: str = Query(default=""),
        tag: str = Query(default=""),
        status: str = Query(default=""),
        authorization: str | None = Header(default=None),
    ):
        identity = require_admin(authorization) if scope == "review" else require_identity(authorization)
        try:
            return await run_in_threadpool(
                prompt_template_service.list,
                identity,
                scope=scope,
                q=q,
                tag=tag,
                status=status,
            )
        except Exception as exc:
            _raise_service_error(exc)

    @router.get("/api/prompt-templates/stats")
    async def get_prompt_template_stats(
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        return await run_in_threadpool(prompt_template_service.stats, identity)

    @router.post("/api/prompt-templates")
    async def create_prompt_template(
        body: PromptTemplateCreateRequest,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            item = await run_in_threadpool(prompt_template_service.create, identity, _payload(body))
            return {"item": item}
        except Exception as exc:
            _raise_service_error(exc)

    @router.patch("/api/prompt-templates/{template_id}")
    async def update_prompt_template(
        template_id: str,
        body: PromptTemplateUpdateRequest,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            item = await run_in_threadpool(prompt_template_service.update, identity, template_id, _payload(body))
            return {"item": item}
        except Exception as exc:
            _raise_service_error(exc)

    @router.delete("/api/prompt-templates/{template_id}")
    async def delete_prompt_template(
        template_id: str,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            return await run_in_threadpool(prompt_template_service.delete, identity, template_id)
        except Exception as exc:
            _raise_service_error(exc)

    @router.post("/api/prompt-templates/{template_id}/favorite")
    async def favorite_prompt_template(
        template_id: str,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            item = await run_in_threadpool(prompt_template_service.favorite, identity, template_id)
            return {"item": item}
        except Exception as exc:
            _raise_service_error(exc)

    @router.delete("/api/prompt-templates/{template_id}/favorite")
    async def unfavorite_prompt_template(
        template_id: str,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            item = await run_in_threadpool(prompt_template_service.unfavorite, identity, template_id)
            return {"item": item}
        except Exception as exc:
            _raise_service_error(exc)

    @router.post("/api/prompt-templates/{template_id}/review")
    async def review_prompt_template(
        template_id: str,
        body: PromptTemplateReviewRequest,
        authorization: str | None = Header(default=None),
    ):
        identity = require_admin(authorization)
        try:
            item = await run_in_threadpool(
                prompt_template_service.review,
                identity,
                template_id,
                action=body.action,
                reason=body.reason,
            )
            return {"item": item}
        except Exception as exc:
            _raise_service_error(exc)

    return router
