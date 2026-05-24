from __future__ import annotations

import math
import hashlib
import time
from datetime import datetime, timezone
from threading import Lock


DEFAULT_MAX_FAILURES = 10
DEFAULT_WINDOW_SECONDS = 60
DEFAULT_BLOCK_SECONDS = 60
DEFAULT_MAX_EVENTS = 200


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def key_hint(raw_key: str) -> str:
    token = str(raw_key or "").strip()
    if not token:
        return ""
    if len(token) <= 4:
        return "*" * len(token)
    prefix = token[:3] if token.startswith("sk-") else token[:2]
    suffix = token[-4:] if len(token) > 8 else token[-2:]
    return f"{prefix}...{suffix}"


def source_hint(raw_key: str, source: str = "") -> str:
    normalized_source = str(source or "").strip()
    if normalized_source:
        return normalized_source
    token = str(raw_key or "").strip()
    if not token:
        return "missing-bearer-token"
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
    return f"key:{digest}"


class AuthAuditService:
    def __init__(
        self,
        *,
        max_failures: int = DEFAULT_MAX_FAILURES,
        window_seconds: int = DEFAULT_WINDOW_SECONDS,
        block_seconds: int = DEFAULT_BLOCK_SECONDS,
        max_events: int = DEFAULT_MAX_EVENTS,
    ):
        self._lock = Lock()
        self._failures: dict[str, list[float]] = {}
        self._blocked_until: dict[str, float] = {}
        self._events: list[dict[str, object]] = []
        self._max_failures = max(1, int(max_failures))
        self._window_seconds = max(1, int(window_seconds))
        self._block_seconds = max(1, int(block_seconds))
        self._max_events = max(1, int(max_events))

    def configure(
        self,
        *,
        max_failures: int | None = None,
        window_seconds: int | None = None,
        block_seconds: int | None = None,
        max_events: int | None = None,
    ) -> None:
        with self._lock:
            if max_failures is not None:
                self._max_failures = max(1, int(max_failures))
            if window_seconds is not None:
                self._window_seconds = max(1, int(window_seconds))
            if block_seconds is not None:
                self._block_seconds = max(1, int(block_seconds))
            if max_events is not None:
                self._max_events = max(1, int(max_events))
                self._events = self._events[-self._max_events :]

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()
            self._blocked_until.clear()
            self._events.clear()

    def list_events(self) -> list[dict[str, object]]:
        with self._lock:
            return [dict(event) for event in self._events]

    def record_event(
        self,
        *,
        source: str,
        interface: str,
        subject_role: str,
        reason: str,
        key_hint: str = "",
        detail: dict[str, object] | None = None,
    ) -> None:
        normalized_source = str(source or "").strip() or "unknown"
        event = {
            "timestamp": _now_iso(),
            "source": normalized_source,
            "interface": str(interface or "api"),
            "subject_role": str(subject_role or "identity"),
            "reason": str(reason or "event"),
            "key_hint": str(key_hint or ""),
        }
        if detail:
            event["detail"] = dict(detail)
        with self._lock:
            self._append_event_locked(event)

    def clear_failures(self, source: str) -> None:
        normalized_source = str(source or "").strip()
        if not normalized_source:
            return
        with self._lock:
            self._failures.pop(normalized_source, None)
            self._blocked_until.pop(normalized_source, None)

    def is_blocked(self, source: str) -> tuple[bool, int]:
        normalized_source = str(source or "").strip()
        if not normalized_source:
            return False, 0
        now = time.monotonic()
        with self._lock:
            blocked_until = self._blocked_until.get(normalized_source, 0.0)
            if blocked_until <= now:
                self._blocked_until.pop(normalized_source, None)
                return False, 0
            return True, max(1, int(math.ceil(blocked_until - now)))

    def record_failure(
        self,
        *,
        source: str,
        interface: str,
        subject_role: str,
        reason: str,
        key_hint: str = "",
    ) -> tuple[bool, int]:
        normalized_source = str(source or "").strip() or "unknown"
        now = time.monotonic()
        with self._lock:
            failures = [
                failure_at
                for failure_at in self._failures.get(normalized_source, [])
                if now - failure_at <= self._window_seconds
            ]
            failures.append(now)
            self._failures[normalized_source] = failures

            blocked_until = self._blocked_until.get(normalized_source, 0.0)
            if len(failures) >= self._max_failures:
                blocked_until = max(blocked_until, now + self._block_seconds)
                self._blocked_until[normalized_source] = blocked_until

            retry_after = max(0, int(math.ceil(blocked_until - now))) if blocked_until > now else 0
            self._append_event_locked(
                {
                    "timestamp": _now_iso(),
                    "source": normalized_source,
                    "interface": str(interface or "api"),
                    "subject_role": str(subject_role or "identity"),
                    "reason": str(reason or "authentication_failed"),
                    "key_hint": str(key_hint or ""),
                    "failure_count": len(failures),
                    "blocked": blocked_until > now,
                    "retry_after_seconds": retry_after,
                }
            )
            return blocked_until > now, retry_after

    def _append_event_locked(self, event: dict[str, object]) -> None:
        self._events.append(event)
        if len(self._events) > self._max_events:
            self._events = self._events[-self._max_events :]


auth_audit_service = AuthAuditService()
