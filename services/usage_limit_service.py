from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
from datetime import datetime
from threading import Lock
from typing import Iterator


class UsageLimitError(ValueError):
    def __init__(self, message: str, status_code: int = 429):
        super().__init__(message)
        self.status_code = status_code


class UsageLimitService:
    def __init__(self) -> None:
        self._lock = Lock()
        self._counts: dict[tuple[str, str, str], int] = {}
        self._active: dict[str, int] = {}

    @staticmethod
    def _today() -> str:
        return datetime.now().strftime("%Y-%m-%d")

    @staticmethod
    def _key_id(identity: dict[str, object]) -> str:
        return str(identity.get("id") or "").strip()

    @staticmethod
    def _is_admin(identity: dict[str, object]) -> bool:
        return str(identity.get("role") or "").strip().lower() == "admin"

    @staticmethod
    def _limit_value(limits: object, name: str) -> int | None:
        if not isinstance(limits, dict):
            return None
        value = limits.get(name)
        if value is None:
            return None
        try:
            number = int(value)
        except (TypeError, ValueError):
            return None
        return number if number >= 0 else None

    @staticmethod
    def _models(limits: object) -> list[str]:
        if not isinstance(limits, dict):
            return []
        models = limits.get("models")
        if not isinstance(models, list):
            return []
        return [str(model).strip() for model in models if str(model).strip()]

    def check_model(self, identity: dict[str, object], model: str) -> None:
        if self._is_admin(identity):
            return
        allowed_models = self._models(identity.get("limits"))
        if allowed_models and str(model or "").strip() not in allowed_models:
            raise UsageLimitError("model is not allowed", status_code=403)

    def acquire(self, identity: dict[str, object], *, model: str, kind: str) -> Callable[[], None]:
        if self._is_admin(identity):
            return lambda: None

        key_id = self._key_id(identity)
        if not key_id:
            return lambda: None

        count_name = "images_per_day" if kind == "image" else "requests_per_day"
        counter_kind = "image" if kind == "image" else "request"
        with self._lock:
            self.check_model(identity, model)
            limits = identity.get("limits")
            concurrency_limit = self._limit_value(limits, "concurrency")
            active = self._active.get(key_id, 0)
            if concurrency_limit is not None and active >= concurrency_limit:
                raise UsageLimitError("concurrency limit exceeded", status_code=429)
            day_limit = self._limit_value(limits, count_name)
            count_key = (key_id, self._today(), counter_kind)
            used = self._counts.get(count_key, 0)
            if day_limit is not None and used >= day_limit:
                raise UsageLimitError(f"{counter_kind} daily limit exceeded", status_code=429)
            self._active[key_id] = active + 1
            self._counts[count_key] = used + 1

        released = False

        def release() -> None:
            nonlocal released
            if released:
                return
            released = True
            with self._lock:
                active = self._active.get(key_id, 0)
                if active <= 1:
                    self._active.pop(key_id, None)
                else:
                    self._active[key_id] = active - 1

        return release

    @contextmanager
    def reserve(self, identity: dict[str, object], *, model: str, kind: str) -> Iterator[None]:
        release = self.acquire(identity, model=model, kind=kind)
        try:
            yield
        finally:
            release()

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()
            self._active.clear()


usage_limit_service = UsageLimitService()
