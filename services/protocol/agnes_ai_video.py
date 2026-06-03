from __future__ import annotations

from dataclasses import dataclass, field
import time
from typing import Any

from curl_cffi import requests

from services.protocol.agnes_ai_image import (
    RETRYABLE_STATUS_CODES,
    _response_error_message,
    _rotated_api_keys,
    agnes_ai_settings,
)

AGNES_VIDEO_MODEL = "agnes-video-v2.0"
DEFAULT_VIDEO_NUM_FRAMES = 121
DEFAULT_VIDEO_FRAME_RATE = 24
VIDEO_TERMINAL_SUCCESS_STATUSES = {"completed", "success", "succeeded"}
VIDEO_TERMINAL_ERROR_STATUSES = {"failed", "error", "cancelled", "canceled"}


class AgnesAIVideoError(RuntimeError):
    pass


@dataclass(frozen=True)
class AgnesVideoRequest:
    prompt: str
    size: str | None = None
    image_urls: list[str] = field(default_factory=list)
    num_frames: int = DEFAULT_VIDEO_NUM_FRAMES
    frame_rate: int = DEFAULT_VIDEO_FRAME_RATE


def is_agnes_video_model(model: object) -> bool:
    return str(model or "").strip() == AGNES_VIDEO_MODEL


def _is_public_url(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("https://") or lowered.startswith("http://")


def _video_dimensions(size: str | None) -> tuple[int, int] | None:
    normalized = str(size or "").strip()
    if not normalized or normalized == "智能":
        return None
    dimensions = {
        "16:9": (1152, 768),
        "3:2": (1152, 768),
        "1:1": (1024, 1024),
        "2:3": (768, 1152),
        "9:16": (768, 1152),
    }
    return dimensions.get(normalized)


def _clean_image_urls(urls: list[str]) -> list[str]:
    clean_urls: list[str] = []
    for item in urls:
        url = str(item or "").strip()
        if not url:
            continue
        if not _is_public_url(url):
            raise AgnesAIVideoError("Agnes video generation requires publicly accessible image URL references.")
        clean_urls.append(url)
    return clean_urls


def build_agnes_video_payload(request: AgnesVideoRequest) -> dict[str, Any]:
    prompt = str(request.prompt or "").strip()
    if not prompt:
        raise AgnesAIVideoError("prompt is required")

    payload: dict[str, Any] = {
        "model": AGNES_VIDEO_MODEL,
        "prompt": prompt,
        "num_frames": max(1, int(request.num_frames or DEFAULT_VIDEO_NUM_FRAMES)),
        "frame_rate": max(1, int(request.frame_rate or DEFAULT_VIDEO_FRAME_RATE)),
    }
    dimensions = _video_dimensions(request.size)
    if dimensions is not None:
        width, height = dimensions
        payload["width"] = width
        payload["height"] = height

    image_urls = _clean_image_urls(request.image_urls)
    if len(image_urls) == 1:
        payload["image"] = image_urls[0]
    elif len(image_urls) > 1:
        payload["extra_body"] = {"image": image_urls}
    return payload


def _extract_task_id(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in ("id", "task_id"):
        value = str(payload.get(key) or "").strip()
        if value:
            return value
    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("id", "task_id"):
            value = str(data.get(key) or "").strip()
            if value:
                return value
    return ""


def _extract_video_url(payload: dict[str, Any]) -> str:
    for key in ("video_url", "url"):
        value = str(payload.get(key) or "").strip()
        if value:
            return value
    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("video_url", "url"):
            value = str(data.get(key) or "").strip()
            if value:
                return value
    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                continue
            for key in ("video_url", "url"):
                value = str(item.get(key) or "").strip()
                if value:
                    return value
    return ""


def _task_status(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    return str(payload.get("status") or "").strip().lower()


def _request_json(method: str, endpoint: str, api_key: str, payload: dict[str, Any] | None = None) -> tuple[int, object]:
    kwargs = {
        "headers": {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        "timeout": 300,
    }
    if method == "post":
        response = requests.post(endpoint, json=payload or {}, **kwargs)
    else:
        response = requests.get(endpoint, **kwargs)
    try:
        data = response.json()
    except Exception as exc:
        raise AgnesAIVideoError(f"Agnes AI video returned a non-JSON response: status={response.status_code}") from exc
    return int(response.status_code), data


def _poll_agnes_video_task(
    *,
    base_url: str,
    api_key: str,
    task_id: str,
    prompt: str,
    max_poll_attempts: int,
    poll_interval_seconds: float,
) -> dict[str, Any]:
    endpoint = f"{base_url}/videos/{task_id}"
    for attempt in range(max(1, max_poll_attempts)):
        status_code, data = _request_json("get", endpoint, api_key)
        if not 200 <= status_code < 300:
            if status_code in RETRYABLE_STATUS_CODES and attempt + 1 < max_poll_attempts:
                time.sleep(max(0.0, poll_interval_seconds))
                continue
            raise AgnesAIVideoError(_response_error_message(data, f"Agnes AI video poll failed: status={status_code}"))
        if not isinstance(data, dict):
            raise AgnesAIVideoError("Agnes AI video returned an invalid task response")

        status = _task_status(data)
        if status in VIDEO_TERMINAL_SUCCESS_STATUSES:
            video_url = _extract_video_url(data)
            if not video_url:
                raise AgnesAIVideoError("Agnes AI video task completed without video_url")
            return {
                "created": int(data.get("completed_at") or data.get("created_at") or time.time()),
                "data": [{
                    "url": video_url,
                    "video_url": video_url,
                    "revised_prompt": prompt,
                }],
                "raw": data,
            }
        if status in VIDEO_TERMINAL_ERROR_STATUSES:
            raise AgnesAIVideoError(_response_error_message(data, "Agnes AI video task failed"))
        time.sleep(max(0.0, poll_interval_seconds))
    raise AgnesAIVideoError("Agnes AI video task timed out")


def request_agnes_video(
    request: AgnesVideoRequest,
    *,
    max_poll_attempts: int = 120,
    poll_interval_seconds: float = 2.0,
) -> dict[str, Any]:
    settings = agnes_ai_settings()
    api_keys = _rotated_api_keys(settings)
    if not api_keys:
        raise AgnesAIVideoError("Agnes AI API key is not configured. Set AGNES_AI_API_KEY or config.json agnes_ai.api_keys.")

    base_url = str(settings.get("base_url") or "").strip().rstrip("/")
    if not base_url:
        raise AgnesAIVideoError("Agnes AI base URL is not configured")

    payload = build_agnes_video_payload(request)
    endpoint = f"{base_url}/videos"
    last_error: AgnesAIVideoError | None = None
    for key_entry in api_keys:
        api_key = str(key_entry.get("api_key") or "").strip()
        if not api_key:
            continue
        try:
            status_code, data = _request_json("post", endpoint, api_key, payload)
            if not 200 <= status_code < 300:
                last_error = AgnesAIVideoError(_response_error_message(data, f"Agnes AI video request failed: status={status_code}"))
                if status_code in RETRYABLE_STATUS_CODES:
                    continue
                raise last_error
            task_id = _extract_task_id(data)
            if not task_id:
                raise AgnesAIVideoError("Agnes AI video create response did not include a task id")
            return _poll_agnes_video_task(
                base_url=base_url,
                api_key=api_key,
                task_id=task_id,
                prompt=str(request.prompt or "").strip(),
                max_poll_attempts=max_poll_attempts,
                poll_interval_seconds=poll_interval_seconds,
            )
        except AgnesAIVideoError as exc:
            last_error = exc
            continue
        except Exception as exc:
            last_error = AgnesAIVideoError(f"Agnes AI video request failed with {key_entry.get('name') or 'key'}: {exc}")
            continue

    if last_error is not None:
        raise last_error
    raise AgnesAIVideoError("Agnes AI video request failed: no enabled API keys")


def handle(body: dict[str, Any]) -> dict[str, Any]:
    reference_image_urls = body.get("reference_image_urls")
    image_urls = [
        str(item or "").strip()
        for item in reference_image_urls
        if str(item or "").strip()
    ] if isinstance(reference_image_urls, list) else []
    return request_agnes_video(
        AgnesVideoRequest(
            prompt=str(body.get("prompt") or ""),
            size=str(body.get("size") or "") or None,
            image_urls=image_urls,
        )
    )
