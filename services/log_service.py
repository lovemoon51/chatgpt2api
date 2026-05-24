from __future__ import annotations

import hashlib
import json
import itertools
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, StreamingResponse

from services.config import DATA_DIR
from utils.helper import anthropic_sse_stream, sse_json_stream

LOG_TYPE_CALL = "call"
LOG_TYPE_TEXT = "text"
LOG_TYPE_ACCOUNT = "account"

TEXT_LOG_ENDPOINTS = {"/v1/chat/completions", "/v1/responses", "/v1/messages", "/v1/embeddings"}
TEXT_LOG_SUMMARIES = ("文本生成", "Responses", "Messages", "Embeddings")
DEFAULT_LOG_RETENTION_MAX_ENTRIES = 5000
LOG_RETENTION_CONFIG_KEY = "log_retention_max_entries"
LOG_RETENTION_ENV_KEY = "CHATGPT2API_LOG_RETENTION_MAX_ENTRIES"
REDACTED_VALUE = "[REDACTED]"

_OPENAI_KEY_RE = re.compile(r"\bsk-[A-Za-z0-9][A-Za-z0-9_-]{6,}\b")
_BEARER_TOKEN_RE = re.compile(r"(?i)\bbearer\s+([A-Za-z0-9._~+/=-]{6,})")
_HEADER_TOKEN_RE = re.compile(r"(?i)\b(x-api-key|api-key)\s*[:=]\s*([^\s,;&\"'}]+)")
_QUERY_TOKEN_RE = re.compile(
    r"(?i)\b(access_token|refresh_token|session_token|id_token|api_key|x-api-key|token)\s*=\s*([^&\s,;\"'}]+)"
)
_QUOTED_FIELD_TOKEN_RE = re.compile(
    r"(?i)([\"'](?:access_token|accessToken|refresh_token|refreshToken|session_token|sessionToken|"
    r"id_token|idToken|api_key|apiKey|x-api-key|authorization|token)[\"']\s*:\s*[\"'])([^\"']+)([\"'])"
)
_PLAIN_FIELD_TOKEN_RE = re.compile(
    r"(?i)\b(access_token|accessToken|refresh_token|refreshToken|session_token|sessionToken|id_token|idToken|"
    r"api_key|apiKey|x-api-key|authorization|token)\s*[:=]\s*([^\s,;&\"'}]+)"
)
_SENSITIVE_KEY_NAMES = {
    "authorization",
    "xapikey",
    "x_api_key",
    "apikey",
    "api_key",
    "openaiapikey",
    "openai_api_key",
    "access_token",
    "accesstoken",
    "refresh_token",
    "refreshtoken",
    "session_token",
    "sessiontoken",
    "id_token",
    "idtoken",
    "token",
    "cookie",
    "set_cookie",
    "setcookie",
    "password",
    "secret",
}


def _normalize_sensitive_key(key: object) -> str:
    return re.sub(r"[^a-z0-9_]+", "", str(key or "").strip().lower().replace("-", "_"))


def _is_sensitive_key(key: object) -> bool:
    normalized = _normalize_sensitive_key(key)
    return normalized in _SENSITIVE_KEY_NAMES or normalized.endswith("_token") or normalized.endswith("token")


def _redact_string(value: str) -> str:
    redacted = _OPENAI_KEY_RE.sub(REDACTED_VALUE, value)
    redacted = _BEARER_TOKEN_RE.sub(f"Bearer {REDACTED_VALUE}", redacted)
    redacted = _HEADER_TOKEN_RE.sub(lambda match: f"{match.group(1)}: {REDACTED_VALUE}", redacted)
    redacted = _QUERY_TOKEN_RE.sub(lambda match: f"{match.group(1)}={REDACTED_VALUE}", redacted)
    redacted = _QUOTED_FIELD_TOKEN_RE.sub(lambda match: f"{match.group(1)}{REDACTED_VALUE}{match.group(3)}", redacted)
    redacted = _PLAIN_FIELD_TOKEN_RE.sub(lambda match: f"{match.group(1)}={REDACTED_VALUE}", redacted)
    return redacted


def sanitize_log_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: REDACTED_VALUE if _is_sensitive_key(key) else sanitize_log_value(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize_log_value(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_log_value(item) for item in value]
    if isinstance(value, str):
        return _redact_string(value)
    return value


def _normalize_retention_max_entries(value: object, default: int = DEFAULT_LOG_RETENTION_MAX_ENTRIES) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        normalized = default
    return max(1, normalized)


class LogService:
    def __init__(self, path: Path, retention_max_entries: int | None = None):
        self.path = path
        self._retention_max_entries = retention_max_entries
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _legacy_id(raw_line: str, line_number: int) -> str:
        payload = f"{line_number}:{raw_line}".encode("utf-8", errors="ignore")
        return hashlib.sha1(payload).hexdigest()[:24]

    def _parse_line(self, raw_line: str, line_number: int) -> dict[str, Any] | None:
        try:
            item = json.loads(raw_line)
        except Exception:
            return None
        if not isinstance(item, dict):
            return None
        parsed = dict(item)
        parsed["id"] = str(parsed.get("id") or self._legacy_id(raw_line, line_number))
        return parsed

    @staticmethod
    def _serialize_item(item: dict[str, Any]) -> str:
        return json.dumps(item, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _sanitize_item(item: dict[str, Any]) -> dict[str, Any]:
        sanitized = sanitize_log_value(item)
        return sanitized if isinstance(sanitized, dict) else item

    def _retention_limit(self) -> int:
        if self._retention_max_entries is not None:
            return _normalize_retention_max_entries(self._retention_max_entries)
        env_value = os.getenv(LOG_RETENTION_ENV_KEY)
        if env_value is not None:
            return _normalize_retention_max_entries(env_value)
        try:
            from services.config import config

            return _normalize_retention_max_entries(config.data.get(LOG_RETENTION_CONFIG_KEY))
        except Exception:
            return DEFAULT_LOG_RETENTION_MAX_ENTRIES

    def _read_lines(self) -> list[str]:
        if not self.path.exists():
            return []
        return self.path.read_text(encoding="utf-8", errors="replace").splitlines()

    def _prune_retention(self) -> None:
        limit = self._retention_limit()
        if not self.path.exists():
            return
        lines = self._read_lines()
        if len(lines) <= limit:
            return
        content = "\n".join(lines[-limit:])
        self.path.write_text(content + ("\n" if content else ""), encoding="utf-8")

    @staticmethod
    def _matches_filters(item: dict[str, Any], *, type: str = "", start_date: str = "", end_date: str = "") -> bool:
        t = str(item.get("time") or "")
        day = t[:10]
        if type and item.get("type") != type:
            return False
        if start_date and day < start_date:
            return False
        if end_date and day > end_date:
            return False
        return True

    @staticmethod
    def _is_text_call(item: dict[str, Any]) -> bool:
        if item.get("type") == LOG_TYPE_TEXT:
            return True
        if item.get("type") != LOG_TYPE_CALL:
            return False
        detail = item.get("detail")
        endpoint = str(detail.get("endpoint") or "") if isinstance(detail, dict) else ""
        summary = str(item.get("summary") or "")
        return endpoint in TEXT_LOG_ENDPOINTS or summary.startswith(TEXT_LOG_SUMMARIES)

    @classmethod
    def _normalized_item(cls, item: dict[str, Any]) -> dict[str, Any]:
        if cls._is_text_call(item) and item.get("type") != LOG_TYPE_TEXT:
            normalized = dict(item)
            normalized["type"] = LOG_TYPE_TEXT
            return normalized
        return item

    def add(self, type: str, summary: str = "", detail: dict[str, Any] | None = None, **data: Any) -> None:
        item = self._sanitize_item({
            "id": uuid4().hex,
            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "type": type,
            "summary": summary,
            "detail": detail or data,
        })
        with self.path.open("a", encoding="utf-8") as file:
            file.write(self._serialize_item(item) + "\n")
        self._prune_retention()

    def list(self, type: str = "", start_date: str = "", end_date: str = "", limit: int = 200) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        items: list[dict[str, Any]] = []
        lines = self._read_lines()
        for line_number in range(len(lines) - 1, -1, -1):
            item = self._parse_line(lines[line_number], line_number)
            if item is None:
                continue
            normalized = self._normalized_item(item)
            if not self._matches_filters(normalized, type=type, start_date=start_date, end_date=end_date):
                continue
            items.append(self._sanitize_item(normalized))
            if len(items) >= limit:
                break
        return items

    def delete(self, ids: list[str]) -> dict[str, int]:
        target_ids = {str(item or "").strip() for item in ids if str(item or "").strip()}
        if not self.path.exists() or not target_ids:
            return {"removed": 0}
        lines = self._read_lines()
        kept_lines: list[str] = []
        removed = 0
        for line_number, raw_line in enumerate(lines):
            item = self._parse_line(raw_line, line_number)
            if item is None:
                kept_lines.append(raw_line)
                continue
            if str(item.get("id") or "") in target_ids:
                removed += 1
                continue
            kept_lines.append(self._serialize_item(self._sanitize_item(item)))
        content = "\n".join(kept_lines)
        if content:
            content += "\n"
        self.path.write_text(content, encoding="utf-8")
        return {"removed": removed}


log_service = LogService(DATA_DIR / "logs.jsonl")


def _collect_urls(value: object) -> list[str]:
    urls: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "url" and isinstance(item, str):
                urls.append(item)
            elif key == "urls" and isinstance(item, list):
                urls.extend(str(url) for url in item if isinstance(url, str))
            else:
                urls.extend(_collect_urls(item))
    elif isinstance(value, list):
        for item in value:
            urls.extend(_collect_urls(item))
    return urls


def _request_excerpt(text: object, limit: int = 1000) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    normalized = " ".join(value.split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"


def _image_error_response(exc: Exception) -> JSONResponse:
    message = str(exc)
    if "no available image quota" in message.lower():
        return JSONResponse(
            status_code=429,
            content={
                "error": {
                    "message": "no available image quota",
                    "type": "insufficient_quota",
                    "param": None,
                    "code": "insufficient_quota",
                }
            },
        )
    if hasattr(exc, "to_openai_error") and hasattr(exc, "status_code"):
        return JSONResponse(status_code=int(exc.status_code), content=exc.to_openai_error())
    return JSONResponse(
        status_code=502,
        content={
            "error": {
                "message": message,
                "type": "server_error",
                "param": None,
                "code": "upstream_error",
            }
        },
    )


def _next_item(items):
    try:
        return True, next(items)
    except StopIteration:
        return False, None


@dataclass
class LoggedCall:
    identity: dict[str, object]
    endpoint: str
    model: str
    summary: str
    started: float = field(default_factory=time.time)
    request_text: str = ""

    def _log_type(self) -> str:
        if self.endpoint in TEXT_LOG_ENDPOINTS or self.summary.startswith(TEXT_LOG_SUMMARIES):
            return LOG_TYPE_TEXT
        return LOG_TYPE_CALL

    async def run(self, handler, *args, sse: str = "openai"):
        from services.protocol.conversation import ImageGenerationError

        try:
            result = await run_in_threadpool(handler, *args)
        except ImageGenerationError as exc:
            self.log("调用失败", status="failed", error=str(exc))
            return _image_error_response(exc)
        except HTTPException as exc:
            self.log("调用失败", status="failed", error=str(exc.detail))
            raise
        except Exception as exc:
            if hasattr(exc, "status_code") and hasattr(exc, "payload"):
                status_code = int(getattr(exc, "status_code"))
                payload = getattr(exc, "payload")
                content = payload if isinstance(payload, dict) else {
                    "error": {
                        "message": str(exc),
                        "type": "server_error",
                        "param": None,
                        "code": "upstream_error",
                    }
                }
                self.log("调用失败", status="failed", error=str(content))
                return JSONResponse(status_code=status_code, content=content)
            self.log("调用失败", status="failed", error=str(exc))
            raise HTTPException(status_code=502, detail={"error": str(exc)}) from exc

        if isinstance(result, dict):
            self.log("调用完成", result)
            return result

        sender = anthropic_sse_stream if sse == "anthropic" else sse_json_stream
        try:
            has_first, first = await run_in_threadpool(_next_item, result)
        except ImageGenerationError as exc:
            self.log("调用失败", status="failed", error=str(exc))
            return _image_error_response(exc)
        except HTTPException as exc:
            self.log("调用失败", status="failed", error=str(exc.detail))
            raise
        except Exception as exc:
            self.log("调用失败", status="failed", error=str(exc))
            raise HTTPException(status_code=502, detail={"error": str(exc)}) from exc
        if not has_first:
            self.log("流式调用结束")
            return StreamingResponse(sender(()), media_type="text/event-stream")
        return StreamingResponse(sender(self.stream(itertools.chain([first], result))), media_type="text/event-stream")

    def stream(self, items):
        urls: list[str] = []
        failed = False
        try:
            for item in items:
                urls.extend(_collect_urls(item))
                yield item
        except Exception as exc:
            failed = True
            self.log("流式调用失败", status="failed", error=str(exc), urls=urls)
            raise
        finally:
            if not failed:
                self.log("流式调用结束", urls=urls)

    def log(self, suffix: str, result: object = None, status: str = "success", error: str = "",
            urls: list[str] | None = None) -> None:
        detail = {
            "key_id": self.identity.get("id"),
            "key_name": self.identity.get("name"),
            "role": self.identity.get("role"),
            "endpoint": self.endpoint,
            "model": self.model,
            "started_at": datetime.fromtimestamp(self.started).strftime("%Y-%m-%d %H:%M:%S"),
            "ended_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "duration_ms": int((time.time() - self.started) * 1000),
            "status": status,
        }
        request_excerpt = _request_excerpt(self.request_text)
        if request_excerpt:
            detail["request_text"] = request_excerpt
        if error:
            detail["error"] = error
        collected_urls = [*(urls or []), *_collect_urls(result)]
        if collected_urls:
            detail["urls"] = list(dict.fromkeys(collected_urls))
        log_service.add(self._log_type(), f"{self.summary}{suffix}", detail)
