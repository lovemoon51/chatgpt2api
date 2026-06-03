from __future__ import annotations

import os
import threading
from typing import Any
from urllib.request import Request, urlopen

from curl_cffi import requests

from services.config import config

AGNES_IMAGE_MODEL = "agnes-image-2.1-flash"
AGNES_IMAGE_MODELS = {AGNES_IMAGE_MODEL, "agnes-image-2.0-flash"}
DEFAULT_AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1"
RETRYABLE_STATUS_CODES = {401, 403, 429, 500, 502, 503, 504}
_key_rotation_lock = threading.Lock()
_key_rotation_index = 0


class AgnesAIImageError(RuntimeError):
    pass


def is_agnes_image_model(model: object) -> bool:
    return str(model or "").strip() in AGNES_IMAGE_MODELS


def agnes_ai_settings() -> dict[str, str]:
    raw = config.data.get("agnes_ai")
    source = raw if isinstance(raw, dict) else {}
    base_url = str(os.getenv("AGNES_AI_BASE_URL") or source.get("base_url") or DEFAULT_AGNES_BASE_URL).strip().rstrip("/")
    env_api_key = str(os.getenv("AGNES_AI_API_KEY") or "").strip()
    if env_api_key:
        api_keys = [{"name": "AGNES_AI_API_KEY", "api_key": env_api_key, "enabled": True}]
    else:
        api_keys = []
        raw_keys = source.get("api_keys")
        if isinstance(raw_keys, list):
            for index, item in enumerate(raw_keys, start=1):
                entry = item if isinstance(item, dict) else {}
                api_key = str(entry.get("api_key") or "").strip()
                if not api_key:
                    continue
                api_keys.append({
                    "name": str(entry.get("name") or f"Key {index}").strip() or f"Key {index}",
                    "api_key": api_key,
                    "enabled": bool(entry.get("enabled", True)),
                })
        legacy_api_key = str(source.get("api_key") or "").strip()
        if legacy_api_key:
            api_keys.append({"name": "Legacy API Key", "api_key": legacy_api_key, "enabled": True})
    return {
        "api_key": api_keys[0]["api_key"] if api_keys else "",
        "api_keys": api_keys,
        "base_url": base_url or DEFAULT_AGNES_BASE_URL,
    }


def _enabled_api_keys(settings: dict[str, Any]) -> list[dict[str, str]]:
    raw_keys = settings.get("api_keys")
    keys: list[dict[str, str]] = []
    if isinstance(raw_keys, list):
        for index, item in enumerate(raw_keys, start=1):
            entry = item if isinstance(item, dict) else {}
            if entry.get("enabled", True) is False:
                continue
            api_key = str(entry.get("api_key") or "").strip()
            if not api_key:
                continue
            keys.append({
                "name": str(entry.get("name") or f"Key {index}").strip() or f"Key {index}",
                "api_key": api_key,
            })
    if keys:
        return keys
    legacy_api_key = str(settings.get("api_key") or "").strip()
    if legacy_api_key:
        return [{"name": "Legacy API Key", "api_key": legacy_api_key}]
    return []


def _rotated_api_keys(settings: dict[str, Any]) -> list[dict[str, str]]:
    global _key_rotation_index
    keys = _enabled_api_keys(settings)
    if not keys:
        return []
    with _key_rotation_lock:
        start = _key_rotation_index % len(keys)
        _key_rotation_index = (_key_rotation_index + 1) % len(keys)
    return keys[start:] + keys[:start]


def test_agnes_ai_connection(settings: dict[str, Any] | None = None) -> dict[str, Any]:
    source_settings = settings or agnes_ai_settings()
    api_keys = _rotated_api_keys(source_settings)
    if not api_keys:
        return {
            "ok": False,
            "status": 0,
            "key_name": "",
            "error": "Agnes AI API key is not configured",
        }

    base_url = str(source_settings.get("base_url") or DEFAULT_AGNES_BASE_URL).strip().rstrip("/") or DEFAULT_AGNES_BASE_URL
    endpoint = f"{base_url}/models"
    last_result: dict[str, Any] | None = None
    for key_entry in api_keys:
        key_name = key_entry["name"]
        try:
            response = requests.get(
                endpoint,
                headers={
                    "Authorization": f"Bearer {key_entry['api_key']}",
                },
                timeout=30,
            )
            try:
                data = response.json()
            except Exception:
                data = {}
            status_code = int(response.status_code)
            if 200 <= status_code < 300:
                models = []
                if isinstance(data, dict) and isinstance(data.get("data"), list):
                    models = [
                        str(item.get("id") or "").strip()
                        for item in data["data"]
                        if isinstance(item, dict) and str(item.get("id") or "").strip()
                    ]
                return {
                    "ok": True,
                    "status": status_code,
                    "key_name": key_name,
                    "error": None,
                    "models": models,
                    "image_model_available": AGNES_IMAGE_MODEL in models,
                }
            last_result = {
                "ok": False,
                "status": status_code,
                "key_name": key_name,
                "error": _response_error_message(data, f"Agnes AI request failed: status={status_code}"),
            }
            if status_code in RETRYABLE_STATUS_CODES:
                continue
            return last_result
        except Exception as exc:
            last_result = {
                "ok": False,
                "status": 0,
                "key_name": key_name,
                "error": str(exc),
            }
    return last_result or {
        "ok": False,
        "status": 0,
        "key_name": "",
        "error": "Agnes AI request failed",
    }


def _is_public_image_url(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("https://") or lowered.startswith("http://")


def _reference_image_urls(images: object) -> list[str]:
    if not isinstance(images, list):
        return []
    urls = []
    for image in images:
        value = str(image or "").strip()
        if not value:
            continue
        if not _is_public_image_url(value):
            raise AgnesAIImageError("Agnes image-to-image requires publicly accessible image URL references.")
        urls.append(value)
    return urls


def build_agnes_image_payload(request: Any) -> dict[str, Any]:
    prompt = str(getattr(request, "prompt", "") or "").strip()
    if not prompt:
        raise AgnesAIImageError("prompt is required")

    payload: dict[str, Any] = {
        "model": AGNES_IMAGE_MODEL,
        "prompt": prompt,
    }
    size = str(getattr(request, "size", "") or "").strip()
    if size and size != "智能":
        payload["size"] = size

    reference_urls = _reference_image_urls(getattr(request, "images", None))
    if reference_urls:
        payload["tags"] = ["img2img"]
        payload["extra_body"] = {
            "image": reference_urls,
            "response_format": "url",
        }
    return payload


def _response_error_message(payload: object, fallback: str) -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error.get("error") or fallback)
        if error:
            return str(error)
        message = payload.get("message")
        if message:
            return str(message)
    return fallback


def request_agnes_image(request: Any) -> dict[str, Any]:
    settings = agnes_ai_settings()
    api_keys = _rotated_api_keys(settings)
    if not api_keys:
        raise AgnesAIImageError("Agnes AI API key is not configured. Set AGNES_AI_API_KEY or config.json agnes_ai.api_keys.")

    endpoint = f"{settings['base_url']}/images/generations"
    payload = build_agnes_image_payload(request)
    last_error: AgnesAIImageError | None = None
    for key_entry in api_keys:
        api_key = key_entry["api_key"]
        try:
            response = requests.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=300,
            )
        except Exception as exc:
            last_error = AgnesAIImageError(f"Agnes AI request failed with {key_entry['name']}: {exc}")
            continue

        try:
            data = response.json()
        except Exception as exc:
            last_error = AgnesAIImageError(f"Agnes AI returned a non-JSON response: status={response.status_code}")
            if int(response.status_code) in RETRYABLE_STATUS_CODES:
                continue
            raise last_error from exc

        status_code = int(response.status_code)
        if 200 <= status_code < 300:
            if not isinstance(data, dict):
                raise AgnesAIImageError("Agnes AI returned an invalid response")
            return data

        last_error = AgnesAIImageError(_response_error_message(data, f"Agnes AI request failed: status={status_code}"))
        if status_code in RETRYABLE_STATUS_CODES:
            continue
        raise last_error

    if last_error is not None:
        raise last_error
    raise AgnesAIImageError("Agnes AI request failed: no enabled API keys")


def collect_agnes_image_urls(payload: dict[str, Any]) -> list[str]:
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    urls = []
    for item in data:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if url:
            urls.append(url)
    return urls


def download_image_bytes(urls: list[str]) -> list[bytes]:
    images: list[bytes] = []
    for url in urls:
        try:
            response = requests.get(url, headers={"Accept-Encoding": "identity"}, timeout=120)
        except Exception as exc:
            try:
                fallback_request = Request(url, headers={"Accept-Encoding": "identity"})
                with urlopen(fallback_request, timeout=120) as response:
                    images.append(response.read())
                    continue
            except Exception as fallback_exc:
                raise AgnesAIImageError(f"Agnes AI image download failed: {fallback_exc}") from exc
        if not 200 <= int(response.status_code) < 300:
            raise AgnesAIImageError(f"Agnes AI image download failed: status={response.status_code}")
        images.append(bytes(response.content))
    return images
