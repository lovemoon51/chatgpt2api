from __future__ import annotations

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from api.support import (
    consume_persistent_image_quota,
    image_credit_cost,
    normalize_image_resolution,
    openai_response_from_http_exception,
    openai_usage_limit_exception,
    require_identity,
    resolve_image_base_url,
)
from services.content_filter import check_request
from services.image_task_service import ImageTaskCancelError, ImageTaskNotFound, ImageTaskQueueFull, image_task_service
from services.log_service import LoggedCall
from services.usage_limit_service import UsageLimitError, usage_limit_service


class ImageGenerationTaskRequest(BaseModel):
    client_task_id: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1)
    model: str = "gpt-image-2"
    size: str | None = None
    resolution: str | None = None
    public: bool = False


class VideoGenerationTaskRequest(BaseModel):
    client_task_id: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1)
    model: str = "agnes-video-v2.0"
    size: str | None = None
    reference_image_urls: list[str] = Field(default_factory=list)


class ImageTaskTimingRequest(BaseModel):
    timing_key: str = Field(..., min_length=1)
    duration_ms: float
    phase: str | None = None


def _parse_task_ids(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _acquire_image_usage_limit(identity: dict[str, object], model: str, *, amount: int = 1):
    release = usage_limit_service.acquire(identity, model=model, kind="image")
    consume_persistent_image_quota(identity, release, amount=amount)
    return release


async def filter_or_log(call: LoggedCall, text: str) -> None:
    try:
        await run_in_threadpool(check_request, text)
    except HTTPException as exc:
        call.log("调用失败", status="failed", error=str(exc.detail))
        raise


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/image-tasks")
    async def list_image_tasks(
        request: Request,
        ids: str = Query(default=""),
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        base_url = resolve_image_base_url(request)
        return await run_in_threadpool(image_task_service.list_tasks, identity, _parse_task_ids(ids), base_url)

    @router.get("/api/image-tasks/queue")
    async def get_image_task_queue_overview(
        authorization: str | None = Header(default=None),
    ):
        require_identity(authorization)
        return await run_in_threadpool(image_task_service.queue_overview)

    @router.delete("/api/image-tasks/{task_id}")
    async def cancel_image_task(
        task_id: str,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            return await run_in_threadpool(image_task_service.cancel_task, identity, task_id)
        except ImageTaskNotFound as exc:
            raise HTTPException(status_code=404, detail={"error": "image task not found"}) from exc
        except ImageTaskCancelError as exc:
            raise HTTPException(status_code=409, detail={"error": str(exc)}) from exc

    @router.post("/api/image-tasks/{task_id}/timings")
    async def report_image_task_timing(
        task_id: str,
        body: ImageTaskTimingRequest,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            return await run_in_threadpool(
                image_task_service.report_timing,
                identity,
                task_id,
                timing_key=body.timing_key,
                duration_ms=body.duration_ms,
                phase=body.phase,
            )
        except ImageTaskNotFound as exc:
            raise HTTPException(status_code=404, detail={"error": "image task not found"}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/image-tasks/generations")
    async def create_generation_task(
        body: ImageGenerationTaskRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            resolution = normalize_image_resolution(body.resolution, strict=True)
            credit_amount = image_credit_cost(resolution, strict=True)
            await filter_or_log(LoggedCall(identity, "/api/image-tasks/generations", body.model, "文生图任务", request_text=body.prompt), body.prompt)
            return await run_in_threadpool(
                image_task_service.submit_generation,
                identity,
                client_task_id=body.client_task_id,
                prompt=body.prompt,
                model=body.model,
                size=body.size,
                resolution=resolution,
                public=body.public,
                base_url=resolve_image_base_url(request),
                acquire_usage_limit=lambda: _acquire_image_usage_limit(identity, body.model, amount=credit_amount),
            )
        except UsageLimitError as exc:
            return openai_response_from_http_exception(openai_usage_limit_exception(exc))
        except ImageTaskQueueFull as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/image-tasks/videos")
    async def create_video_task(
        body: VideoGenerationTaskRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            await filter_or_log(LoggedCall(identity, "/api/image-tasks/videos", body.model, "视频生成任务", request_text=body.prompt), body.prompt)
            return await run_in_threadpool(
                image_task_service.submit_video,
                identity,
                client_task_id=body.client_task_id,
                prompt=body.prompt,
                model=body.model,
                size=body.size,
                base_url=resolve_image_base_url(request),
                reference_image_urls=body.reference_image_urls,
                acquire_usage_limit=lambda: _acquire_image_usage_limit(identity, body.model, amount=1),
            )
        except UsageLimitError as exc:
            return openai_response_from_http_exception(openai_usage_limit_exception(exc))
        except ImageTaskQueueFull as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/image-tasks/edits")
    async def create_edit_task(
        request: Request,
        authorization: str | None = Header(default=None),
        image: list[UploadFile] | None = File(default=None),
        image_list: list[UploadFile] | None = File(default=None, alias="image[]"),
        client_task_id: str = Form(...),
        prompt: str = Form(...),
        model: str = Form(default="gpt-image-2"),
        size: str | None = Form(default=None),
        resolution: str | None = Form(default=None),
        public: bool = Form(default=False),
    ):
        identity = require_identity(authorization)
        try:
            normalized_resolution = normalize_image_resolution(resolution, strict=True)
            credit_amount = image_credit_cost(normalized_resolution, strict=True)
            await filter_or_log(LoggedCall(identity, "/api/image-tasks/edits", model, "图生图任务", request_text=prompt), prompt)
            uploads = [*(image or []), *(image_list or [])]
            if not uploads:
                raise HTTPException(status_code=400, detail={"error": "image file is required"})
            images: list[tuple[bytes, str, str]] = []
            for upload in uploads:
                image_data = await upload.read()
                if not image_data:
                    raise HTTPException(status_code=400, detail={"error": "image file is empty"})
                images.append((image_data, upload.filename or "image.png", upload.content_type or "image/png"))
            return await run_in_threadpool(
                image_task_service.submit_edit,
                identity,
                client_task_id=client_task_id,
                prompt=prompt,
                model=model,
                size=size,
                resolution=normalized_resolution,
                public=public,
                base_url=resolve_image_base_url(request),
                images=images,
                acquire_usage_limit=lambda: _acquire_image_usage_limit(identity, model, amount=credit_amount),
            )
        except UsageLimitError as exc:
            return openai_response_from_http_exception(openai_usage_limit_exception(exc))
        except ImageTaskQueueFull as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    return router
