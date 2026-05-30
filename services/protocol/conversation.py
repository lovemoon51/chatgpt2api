from __future__ import annotations

import base64
import dataclasses
import hashlib
import json
import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, CancelledError, ThreadPoolExecutor, as_completed, wait
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, Protocol

import tiktoken

from services.account_service import account_service
from services.config import config
from services.image_service import record_image_owner
from services.openai_backend_api import ChatGPTCheckoutRequiredError, OpenAIBackendAPI
from utils.helper import IMAGE_MODELS, extract_image_from_message_content
from utils.log import logger


class ImageGenerationError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 502,
        error_type: str = "server_error",
        code: str | None = "upstream_error",
        param: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_type = error_type
        self.code = code
        self.param = param

    def to_openai_error(self) -> dict[str, Any]:
        return {
            "error": {
                "message": str(self),
                "type": self.error_type,
                "param": self.param,
                "code": self.code,
            }
        }


class TextOnlyImageResponseError(RuntimeError):
    pass


class ImageUsageLimitReachedError(RuntimeError):
    pass


def is_token_invalid_error(message: str) -> bool:
    text = str(message or "").lower()
    return (
        "token_invalidated" in text
        or "token_revoked" in text
        or "authentication token has been invalidated" in text
        or "invalidated oauth token" in text
    )


def is_usage_limit_error(message: str) -> bool:
    text = str(message or "").lower()
    return "usage_limit_reached" in text or "the usage limit has been reached" in text


def extract_usage_limit_reset(message: str) -> tuple[int | None, int | None]:
    text = str(message or "")

    def extract_int(name: str) -> int | None:
        match = re.search(rf"['\"]{name}['\"]\s*:\s*(\d+)", text)
        if not match:
            return None
        try:
            return int(match.group(1))
        except ValueError:
            return None

    return extract_int("resets_at"), extract_int("resets_in_seconds")


def image_empty_result_retry_limit() -> int:
    try:
        value = int(config.data.get("image_empty_result_retry_limit") or 2)
    except (TypeError, ValueError):
        value = 2
    return max(1, value)


def image_first_attempt_poll_timeout_secs() -> int:
    try:
        value = int(config.data.get("image_first_attempt_poll_timeout_secs") or 90)
    except (TypeError, ValueError):
        value = 90
    return max(1, value)


def image_request_parallelism_limit() -> int:
    try:
        value = int(config.data.get("image_request_parallelism") or 3)
    except (TypeError, ValueError):
        value = 3
    return max(1, min(8, value))


def image_race_parallelism_limit() -> int:
    try:
        value = int(config.data.get("image_race_parallelism") or 1)
    except (TypeError, ValueError):
        value = 1
    return max(1, min(8, value))


def image_race_max_inflight_limit(total: int) -> int:
    total = max(1, int(total or 1))
    race_parallelism = image_race_parallelism_limit()
    default_limit = total * race_parallelism
    try:
        value = int(config.data.get("image_race_max_inflight") or default_limit)
    except (TypeError, ValueError):
        value = default_limit
    return max(total, min(default_limit, value))


def is_unusable_image_account_error(message: str) -> bool:
    text = str(message or "").lower()
    if is_usage_limit_error(text) or is_token_invalid_error(text):
        return False
    return (
        is_checkout_required_error(text)
        or "chat requirements requires arkose token" in text
        or "requires arkose token" in text
        or "missing auth chat requirements token" in text
    )


def is_retryable_image_connection_error(message: str) -> bool:
    text = str(message or "").lower()
    return "curl: (35)" in text or "tls connect error" in text or "openssl_internal" in text


def image_stream_error_message(message: str) -> str:
    text = str(message or "")
    if is_usage_limit_error(text):
        return "当前可用账号图片额度已用尽，账号已保留，等待额度恢复后会自动重新检查。"
    lower = text.lower()
    if is_checkout_required_error(text):
        return "上游返回 ChatGPT Plus 结账页，当前账号不能生成图片。请换可生成图片的账号，或给账号开通 Plus 后重试。"
    if is_retryable_image_connection_error(lower):
        return "upstream image connection failed, please retry later"
    return text or "image generation failed"


def is_checkout_required_error(message: str) -> bool:
    text = str(message or "").lower()
    return (
        "chatgpt checkout" in text
        or "/checkout/openai_llc/" in text
        or "chatgpt.com/checkout/" in text
        or "cs_live_" in text
        or "cannot generate images" in text
    )


def no_image_result_message(timeout_secs: int | None = None) -> str:
    return (
        f"上游图片任务在 {timeout_secs or config.image_poll_timeout_secs} 秒内没有返回图片数据，"
        "可能仍在生成、被上游静默拒绝，或返回格式发生变化。请稍后重试，或在设置里调大图片轮询超时。"
    )


def emit_image_progress(
    progress_callback: Callable[[dict[str, Any]], None] | None,
    *,
    phase: str,
    label: str = "",
    timing_key: str = "",
    duration_ms: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    if not callable(progress_callback):
        return
    event: dict[str, Any] = {"phase": phase}
    if label:
        event["label"] = label
    if timing_key:
        event["timing_key"] = timing_key
    if duration_ms is not None:
        event["duration_ms"] = max(0, int(duration_ms))
    if metadata:
        event["metadata"] = metadata
    try:
        progress_callback(event)
    except Exception:
        pass


def elapsed_ms(started: float) -> int:
    return max(0, int((time.time() - started) * 1000))


def encode_images(images: Iterable[tuple[bytes, str, str]]) -> list[str]:
    return [base64.b64encode(data).decode("ascii") for data, _, _ in images if data]


def save_image_bytes(
    image_data: bytes,
    base_url: str | None = None,
    owner_identity: dict[str, object] | None = None,
    *,
    prompt: str = "",
    model: str = "",
    size: str | None = None,
    mode: str = "",
    source_task_id: str = "",
    revised_prompt: str = "",
) -> str:
    config.cleanup_old_images()
    file_hash = hashlib.md5(image_data).hexdigest()
    filename = f"{int(time.time())}_{file_hash}.png"
    relative_dir = Path(time.strftime("%Y"), time.strftime("%m"), time.strftime("%d"))
    file_path = config.images_dir / relative_dir / filename
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(image_data)
    relative_path = f"{relative_dir.as_posix()}/{filename}"
    record_image_owner(relative_path, owner_identity)
    try:
        from services.image_asset_service import upsert_asset

        upsert_asset(
            relative_path,
            file_path=file_path,
            owner_identity=owner_identity,
            prompt=prompt,
            model=model,
            size=size,
            mode=mode,
            source_task_id=source_task_id,
            revised_prompt=revised_prompt,
        )
    except Exception:
        pass
    return f"{(base_url or config.base_url)}/images/{relative_path}"


def message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and str(item.get("type") or "") in {"text", "input_text", "output_text"}:
                parts.append(str(item.get("text") or ""))
        return "".join(parts)
    return ""


def normalize_messages(messages: object, system: Any = None) -> list[dict[str, Any]]:
    normalized = []
    if config.global_system_prompt:
        normalized.append({"role": "system", "content": config.global_system_prompt})
    system_text = message_text(system)
    if system_text:
        normalized.append({"role": "system", "content": system_text})
    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = message.get("role", "user")
            content = message.get("content", "")
            text = message_text(content)
            images: list[tuple[bytes, str]] = []
            if role == "user":
                images.extend(extract_image_from_message_content(content))
                if isinstance(content, list):
                    for part in content:
                        if not isinstance(part, dict) or part.get("type") != "image":
                            continue
                        data = part.get("data")
                        if isinstance(data, (bytes, bytearray)):
                            images.append((bytes(data), str(part.get("mime") or "image/png")))
            if images:
                parts: list[Any] = []
                if text:
                    parts.append({"type": "text", "text": text})
                for data, mime in images:
                    parts.append({"type": "image", "data": data, "mime": mime})
                normalized.append({"role": role, "content": parts})
            else:
                normalized.append({"role": role, "content": text})
    return normalized


def prompt_with_global_system(prompt: str) -> str:
    return f"{config.global_system_prompt}\n\n{prompt}" if config.global_system_prompt else prompt


def assistant_history_text(messages: list[dict[str, Any]]) -> str:
    return "".join(str(item.get("content") or "") for item in messages if item.get("role") == "assistant")


def assistant_history_messages(messages: list[dict[str, Any]]) -> list[str]:
    return [str(item.get("content") or "") for item in messages if item.get("role") == "assistant" and item.get("content")]


def build_image_prompt(prompt: str, size: str | None) -> str:
    base_prompt = str(prompt or "").strip()
    prompt = f"请直接生成图片，不要只回复文字描述。画面需求：{base_prompt}" if base_prompt else "请直接生成图片。"
    if not size:
        return prompt
    if size not in {"1:1", "16:9", "9:16", "4:3", "3:4"}:
        return f"{prompt.strip()}\n\n输出图片，宽高比为 {size}。"
    hint = {
        "1:1": "输出为 1:1 正方形构图，主体居中，适合正方形画幅。",
        "16:9": "输出为 16:9 横屏构图，适合宽画幅展示。",
        "9:16": "输出为 9:16 竖屏构图，适合竖版画幅展示。",
        "4:3": "输出为 4:3 比例，兼顾宽度与高度，适合展示画面细节。",
        "3:4": "输出为 3:4 比例，纵向构图，适合人物肖像或竖向场景。",
    }[size]
    return f"{prompt.strip()}\n\n{hint}"


def encoding_for_model(model: str):
    try:
        return tiktoken.encoding_for_model(model)
    except KeyError:
        try:
            return tiktoken.get_encoding("o200k_base")
        except KeyError:
            return tiktoken.get_encoding("cl100k_base")


def count_message_tokens(messages: list[dict[str, Any]], model: str) -> int:
    encoding = encoding_for_model(model)
    total = 0
    for message in messages:
        total += 3
        for key, value in message.items():
            if not isinstance(value, str):
                continue
            total += len(encoding.encode(value))
            if key == "name":
                total += 1
    return total + 3


def count_text_tokens(text: str, model: str) -> int:
    return len(encoding_for_model(model).encode(text))


def format_image_result(
    items: list[dict[str, Any]],
    prompt: str,
    response_format: str,
    base_url: str | None = None,
    created: int | None = None,
    message: str = "",
    owner_identity: dict[str, object] | None = None,
    model: str = "",
    size: str | None = None,
    mode: str = "",
    source_task_id: str = "",
) -> dict[str, Any]:
    data: list[dict[str, Any]] = []
    for item in items:
        b64_json = str(item.get("b64_json") or "").strip()
        if not b64_json:
            continue
        revised_prompt = str(item.get("revised_prompt") or prompt).strip() or prompt
        url = save_image_bytes(
            base64.b64decode(b64_json),
            base_url,
            owner_identity,
            prompt=prompt,
            model=model,
            size=size,
            mode=mode,
            source_task_id=source_task_id,
            revised_prompt=revised_prompt,
        )
        if response_format == "b64_json":
            data.append({
                "b64_json": b64_json,
                "url": url,
                "revised_prompt": revised_prompt,
            })
        else:
            data.append({
                "url": url,
                "revised_prompt": revised_prompt,
            })
    result: dict[str, Any] = {"created": created or int(time.time()), "data": data}
    if message and not data:
        result["message"] = message
    return result


@dataclass
class ConversationRequest:
    model: str = "auto"
    prompt: str = ""
    messages: list[dict[str, Any]] | None = None
    images: list[str] | None = None
    n: int = 1
    size: str | None = None
    response_format: str = "b64_json"
    base_url: str | None = None
    message_as_error: bool = False
    owner_identity: dict[str, object] | None = None
    mode: str = ""
    source_task_id: str = ""
    progress_callback: Callable[[dict[str, Any]], None] | None = None
    image_poll_timeout_secs: int | None = None


@dataclass
class ConversationState:
    text: str = ""
    conversation_id: str = ""
    file_ids: list[str] = field(default_factory=list)
    sediment_ids: list[str] = field(default_factory=list)
    blocked: bool = False
    tool_invoked: bool | None = None
    turn_use_case: str = ""


@dataclass
class ImageOutput:
    kind: str
    model: str
    index: int
    total: int
    created: int = field(default_factory=lambda: int(time.time()))
    text: str = ""
    upstream_event_type: str = ""
    data: list[dict[str, Any]] = field(default_factory=list)

    def to_chunk(self) -> dict[str, Any]:
        chunk: dict[str, Any] = {
            "object": "image.generation.chunk",
            "created": self.created,
            "model": self.model,
            "index": self.index,
            "total": self.total,
            "progress_text": self.text,
            "upstream_event_type": self.upstream_event_type,
            "data": [],
        }
        if self.kind == "message":
            chunk.update({
                "object": "image.generation.message",
                "message": self.text,
            })
            chunk.pop("progress_text", None)
            chunk.pop("upstream_event_type", None)
        elif self.kind == "result":
            chunk.update({
                "object": "image.generation.result",
                "data": self.data,
            })
            chunk.pop("progress_text", None)
            chunk.pop("upstream_event_type", None)
        return chunk


def assistant_message_text(message: dict[str, Any]) -> str:
    content = message.get("content") or {}
    parts = content.get("parts") or []
    if not isinstance(parts, list):
        return ""
    return "".join(part for part in parts if isinstance(part, str))


def strip_history(text: str, history_text: str = "") -> str:
    text = str(text or "")
    history_text = str(history_text or "")
    while history_text and text.startswith(history_text):
        text = text[len(history_text):]
    return text


def assistant_text(event: dict[str, Any], current_text: str = "", history_text: str = "") -> str:
    for candidate in (event, event.get("v")):
        if not isinstance(candidate, dict):
            continue
        message = candidate.get("message")
        if not isinstance(message, dict):
            continue
        role = str((message.get("author") or {}).get("role") or "").strip().lower()
        if role != "assistant":
            continue
        text = assistant_message_text(message)
        if text:
            return strip_history(text, history_text)
    return apply_text_patch(event, current_text, history_text)


def event_assistant_text(event: dict[str, Any], history_text: str = "") -> str:
    for candidate in (event, event.get("v")):
        if not isinstance(candidate, dict):
            continue
        message = candidate.get("message")
        if isinstance(message, dict) and (message.get("author") or {}).get("role") == "assistant":
            return strip_history(assistant_message_text(message), history_text)
    return ""


def apply_text_patch(event: dict[str, Any], current_text: str = "", history_text: str = "") -> str:
    if event.get("p") == "/message/content/parts/0":
        return apply_patch_op(event, current_text, history_text)

    operations = event.get("v")
    if isinstance(operations, str) and current_text and not event.get("p") and not event.get("o"):
        return current_text + operations

    if event.get("o") == "patch" and isinstance(operations, list):
        text = current_text
        for item in operations:
            if isinstance(item, dict):
                text = apply_text_patch(item, text, history_text)
        return text

    if not isinstance(operations, list):
        return current_text

    text = current_text
    for item in operations:
        if isinstance(item, dict):
            text = apply_text_patch(item, text, history_text)
    return text


def apply_patch_op(operation: dict[str, Any], current_text: str, history_text: str = "") -> str:
    op = operation.get("o")
    value = str(operation.get("v") or "")
    if op == "append":
        return current_text + value
    if op == "replace":
        return strip_history(value, history_text)
    return current_text


def add_unique(values: list[str], candidates: list[str]) -> None:
    for candidate in candidates:
        if candidate and candidate not in values:
            values.append(candidate)


def extract_conversation_ids(payload: str) -> tuple[str, list[str], list[str]]:
    conversation_match = re.search(r'"conversation_id"\s*:\s*"([^"]+)"', payload)
    conversation_id = conversation_match.group(1) if conversation_match else ""
    file_ids = re.findall(r"(file[-_][A-Za-z0-9]+)", payload)
    sediment_ids = re.findall(r"sediment://([A-Za-z0-9_-]+)", payload)
    return conversation_id, file_ids, sediment_ids


def is_image_tool_event(event: dict[str, Any]) -> bool:
    value = event.get("v")
    message = event.get("message") or (value.get("message") if isinstance(value, dict) else None)
    if not isinstance(message, dict):
        return False
    metadata = message.get("metadata") or {}
    author = message.get("author") or {}
    return author.get("role") == "tool" and metadata.get("async_task_type") == "image_gen"


def update_conversation_state(state: ConversationState, payload: str, event: dict[str, Any] | None = None) -> None:
    conversation_id, file_ids, sediment_ids = extract_conversation_ids(payload)
    if conversation_id and not state.conversation_id:
        state.conversation_id = conversation_id
    if isinstance(event, dict) and is_image_tool_event(event):
        add_unique(state.file_ids, file_ids)
        add_unique(state.sediment_ids, sediment_ids)
    if not isinstance(event, dict):
        return
    state.conversation_id = str(event.get("conversation_id") or state.conversation_id)
    value = event.get("v")
    if isinstance(value, dict):
        state.conversation_id = str(value.get("conversation_id") or state.conversation_id)
    if event.get("type") == "moderation":
        moderation = event.get("moderation_response")
        if isinstance(moderation, dict) and moderation.get("blocked") is True:
            state.blocked = True
    if event.get("type") == "server_ste_metadata":
        metadata = event.get("metadata")
        if isinstance(metadata, dict):
            if isinstance(metadata.get("tool_invoked"), bool):
                state.tool_invoked = metadata["tool_invoked"]
            state.turn_use_case = str(metadata.get("turn_use_case") or state.turn_use_case)


def conversation_base_event(event_type: str, state: ConversationState, **extra: Any) -> dict[str, Any]:
    return {
        "type": event_type,
        "text": state.text,
        "conversation_id": state.conversation_id,
        "file_ids": list(state.file_ids),
        "sediment_ids": list(state.sediment_ids),
        "blocked": state.blocked,
        "tool_invoked": state.tool_invoked,
        "turn_use_case": state.turn_use_case,
        **extra,
    }


def iter_conversation_payloads(payloads: Iterator[str], history_text: str = "",
                               history_messages: list[str] | None = None) -> Iterator[dict[str, Any]]:
    state = ConversationState()
    history_messages = history_messages or []
    history_index = 0
    for payload in payloads:
        # print(f"[upstream_sse] {payload}", flush=True)
        if not payload:
            continue
        if is_usage_limit_error(payload):
            raise ImageUsageLimitReachedError(payload[:500])
        if is_checkout_required_error(payload):
            raise ChatGPTCheckoutRequiredError(f"upstream returned ChatGPT checkout while generating image: {payload[:300]}")
        if payload == "[DONE]":
            yield conversation_base_event("conversation.done", state, done=True)
            break
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            update_conversation_state(state, payload)
            yield conversation_base_event("conversation.raw", state, payload=payload)
            continue
        if not isinstance(event, dict):
            yield conversation_base_event("conversation.event", state, raw=event)
            continue
        update_conversation_state(state, payload, event)
        if history_index < len(history_messages) and event_assistant_text(event, history_text) == history_messages[history_index]:
            history_index += 1
            state.text = ""
            continue
        next_text = assistant_text(event, state.text, history_text)
        if next_text != state.text:
            delta = next_text[len(state.text):] if next_text.startswith(state.text) else next_text
            state.text = next_text
            yield conversation_base_event("conversation.delta", state, raw=event, delta=delta)
            continue
        yield conversation_base_event("conversation.event", state, raw=event)


def conversation_events(
    backend: OpenAIBackendAPI,
    messages: list[dict[str, Any]] | None = None,
    model: str = "auto",
    prompt: str = "",
    images: list[str] | None = None,
    size: str | None = None,
) -> Iterator[dict[str, Any]]:
    normalized = normalize_messages(messages or ([{"role": "user", "content": prompt}] if prompt else []))
    image_model = str(model or "").strip() in IMAGE_MODELS
    history_text = "" if image_model else assistant_history_text(normalized)
    history_messages = [] if image_model else assistant_history_messages(normalized)
    final_prompt = prompt_with_global_system(build_image_prompt(prompt, size)) if image_model else prompt
    payloads = backend.stream_conversation(
        messages=normalized,
        model=model,
        prompt=final_prompt,
        images=images if image_model else None,
        system_hints=["picture_v2"] if image_model else None,
    )
    yield from iter_conversation_payloads(payloads, history_text, history_messages)


def text_backend() -> OpenAIBackendAPI:
    return OpenAIBackendAPI(access_token=account_service.get_text_access_token())


def stream_text_deltas(backend: OpenAIBackendAPI, request: ConversationRequest) -> Iterator[str]:
    attempted_tokens: set[str] = set()
    token = getattr(backend, "access_token", "")
    emitted = False
    while True:
        if token and token in attempted_tokens:
            raise RuntimeError("no available text account")
        if token:
            attempted_tokens.add(token)
        try:
            active_backend = OpenAIBackendAPI(access_token=token)
            for event in conversation_events(active_backend, messages=request.messages, model=request.model, prompt=request.prompt):
                if event.get("type") != "conversation.delta":
                    continue
                delta = str(event.get("delta") or "")
                if delta:
                    emitted = True
                    yield delta
            account_service.mark_text_used(token)
            return
        except Exception as exc:
            error_message = str(exc)
            if token and not emitted and is_token_invalid_error(error_message):
                account_service.remove_invalid_token(token, "text_stream")
                token = account_service.get_text_access_token(attempted_tokens)
                if token:
                    continue
            raise


def collect_text(backend: OpenAIBackendAPI, request: ConversationRequest) -> str:
    return "".join(stream_text_deltas(backend, request))


def stream_image_outputs(
        backend: OpenAIBackendAPI,
        request: ConversationRequest,
        index: int = 1,
        total: int = 1,
) -> Iterator[ImageOutput]:
    last: dict[str, Any] = {}
    submit_started = time.time()
    first_event_seen = False
    emit_image_progress(
        request.progress_callback,
        phase="submitting",
        label="提交中",
    )
    for event in conversation_events(
            backend,
            prompt=request.prompt,
            model=request.model,
            images=request.images or [],
            size=request.size,
    ):
        if not first_event_seen:
            first_event_seen = True
            emit_image_progress(
                request.progress_callback,
                phase="polling",
                label="生成中",
                timing_key="upstream_submit_ms",
                duration_ms=elapsed_ms(submit_started),
            )
        last = event
        if event.get("type") == "conversation.delta":
            yield ImageOutput(
                kind="progress",
                model=request.model,
                index=index,
                total=total,
                text=str(event.get("delta") or ""),
                upstream_event_type="conversation.delta",
            )
            continue
        if event.get("type") == "conversation.event":
            raw = event.get("raw")
            raw_type = str(raw.get("type") or "") if isinstance(raw, dict) else ""
            yield ImageOutput(
                kind="progress",
                model=request.model,
                index=index,
                total=total,
                upstream_event_type=raw_type,
            )

    conversation_id = str(last.get("conversation_id") or "")
    file_ids = [str(item) for item in last.get("file_ids") or []]
    sediment_ids = [str(item) for item in last.get("sediment_ids") or []]
    message = str(last.get("text") or "").strip()
    is_text_response = last.get("tool_invoked") is False or last.get("turn_use_case") == "text"
    logger.info({
        "event": "image_stream_resolve_start",
        "conversation_id": conversation_id,
        "file_ids": file_ids,
        "sediment_ids": sediment_ids,
        "tool_invoked": last.get("tool_invoked"),
        "turn_use_case": last.get("turn_use_case"),
    })
    if message and not file_ids and not sediment_ids and last.get("blocked"):
        yield ImageOutput(kind="message", model=request.model, index=index, total=total, text=message)
        return
    if message and not file_ids and not sediment_ids and is_text_response:
        raise TextOnlyImageResponseError(f"上游返回了文字而不是图片：{message[:240]}")

    resolve_started = time.time()
    emit_image_progress(
        request.progress_callback,
        phase="polling",
        label="生成中",
    )
    poll_timeout_secs = request.image_poll_timeout_secs or config.image_poll_timeout_secs
    image_urls = backend.resolve_conversation_image_urls(
        conversation_id,
        file_ids,
        sediment_ids,
        progress_callback=request.progress_callback,
        poll_timeout_secs=poll_timeout_secs,
    )
    emit_image_progress(
        request.progress_callback,
        phase="downloading",
        label="下载中",
        timing_key="resolve_image_urls_ms",
        duration_ms=elapsed_ms(resolve_started),
    )
    if image_urls:
        download_started = time.time()
        image_items = [
            {"b64_json": base64.b64encode(image_data).decode("ascii")}
            for image_data in backend.download_image_bytes(image_urls)
        ]
        emit_image_progress(
            request.progress_callback,
            phase="saving",
            label="保存中",
            timing_key="download_image_ms",
            duration_ms=elapsed_ms(download_started),
        )
        save_started = time.time()
        data = format_image_result(
            image_items,
            request.prompt,
            request.response_format,
            request.base_url,
            int(time.time()),
            owner_identity=request.owner_identity,
            model=request.model,
            size=request.size,
            mode=request.mode or ("edit" if request.images else "generate"),
            source_task_id=request.source_task_id,
        )["data"]
        emit_image_progress(
            request.progress_callback,
            phase="saving",
            label="保存中",
            timing_key="save_image_ms",
            duration_ms=elapsed_ms(save_started),
        )
        if data:
            yield ImageOutput(kind="result", model=request.model, index=index, total=total, data=data)
        return

    if message:
        yield ImageOutput(kind="message", model=request.model, index=index, total=total, text=message)


class _ImageTokenScope(Protocol):
    def excluded(self, attempted_tokens: set[str] | None = None) -> set[str]:
        ...

    def remember(self, access_token: str) -> None:
        ...

    def acquire(self, attempted_tokens: set[str] | None = None) -> str:
        ...


@dataclass
class _ImageBatchTokenScope:
    tokens: set[str] = field(default_factory=set)
    lock: Any = field(default_factory=threading.Lock)

    def excluded(self, attempted_tokens: set[str] | None = None) -> set[str]:
        with self.lock:
            return set(attempted_tokens or set()) | set(self.tokens)

    def remember(self, access_token: str) -> None:
        if not access_token:
            return
        with self.lock:
            self.tokens.add(access_token)

    def acquire(self, attempted_tokens: set[str] | None = None) -> str:
        attempted = set(attempted_tokens or set())
        try:
            token = account_service.get_available_access_token(self.excluded(attempted))
        except RuntimeError:
            token = account_service.get_available_access_token(attempted)
        self.remember(token)
        return token


class _ImageRaceTokenCoordinator:
    def __init__(self) -> None:
        self.tokens: set[str] = set()
        self.slot_tokens: dict[int, set[str]] = {}
        self.lock = threading.Lock()

    def _slot_tokens(self, index: int) -> set[str]:
        return self.slot_tokens.setdefault(index, set())

    def excluded(self, index: int, attempted_tokens: set[str] | None = None) -> set[str]:
        with self.lock:
            return set(attempted_tokens or set()) | set(self.tokens) | set(self._slot_tokens(index))

    def remember(self, index: int, access_token: str) -> None:
        if not access_token:
            return
        with self.lock:
            self.tokens.add(access_token)
            self._slot_tokens(index).add(access_token)

    def acquire(self, index: int, attempted_tokens: set[str] | None = None) -> str:
        attempted = set(attempted_tokens or set())
        with self.lock:
            slot_excluded = attempted | set(self._slot_tokens(index))
            try:
                token = account_service.get_available_access_token(slot_excluded | set(self.tokens))
            except RuntimeError:
                token = account_service.get_available_access_token(slot_excluded)
            if token:
                self.tokens.add(token)
                self._slot_tokens(index).add(token)
            return token


class _ImageRaceSlotTokenScope:
    def __init__(self, coordinator: _ImageRaceTokenCoordinator, index: int) -> None:
        self.coordinator = coordinator
        self.index = index

    def excluded(self, attempted_tokens: set[str] | None = None) -> set[str]:
        return self.coordinator.excluded(self.index, attempted_tokens)

    def remember(self, access_token: str) -> None:
        self.coordinator.remember(self.index, access_token)

    def acquire(self, attempted_tokens: set[str] | None = None) -> str:
        return self.coordinator.acquire(self.index, attempted_tokens)


class _ImageBatchStopped(RuntimeError):
    pass


def _raise_if_batch_stopped(cancel_event: threading.Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise _ImageBatchStopped("image batch stopped")


def _release_cancelled_image_token(access_token: str) -> None:
    release_image_slot = getattr(account_service, "release_image_slot", None)
    if not callable(release_image_slot):
        return
    try:
        release_image_slot(access_token)
    except Exception:
        pass


def _thread_safe_progress_callback(
        progress_callback: Callable[[dict[str, Any]], None] | None,
) -> Callable[[dict[str, Any]], None] | None:
    if not callable(progress_callback):
        return progress_callback
    progress_lock = threading.Lock()

    def wrapped(event: dict[str, Any]) -> None:
        with progress_lock:
            progress_callback(event)

    return wrapped


def _stream_single_image_outputs_with_pool(
        request: ConversationRequest,
        index: int,
        total: int,
        token_scope: _ImageTokenScope | None = None,
        cancel_event: threading.Event | None = None,
        mark_cancelled_failure: bool = True,
) -> Iterator[ImageOutput]:
    emitted = False
    last_error = ""
    attempted_tokens: set[str] = set()
    empty_result_attempts = 0
    empty_result_limit = image_empty_result_retry_limit()
    registered_replacement_token = ""
    triggered_first_failure_register = False

    def try_register_after_first_failure(reason: str) -> bool:
        nonlocal registered_replacement_token, triggered_first_failure_register
        if triggered_first_failure_register or len(attempted_tokens) != 1:
            return False
        triggered_first_failure_register = True
        try:
            excluded_tokens = token_scope.excluded(attempted_tokens) if token_scope else attempted_tokens
            registered_replacement_token = account_service.register_image_account_for_request(
                excluded_tokens,
                reason=reason,
            )
            if token_scope:
                token_scope.remember(registered_replacement_token)
            logger.info({
                "event": "image_stream_first_failure_registered_account",
                "reason": reason,
                "attempted_tokens": len(attempted_tokens),
            })
            return bool(registered_replacement_token)
        except Exception as exc:
            logger.warning({
                "event": "image_stream_first_failure_register_failed",
                "reason": reason,
                "error": str(exc),
            })
            return False

    while True:
        _raise_if_batch_stopped(cancel_event)
        try:
            checkout_started = time.time()
            emit_image_progress(request.progress_callback, phase="checking_out_account", label="取账号")
            if registered_replacement_token:
                token = registered_replacement_token
                registered_replacement_token = ""
            elif token_scope:
                token = token_scope.acquire(attempted_tokens)
            else:
                token = account_service.get_available_access_token(attempted_tokens)
            if token_scope:
                token_scope.remember(token)
            emit_image_progress(
                request.progress_callback,
                phase="submitting",
                label="提交中",
                timing_key="account_checkout_ms",
                duration_ms=elapsed_ms(checkout_started),
                metadata={"attempted_tokens": len(attempted_tokens), "image_index": index, "image_total": total},
            )
        except RuntimeError as exc:
            if emitted:
                raise ImageGenerationError(image_stream_error_message(last_error or str(exc))) from exc
            if last_error:
                raise ImageGenerationError(image_stream_error_message(last_error)) from exc
            raise ImageGenerationError(str(exc) or "image generation failed") from exc
        attempted_tokens.add(token)

        emitted_for_token = False
        returned_message = False
        returned_result = False
        try:
            backend = OpenAIBackendAPI(access_token=token)
            attempt_timeout = (
                image_first_attempt_poll_timeout_secs()
                if empty_result_attempts == 0 and empty_result_limit > 1
                else config.image_poll_timeout_secs
            )
            attempt_request = dataclasses.replace(request, image_poll_timeout_secs=attempt_timeout)
            for output in stream_image_outputs(backend, attempt_request, index, total):
                _raise_if_batch_stopped(cancel_event)
                if output.kind == "message" and request.message_as_error:
                    raise ImageGenerationError(
                        output.text or "Image generation was rejected by upstream policy.",
                        status_code=400,
                        error_type="invalid_request_error",
                        code="content_policy_violation",
                    )
                emitted = True
                emitted_for_token = True
                returned_message = output.kind == "message"
                returned_result = returned_result or output.kind == "result"
                yield output
            if returned_message:
                account_service.mark_image_result(token, False)
                return
            if not returned_result:
                empty_result_attempts += 1
                last_error = no_image_result_message(attempt_timeout)
                logger.warning({
                    "event": "image_stream_empty_result",
                    "request_token": token,
                    "attempted_tokens": len(attempted_tokens),
                    "timeout_secs": attempt_timeout,
                })
                if empty_result_attempts >= empty_result_limit:
                    raise ImageGenerationError(image_stream_error_message(last_error))
                account_service.mark_image_result(token, False)
                try_register_after_first_failure("empty_image_result")
                continue
            account_service.mark_image_result(token, True)
            break
        except _ImageBatchStopped:
            if mark_cancelled_failure:
                account_service.mark_image_result(token, False)
            else:
                _release_cancelled_image_token(token)
            raise
        except ImageUsageLimitReachedError as exc:
            last_error = str(exc)
            resets_at, resets_in_seconds = extract_usage_limit_reset(last_error)
            account_service.mark_image_usage_limit(
                token,
                last_error,
                resets_at=resets_at,
                resets_in_seconds=resets_in_seconds,
            )
            logger.warning({
                "event": "image_stream_usage_limit",
                "request_token": token,
                "attempted_tokens": len(attempted_tokens),
            })
            try_register_after_first_failure("usage_limit_reached")
            continue
        except ChatGPTCheckoutRequiredError as exc:
            last_error = str(exc)
            account_service.mark_image_checkout_required(token, last_error)
            logger.warning({
                "event": "image_stream_checkout_required",
                "request_token": token,
                "attempted_tokens": len(attempted_tokens),
                "error": last_error,
            })
            try_register_after_first_failure("checkout_required")
            continue
        except TextOnlyImageResponseError as exc:
            account_service.mark_image_result(token, False)
            last_error = str(exc)
            logger.warning({
                "event": "image_stream_text_only_response",
                "request_token": token,
                "attempted_tokens": len(attempted_tokens),
                "error": last_error,
            })
            try_register_after_first_failure("text_only_response")
            continue
        except ImageGenerationError:
            account_service.mark_image_result(token, False)
            raise
        except Exception as exc:
            last_error = str(exc)
            if is_usage_limit_error(last_error):
                resets_at, resets_in_seconds = extract_usage_limit_reset(last_error)
                account_service.mark_image_usage_limit(
                    token,
                    last_error,
                    resets_at=resets_at,
                    resets_in_seconds=resets_in_seconds,
                )
                logger.warning({
                    "event": "image_stream_usage_limit",
                    "request_token": token,
                    "attempted_tokens": len(attempted_tokens),
                })
                try_register_after_first_failure("usage_limit_error")
                continue
            logger.warning({"event": "image_stream_fail", "request_token": token, "error": last_error})
            if not emitted_for_token and is_token_invalid_error(last_error):
                account_service.remove_unusable_image_token(token, "image_stream_invalid_token", last_error)
                try_register_after_first_failure("invalid_token")
                continue
            if not emitted_for_token and is_unusable_image_account_error(last_error):
                account_service.remove_unusable_image_token(token, "image_unusable", last_error)
                try_register_after_first_failure("unusable_image_account")
                continue
            if not emitted_for_token and is_retryable_image_connection_error(last_error):
                account_service.mark_image_result(token, False)
                logger.warning({
                    "event": "image_stream_retryable_connection_error",
                    "request_token": token,
                    "attempted_tokens": len(attempted_tokens),
                    "error": last_error,
                })
                try_register_after_first_failure("connection_error")
                continue
            account_service.mark_image_result(token, False)
            if try_register_after_first_failure("image_stream_error"):
                continue
            raise ImageGenerationError(image_stream_error_message(last_error)) from exc

    if not emitted:
        raise ImageGenerationError(image_stream_error_message(last_error))


def _collect_single_image_outputs_with_pool(
        request: ConversationRequest,
        index: int,
        total: int,
        token_scope: _ImageTokenScope,
        cancel_event: threading.Event,
        mark_cancelled_failure: bool = True,
) -> list[ImageOutput]:
    return list(
        _stream_single_image_outputs_with_pool(
            request,
            index,
            total,
            token_scope,
            cancel_event,
            mark_cancelled_failure,
        )
    )


def _stream_race_image_outputs_with_pool(request: ConversationRequest, total: int) -> Iterator[ImageOutput]:
    race_parallelism = image_race_parallelism_limit()
    max_inflight = image_race_max_inflight_limit(total)
    token_coordinator = _ImageRaceTokenCoordinator()
    worker_request = dataclasses.replace(
        request,
        progress_callback=_thread_safe_progress_callback(request.progress_callback),
    )
    logger.info({
        "event": "image_stream_race_batch_start",
        "image_count": total,
        "race_parallelism": race_parallelism,
        "max_inflight": max_inflight,
    })
    emit_image_progress(
        request.progress_callback,
        phase="submitting",
        label="批量提交中" if total > 1 else "提交中",
        metadata={"image_total": total, "race_parallelism": race_parallelism, "max_inflight": max_inflight},
    )

    results: dict[int, list[ImageOutput]] = {}
    slot_errors: dict[int, BaseException] = {}
    slot_attempts = {index: 0 for index in range(1, total + 1)}
    slot_cancel_events = {index: threading.Event() for index in range(1, total + 1)}
    future_to_index: dict[Any, int] = {}
    executor = ThreadPoolExecutor(max_workers=max_inflight, thread_name_prefix="image-race")
    shutdown_wait = True

    def slot_is_active(index: int) -> bool:
        return any(active_index == index for active_index in future_to_index.values())

    def submit_slot(index: int) -> bool:
        if index in results or slot_attempts[index] >= race_parallelism:
            return False
        future = executor.submit(
            _collect_single_image_outputs_with_pool,
            worker_request,
            index,
            total,
            _ImageRaceSlotTokenScope(token_coordinator, index),
            slot_cancel_events[index],
            False,
        )
        future_to_index[future] = index
        slot_attempts[index] += 1
        return True

    def fill_capacity() -> None:
        while len(future_to_index) < max_inflight:
            submitted = False
            for index in range(1, total + 1):
                if index in results or slot_is_active(index):
                    continue
                submitted = submit_slot(index)
                if submitted:
                    break
            if submitted:
                continue
            for index in range(1, total + 1):
                if index in results:
                    continue
                submitted = submit_slot(index)
                if submitted:
                    break
            if not submitted:
                break

    def cancel_slot_losers(index: int) -> None:
        slot_cancel_events[index].set()
        for future, active_index in list(future_to_index.items()):
            if active_index != index:
                continue
            if future.cancel():
                future_to_index.pop(future, None)

    def cancel_batch() -> None:
        for event in slot_cancel_events.values():
            event.set()
        for future in list(future_to_index):
            future.cancel()
        future_to_index.clear()

    try:
        for index in range(1, total + 1):
            submit_slot(index)
        fill_capacity()

        while len(results) < total:
            if not future_to_index:
                error = next(
                    (slot_errors[index] for index in range(1, total + 1) if index not in results and index in slot_errors),
                    None,
                )
                if error is not None:
                    raise error
                raise ImageGenerationError("image generation failed")

            done, _ = wait(set(future_to_index), return_when=FIRST_COMPLETED)
            for future in done:
                index = future_to_index.pop(future, None)
                if index is None or index in results:
                    continue
                try:
                    outputs = future.result()
                except (CancelledError, _ImageBatchStopped):
                    continue
                except Exception as exc:
                    slot_errors[index] = exc
                    if slot_attempts[index] >= race_parallelism and not slot_is_active(index):
                        cancel_batch()
                        shutdown_wait = False
                        raise
                    continue

                message_output = next((output for output in outputs if output.kind == "message"), None)
                if message_output is not None:
                    cancel_batch()
                    shutdown_wait = False
                    yield message_output
                    return

                if any(output.kind == "result" for output in outputs):
                    results[index] = outputs
                    cancel_slot_losers(index)
                    continue

                slot_errors[index] = ImageGenerationError("image generation failed")
                if slot_attempts[index] >= race_parallelism and not slot_is_active(index):
                    cancel_batch()
                    shutdown_wait = False
                    raise slot_errors[index]
            fill_capacity()
    finally:
        if len(results) >= total:
            shutdown_wait = False
        logger.info({
            "event": "image_stream_race_batch_done",
            "image_count": total,
            "completed": len(results),
        })
        executor.shutdown(wait=shutdown_wait, cancel_futures=not shutdown_wait)

    for index in range(1, total + 1):
        for output in results.get(index, []):
            yield output


def _stream_parallel_image_outputs_with_pool(request: ConversationRequest, total: int) -> Iterator[ImageOutput]:
    parallelism = min(total, image_request_parallelism_limit())
    token_scope = _ImageBatchTokenScope()
    cancel_event = threading.Event()
    worker_request = dataclasses.replace(
        request,
        progress_callback=_thread_safe_progress_callback(request.progress_callback),
    )
    logger.info({
        "event": "image_stream_parallel_batch_start",
        "image_count": total,
        "parallelism": parallelism,
    })
    emit_image_progress(
        request.progress_callback,
        phase="submitting",
        label="批量提交中",
        metadata={"image_total": total, "parallelism": parallelism},
    )
    results: dict[int, list[ImageOutput]] = {}
    executor = ThreadPoolExecutor(max_workers=parallelism, thread_name_prefix="image-batch")
    shutdown_wait = True
    try:
        future_to_index = {
            executor.submit(
                _collect_single_image_outputs_with_pool,
                worker_request,
                index,
                total,
                token_scope,
                cancel_event,
            ): index
            for index in range(1, total + 1)
        }
        try:
            for future in as_completed(future_to_index):
                index = future_to_index[future]
                try:
                    outputs = future.result()
                except _ImageBatchStopped:
                    continue
                except Exception:
                    cancel_event.set()
                    for pending in future_to_index:
                        if pending is not future:
                            pending.cancel()
                    shutdown_wait = False
                    raise
                message_output = next((output for output in outputs if output.kind == "message"), None)
                if message_output is not None:
                    cancel_event.set()
                    for pending in future_to_index:
                        if pending is not future:
                            pending.cancel()
                    shutdown_wait = False
                    yield message_output
                    return
                results[index] = outputs
        finally:
            logger.info({
                "event": "image_stream_parallel_batch_done",
                "image_count": total,
                "completed": len(results),
            })
    finally:
        executor.shutdown(wait=shutdown_wait, cancel_futures=not shutdown_wait)

    for index in range(1, total + 1):
        for output in results.get(index, []):
            yield output


def stream_image_outputs_with_pool(request: ConversationRequest) -> Iterator[ImageOutput]:
    if str(request.model or "").strip() not in IMAGE_MODELS:
        raise ImageGenerationError("unsupported image model,supported models: " + ", ".join(IMAGE_MODELS))

    account_service.begin_image_request()
    try:
        capacity_started = time.time()
        emit_image_progress(request.progress_callback, phase="checking_capacity", label="检查号池")
        if not account_service.ensure_image_capacity():
            raise ImageGenerationError(
                "当前无可用图片账号，已尝试补充号池，请稍后重试。",
                status_code=429,
                error_type="insufficient_quota",
                code="insufficient_quota",
            )
        emit_image_progress(
            request.progress_callback,
            phase="checking_out_account",
            label="取账号",
            timing_key="capacity_check_ms",
            duration_ms=elapsed_ms(capacity_started),
        )

        total = max(1, int(request.n or 1))
        race_enabled = image_race_parallelism_limit() > 1 and image_race_max_inflight_limit(total) > total
        if race_enabled:
            yield from _stream_race_image_outputs_with_pool(request, total)
        elif total == 1:
            yield from _stream_single_image_outputs_with_pool(request, 1, 1)
        else:
            yield from _stream_parallel_image_outputs_with_pool(request, total)
    finally:
        account_service.end_image_request()


def stream_image_chunks(outputs: Iterable[ImageOutput]) -> Iterator[dict[str, Any]]:
    for output in outputs:
        yield output.to_chunk()


def collect_image_outputs(outputs: Iterable[ImageOutput]) -> dict[str, Any]:
    created = None
    data: list[dict[str, Any]] = []
    message = ""
    progress_parts: list[str] = []
    for output in outputs:
        created = created or output.created
        if output.kind == "progress" and output.text:
            progress_parts.append(output.text)
        elif output.kind == "message":
            message = output.text
        elif output.kind == "result":
            data.extend(output.data)

    result: dict[str, Any] = {"created": created or int(time.time()), "data": data}
    if not data:
        text = message or "".join(progress_parts).strip()
        if text:
            result["message"] = text
    return result
