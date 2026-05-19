from __future__ import annotations

import hashlib
import hmac
import base64
import json
import secrets
import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Literal

from services.config import config
from services.storage.base import StorageBackend

AuthRole = Literal["admin", "user"]

DEFAULT_LIMITS: dict[str, object] = {
    "requests_per_day": None,
    "images_per_day": None,
    "concurrency": None,
    "models": [],
}

SESSION_TOKEN_PREFIX = "sess-"
SESSION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


class AuthService:
    def __init__(self, storage: StorageBackend):
        self.storage = storage
        self._lock = Lock()
        self._items = self._load()
        self._last_used_flush_at: dict[str, datetime] = {}

    @staticmethod
    def _clean(value: object) -> str:
        return str(value or "").strip()

    @staticmethod
    def _default_name(role: object) -> str:
        return "管理员密钥" if str(role or "").strip().lower() == "admin" else "普通用户"

    @classmethod
    def normalize_limits(cls, raw: object) -> dict[str, object]:
        limits = dict(DEFAULT_LIMITS)
        if not isinstance(raw, dict):
            return limits
        for key in ("requests_per_day", "images_per_day", "concurrency"):
            value = raw.get(key)
            if value is None:
                limits[key] = None
                continue
            if isinstance(value, bool):
                raise ValueError(f"{key} must be a non-negative number or null")
            try:
                number = int(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{key} must be a non-negative number or null") from exc
            if number < 0:
                raise ValueError(f"{key} must be a non-negative number or null")
            limits[key] = number
        models = raw.get("models", [])
        if models is None:
            limits["models"] = []
        elif isinstance(models, list):
            limits["models"] = list(dict.fromkeys(str(model).strip() for model in models if str(model).strip()))
        else:
            raise ValueError("models must be a list")
        return limits

    def _normalize_item(self, raw: object) -> dict[str, object] | None:
        if not isinstance(raw, dict):
            return None
        role = self._clean(raw.get("role")).lower()
        if role not in {"admin", "user"}:
            return None
        key_hash = self._clean(raw.get("key_hash"))
        if not key_hash:
            return None
        item_id = self._clean(raw.get("id")) or uuid.uuid4().hex[:12]
        name = self._clean(raw.get("name")) or self._default_name(role)
        created_at = self._clean(raw.get("created_at")) or _now_iso()
        last_used_at = self._clean(raw.get("last_used_at")) or None
        try:
            limits = self.normalize_limits(raw.get("limits"))
        except ValueError:
            limits = dict(DEFAULT_LIMITS)
        return {
            "id": item_id,
            "name": name,
            "role": role,
            "key_hash": key_hash,
            "enabled": bool(raw.get("enabled", True)),
            "created_at": created_at,
            "last_used_at": last_used_at,
            "limits": limits,
        }

    def _load(self) -> list[dict[str, object]]:
        try:
            items = self.storage.load_auth_keys()
        except Exception:
            return []
        if not isinstance(items, list):
            return []
        return [normalized for item in items if (normalized := self._normalize_item(item)) is not None]

    def _save(self) -> None:
        self.storage.save_auth_keys(self._items)

    def _reload_locked(self) -> None:
        self._items = self._load()

    @staticmethod
    def _public_item(item: dict[str, object]) -> dict[str, object]:
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "role": item.get("role"),
            "enabled": bool(item.get("enabled", True)),
            "created_at": item.get("created_at"),
            "last_used_at": item.get("last_used_at"),
            "limits": AuthService.normalize_limits(item.get("limits")),
        }

    def list_keys(self, role: AuthRole | None = None) -> list[dict[str, object]]:
        with self._lock:
            self._reload_locked()
            items = [item for item in self._items if role is None or item.get("role") == role]
            return [self._public_item(item) for item in items]

    def _has_key_hash_locked(self, key_hash: str, *, exclude_id: str = "") -> bool:
        for item in self._items:
            item_id = self._clean(item.get("id"))
            if exclude_id and item_id == exclude_id:
                continue
            stored_hash = self._clean(item.get("key_hash"))
            if stored_hash and hmac.compare_digest(stored_hash, key_hash):
                return True
        return False

    def _build_key_hash_locked(self, raw_key: str, *, exclude_id: str = "") -> str:
        candidate = self._clean(raw_key)
        if not candidate:
            raise ValueError("请输入新的专用密钥")
        admin_key = self._clean(config.auth_key)
        if admin_key and hmac.compare_digest(candidate, admin_key):
            raise ValueError("这个密钥和管理员密钥冲突了，请换一个新的密钥")
        key_hash = _hash_key(candidate)
        if self._has_key_hash_locked(key_hash, exclude_id=exclude_id):
            raise ValueError("这个专用密钥已经存在，请换一个新的密钥")
        return key_hash

    def _has_name_locked(self, name: str, *, role: AuthRole | None = None, exclude_id: str = "") -> bool:
        candidate = self._clean(name)
        if not candidate:
            return False
        for item in self._items:
            item_id = self._clean(item.get("id"))
            if exclude_id and item_id == exclude_id:
                continue
            if role is not None and item.get("role") != role:
                continue
            if self._clean(item.get("name")) == candidate:
                return True
        return False

    def _build_default_name_locked(self, role: AuthRole, *, exclude_id: str = "") -> str:
        base_name = self._default_name(role)
        if not self._has_name_locked(base_name, role=role, exclude_id=exclude_id):
            return base_name
        suffix = 2
        while True:
            candidate = f"{base_name} {suffix}"
            if not self._has_name_locked(candidate, role=role, exclude_id=exclude_id):
                return candidate
            suffix += 1

    def _build_name_locked(self, name: str, *, role: AuthRole, exclude_id: str = "") -> str:
        candidate = self._clean(name)
        if not candidate:
            return self._build_default_name_locked(role, exclude_id=exclude_id)
        if self._has_name_locked(candidate, role=role, exclude_id=exclude_id):
            raise ValueError("这个名称已经在使用中了，换一个更容易区分的名称吧")
        return candidate

    def create_key(self, *, role: AuthRole, name: str = "", limits: dict[str, object] | None = None) -> tuple[dict[str, object], str]:
        with self._lock:
            self._reload_locked()
            normalized_name = self._build_name_locked(name, role=role)
            normalized_limits = self.normalize_limits(limits)
            while True:
                raw_key = f"sk-{secrets.token_urlsafe(24)}"
                try:
                    key_hash = self._build_key_hash_locked(raw_key)
                    break
                except ValueError:
                    continue
            item = {
                "id": uuid.uuid4().hex[:12],
                "name": normalized_name,
                "role": role,
                "key_hash": key_hash,
                "enabled": True,
                "created_at": _now_iso(),
                "last_used_at": None,
                "limits": normalized_limits,
            }
            self._items.append(item)
            self._save()
            return self._public_item(item), raw_key

    def update_key(
        self,
        key_id: str,
        updates: dict[str, object],
        *,
        role: AuthRole | None = None,
    ) -> dict[str, object] | None:
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return None
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("id") != normalized_id:
                    continue
                if role is not None and item.get("role") != role:
                    return None
                next_item = dict(item)
                next_role = "admin" if str(next_item.get("role") or "").strip().lower() == "admin" else "user"
                if "name" in updates and updates.get("name") is not None:
                    next_item["name"] = self._build_name_locked(
                        str(updates.get("name") or ""),
                        role=next_role,
                        exclude_id=normalized_id,
                    )
                if "enabled" in updates and updates.get("enabled") is not None:
                    next_item["enabled"] = bool(updates.get("enabled"))
                if "key" in updates and updates.get("key") is not None:
                    next_item["key_hash"] = self._build_key_hash_locked(str(updates.get("key") or ""), exclude_id=normalized_id)
                if "limits" in updates and updates.get("limits") is not None:
                    next_item["limits"] = self.normalize_limits(updates.get("limits"))
                self._items[index] = next_item
                self._save()
                return self._public_item(next_item)
        return None

    def delete_key(self, key_id: str, *, role: AuthRole | None = None) -> bool:
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return False
        with self._lock:
            self._reload_locked()
            before = len(self._items)
            self._items = [
                item
                for item in self._items
                if not (item.get("id") == normalized_id and (role is None or item.get("role") == role))
            ]
            if len(self._items) == before:
                return False
            self._save()
            return True

    def _mark_used_locked(self, item: dict[str, object], index: int) -> dict[str, object]:
        next_item = dict(item)
        now = datetime.now(timezone.utc)
        next_item["last_used_at"] = now.isoformat()
        self._items[index] = next_item
        item_id = self._clean(next_item.get("id"))
        last_flush_at = self._last_used_flush_at.get(item_id)
        if last_flush_at is None or (now - last_flush_at).total_seconds() >= 60:
            try:
                self._save()
                self._last_used_flush_at[item_id] = now
            except Exception:
                pass
        return self._public_item(next_item)

    def authenticate(self, raw_key: str) -> dict[str, object] | None:
        candidate = self._clean(raw_key)
        if not candidate:
            return None
        candidate_hash = _hash_key(candidate)
        with self._lock:
            for index, item in enumerate(self._items):
                if not bool(item.get("enabled", True)):
                    continue
                stored_hash = self._clean(item.get("key_hash"))
                if not stored_hash or not hmac.compare_digest(stored_hash, candidate_hash):
                    continue
                return self._mark_used_locked(item, index)
        return None

    def authenticate_user_name(self, name: str) -> dict[str, object] | None:
        candidate = self._clean(name)
        if not candidate:
            return None
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("role") != "user" or not bool(item.get("enabled", True)):
                    continue
                if self._clean(item.get("name")) != candidate:
                    continue
                return self._mark_used_locked(item, index)
        return None

    def create_session_token(self, identity: dict[str, object]) -> str:
        role = self._clean(identity.get("role")).lower()
        item_id = self._clean(identity.get("id"))
        if role != "user" or not item_id:
            raise ValueError("only user identities can create session tokens")
        payload = {
            "typ": "user_session",
            "sub": item_id,
            "role": role,
            "iat": int(datetime.now(timezone.utc).timestamp()),
        }
        payload_b64 = _base64url_encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        signature = hmac.new(config.auth_key.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
        return f"{SESSION_TOKEN_PREFIX}{payload_b64}.{signature}"

    def authenticate_session_token(self, raw_token: str) -> dict[str, object] | None:
        candidate = self._clean(raw_token)
        if not candidate.startswith(SESSION_TOKEN_PREFIX):
            return None
        token_body = candidate[len(SESSION_TOKEN_PREFIX):]
        payload_b64, sep, signature = token_body.partition(".")
        if not sep or not payload_b64 or not signature:
            return None
        expected = hmac.new(config.auth_key.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        try:
            payload = json.loads(_base64url_decode(payload_b64).decode("utf-8"))
        except Exception:
            return None
        if not isinstance(payload, dict) or payload.get("typ") != "user_session":
            return None
        if self._clean(payload.get("role")).lower() != "user":
            return None
        item_id = self._clean(payload.get("sub"))
        try:
            issued_at = int(payload.get("iat"))
        except (TypeError, ValueError):
            return None
        now_ts = int(datetime.now(timezone.utc).timestamp())
        if issued_at <= 0 or issued_at > now_ts + 60 or now_ts - issued_at > SESSION_TOKEN_TTL_SECONDS:
            return None
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("role") != "user" or not bool(item.get("enabled", True)):
                    continue
                if self._clean(item.get("id")) != item_id:
                    continue
                return self._mark_used_locked(item, index)
        return None


auth_service = AuthService(config.get_storage_backend())
