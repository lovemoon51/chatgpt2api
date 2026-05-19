from __future__ import annotations

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field

from api.support import (
    openai_http_exception,
    openai_response_from_http_exception,
    release_usage_limit_after_response,
    require_identity,
    resolve_image_base_url,
    usage_limited_call,
)
from services.content_filter import check_request, request_text
from services.log_service import LoggedCall
from services.protocol import (
    anthropic_v1_messages,
    openai_v1_chat_complete,
    openai_v1_embeddings,
    openai_v1_image_edit,
    openai_v1_image_generations,
    openai_v1_models,
    openai_v1_response,
)


class OpenAIErrorRoute(APIRoute):
    def get_route_handler(self):
        original_route_handler = super().get_route_handler()

        async def custom_route_handler(request: Request):
            try:
                return await original_route_handler(request)
            except HTTPException as exc:
                return openai_response_from_http_exception(exc)

        return custom_route_handler


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    model: str = "gpt-image-2"
    n: int = Field(default=1, ge=1, le=4)
    size: str | None = None
    response_format: str = "b64_json"
    history_disabled: bool = True
    stream: bool | None = None


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str | None = None
    prompt: str | None = None
    n: int | None = None
    stream: bool | None = None
    modalities: list[str] | None = None
    messages: list[dict[str, object]] | None = None


class ResponseCreateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str | None = None
    input: object | None = None
    tools: list[dict[str, object]] | None = None
    tool_choice: object | None = None
    stream: bool | None = None


class AnthropicMessageRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str | None = None
    messages: list[dict[str, object]] | None = None
    system: object | None = None
    stream: bool | None = None


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    input: object | None = None
    model: str | None = None
    encoding_format: str | None = None
    dimensions: int | None = None
    user: str | None = None


async def filter_or_log(call: LoggedCall, text: str) -> None:
    try:
        await run_in_threadpool(check_request, text)
    except HTTPException as exc:
        call.log("调用失败", status="failed", error=str(exc.detail))
        raise


def create_router() -> APIRouter:
    router = APIRouter(route_class=OpenAIErrorRoute)

    @router.get("/v1/models")
    async def list_models(authorization: str | None = Header(default=None)):
        require_identity(authorization)
        try:
            return await run_in_threadpool(openai_v1_models.list_models)
        except Exception as exc:
            raise openai_http_exception(str(exc), status_code=502, type="server_error", code="upstream_error") from exc

    @router.post("/v1/embeddings")
    async def create_embedding(body: EmbeddingRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        payload = body.model_dump(mode="python", exclude_none=True)
        model = str(payload.get("model") or openai_v1_embeddings.DEFAULT_EMBEDDING_MODEL)
        call = LoggedCall(identity, "/v1/embeddings", model, "Embeddings", request_text=request_text(payload.get("input")))
        with usage_limited_call(identity, "/v1/embeddings", model, "text") as release_limit:
            try:
                response = await call.run(openai_v1_embeddings.handle, payload)
            except HTTPException as exc:
                release_limit()
                raise
            return release_usage_limit_after_response(response, release_limit)

    @router.post("/v1/images/generations")
    async def generate_images(
            body: ImageGenerationRequest,
            request: Request,
            authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        payload = body.model_dump(mode="python")
        payload["base_url"] = resolve_image_base_url(request)
        call = LoggedCall(identity, "/v1/images/generations", body.model, "文生图", request_text=body.prompt)
        with usage_limited_call(identity, "/v1/images/generations", body.model, "image") as release_limit:
            await filter_or_log(call, body.prompt)
            response = await call.run(openai_v1_image_generations.handle, payload)
            return release_usage_limit_after_response(response, release_limit)

    @router.post("/v1/images/edits")
    async def edit_images(
            request: Request,
            authorization: str | None = Header(default=None),
            image: list[UploadFile] | None = File(default=None),
            image_list: list[UploadFile] | None = File(default=None, alias="image[]"),
            prompt: str = Form(...),
            model: str = Form(default="gpt-image-2"),
            n: int = Form(default=1),
            size: str | None = Form(default=None),
            response_format: str = Form(default="b64_json"),
            stream: bool | None = Form(default=None),
    ):
        identity = require_identity(authorization)
        call = LoggedCall(identity, "/v1/images/edits", model, "图生图", request_text=prompt)
        if n < 1 or n > 4:
            raise openai_http_exception("n must be between 1 and 4", status_code=400, param="n", code="invalid_value")
        with usage_limited_call(identity, "/v1/images/edits", model, "image") as release_limit:
            await filter_or_log(call, prompt)
            uploads = [*(image or []), *(image_list or [])]
            if not uploads:
                raise openai_http_exception(
                    "image file is required",
                    status_code=400,
                    param="image",
                    code="missing_required_parameter",
                )
            images: list[tuple[bytes, str, str]] = []
            for upload in uploads:
                image_data = await upload.read()
                if not image_data:
                    raise openai_http_exception("image file is empty", status_code=400, param="image", code="invalid_value")
                images.append((image_data, upload.filename or "image.png", upload.content_type or "image/png"))
            payload = {
                "prompt": prompt,
                "images": images,
                "model": model,
                "n": n,
                "size": size,
                "response_format": response_format,
                "stream": stream,
                "base_url": resolve_image_base_url(request),
            }
            response = await call.run(openai_v1_image_edit.handle, payload)
            return release_usage_limit_after_response(response, release_limit)

    @router.post("/v1/chat/completions")
    async def create_chat_completion(body: ChatCompletionRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        payload = body.model_dump(mode="python")
        model = str(payload.get("model") or "auto")
        request_preview = request_text(payload.get("prompt"), payload.get("messages"))
        call = LoggedCall(identity, "/v1/chat/completions", model, "文本生成", request_text=request_preview)
        with usage_limited_call(identity, "/v1/chat/completions", model, "text") as release_limit:
            await filter_or_log(call, request_preview)
            response = await call.run(openai_v1_chat_complete.handle, payload)
            return release_usage_limit_after_response(response, release_limit)

    @router.post("/v1/responses")
    async def create_response(body: ResponseCreateRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        payload = body.model_dump(mode="python")
        model = str(payload.get("model") or "auto")
        request_preview = request_text(payload.get("input"), payload.get("instructions"))
        call = LoggedCall(identity, "/v1/responses", model, "Responses", request_text=request_preview)
        with usage_limited_call(identity, "/v1/responses", model, "text") as release_limit:
            await filter_or_log(call, request_preview)
            response = await call.run(openai_v1_response.handle, payload)
            return release_usage_limit_after_response(response, release_limit)

    @router.post("/v1/messages")
    async def create_message(
            body: AnthropicMessageRequest,
            authorization: str | None = Header(default=None),
            x_api_key: str | None = Header(default=None, alias="x-api-key"),
            anthropic_version: str | None = Header(default=None, alias="anthropic-version"),
    ):
        identity = require_identity(authorization or (f"Bearer {x_api_key}" if x_api_key else None))
        payload = body.model_dump(mode="python")
        model = str(payload.get("model") or "auto")
        request_preview = request_text(payload.get("system"), payload.get("messages"), payload.get("tools"))
        call = LoggedCall(identity, "/v1/messages", model, "Messages", request_text=request_preview)
        with usage_limited_call(identity, "/v1/messages", model, "text") as release_limit:
            await filter_or_log(call, request_preview)
            response = await call.run(anthropic_v1_messages.handle, payload, sse="anthropic")
            return release_usage_limit_after_response(response, release_limit)

    return router
