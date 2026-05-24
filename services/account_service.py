from __future__ import annotations

import json
import queue as _queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from threading import Condition, Lock
from typing import Any, Iterator

from services.config import config
from services.log_service import (
    LOG_TYPE_ACCOUNT,
    log_service,
)
from services.storage.base import StorageBackend
from utils.helper import anonymize_token


PLUS_PROMO_ACCOUNT_TAG = "可开通 Plus"
DEFAULT_REFRESH_WORKERS = 4
MAX_REFRESH_WORKERS = 8
DEFAULT_LIMITED_REFRESH_BATCH_SIZE = 3
DEFAULT_REFRESH_FAST_PATH_THRESHOLD = 3
DEFAULT_REFRESH_BATCH_SIZE = 4
DEFAULT_REFRESH_BATCH_INTERVAL_SECONDS = 1.0
CPA_DELETE_PARALLELISM = 4
IMAGE_POOL_REPLENISH_HIGH = "high"
IMAGE_POOL_REPLENISH_LOW = "low"


def _is_upstream_timeout_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "curl: (28)" in message
        or "connection timed out" in message
        or "operation timed out" in message
        or "timed out after" in message
    )


def _format_refresh_error(exc: Exception) -> str:
    if _is_upstream_timeout_error(exc):
        if config.get_proxy_settings():
            return "连接 chatgpt.com 超时。已配置全局代理，但代理链路仍不可达；请在设置页测试代理，或减少单次刷新账号数量后重试。"
        return "连接 chatgpt.com 超时。当前未配置全局代理，请在设置页填写并测试可用代理后再刷新账号信息和额度。"
    return str(exc) or exc.__class__.__name__


def _config_int(key: str, default: int, minimum: int = 1) -> int:
    try:
        value = int(config.data.get(key) or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, value)


def _config_float(key: str, default: float, minimum: float = 0.0) -> float:
    try:
        value = float(config.data.get(key) or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, value)


def _auto_register_account_cap() -> int:
    try:
        settings = config.get_account_pool_settings()
        return max(1, int(settings.get("max_total_accounts") or 0))
    except Exception:
        return 0


def _normalize_account_tags(value: object) -> list[str]:
    if isinstance(value, str):
        candidates = [value]
    elif isinstance(value, list):
        candidates = value
    else:
        candidates = []
    tags: list[str] = []
    for item in candidates:
        tag = str(item or "").strip()
        if tag and tag not in tags:
            tags.append(tag)
    return tags


def _parse_restore_at_timestamp(value: object) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        timestamp = float(value)
        return timestamp / 1000 if timestamp > 10_000_000_000 else timestamp
    text = str(value or "").strip()
    if not text:
        return 0.0
    try:
        timestamp = float(text)
        return timestamp / 1000 if timestamp > 10_000_000_000 else timestamp
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:26], fmt).timestamp()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _format_restore_at_from_usage_limit(resets_at: object = None, resets_in_seconds: object = None) -> str | None:
    timestamp = _parse_restore_at_timestamp(resets_at)
    if timestamp <= 0:
        try:
            seconds = max(0, int(resets_in_seconds or 0))
        except (TypeError, ValueError):
            seconds = 0
        if seconds > 0:
            timestamp = time.time() + seconds
    if timestamp <= 0:
        return None
    return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")


class AccountService:
    """账号池服务，使用 token -> account 的 dict 保存账号。"""

    def __init__(self, storage_backend: StorageBackend):
        self.storage = storage_backend
        self._lock = Lock()
        self._image_slot_condition = Condition(self._lock)
        self._index = 0
        self._accounts = self._load_accounts()
        self._image_inflight: dict[str, int] = {}
        self._active_image_requests = 0
        self._image_pool_replenish_running = False
        self._image_pool_replenish_last_started_at = 0.0
        self._image_pool_replenish_thread: threading.Thread | None = None
        self._image_pool_register_running = False
        self._image_pool_register_generation = 0

    def _load_accounts(self) -> dict[str, dict]:
        accounts = self.storage.load_accounts()
        return {
            normalized["access_token"]: normalized
            for item in accounts
            if (normalized := self._normalize_account(item)) is not None
        }

    def _save_accounts(self) -> None:
        self.storage.save_accounts(list(self._accounts.values()))

    @staticmethod
    def _is_image_account_available(account: dict) -> bool:
        if not isinstance(account, dict):
            return False
        if str(account.get("image_blocked_reason") or "").strip():
            return False
        if account.get("status") in {"禁用", "限流", "异常"}:
            return False
        if bool(account.get("image_quota_unknown")):
            return True
        return int(account.get("quota") or 0) > 0

    @staticmethod
    def _normalize_account_type(value: object) -> str | None:
        text = str(value or "").strip()
        if not text:
            return None
        normalized = text.replace("_", "").replace("-", "").replace(" ", "").lower()
        if normalized == "prolite":
            return "ProLite"
        if normalized == "plus":
            return "Plus"
        if normalized == "pro":
            return "Pro"
        if normalized == "free":
            return "free"
        return text

    def _search_account_type(self, value: object) -> str | None:
        if isinstance(value, dict):
            for key, item in value.items():
                key_text = str(key or "").lower()
                if any(marker in key_text for marker in ("plan", "account_type", "subscription")):
                    normalized = self._normalize_account_type(item)
                    if normalized and normalized.lower() not in {"no_constraint", "none", "null"}:
                        return normalized
                found = self._search_account_type(item)
                if found:
                    return found
            return None
        if isinstance(value, list):
            for item in value:
                found = self._search_account_type(item)
                if found:
                    return found
            return None
        return None

    def _normalize_account(self, item: dict) -> dict | None:
        if not isinstance(item, dict):
            return None
        access_token = item.get("access_token") or ""
        if not access_token:
            return None
        normalized = dict(item)
        normalized["access_token"] = access_token
        normalized["type"] = self._normalize_account_type(normalized.get("type")) or "free"
        normalized["status"] = normalized.get("status") or "正常"
        normalized["quota"] = max(0, int(normalized.get("quota") if normalized.get("quota") is not None else 0))
        normalized["image_quota_unknown"] = bool(normalized.get("image_quota_unknown"))
        normalized["email"] = normalized.get("email") or None
        normalized["account_id"] = normalized.get("account_id") or None
        normalized["user_id"] = normalized.get("user_id") or None
        limits_progress = normalized.get("limits_progress")
        normalized["limits_progress"] = limits_progress if isinstance(limits_progress, list) else []
        normalized["default_model_slug"] = normalized.get("default_model_slug") or None
        normalized["restore_at"] = normalized.get("restore_at") or None
        normalized["can_activate_plus"] = bool(normalized.get("can_activate_plus"))
        normalized["plus_promo_text"] = str(normalized.get("plus_promo_text") or "").strip() or None
        normalized["image_blocked_reason"] = str(normalized.get("image_blocked_reason") or "").strip()
        tags = _normalize_account_tags(normalized.get("tags"))
        if normalized["can_activate_plus"]:
            if PLUS_PROMO_ACCOUNT_TAG not in tags:
                tags.append(PLUS_PROMO_ACCOUNT_TAG)
        else:
            tags = [tag for tag in tags if tag != PLUS_PROMO_ACCOUNT_TAG]
        normalized["tags"] = tags
        normalized["success"] = int(normalized.get("success") or 0)
        normalized["fail"] = int(normalized.get("fail") or 0)
        normalized["last_used_at"] = normalized.get("last_used_at")
        return normalized

    def list_tokens(self) -> list[str]:
        with self._lock:
            return list(self._accounts)

    def _list_ready_candidate_tokens(self, excluded_tokens: set[str] | None = None) -> list[str]:
        excluded = set(excluded_tokens or set())
        return [
            token
            for item in self._accounts.values()
            if self._is_image_account_available(item)
               and (token := item.get("access_token") or "")
               and token not in excluded
        ]

    def _list_available_candidate_tokens(self, excluded_tokens: set[str] | None = None) -> list[str]:
        max_concurrency = max(1, int(config.image_account_concurrency or 1))
        return [
            token
            for token in self._list_ready_candidate_tokens(excluded_tokens)
            if int(self._image_inflight.get(token, 0)) < max_concurrency
        ]

    def _has_ready_image_account_locked(self) -> bool:
        return bool(self._list_ready_candidate_tokens())

    def begin_image_request(self) -> None:
        with self._image_slot_condition:
            self._active_image_requests += 1
            self._image_slot_condition.notify_all()

    def end_image_request(self) -> None:
        should_replenish = False
        with self._image_slot_condition:
            self._active_image_requests = max(0, self._active_image_requests - 1)
            should_replenish = self._active_image_requests == 0
            self._image_slot_condition.notify_all()
        if should_replenish:
            self.schedule_image_pool_replenish("image_request_finished", priority=IMAGE_POOL_REPLENISH_LOW)

    def has_active_image_requests(self) -> bool:
        with self._lock:
            return self._active_image_requests > 0

    def ensure_image_capacity(self, timeout_seconds: float | None = None) -> bool:
        timeout = config.image_pool_preflight_wait_seconds if timeout_seconds is None else max(0.0, float(timeout_seconds))
        deadline = time.time() + timeout
        replenish_requested = False
        while True:
            with self._image_slot_condition:
                if self._has_ready_image_account_locked():
                    return True
                remaining = deadline - time.time()
                if remaining <= 0:
                    return False
                replenish_running = self._image_pool_replenish_running
            if not replenish_running and not replenish_requested:
                replenish_requested = self.schedule_image_pool_replenish(
                    "image_preflight",
                    priority=IMAGE_POOL_REPLENISH_HIGH,
                )
            with self._image_slot_condition:
                if self._has_ready_image_account_locked():
                    return True
                remaining = deadline - time.time()
                if remaining <= 0:
                    return False
                self._image_slot_condition.wait(timeout=min(0.25, remaining))

    def schedule_image_pool_replenish(self, reason: str = "", priority: str = IMAGE_POOL_REPLENISH_LOW) -> bool:
        normalized_priority = IMAGE_POOL_REPLENISH_HIGH if priority == IMAGE_POOL_REPLENISH_HIGH else IMAGE_POOL_REPLENISH_LOW
        if normalized_priority == IMAGE_POOL_REPLENISH_HIGH:
            return self._start_image_pool_replenish(reason, normalized_priority)

        now = time.time()
        with self._image_slot_condition:
            if self._image_pool_replenish_running:
                return False
            debounce_seconds = max(0.0, float(config.image_pool_replenish_debounce_seconds))
            if debounce_seconds > 0 and now - self._image_pool_replenish_last_started_at < debounce_seconds:
                return False
        return self._start_image_pool_replenish(reason, normalized_priority)

    def _start_image_pool_replenish(self, reason: str, priority: str) -> bool:
        with self._image_slot_condition:
            if self._image_pool_replenish_running:
                return False
        limit = self.limited_refresh_batch_size() if priority == IMAGE_POOL_REPLENISH_HIGH else 1
        tokens = self.list_limited_tokens(due_only=True, limit=limit)
        if not tokens:
            return False
        with self._image_slot_condition:
            if self._image_pool_replenish_running:
                return False
            self._image_pool_replenish_running = True
            self._image_pool_replenish_last_started_at = time.time()
            self._image_pool_replenish_thread = threading.Thread(
                target=self._run_image_pool_replenish,
                args=(tokens, reason, priority),
                name=f"image-pool-replenish-{priority}",
                daemon=True,
            )
            self._image_pool_replenish_thread.start()
            return True

    def _run_image_pool_replenish(self, tokens: list[str], reason: str, priority: str) -> None:
        started = time.time()
        refreshed = 0
        failed = 0
        skipped = 0
        first_error = ""
        for token in tokens:
            if priority != IMAGE_POOL_REPLENISH_HIGH and self.has_active_image_requests():
                skipped += 1
                break
            fetched: dict[str, dict[str, Any]] = {}
            invalid_tokens: set[str] = set()
            try:
                result = self._fetch_remote_user_info(token)
                fetched[token] = result
            except Exception as exc:
                failed += 1
                if not first_error:
                    first_error = _format_refresh_error(exc)
                if self._is_invalid_token_error(exc):
                    invalid_tokens.add(token)
            delta = self._apply_refresh_batch(fetched, invalid_tokens)
            refreshed += int(delta.get("refreshed") or 0)
            if priority == IMAGE_POOL_REPLENISH_HIGH and self.available_account_count() > 0:
                break

        duration_ms = int((time.time() - started) * 1000)
        try:
            log_service.add(
                LOG_TYPE_ACCOUNT,
                f"图片号池补充完成：成功 {refreshed} 个，失败 {failed} 个",
                {
                    "reason": reason,
                    "priority": priority,
                    "requested": len(tokens),
                    "refreshed": refreshed,
                    "failed": failed,
                    "skipped": skipped,
                    "first_error": first_error,
                    "started_at": datetime.fromtimestamp(started).strftime("%Y-%m-%d %H:%M:%S"),
                    "ended_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "duration_ms": duration_ms,
                },
            )
        except Exception:
            pass
        finally:
            with self._image_slot_condition:
                self._image_pool_replenish_running = False
                self._image_slot_condition.notify_all()

    def _list_text_candidate_tokens(self, excluded_tokens: set[str] | None = None) -> list[str]:
        excluded = set(excluded_tokens or set())
        return [
            token
            for account in self._accounts.values()
            if account.get("status") not in {"禁用", "异常"}
               and (token := account.get("access_token") or "")
               and token not in excluded
        ]

    def _acquire_next_candidate_token(self, excluded_tokens: set[str] | None = None) -> str:
        with self._image_slot_condition:
            while True:
                if not self._list_ready_candidate_tokens(excluded_tokens):
                    raise RuntimeError("no available image quota")
                tokens = self._list_available_candidate_tokens(excluded_tokens)
                if tokens:
                    access_token = tokens[self._index % len(tokens)]
                    self._index += 1
                    self._image_inflight[access_token] = int(self._image_inflight.get(access_token, 0)) + 1
                    return access_token
                self._image_slot_condition.wait(timeout=1.0)

    def _acquire_specific_candidate_token(self, access_token: str) -> str:
        if not access_token:
            raise RuntimeError("no available image quota")
        max_concurrency = max(1, int(config.image_account_concurrency or 1))
        with self._image_slot_condition:
            account = self._accounts.get(access_token)
            if not self._is_image_account_available(account or {}):
                raise RuntimeError("registered account is not available for image generation")
            if int(self._image_inflight.get(access_token, 0)) >= max_concurrency:
                raise RuntimeError("registered account image concurrency exceeded")
            self._image_inflight[access_token] = int(self._image_inflight.get(access_token, 0)) + 1
            return access_token

    def release_image_slot(self, access_token: str) -> None:
        if not access_token:
            return
        with self._image_slot_condition:
            current_inflight = int(self._image_inflight.get(access_token, 0))
            if current_inflight <= 1:
                self._image_inflight.pop(access_token, None)
            else:
                self._image_inflight[access_token] = current_inflight - 1
            self._image_slot_condition.notify_all()

    def get_available_access_token(self, excluded_tokens: set[str] | None = None, verify_remote: bool = False) -> str:
        if not verify_remote:
            return self._acquire_next_candidate_token(excluded_tokens=excluded_tokens)
        attempted_tokens: set[str] = set(excluded_tokens or set())
        while True:
            access_token = self._acquire_next_candidate_token(excluded_tokens=attempted_tokens)
            attempted_tokens.add(access_token)
            try:
                account = self.fetch_remote_info(access_token, "get_available_access_token")
            except Exception:
                self.release_image_slot(access_token)
                continue
            if self._is_image_account_available(account or {}):
                return access_token
            self.release_image_slot(access_token)

    def register_image_account_for_request(self, excluded_tokens: set[str] | None = None, reason: str = "image_first_failure") -> str:
        excluded = set(excluded_tokens or set())
        timeout_seconds = max(0.001, float(config.image_pool_register_timeout_seconds))
        deadline = time.time() + timeout_seconds
        generation = 0
        with self._image_slot_condition:
            account_cap = _auto_register_account_cap()
            if account_cap and len(self._accounts) >= account_cap:
                raise RuntimeError(f"account limit reached ({len(self._accounts)}/{account_cap})")
            if self._image_pool_register_running:
                while self._image_pool_register_running:
                    remaining = deadline - time.time()
                    if remaining <= 0:
                        self._image_pool_register_running = False
                        self._image_pool_register_generation += 1
                        self._image_slot_condition.notify_all()
                        raise RuntimeError(f"image pool register timed out after {timeout_seconds:g} seconds")
                    self._image_slot_condition.wait(timeout=min(0.5, remaining))
                registered_by_other = True
            else:
                registered_by_other = False
                self._image_pool_register_running = True
                self._image_pool_register_generation += 1
                generation = self._image_pool_register_generation
        if registered_by_other:
            return self._acquire_next_candidate_token(excluded_tokens=excluded)

        started = time.time()
        access_token = ""
        error = ""
        try:
            from services.register import openai_register

            result_queue: _queue.Queue[tuple[bool, object]] = _queue.Queue(maxsize=1)

            def run_worker() -> None:
                try:
                    with openai_register.stats_lock:
                        if not openai_register.stats.get("start_time"):
                            openai_register.stats["start_time"] = time.time()
                    result_queue.put((True, openai_register.worker(int(started * 1000) % 1_000_000)))
                except Exception as exc:
                    result_queue.put((False, exc))

            worker_thread = threading.Thread(
                target=run_worker,
                name="image-pool-register-request",
                daemon=True,
            )
            worker_thread.start()
            worker_thread.join(timeout=timeout_seconds)
            if worker_thread.is_alive():
                raise TimeoutError(f"image pool register timed out after {timeout_seconds:g} seconds")
            try:
                ok, result_or_error = result_queue.get_nowait()
            except _queue.Empty as exc:
                raise RuntimeError("image pool register finished without result") from exc
            if not ok:
                raise result_or_error
            result = result_or_error
            if not isinstance(result, dict) or not result.get("ok"):
                raise RuntimeError(str((result or {}).get("error") or "register failed"))
            raw_result = result.get("result") if isinstance(result.get("result"), dict) else {}
            access_token = str(raw_result.get("access_token") or "").strip()
            if not access_token:
                raise RuntimeError("registered account did not return access_token")
            try:
                return self._acquire_specific_candidate_token(access_token)
            except RuntimeError:
                return self._acquire_next_candidate_token(excluded_tokens=excluded)
        except Exception as exc:
            error = str(exc) or exc.__class__.__name__
            raise
        finally:
            duration_ms = int((time.time() - started) * 1000)
            try:
                log_service.add(
                    LOG_TYPE_ACCOUNT,
                    "图片请求触发即时注册补号",
                    {
                        "reason": reason,
                        "success": bool(access_token and not error),
                        "token": anonymize_token(access_token) if access_token else "",
                        "error": error[:500],
                        "started_at": datetime.fromtimestamp(started).strftime("%Y-%m-%d %H:%M:%S"),
                        "ended_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "duration_ms": duration_ms,
                    },
                )
            except Exception:
                pass
            with self._image_slot_condition:
                if self._image_pool_register_generation == generation:
                    self._image_pool_register_running = False
                    self._image_slot_condition.notify_all()

    def get_text_access_token(self, excluded_tokens: set[str] | None = None) -> str:
        with self._lock:
            candidates = self._list_text_candidate_tokens(excluded_tokens)
            if not candidates:
                return ""
            access_token = candidates[self._index % len(candidates)]
            self._index += 1
            return access_token

    def peek_text_access_token(self, excluded_tokens: set[str] | None = None) -> str:
        with self._lock:
            candidates = self._list_text_candidate_tokens(excluded_tokens)
            if not candidates:
                return ""
            return candidates[self._index % len(candidates)]

    def mark_text_used(self, access_token: str) -> None:
        if not access_token:
            return
        with self._lock:
            current = self._accounts.get(access_token)
            if current is None:
                return
            next_item = dict(current)
            next_item["last_used_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            account = self._normalize_account(next_item)
            if account is None:
                return
            self._accounts[access_token] = account
            self._save_accounts()

    def remove_invalid_token(self, access_token: str, event: str) -> bool:
        if not config.auto_remove_invalid_accounts:
            self.update_account(access_token, {"status": "异常", "quota": 0})
            return False
        account = self.get_account(access_token)
        removed = bool(self.delete_accounts([access_token])["removed"])
        if removed:
            self._sync_cpa_delete(account, event)
            log_service.add(LOG_TYPE_ACCOUNT, "自动移除异常账号",
                            {"source": event, "token": anonymize_token(access_token)})
        elif access_token:
            self.update_account(access_token, {"status": "异常", "quota": 0})
        return removed

    def remove_unusable_image_token(self, access_token: str, event: str, reason: str = "") -> bool:
        if not access_token:
            return False
        self.release_image_slot(access_token)
        account = self.get_account(access_token)
        removed = bool(self.delete_accounts([access_token])["removed"])
        if removed:
            self._sync_cpa_delete(account, event)
            log_service.add(LOG_TYPE_ACCOUNT, "自动移除不可生图账号",
                            {"source": event, "token": anonymize_token(access_token), "reason": str(reason)[:500]})
        return removed

    def get_account(self, access_token: str) -> dict | None:
        if not access_token:
            return None
        with self._lock:
            account = self._accounts.get(access_token)
            return dict(account) if account else None

    def list_accounts(self) -> list[dict]:
        with self._lock:
            return [dict(item) for item in self._accounts.values()]

    def available_account_count(self) -> int:
        with self._lock:
            return sum(1 for item in self._accounts.values() if self._is_image_account_available(item))

    def list_limited_tokens(self, *, due_only: bool = True, limit: int | None = None) -> list[str]:
        now = time.time()
        tokens: list[str] = []
        with self._lock:
            for item in self._accounts.values():
                if item.get("status") != "限流":
                    continue
                if str(item.get("image_blocked_reason") or "").strip():
                    continue
                if due_only:
                    restore_at = _parse_restore_at_timestamp(item.get("restore_at"))
                    if restore_at > now:
                        continue
                token = item.get("access_token") or ""
                if not token:
                    continue
                tokens.append(token)
                if limit is not None and len(tokens) >= max(1, limit):
                    break
        return tokens

    def add_accounts(self, tokens: list[str]) -> dict:
        tokens = list(dict.fromkeys(token for token in tokens if token))
        if not tokens:
            return {"added": 0, "skipped": 0, "items": self.list_accounts()}

        with self._lock:
            added = 0
            skipped = 0
            for access_token in tokens:
                current = self._accounts.get(access_token)
                if current is None:
                    added += 1
                    current = {}
                else:
                    skipped += 1
                account = self._normalize_account(
                    {
                        **current,
                        "access_token": access_token,
                        "type": str(current.get("type") or "free"),
                    }
                )
                if account is not None:
                    self._accounts[access_token] = account
            self._save_accounts()
            items = [dict(item) for item in self._accounts.values()]
            log_service.add(LOG_TYPE_ACCOUNT, f"新增 {added} 个账号，跳过 {skipped} 个",
                            {"added": added, "skipped": skipped})
        return {"added": added, "skipped": skipped, "items": items}

    def delete_accounts(self, tokens: list[str]) -> dict:
        target_set = set(token for token in tokens if token)
        if not target_set:
            return {"removed": 0, "items": self.list_accounts()}
        with self._lock:
            removed = sum(self._accounts.pop(token, None) is not None for token in target_set)
            for token in target_set:
                self._image_inflight.pop(token, None)
            if removed:
                if self._accounts:
                    self._index %= len(self._accounts)
                else:
                    self._index = 0
                self._save_accounts()
                log_service.add(LOG_TYPE_ACCOUNT, f"删除 {removed} 个账号", {"removed": removed})
            items = [dict(item) for item in self._accounts.values()]
        return {"removed": removed, "items": items}

    @staticmethod
    def _sync_cpa_delete(account: dict | None, event: str) -> dict[str, Any] | None:
        if not isinstance(account, dict) or not account.get("access_token"):
            return None
        try:
            from services.cpa_service import delete_account_from_configured_pools

            result = delete_account_from_configured_pools(account)
        except Exception as exc:
            result = {
                "configured": 0,
                "deleted": 0,
                "items": [],
                "errors": [{"error": str(exc) or exc.__class__.__name__}],
            }
        deleted = int(result.get("deleted") or 0)
        errors = result.get("errors") if isinstance(result.get("errors"), list) else []
        if deleted or errors:
            log_service.add(
                LOG_TYPE_ACCOUNT,
                "同步删除 CPA 账号文件",
                {
                    "source": event,
                    "token": anonymize_token(str(account.get("access_token") or "")),
                    "deleted": deleted,
                    "failed": len(errors),
                    "filename": result.get("filename"),
                    "errors": errors[:3],
                },
            )
        return result

    def update_account(self, access_token: str, updates: dict) -> dict | None:
        if not access_token:
            return None
        with self._lock:
            current = self._accounts.get(access_token)
            if current is None:
                return None
            account = self._normalize_account({**current, **updates, "access_token": access_token})
            if account is None:
                return None
            if account.get("status") == "限流" and config.auto_remove_rate_limited_accounts:
                self._accounts.pop(access_token, None)
                self._save_accounts()
                log_service.add(LOG_TYPE_ACCOUNT, "自动移除限流账号", {"token": anonymize_token(access_token)})
                return None
            self._accounts[access_token] = account
            self._save_accounts()
            log_service.add(LOG_TYPE_ACCOUNT, "更新账号",
                            {"token": anonymize_token(access_token), "status": account.get("status")})
            return dict(account)
        return None

    def mark_image_result(self, access_token: str, success: bool) -> dict | None:
        if not access_token:
            return None
        self.release_image_slot(access_token)
        with self._lock:
            current = self._accounts.get(access_token)
            if current is None:
                return None
            next_item = dict(current)
            next_item["last_used_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            image_quota_unknown = bool(next_item.get("image_quota_unknown"))
            if success:
                next_item["success"] = int(next_item.get("success") or 0) + 1
                if not image_quota_unknown:
                    next_item["quota"] = max(0, int(next_item.get("quota") or 0) - 1)
                if not image_quota_unknown and next_item["quota"] == 0:
                    next_item["status"] = "限流"
                    next_item["restore_at"] = next_item.get("restore_at") or None
                elif next_item.get("status") == "限流":
                    next_item["status"] = "正常"
            else:
                next_item["fail"] = int(next_item.get("fail") or 0) + 1
            account = self._normalize_account(next_item)
            if account is None:
                return None
            if account.get("status") == "限流" and config.auto_remove_rate_limited_accounts:
                self._accounts.pop(access_token, None)
                self._save_accounts()
                log_service.add(LOG_TYPE_ACCOUNT, "自动移除限流账号", {"token": anonymize_token(access_token)})
                return None
            self._accounts[access_token] = account
            self._save_accounts()
            return dict(account)
        return None

    def mark_image_usage_limit(
            self,
            access_token: str,
            reason: str = "",
            *,
            resets_at: object = None,
            resets_in_seconds: object = None,
    ) -> dict | None:
        if not access_token:
            return None
        self.release_image_slot(access_token)
        with self._lock:
            current = self._accounts.get(access_token)
            if current is None:
                return None
            restore_at = _format_restore_at_from_usage_limit(resets_at, resets_in_seconds)
            next_item = dict(current)
            next_item["last_used_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            next_item["fail"] = int(next_item.get("fail") or 0) + 1
            next_item["status"] = "限流"
            next_item["quota"] = 0
            next_item["image_quota_unknown"] = False
            next_item["image_blocked_reason"] = ""
            next_item["last_image_error"] = str(reason or "usage_limit_reached")[:500]
            if restore_at:
                next_item["restore_at"] = restore_at
            account = self._normalize_account(next_item)
            if account is None:
                return None
            self._accounts[access_token] = account
            self._save_accounts()
            self._image_slot_condition.notify_all()
        log_service.add(LOG_TYPE_ACCOUNT, "账号图片额度已用尽",
                        {"token": anonymize_token(access_token), "restore_at": restore_at})
        return dict(account)

    def mark_image_checkout_required(self, access_token: str, reason: str = "") -> dict | None:
        self.remove_unusable_image_token(access_token, "checkout_required", reason)
        return self.get_account(access_token)

    @staticmethod
    def _refresh_worker_count(total: int) -> int:
        try:
            configured = int(config.data.get("refresh_account_workers") or DEFAULT_REFRESH_WORKERS)
        except (TypeError, ValueError):
            configured = DEFAULT_REFRESH_WORKERS
        return min(MAX_REFRESH_WORKERS, max(1, configured), max(1, total))

    @staticmethod
    def limited_refresh_batch_size() -> int:
        return _config_int("limited_account_refresh_batch_size", DEFAULT_LIMITED_REFRESH_BATCH_SIZE)

    @staticmethod
    def refresh_fast_path_threshold() -> int:
        return _config_int("refresh_account_fast_path_threshold", DEFAULT_REFRESH_FAST_PATH_THRESHOLD)

    @staticmethod
    def refresh_batch_size() -> int:
        return _config_int("refresh_account_batch_size", DEFAULT_REFRESH_BATCH_SIZE)

    @staticmethod
    def refresh_batch_interval_seconds() -> float:
        return _config_float("refresh_account_batch_interval_seconds", DEFAULT_REFRESH_BATCH_INTERVAL_SECONDS)

    @staticmethod
    def _refresh_log_summary(
            title: str,
            refreshed: int,
            errors: list[dict[str, Any]],
            removed_failed: int,
            removed_rate_limited: int,
            duration_ms: int,
    ) -> str:
        duration_text = f"，耗时 {duration_ms / 1000:.2f} s"
        if errors:
            first_error = str(errors[0].get("error") or "") if isinstance(errors[0], dict) else str(errors[0])
            summary = f"{title}：刷新完成：成功 {refreshed} 个，失败 {len(errors)} 个"
            if removed_failed:
                summary += f"，已删除 {removed_failed} 个失败账号"
            if removed_rate_limited:
                summary += f"，已删除 {removed_rate_limited} 个限流账号"
            if first_error:
                summary += f"，首个错误：{first_error}"
            return f"{summary}{duration_text}"
        return f"{title}：刷新成功 {refreshed} 个账号{duration_text}"

    @staticmethod
    def _fetch_remote_user_info(access_token: str) -> dict[str, Any]:
        from services.openai_backend_api import OpenAIBackendAPI
        return OpenAIBackendAPI(access_token).get_user_info()

    def fetch_remote_info(self, access_token: str, event: str = "fetch_remote_info") -> dict[str, Any] | None:
        if not access_token:
            raise ValueError("access_token is required")

        try:
            from services.openai_backend_api import InvalidAccessTokenError
            result = self._fetch_remote_user_info(access_token)
        except InvalidAccessTokenError:
            self.remove_invalid_token(access_token, event)
            raise
        return self.update_account(access_token, result)

    @staticmethod
    def _chunks(items: list[str], size: int) -> list[list[str]]:
        return [items[index:index + size] for index in range(0, len(items), size)]

    def _refresh_remote_batch(
            self,
            access_tokens: list[str],
            *,
            max_workers: int,
            on_token_done: "Any | None" = None,
    ) -> tuple[dict[str, dict[str, Any]], list[dict[str, str]], set[str]]:
        fetched: dict[str, dict[str, Any]] = {}
        errors: list[dict[str, str]] = []
        failed_invalid_tokens: set[str] = set()
        workers = min(max_workers, max(1, len(access_tokens)))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(self._fetch_remote_user_info, token): token
                for token in access_tokens
            }
            for future in as_completed(futures):
                token = futures[future]
                error_message: str | None = None
                outcome = "succeeded"
                try:
                    fetched[token] = future.result()
                except Exception as exc:
                    error_message = _format_refresh_error(exc)
                    if self._is_invalid_token_error(exc):
                        failed_invalid_tokens.add(token)
                        outcome = "invalid"
                    else:
                        outcome = "failed"
                    errors.append({"token": anonymize_token(token), "error": error_message})
                if on_token_done is not None:
                    try:
                        on_token_done(token, outcome, error_message)
                    except Exception:
                        pass
        return fetched, errors, failed_invalid_tokens

    @staticmethod
    def _is_invalid_token_error(exc: Exception) -> bool:
        from services.openai_backend_api import InvalidAccessTokenError

        if isinstance(exc, InvalidAccessTokenError):
            return True
        message = str(exc or "").lower()
        if not message:
            return False
        invalid_markers = (
            "http 401", "http 403",
            " 401 ", " 403 ",
            "unauthorized",
            "invalid_access_token",
            "invalid token",
            "token expired",
            "token has expired",
            "reauth",
            "please log in",
            "please login",
            "login required",
            "need login",
            "need to log in",
        )
        return any(marker in message for marker in invalid_markers)

    def _apply_refresh_batch(
            self,
            batch_fetched: dict[str, dict[str, Any]],
            batch_invalid_tokens: set[str],
    ) -> dict[str, Any]:
        """Apply one batch of remote results to memory + storage."""
        refreshed = 0
        removed_failed = 0
        removed_rate_limited = 0
        invalid_accounts: list[dict] = []
        removed_tokens: list[str] = []
        changed = False

        with self._lock:
            for token in batch_invalid_tokens:
                removed_account = self._accounts.pop(token, None)
                self._image_inflight.pop(token, None)
                if removed_account is not None:
                    invalid_accounts.append(dict(removed_account))
                    removed_tokens.append(token)
                    removed_failed += 1
                    changed = True

            for token, result in batch_fetched.items():
                current = self._accounts.get(token)
                if current is None:
                    continue
                account = self._normalize_account({**current, **result, "access_token": token})
                if account is None:
                    continue
                if account.get("status") == "限流" and config.auto_remove_rate_limited_accounts:
                    self._accounts.pop(token, None)
                    self._image_inflight.pop(token, None)
                    removed_tokens.append(token)
                    removed_rate_limited += 1
                    changed = True
                    continue
                self._accounts[token] = account
                refreshed += 1
                changed = True

            if changed:
                if self._accounts:
                    self._index %= len(self._accounts)
                else:
                    self._index = 0
                self._save_accounts()
                self._image_slot_condition.notify_all()
            items = [dict(item) for item in self._accounts.values()]

        if invalid_accounts:
            self._sync_cpa_delete_many(invalid_accounts, "refresh_accounts_invalid")

        return {
            "refreshed": refreshed,
            "removed_failed": removed_failed,
            "removed_rate_limited": removed_rate_limited,
            "invalid_accounts": invalid_accounts,
            "removed_tokens": removed_tokens,
            "items": items,
        }

    def _sync_cpa_delete_many(self, accounts: list[dict], event: str) -> None:
        if not accounts:
            return
        if len(accounts) == 1:
            self._sync_cpa_delete(accounts[0], event)
            return
        workers = max(1, min(CPA_DELETE_PARALLELISM, len(accounts)))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            list(executor.map(lambda account: self._sync_cpa_delete(account, event), accounts))

    def iter_refresh_accounts(
            self,
            access_tokens: list[str],
            log_title: str = "批量刷新账号",
    ) -> Iterator[dict[str, Any]]:
        """逐批刷新账号并以生成器的形式 yield 进度事件。"""
        access_tokens = list(dict.fromkeys(token for token in access_tokens if token))
        if not access_tokens:
            yield {
                "type": "done",
                "refreshed": 0,
                "removed_failed": 0,
                "removed_rate_limited": 0,
                "errors": [],
                "items": self.list_accounts(),
                "requested": 0,
                "completed": 0,
                "duration_ms": 0,
            }
            return

        started = time.time()
        max_workers = self._refresh_worker_count(len(access_tokens))
        fast_path_threshold = self.refresh_fast_path_threshold()
        batch_size = self.refresh_batch_size()
        batch_interval_seconds = self.refresh_batch_interval_seconds()

        batches = (
            [access_tokens]
            if len(access_tokens) <= fast_path_threshold
            else self._chunks(access_tokens, batch_size)
        )
        total = len(access_tokens)
        completed = 0
        refreshed_total = 0
        removed_failed_total = 0
        removed_rate_limited_total = 0
        errors_total: list[dict[str, str]] = []
        latest_items: list[dict] = []
        seen_invalid: set[str] = set()

        yield {
            "type": "start",
            "requested": total,
            "batches": len(batches),
            "batch_size": batch_size,
            "workers": max_workers,
            "interval_seconds": batch_interval_seconds,
        }

        for index, batch in enumerate(batches):
            active_batch = [token for token in batch if token not in seen_invalid]
            if not active_batch:
                completed += len(batch)
                continue

            event_queue: _queue.Queue = _queue.Queue()

            def _on_token_done(token: str, outcome: str, error_message: str | None) -> None:
                event_queue.put((token, outcome, error_message))

            with ThreadPoolExecutor(max_workers=1, thread_name_prefix="refresh-batch") as executor:
                future = executor.submit(
                    self._refresh_remote_batch,
                    active_batch,
                    max_workers=max_workers,
                    on_token_done=_on_token_done,
                )
                while True:
                    try:
                        token, outcome, error_message = event_queue.get(timeout=0.1)
                    except _queue.Empty:
                        if future.done():
                            break
                        continue
                    completed += 1
                    payload: dict[str, Any] = {
                        "type": "account",
                        "token": anonymize_token(token),
                        "outcome": outcome,
                        "completed": completed,
                        "requested": total,
                        "index": index,
                        "total_batches": len(batches),
                    }
                    if error_message:
                        payload["error"] = error_message
                    yield payload
                batch_fetched, batch_errors, batch_invalid_tokens = future.result()
            seen_invalid.update(batch_invalid_tokens)
            errors_total.extend(batch_errors)

            delta = self._apply_refresh_batch(batch_fetched, batch_invalid_tokens)
            refreshed_total += int(delta["refreshed"])
            removed_failed_total += int(delta["removed_failed"])
            removed_rate_limited_total += int(delta["removed_rate_limited"])
            latest_items = delta["items"]

            yield {
                "type": "batch",
                "index": index,
                "total_batches": len(batches),
                "requested": total,
                "completed": completed,
                "refreshed": int(delta["refreshed"]),
                "removed_failed": int(delta["removed_failed"]),
                "removed_rate_limited": int(delta["removed_rate_limited"]),
                "removed_tokens": list(delta["removed_tokens"]),
                "errors": list(batch_errors),
                "items": delta["items"],
            }

            if (
                len(access_tokens) > fast_path_threshold
                and index < len(batches) - 1
                and batch_interval_seconds > 0
            ):
                time.sleep(batch_interval_seconds)

        ended = time.time()
        duration_ms = int((ended - started) * 1000)

        first_error = errors_total[0].get("error") if errors_total and isinstance(errors_total[0], dict) else ""
        log_service.add(
            LOG_TYPE_ACCOUNT,
            self._refresh_log_summary(
                log_title or "批量刷新账号",
                refreshed_total,
                errors_total,
                removed_failed_total,
                removed_rate_limited_total,
                duration_ms,
            ),
            {
                "title": log_title or "批量刷新账号",
                "requested": total,
                "refreshed": refreshed_total,
                "failed": len(errors_total),
                "workers": max_workers,
                "removed_failed": removed_failed_total,
                "removed_rate_limited": removed_rate_limited_total,
                "first_error": first_error,
                "started_at": datetime.fromtimestamp(started).strftime("%Y-%m-%d %H:%M:%S"),
                "ended_at": datetime.fromtimestamp(ended).strftime("%Y-%m-%d %H:%M:%S"),
                "duration_ms": duration_ms,
            },
        )

        if not latest_items:
            latest_items = self.list_accounts()

        yield {
            "type": "done",
            "refreshed": refreshed_total,
            "removed_failed": removed_failed_total,
            "removed_rate_limited": removed_rate_limited_total,
            "errors": errors_total,
            "items": latest_items,
            "requested": total,
            "completed": completed,
            "duration_ms": duration_ms,
        }

    def refresh_accounts(self, access_tokens: list[str], log_title: str = "批量刷新账号") -> dict[str, Any]:
        """同步刷新接口 — 仅返回最终汇总结果。"""
        final_event: dict[str, Any] | None = None
        for event in self.iter_refresh_accounts(access_tokens, log_title=log_title):
            if event.get("type") == "done":
                final_event = event
        if final_event is None:
            return {"refreshed": 0, "errors": [], "removed_failed": 0, "items": self.list_accounts()}
        return {
            "refreshed": final_event.get("refreshed", 0),
            "errors": final_event.get("errors", []),
            "removed_failed": final_event.get("removed_failed", 0),
            "items": final_event.get("items", self.list_accounts()),
        }

account_service = AccountService(config.get_storage_backend())
