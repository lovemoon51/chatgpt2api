from __future__ import annotations

import json
import math
import queue
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from services.config import DATA_DIR, config
from services.content_filter import request_text
from services.image_metadata_storage import get_image_metadata_storage
from services.log_service import LOG_TYPE_CALL, log_service
from services.protocol.conversation import no_image_result_message
from services.protocol import agnes_ai_video, openai_v1_image_edit, openai_v1_image_generations
from services.system_status_service import worker_error, worker_heartbeat, worker_started, worker_stopped

TASK_STATUS_QUEUED = "queued"
TASK_STATUS_RUNNING = "running"
TASK_STATUS_SUCCESS = "success"
TASK_STATUS_ERROR = "error"
TASK_STATUS_CANCELLED = "cancelled"
TERMINAL_STATUSES = {TASK_STATUS_SUCCESS, TASK_STATUS_ERROR, TASK_STATUS_CANCELLED}
UNFINISHED_STATUSES = {TASK_STATUS_QUEUED, TASK_STATUS_RUNNING}
DEFAULT_WORKER_COUNT = 3
DEFAULT_MAX_QUEUE_SIZE = 100
FRONTEND_TIMING_KEYS = {"frontend_render_ms", "reveal_duration_ms"}
TASK_PHASE_QUEUED = "queued"
TASK_PHASE_STARTING = "starting"
TASK_PHASE_CHECKING_CAPACITY = "checking_capacity"
TASK_PHASE_CHECKING_OUT_ACCOUNT = "checking_out_account"
TASK_PHASE_SUBMITTING = "submitting"
TASK_PHASE_POLLING = "polling"
TASK_PHASE_DOWNLOADING = "downloading"
TASK_PHASE_SAVING = "saving"
TASK_PHASE_RUNNING = "running"
TASK_PHASE_SUCCESS = "success"
TASK_PHASE_ERROR = "error"
TASK_PHASE_CANCELLED = "cancelled"
TASK_PHASE_LABELS = {
    TASK_PHASE_QUEUED: "排队中",
    TASK_PHASE_STARTING: "启动中",
    TASK_PHASE_CHECKING_CAPACITY: "检查号池",
    TASK_PHASE_CHECKING_OUT_ACCOUNT: "取账号",
    TASK_PHASE_SUBMITTING: "提交中",
    TASK_PHASE_POLLING: "生成中",
    TASK_PHASE_DOWNLOADING: "下载中",
    TASK_PHASE_SAVING: "保存中",
    TASK_PHASE_RUNNING: "生成中",
    TASK_PHASE_SUCCESS: "已完成",
    TASK_PHASE_ERROR: "失败",
    TASK_PHASE_CANCELLED: "已取消",
}


class ImageTaskQueueFull(RuntimeError):
    pass


class ImageTaskNotFound(KeyError):
    pass


class ImageTaskCancelError(ValueError):
    pass


@dataclass
class _ImageTaskJob:
    key: str
    mode: str
    payload: dict[str, Any]
    identity: dict[str, object]
    model: str
    release: Callable[[], None]


@dataclass
class _ReleaseOnce:
    callback: Callable[[], None] | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _released: bool = False

    def __call__(self) -> None:
        with self._lock:
            if self._released:
                return
            self._released = True
            callback = self.callback
        if callback is not None:
            callback()


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _timestamp(value: object) -> float:
    if not isinstance(value, str) or not value.strip():
        return 0.0
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value[:26], fmt).timestamp()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _clean(value: object, default: str = "") -> str:
    return str(value or default).strip()


def _owner_id(identity: dict[str, object]) -> str:
    return _clean(identity.get("id")) or "anonymous"


def _task_key(owner_id: str, task_id: str) -> str:
    return f"{owner_id}:{task_id}"


def _collect_image_urls(data: list[Any]) -> list[str]:
    urls: list[str] = []
    for item in data:
        if isinstance(item, dict):
            url = item.get("url")
            if isinstance(url, str) and url:
                urls.append(url)
    return urls


def _collect_media_urls(data: list[Any]) -> list[str]:
    urls: list[str] = []
    for item in data:
        if isinstance(item, dict):
            url = item.get("video_url") or item.get("url")
            if isinstance(url, str) and url:
                urls.append(url)
    return urls


def _phase_label(phase: object) -> str:
    clean_phase = _clean(phase)
    return TASK_PHASE_LABELS.get(clean_phase, clean_phase or TASK_PHASE_QUEUED)


def _phase_from_status(status: object) -> str:
    clean_status = _clean(status)
    if clean_status == TASK_STATUS_QUEUED:
        return TASK_PHASE_QUEUED
    if clean_status == TASK_STATUS_RUNNING:
        return TASK_PHASE_RUNNING
    if clean_status == TASK_STATUS_SUCCESS:
        return TASK_PHASE_SUCCESS
    if clean_status == TASK_STATUS_CANCELLED:
        return TASK_PHASE_CANCELLED
    return TASK_PHASE_ERROR


def _clean_timings(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    timings: dict[str, int] = {}
    for key, item in value.items():
        clean_key = _clean(key)
        if not clean_key or isinstance(item, bool):
            continue
        if isinstance(item, (int, float)):
            timings[clean_key] = max(0, int(item))
    return timings


def _task_timings(task: dict[str, Any]) -> dict[str, int]:
    timings = _clean_timings(task.get("timings"))
    timings.update(_clean_timings(task.get("timing_ms")))
    queue_duration = task.get("queue_duration_ms")
    if isinstance(queue_duration, int):
        timings.setdefault("queue_wait_ms", max(0, queue_duration))
    duration = task.get("duration_ms")
    if isinstance(duration, int):
        timings.setdefault("worker_total_ms", max(0, duration))
    return timings


def _phase_updates(phase: str, timings: dict[str, int] | None = None) -> dict[str, Any]:
    clean_phase = _clean(phase) or TASK_PHASE_RUNNING
    updates: dict[str, Any] = {
        "phase": clean_phase,
        "phase_label": _phase_label(clean_phase),
        "phase_updated_at": _now_iso(),
    }
    if timings is not None:
        clean_timings = _clean_timings(timings)
        updates["timings"] = clean_timings
        updates["timing_ms"] = clean_timings
    return updates


def _clean_metadata(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    try:
        encoded = json.dumps(value, ensure_ascii=False)
        decoded = json.loads(encoded)
    except Exception:
        return {}
    return decoded if isinstance(decoded, dict) else {}


def _percentile(values: list[int], percentile: int) -> int | None:
    if not values:
        return None
    ordered = sorted(max(0, int(value)) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * max(0, min(100, percentile)) / 100
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    if lower == upper:
        return ordered[lower]
    fraction = rank - lower
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * fraction)


def _public_task(task: dict[str, Any], base_url: str = "") -> dict[str, Any]:
    from services.signed_url_service import generate_signed_image_url

    phase = _clean(task.get("phase")) or _phase_from_status(task.get("status"))
    timings = _task_timings(task)
    item = {
        "id": task.get("id"),
        "status": task.get("status"),
        "phase": phase,
        "phase_label": _clean(task.get("phase_label")) or _phase_label(phase),
        "phase_updated_at": task.get("phase_updated_at") or task.get("updated_at"),
        "mode": task.get("mode"),
        "model": task.get("model"),
        "size": task.get("size"),
        "resolution": task.get("resolution"),
        "media_type": task.get("media_type") or ("video" if task.get("mode") == "video" else "image"),
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
        "timings": timings,
        "timing_ms": timings,
    }
    for key in ("queued_at", "started_at", "finished_at", "duration_ms", "queue_duration_ms"):
        if task.get(key) is not None:
            item[key] = task.get(key)

    # 处理图片数据，添加签名 URL
    if task.get("data") is not None:
        data_with_signed_urls = []
        for data_item in task.get("data"):
            if not isinstance(data_item, dict):
                data_with_signed_urls.append(data_item)
                continue

            # 复制原始数据
            enhanced_item = dict(data_item)

            # 如果有 URL，生成签名 URL
            if base_url and data_item.get("url"):
                try:
                    # 提取图片路径（移除 /images/ 前缀）
                    image_url = str(data_item.get("url"))
                    if image_url.startswith("/images/"):
                        image_path = image_url[len("/images/"):]
                        # 生成 1 小时有效期的签名 URL
                        signed_url = generate_signed_image_url(image_path, base_url, expires_in=3600)
                        enhanced_item["signed_url"] = signed_url
                except Exception:
                    # 如果生成签名 URL 失败，忽略错误，继续使用原始 URL
                    pass

            data_with_signed_urls.append(enhanced_item)

        item["data"] = data_with_signed_urls

    metadata = _clean_metadata(task.get("metadata"))
    if metadata:
        item["metadata"] = metadata
    if task.get("error"):
        item["error"] = task.get("error")
    return item


class ImageTaskService:
    def __init__(
        self,
        path: Path,
        *,
        generation_handler: Callable[[dict[str, Any]], dict[str, Any]] = openai_v1_image_generations.handle,
        edit_handler: Callable[[dict[str, Any]], dict[str, Any]] = openai_v1_image_edit.handle,
        video_handler: Callable[[dict[str, Any]], dict[str, Any]] = agnes_ai_video.handle,
        retention_days_getter: Callable[[], int] | None = None,
        worker_count: int = DEFAULT_WORKER_COUNT,
        max_queue_size: int = DEFAULT_MAX_QUEUE_SIZE,
    ):
        self.path = path
        self.generation_handler = generation_handler
        self.edit_handler = edit_handler
        self.video_handler = video_handler
        self.retention_days_getter = retention_days_getter or (lambda: config.image_retention_days)
        self.worker_count = max(1, int(worker_count or DEFAULT_WORKER_COUNT))
        self.max_queue_size = max(1, int(max_queue_size or DEFAULT_MAX_QUEUE_SIZE))
        self._lock = threading.RLock()
        self._queue: queue.Queue[_ImageTaskJob] = queue.Queue(maxsize=self.max_queue_size)
        self._leases: dict[str, _ReleaseOnce] = {}
        self._workers: list[threading.Thread] = []
        self._worker_statuses: dict[str, dict[str, Any]] = {}
        self._tasks: dict[str, dict[str, Any]] = {}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self._tasks = self._load_locked()
            changed = self._recover_unfinished_locked()
            changed = self._cleanup_locked() or changed
            if changed:
                self._save_locked()
        self._start_workers()

    def submit_generation(
        self,
        identity: dict[str, object],
        *,
        client_task_id: str,
        prompt: str,
        model: str,
        size: str | None,
        resolution: str | None = None,
        public: bool = False,
        base_url: str,
        release_usage_limit: Callable[[], None] | None = None,
        acquire_usage_limit: Callable[[], Callable[[], None]] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "prompt": prompt,
            "model": model,
            "n": 1,
            "size": size,
            "resolution": resolution,
            "response_format": "url",
            "base_url": base_url,
            "owner_identity": dict(identity),
            "source_task_id": client_task_id,
            "public": bool(public),
        }
        return self._submit(
            identity,
            client_task_id=client_task_id,
            mode="generate",
            payload=payload,
            release_usage_limit=release_usage_limit,
            acquire_usage_limit=acquire_usage_limit,
        )

    def submit_edit(
        self,
        identity: dict[str, object],
        *,
        client_task_id: str,
        prompt: str,
        model: str,
        size: str | None,
        resolution: str | None = None,
        public: bool = False,
        base_url: str,
        images: list[tuple[bytes, str, str]],
        release_usage_limit: Callable[[], None] | None = None,
        acquire_usage_limit: Callable[[], Callable[[], None]] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "prompt": prompt,
            "images": images,
            "model": model,
            "n": 1,
            "size": size,
            "resolution": resolution,
            "response_format": "url",
            "base_url": base_url,
            "owner_identity": dict(identity),
            "source_task_id": client_task_id,
            "public": bool(public),
        }
        return self._submit(
            identity,
            client_task_id=client_task_id,
            mode="edit",
            payload=payload,
            release_usage_limit=release_usage_limit,
            acquire_usage_limit=acquire_usage_limit,
        )

    def submit_video(
        self,
        identity: dict[str, object],
        *,
        client_task_id: str,
        prompt: str,
        model: str,
        size: str | None,
        base_url: str,
        reference_image_urls: list[str] | None = None,
        release_usage_limit: Callable[[], None] | None = None,
        acquire_usage_limit: Callable[[], Callable[[], None]] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "prompt": prompt,
            "model": model,
            "size": size,
            "reference_image_urls": list(reference_image_urls or []),
            "base_url": base_url,
            "owner_identity": dict(identity),
            "source_task_id": client_task_id,
        }
        return self._submit(
            identity,
            client_task_id=client_task_id,
            mode="video",
            payload=payload,
            release_usage_limit=release_usage_limit,
            acquire_usage_limit=acquire_usage_limit,
        )

    def list_tasks(self, identity: dict[str, object], task_ids: list[str], base_url: str = "") -> dict[str, Any]:
        owner = _owner_id(identity)
        requested_ids = [_clean(task_id) for task_id in task_ids if _clean(task_id)]
        with self._lock:
            if self._cleanup_locked():
                self._save_locked()
            items = []
            missing_ids = []
            for task_id in requested_ids:
                task = self._tasks.get(_task_key(owner, task_id))
                if task is None:
                    missing_ids.append(task_id)
                else:
                    items.append(_public_task(task, base_url))
            if not requested_ids:
                items = [
                    _public_task(task, base_url)
                    for task in self._tasks.values()
                    if task.get("owner_id") == owner
                ]
                items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
                missing_ids = []
            return {"items": items, "missing_ids": missing_ids}

    def cancel_task(self, identity: dict[str, object], task_id: str) -> dict[str, Any]:
        owner = _owner_id(identity)
        clean_task_id = _clean(task_id)
        if not clean_task_id:
            raise ImageTaskNotFound("image task not found")
        key = _task_key(owner, clean_task_id)
        release_now: _ReleaseOnce | None = None
        with self._lock:
            task = self._tasks.get(key)
            if task is None:
                raise ImageTaskNotFound("image task not found")
            status = _clean(task.get("status"))
            if status in TERMINAL_STATUSES:
                raise ImageTaskCancelError("image task is already finished")
            now = _now_iso()
            if status == TASK_STATUS_QUEUED:
                queued_timestamp = _timestamp(task.get("queued_at") or task.get("created_at"))
                queue_duration_ms = max(0, int((time.time() - queued_timestamp) * 1000)) if queued_timestamp else 0
                task.update(
                    {
                        "status": TASK_STATUS_CANCELLED,
                        "error": "image task cancelled",
                        "finished_at": now,
                        "queue_duration_ms": queue_duration_ms,
                        "duration_ms": 0,
                        **_phase_updates(
                            TASK_PHASE_CANCELLED,
                            {
                                **_task_timings(task),
                                "queue_wait_ms": queue_duration_ms,
                                "worker_total_ms": 0,
                            },
                        ),
                        "updated_at": now,
                    }
                )
                release_now = self._leases.pop(key, None)
            else:
                task["cancel_requested"] = True
                task["error"] = "image task cancellation requested"
                task.update(_phase_updates(_clean(task.get("phase")) or TASK_PHASE_RUNNING, _task_timings(task)))
                task["updated_at"] = now
            self._save_locked()
            public = _public_task(task)
        if release_now is not None:
            release_now()
        return public

    def report_timing(
        self,
        identity: dict[str, object],
        task_id: str,
        *,
        timing_key: str,
        duration_ms: object,
        phase: str | None = None,
    ) -> dict[str, Any]:
        owner = _owner_id(identity)
        clean_task_id = _clean(task_id)
        clean_timing_key = _clean(timing_key)
        if not clean_task_id:
            raise ImageTaskNotFound("image task not found")
        if clean_timing_key not in FRONTEND_TIMING_KEYS:
            raise ValueError("unsupported timing_key")
        if isinstance(duration_ms, bool) or not isinstance(duration_ms, (int, float)) or not math.isfinite(float(duration_ms)) or duration_ms < 0:
            raise ValueError("duration_ms must be a non-negative number")
        clean_duration_ms = int(duration_ms)
        key = _task_key(owner, clean_task_id)
        with self._lock:
            task = self._tasks.get(key)
            if task is None:
                raise ImageTaskNotFound("image task not found")
            timings = _task_timings(task)
            timings[clean_timing_key] = clean_duration_ms
            task["timings"] = timings
            task["timing_ms"] = timings
            if _clean(phase):
                metadata = _clean_metadata(task.get("metadata"))
                metadata["frontend_timing_phase"] = _clean(phase)
                task["metadata"] = metadata
            task["updated_at"] = _now_iso()
            self._save_locked()
            return _public_task(task)

    def queue_overview(self) -> dict[str, Any]:
        with self._lock:
            phase_counts: dict[str, int] = {}
            for task in self._tasks.values():
                if task.get("status") not in UNFINISHED_STATUSES:
                    continue
                phase = _clean(task.get("phase")) or _phase_from_status(task.get("status"))
                phase_counts[phase] = phase_counts.get(phase, 0) + 1
            queued_items = [
                task
                for task in self._tasks.values()
                if task.get("status") == TASK_STATUS_QUEUED
            ]
            running_items = [
                task
                for task in self._tasks.values()
                if task.get("status") == TASK_STATUS_RUNNING
            ]
            failed_items = [
                task
                for task in self._tasks.values()
                if task.get("status") == TASK_STATUS_ERROR
            ]
            finished_items = [
                task
                for task in self._tasks.values()
                if task.get("status") in TERMINAL_STATUSES
            ]
            queue_durations = [
                int(task.get("queue_duration_ms"))
                for task in finished_items
                if isinstance(task.get("queue_duration_ms"), int)
            ]
            total_durations = [
                int(task.get("duration_ms"))
                for task in finished_items
                if isinstance(task.get("duration_ms"), int)
            ]
            oldest_queued_at = min(
                (_timestamp(task.get("queued_at") or task.get("created_at")) for task in queued_items),
                default=0.0,
            )
            oldest_queue_duration_ms = (
                max(0, int((time.time() - oldest_queued_at) * 1000))
                if oldest_queued_at
                else 0
            )
            return {
                "total": len(self._tasks),
                "queued": len(queued_items),
                "running": len(running_items),
                "failed": len(failed_items),
                "capacity": self.max_queue_size,
                "available": max(0, self.max_queue_size - self._queue.qsize()),
                "workers": self.worker_count,
                "oldest_queue_duration_ms": oldest_queue_duration_ms,
                "phase_counts": phase_counts,
                "checking_capacity": phase_counts.get(TASK_PHASE_CHECKING_CAPACITY, 0),
                "checking_out_account": phase_counts.get(TASK_PHASE_CHECKING_OUT_ACCOUNT, 0),
                "submitting": phase_counts.get(TASK_PHASE_SUBMITTING, 0),
                "polling": phase_counts.get(TASK_PHASE_POLLING, 0) + phase_counts.get(TASK_PHASE_RUNNING, 0),
                "downloading": phase_counts.get(TASK_PHASE_DOWNLOADING, 0),
                "saving": phase_counts.get(TASK_PHASE_SAVING, 0),
                "avg_wait_ms": round(sum(queue_durations) / len(queue_durations), 2) if queue_durations else None,
                "p90_wait_ms": _percentile(queue_durations, 90),
                "p99_wait_ms": _percentile(queue_durations, 99),
                "avg_duration_ms": round(sum(total_durations) / len(total_durations), 2) if total_durations else None,
                "p90_duration_ms": _percentile(total_durations, 90),
                "p99_duration_ms": _percentile(total_durations, 99),
            }

    def get_worker_statuses(self) -> list[dict[str, Any]]:
        with self._lock:
            items = []
            for thread in self._workers:
                status = dict(self._worker_statuses.get(thread.name) or {})
                status.setdefault("name", thread.name)
                status["running"] = bool(thread.is_alive())
                status.setdefault("started_at", None)
                status.setdefault("last_heartbeat", None)
                status.setdefault("last_error", None)
                items.append(status)
            return items

    def _submit(
        self,
        identity: dict[str, object],
        *,
        client_task_id: str,
        mode: str,
        payload: dict[str, Any],
        release_usage_limit: Callable[[], None] | None = None,
        acquire_usage_limit: Callable[[], Callable[[], None]] | None = None,
    ) -> dict[str, Any]:
        task_id = _clean(client_task_id)
        if not task_id:
            raise ValueError("client_task_id is required")
        owner = _owner_id(identity)
        key = _task_key(owner, task_id)
        release_once = _ReleaseOnce(release_usage_limit)
        with self._lock:
            cleaned = self._cleanup_locked()
            task = self._tasks.get(key)
            if task is not None:
                release_once()
                if cleaned:
                    self._save_locked()
                return _public_task(task)

        if acquire_usage_limit is not None:
            release_once = _ReleaseOnce(acquire_usage_limit())

        now = _now_iso()
        task = {
            "id": task_id,
            "owner_id": owner,
            "status": TASK_STATUS_QUEUED,
            **_phase_updates(TASK_PHASE_QUEUED, {}),
            "mode": mode,
            "media_type": "video" if mode == "video" else "image",
            "model": _clean(payload.get("model"), "gpt-image-2"),
            "size": _clean(payload.get("size")),
            "resolution": _clean(payload.get("resolution")),
            "created_at": now,
            "updated_at": now,
            "queued_at": now,
        }
        job = _ImageTaskJob(
            key=key,
            mode=mode,
            payload=payload,
            identity=dict(identity),
            model=_clean(payload.get("model"), "gpt-image-2"),
            release=release_once,
        )
        with self._lock:
            cleaned = self._cleanup_locked()
            existing_task = self._tasks.get(key)
            if existing_task is not None:
                release_once()
                if cleaned:
                    self._save_locked()
                return _public_task(existing_task)
            self._tasks[key] = task
            self._leases[key] = release_once
            try:
                self._queue.put_nowait(job)
            except queue.Full as exc:
                self._leases.pop(key, None)
                self._tasks.pop(key, None)
                self._save_locked()
                release_once()
                raise ImageTaskQueueFull("image task queue is full") from exc
            self._save_locked()
        return _public_task(task)

    def _start_workers(self) -> None:
        for index in range(self.worker_count):
            name = f"image-task-worker-{index + 1}"
            thread = threading.Thread(
                target=self._worker_loop,
                name=name,
                daemon=True,
            )
            with self._lock:
                self._worker_statuses[name] = {
                    "name": name,
                    "running": False,
                    "started_at": None,
                    "last_heartbeat": None,
                    "last_error": None,
                }
            thread.start()
            self._workers.append(thread)

    def _worker_loop(self) -> None:
        name = threading.current_thread().name
        self._mark_worker_started(name)
        worker_started(name)
        try:
            while True:
                self._mark_worker_heartbeat(name)
                worker_heartbeat(name)
                job = self._queue.get()
                try:
                    self._run_task(job)
                except Exception as exc:
                    self._mark_worker_error(name, exc)
                    worker_error(name, exc)
                finally:
                    self._queue.task_done()
        except Exception as exc:
            self._mark_worker_stopped(name, exc)
            worker_stopped(name, exc)
            raise

    def _mark_worker_started(self, name: str) -> None:
        now = _now_iso()
        with self._lock:
            status = self._worker_statuses.setdefault(name, {"name": name})
            status.update({
                "running": True,
                "started_at": status.get("started_at") or now,
                "last_heartbeat": now,
                "last_error": status.get("last_error"),
            })

    def _mark_worker_heartbeat(self, name: str) -> None:
        with self._lock:
            status = self._worker_statuses.setdefault(name, {"name": name})
            status["running"] = True
            status["last_heartbeat"] = _now_iso()

    def _mark_worker_error(self, name: str, exc: BaseException) -> None:
        with self._lock:
            status = self._worker_statuses.setdefault(name, {"name": name})
            status["running"] = True
            status["last_heartbeat"] = _now_iso()
            status["last_error"] = str(exc) or exc.__class__.__name__

    def _mark_worker_stopped(self, name: str, exc: BaseException | None = None) -> None:
        with self._lock:
            status = self._worker_statuses.setdefault(name, {"name": name})
            status["running"] = False
            status["last_heartbeat"] = _now_iso()
            if exc is not None:
                status["last_error"] = str(exc) or exc.__class__.__name__

    def _run_task(
        self,
        job: _ImageTaskJob,
    ) -> None:
        started = time.time()
        started_at = _now_iso()
        key = job.key
        with self._lock:
            task = self._tasks.get(key)
            if task is None or task.get("status") == TASK_STATUS_CANCELLED:
                self._leases.pop(key, None)
                job.release()
                return
            queued_timestamp = _timestamp(task.get("queued_at") or task.get("created_at")) if task else 0.0
        queue_duration_ms = max(0, int((started - queued_timestamp) * 1000)) if queued_timestamp else 0
        self._update_task(
            key,
            status=TASK_STATUS_RUNNING,
            **_phase_updates(
                TASK_PHASE_STARTING,
                {
                    **_task_timings(task),
                    "queue_wait_ms": queue_duration_ms,
                },
            ),
            error="",
            started_at=started_at,
            queue_duration_ms=queue_duration_ms,
        )
        try:
            if job.mode == "video":
                handler = self.video_handler
            else:
                handler = self.edit_handler if job.mode == "edit" else self.generation_handler
            progress_callback = self._make_progress_callback(key, started)
            job.payload["progress_callback"] = progress_callback
            job.payload["task_phase_callback"] = progress_callback
            self._update_task(
                key,
                **_phase_updates(
                    TASK_PHASE_RUNNING,
                    {
                        **_task_timings(task),
                        "queue_wait_ms": queue_duration_ms,
                    },
                ),
            )
            result = handler(job.payload)
            if not isinstance(result, dict):
                raise RuntimeError("image task returned streaming result unexpectedly")
            data = result.get("data")
            if not isinstance(data, list) or not data:
                message = _clean(result.get("message")) or no_image_result_message()
                raise RuntimeError(message)
            with self._lock:
                cancel_requested = bool(self._tasks.get(key, {}).get("cancel_requested"))
            if cancel_requested:
                duration_ms = max(0, int((time.time() - started) * 1000))
                self._update_task(
                    key,
                    status=TASK_STATUS_CANCELLED,
                    **_phase_updates(
                        TASK_PHASE_CANCELLED,
                        {
                            **_task_timings(self._get_task_snapshot(key)),
                            "queue_wait_ms": queue_duration_ms,
                            "worker_total_ms": duration_ms,
                        },
                    ),
                    data=[],
                    error="image task cancelled",
                    finished_at=_now_iso(),
                    duration_ms=duration_ms,
                )
                return
            duration_ms = max(0, int((time.time() - started) * 1000))
            self._update_task(
                key,
                status=TASK_STATUS_SUCCESS,
                **_phase_updates(
                    TASK_PHASE_SUCCESS,
                    {
                        **_task_timings(self._get_task_snapshot(key)),
                        "queue_wait_ms": queue_duration_ms,
                        "worker_total_ms": duration_ms,
                    },
                ),
                data=data,
                error="",
                finished_at=_now_iso(),
                duration_ms=duration_ms,
            )
            self._log_call(
                job.identity,
                job.mode,
                job.model,
                started,
                "调用完成",
                request_preview=request_text(job.payload.get("prompt")),
                urls=_collect_media_urls(data),
            )
        except Exception as exc:
            error_message = str(exc) or "image task failed"
            with self._lock:
                cancel_requested = bool(self._tasks.get(key, {}).get("cancel_requested"))
            if cancel_requested:
                duration_ms = max(0, int((time.time() - started) * 1000))
                self._update_task(
                    key,
                    status=TASK_STATUS_CANCELLED,
                    **_phase_updates(
                        TASK_PHASE_CANCELLED,
                        {
                            **_task_timings(self._get_task_snapshot(key)),
                            "queue_wait_ms": queue_duration_ms,
                            "worker_total_ms": duration_ms,
                        },
                    ),
                    error="image task cancelled",
                    data=[],
                    finished_at=_now_iso(),
                    duration_ms=duration_ms,
                )
                return
            duration_ms = max(0, int((time.time() - started) * 1000))
            self._update_task(
                key,
                status=TASK_STATUS_ERROR,
                **_phase_updates(
                    TASK_PHASE_ERROR,
                    {
                        **_task_timings(self._get_task_snapshot(key)),
                        "queue_wait_ms": queue_duration_ms,
                        "worker_total_ms": duration_ms,
                    },
                ),
                error=error_message,
                data=[],
                finished_at=_now_iso(),
                duration_ms=duration_ms,
            )
            self._log_call(
                job.identity,
                job.mode,
                job.model,
                started,
                "调用失败",
                request_preview=request_text(job.payload.get("prompt")),
                status="failed",
                error=error_message,
            )
        finally:
            with self._lock:
                self._leases.pop(key, None)
            job.release()

    def _log_call(
        self,
        identity: dict[str, object],
        mode: str,
        model: str,
        started: float,
        suffix: str,
        *,
        request_preview: str = "",
        status: str = "success",
        error: str = "",
        urls: list[str] | None = None,
    ) -> None:
        if mode == "video":
            endpoint = "/api/image-tasks/videos"
            summary_prefix = "视频生成"
        else:
            endpoint = "/v1/images/edits" if mode == "edit" else "/v1/images/generations"
            summary_prefix = "图生图" if mode == "edit" else "文生图"
        detail = {
            "key_id": identity.get("id"),
            "key_name": identity.get("name"),
            "role": identity.get("role"),
            "endpoint": endpoint,
            "model": model,
            "started_at": datetime.fromtimestamp(started).strftime("%Y-%m-%d %H:%M:%S"),
            "ended_at": _now_iso(),
            "duration_ms": int((time.time() - started) * 1000),
            "status": status,
        }
        if request_preview:
            detail["request_text"] = request_preview
        if error:
            detail["error"] = error
        if urls:
            detail["urls"] = list(dict.fromkeys(urls))
        try:
            log_service.add(LOG_TYPE_CALL, f"{summary_prefix}{suffix}", detail)
        except Exception:
            pass

    def _get_task_snapshot(self, key: str) -> dict[str, Any]:
        with self._lock:
            return dict(self._tasks.get(key) or {})

    def _make_progress_callback(self, key: str, started: float) -> Callable[..., None]:
        def update_progress(event: dict[str, Any] | None = None, **kwargs: Any) -> None:
            try:
                progress_event = dict(event or {})
                progress_event.update(kwargs)
                snapshot = self._get_task_snapshot(key)
                if not snapshot or snapshot.get("status") in TERMINAL_STATUSES:
                    return
                merged_timings = _task_timings(snapshot)
                timing_key = _clean(progress_event.get("timing_key"))
                duration_ms = progress_event.get("duration_ms")
                if timing_key and isinstance(duration_ms, (int, float)) and not isinstance(duration_ms, bool):
                    merged_timings[timing_key] = max(0, int(duration_ms))
                merged_timings.update(_clean_timings(progress_event.get("timings")))
                merged_timings.update(_clean_timings(progress_event.get("timing_ms")))
                merged_timings["worker_elapsed_ms"] = max(0, int((time.time() - started) * 1000))
                clean_phase = _clean(progress_event.get("phase") or snapshot.get("phase") or TASK_PHASE_RUNNING)
                phase_label = _clean(progress_event.get("label") or progress_event.get("phase_label")) or _phase_label(clean_phase)
                metadata = _clean_metadata(progress_event.get("metadata"))
                updates = {
                    "phase": clean_phase,
                    "phase_label": phase_label,
                    "phase_updated_at": _now_iso(),
                    "timings": merged_timings,
                    "timing_ms": merged_timings,
                }
                if metadata:
                    updates["metadata"] = metadata
                self._update_task(
                    key,
                    **updates,
                )
            except Exception:
                pass

        return update_progress

    def _update_task(self, key: str, **updates: Any) -> None:
        with self._lock:
            task = self._tasks.get(key)
            if task is None:
                return
            task.update(updates)
            task["updated_at"] = _now_iso()
            self._save_locked()

    def _load_locked(self) -> dict[str, dict[str, Any]]:
        storage = get_image_metadata_storage()
        if storage is not None:
            tasks = self._clean_task_items(storage.load_map("image_tasks").values())
            if tasks:
                return tasks
            legacy_tasks = self._load_json_locked()
            if legacy_tasks:
                storage.save_map("image_tasks", legacy_tasks)
            return legacy_tasks
        return self._load_json_locked()

    def _load_json_locked(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        raw_items = raw.get("tasks") if isinstance(raw, dict) else raw
        if not isinstance(raw_items, list):
            return {}
        return self._clean_task_items(raw_items)

    def _clean_task_items(self, raw_items: object) -> dict[str, dict[str, Any]]:
        tasks: dict[str, dict[str, Any]] = {}
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            task_id = _clean(item.get("id"))
            owner = _clean(item.get("owner_id"))
            if not task_id or not owner:
                continue
            status = _clean(item.get("status"))
            if status not in {TASK_STATUS_QUEUED, TASK_STATUS_RUNNING, TASK_STATUS_SUCCESS, TASK_STATUS_ERROR, TASK_STATUS_CANCELLED}:
                status = TASK_STATUS_ERROR
            task = {
                "id": task_id,
                "owner_id": owner,
                "status": status,
                "phase": _clean(item.get("phase")) or _phase_from_status(status),
                "mode": "video" if item.get("mode") == "video" else "edit" if item.get("mode") == "edit" else "generate",
                "media_type": _clean(item.get("media_type")) or ("video" if item.get("mode") == "video" else "image"),
                "model": _clean(item.get("model"), "gpt-image-2"),
                "size": _clean(item.get("size")),
                "resolution": _clean(item.get("resolution")),
                "created_at": _clean(item.get("created_at"), _now_iso()),
                "updated_at": _clean(item.get("updated_at"), _clean(item.get("created_at"), _now_iso())),
            }
            task["phase_label"] = _clean(item.get("phase_label")) or _clean(item.get("label")) or _phase_label(task["phase"])
            for key in ("queued_at", "started_at", "finished_at"):
                value = _clean(item.get(key))
                if value:
                    task[key] = value
            phase_updated_at = _clean(item.get("phase_updated_at"))
            if phase_updated_at:
                task["phase_updated_at"] = phase_updated_at
            for key in ("duration_ms", "queue_duration_ms"):
                value = item.get(key)
                if isinstance(value, int):
                    task[key] = max(0, value)
            timings = _task_timings({**task, "timings": item.get("timings"), "timing_ms": item.get("timing_ms")})
            task["timings"] = timings
            task["timing_ms"] = timings
            data = item.get("data")
            if isinstance(data, list):
                task["data"] = data
            metadata = _clean_metadata(item.get("metadata"))
            if metadata:
                task["metadata"] = metadata
            error = _clean(item.get("error"))
            if error:
                task["error"] = error
            tasks[_task_key(owner, task_id)] = task
        return tasks

    def _save_locked(self) -> None:
        items = sorted(self._tasks.values(), key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        storage = get_image_metadata_storage()
        if storage is not None:
            storage.save_map("image_tasks", {key: self._tasks[key] for key in self._tasks})
        tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp_path.write_text(json.dumps({"tasks": items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(self.path)

    def _recover_unfinished_locked(self) -> bool:
        changed = False
        for task in self._tasks.values():
            if task.get("status") in UNFINISHED_STATUSES:
                task["status"] = TASK_STATUS_ERROR
                task.update(_phase_updates(TASK_PHASE_ERROR, _task_timings(task)))
                task["error"] = "服务已重启，未完成的图片任务已中断"
                task["updated_at"] = _now_iso()
                changed = True
        return changed

    def _cleanup_locked(self) -> bool:
        try:
            retention_days = max(1, int(self.retention_days_getter()))
        except Exception:
            retention_days = 30
        cutoff = time.time() - retention_days * 86400
        removed_keys = [
            key
            for key, task in self._tasks.items()
            if task.get("status") in TERMINAL_STATUSES and _timestamp(task.get("updated_at")) < cutoff
        ]
        for key in removed_keys:
            self._tasks.pop(key, None)
        return bool(removed_keys)


image_task_service = ImageTaskService(DATA_DIR / "image_tasks.json")
