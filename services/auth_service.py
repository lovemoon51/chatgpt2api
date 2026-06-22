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
    "images_total": None,
    "images_used": 0,
    "images_remaining": None,
    "concurrency": None,
    "models": [],
}

SESSION_TOKEN_PREFIX = "sess-"
SESSION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
PASSWORD_HASH_PREFIX = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 260_000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_email(value: object) -> str:
    return str(value or "").strip().lower()


def _hash_password(password: str) -> str:
    salt = secrets.token_urlsafe(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PASSWORD_HASH_ITERATIONS,
    ).hex()
    return f"{PASSWORD_HASH_PREFIX}${PASSWORD_HASH_ITERATIONS}${salt}${digest}"


def _verify_password(password: str, password_hash: object) -> bool:
    encoded = str(password_hash or "").strip()
    parts = encoded.split("$")
    if len(parts) != 4 or parts[0] != PASSWORD_HASH_PREFIX:
        return False
    try:
        iterations = int(parts[1])
    except ValueError:
        return False
    salt = parts[2]
    expected = parts[3]
    if iterations <= 0 or not salt or not expected:
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    ).hex()
    return hmac.compare_digest(digest, expected)


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
    def normalize_limits(cls, raw: object, *, current: object = None) -> dict[str, object]:
        limits = dict(DEFAULT_LIMITS)
        if isinstance(current, dict):
            current_limits = cls.normalize_limits(current)
            limits["images_used"] = current_limits.get("images_used", 0)
        if not isinstance(raw, dict):
            cls._refresh_image_remaining(limits)
            return limits
        for key in ("requests_per_day", "images_per_day", "images_total", "concurrency"):
            value = raw.get(key)
            if key == "images_total" and value is None and raw.get("images_per_day") is not None:
                value = raw.get("images_per_day")
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
        for key in ("images_used",):
            value = raw.get(key, limits.get(key, 0))
            if value is None:
                limits[key] = 0
                continue
            if isinstance(value, bool):
                raise ValueError(f"{key} must be a non-negative number")
            try:
                number = int(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{key} must be a non-negative number") from exc
            if number < 0:
                raise ValueError(f"{key} must be a non-negative number")
            limits[key] = number
        models = raw.get("models", [])
        if models is None:
            limits["models"] = []
        elif isinstance(models, list):
            limits["models"] = list(dict.fromkeys(str(model).strip() for model in models if str(model).strip()))
        else:
            raise ValueError("models must be a list")
        cls._refresh_image_remaining(limits)
        return limits

    @staticmethod
    def _refresh_image_remaining(limits: dict[str, object]) -> None:
        total = limits.get("images_total")
        used = limits.get("images_used")
        if not isinstance(used, int):
            try:
                used = int(used or 0)
            except (TypeError, ValueError):
                used = 0
        used = max(0, used)
        limits["images_used"] = used
        if total is None:
            limits["images_remaining"] = None
            return
        try:
            total_number = max(0, int(total))
        except (TypeError, ValueError):
            limits["images_total"] = None
            limits["images_remaining"] = None
            return
        limits["images_total"] = total_number
        limits["images_remaining"] = max(0, total_number - used)

    def _normalize_auth_key(self, raw: object) -> dict[str, object] | None:
        if not isinstance(raw, dict):
            return None
        role = self._clean(raw.get("role")).lower()
        if role not in {"admin", "user"}:
            return None
        key_hash = self._clean(raw.get("key_hash"))
        if not key_hash:
            return None
        item_id = self._clean(raw.get("id")) or uuid.uuid4().hex[:12]
        created_at = self._clean(raw.get("created_at")) or _now_iso()
        last_used_at = self._clean(raw.get("last_used_at")) or None
        if role == "user":
            return {
                "id": item_id,
                "key_id": item_id,
                "user_id": self._clean(raw.get("user_id")) or item_id,
                "role": role,
                "key_hash": key_hash,
                "enabled": bool(raw.get("enabled", True)),
                "created_at": created_at,
                "last_used_at": last_used_at,
                "consumed_at": self._clean(raw.get("consumed_at")) or None,
            }
        name = self._clean(raw.get("name")) or self._default_name(role)
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

    def _normalize_user(self, raw: object) -> dict[str, object] | None:
        if not isinstance(raw, dict):
            return None
        user_id = self._clean(raw.get("id"))
        if not user_id:
            return None
        role = self._clean(raw.get("role")).lower() or "user"
        if role != "user":
            return None
        name = self._clean(raw.get("name")) or self._default_name("user")
        created_at = self._clean(raw.get("created_at")) or _now_iso()
        updated_at = self._clean(raw.get("updated_at")) or created_at
        last_used_at = self._clean(raw.get("last_used_at")) or None
        last_login_ip = self._clean(raw.get("last_login_ip")) or None
        try:
            limits = self.normalize_limits(raw.get("limits"))
        except ValueError:
            limits = dict(DEFAULT_LIMITS)
        email = _normalize_email(raw.get("email"))
        password_hash = self._clean(raw.get("password_hash"))
        return {
            "id": user_id,
            "name": name,
            "email": email,
            "password_hash": password_hash,
            "role": "user",
            "enabled": bool(raw.get("enabled", True)),
            "created_at": created_at,
            "updated_at": updated_at,
            "last_used_at": last_used_at,
            "last_login_ip": last_login_ip,
            "limits": limits,
            "last_checkin_date": self._clean(raw.get("last_checkin_date")) or None,
        }

    def _user_from_legacy_key(self, key_item: dict[str, object], raw: object) -> dict[str, object]:
        raw_dict = raw if isinstance(raw, dict) else {}
        user_id = self._clean(key_item.get("user_id")) or self._clean(key_item.get("id")) or uuid.uuid4().hex[:12]
        created_at = self._clean(raw_dict.get("created_at")) or self._clean(key_item.get("created_at")) or _now_iso()
        try:
            limits = self.normalize_limits(raw_dict.get("limits"))
        except ValueError:
            limits = dict(DEFAULT_LIMITS)
        return {
            "id": user_id,
            "name": self._clean(raw_dict.get("name")) or self._default_name("user"),
            "email": _normalize_email(raw_dict.get("email")),
            "password_hash": self._clean(raw_dict.get("password_hash")),
            "role": "user",
            "enabled": bool(raw_dict.get("enabled", key_item.get("enabled", True))),
            "created_at": created_at,
            "updated_at": self._clean(raw_dict.get("updated_at")) or created_at,
            "last_used_at": self._clean(raw_dict.get("last_used_at")) or self._clean(key_item.get("last_used_at")) or None,
            "last_login_ip": self._clean(raw_dict.get("last_login_ip")) or None,
            "limits": limits,
            "last_checkin_date": self._clean(raw_dict.get("last_checkin_date")) or None,
        }

    @staticmethod
    def _combine_user_key(key_item: dict[str, object], user: dict[str, object]) -> dict[str, object]:
        user_id = str(user.get("id") or key_item.get("user_id") or key_item.get("id") or "").strip()
        return {
            "id": user_id,
            "key_id": key_item.get("id") or user_id,
            "user_id": user_id,
            "name": user.get("name"),
            "email": user.get("email"),
            "password_hash": user.get("password_hash"),
            "role": "user",
            "key_hash": key_item.get("key_hash"),
            "enabled": bool(user.get("enabled", True)),
            "key_enabled": bool(key_item.get("enabled", True)),
            "key_consumed_at": key_item.get("consumed_at"),
            "created_at": user.get("created_at"),
            "updated_at": user.get("updated_at"),
            "key_created_at": key_item.get("created_at"),
            "last_used_at": user.get("last_used_at") or key_item.get("last_used_at"),
            "last_login_ip": user.get("last_login_ip"),
            "limits": AuthService.normalize_limits(user.get("limits")),
            "last_checkin_date": user.get("last_checkin_date"),
        }

    def _load(self) -> list[dict[str, object]]:
        try:
            raw_auth_keys = self.storage.load_auth_keys()
        except Exception:
            return []
        if not isinstance(raw_auth_keys, list):
            return []
        try:
            raw_users = self.storage.load_users()
        except Exception:
            raw_users = []
        raw_users = raw_users if isinstance(raw_users, list) else []
        users_by_id = {
            str(user["id"]): user
            for raw_user in raw_users
            if (user := self._normalize_user(raw_user)) is not None
        }

        items: list[dict[str, object]] = []
        migrated = False
        for raw_item in raw_auth_keys:
            key_item = self._normalize_auth_key(raw_item)
            if key_item is None:
                continue
            if key_item.get("role") != "user":
                items.append(key_item)
                continue
            user_id = self._clean(key_item.get("user_id")) or self._clean(key_item.get("id"))
            if not user_id:
                continue
            key_item["user_id"] = user_id
            user = users_by_id.get(user_id)
            if user is None:
                user = self._user_from_legacy_key(key_item, raw_item)
                users_by_id[user_id] = user
                migrated = True
            if isinstance(raw_item, dict) and self._clean(raw_item.get("user_id")) != user_id:
                migrated = True
            items.append(self._combine_user_key(key_item, user))

        if migrated:
            try:
                self._persist_items(items)
            except Exception:
                pass
        return items

    def _save(self) -> None:
        self._persist_items(self._items)

    def _persist_items(self, items: list[dict[str, object]]) -> None:
        auth_keys: list[dict[str, object]] = []
        users: list[dict[str, object]] = []
        for item in items:
            role = self._clean(item.get("role")).lower()
            if role == "user":
                user_id = self._clean(item.get("user_id")) or self._clean(item.get("id"))
                if not user_id:
                    continue
                users.append(
                    {
                        "id": user_id,
                        "name": self._clean(item.get("name")) or self._default_name("user"),
                        "email": _normalize_email(item.get("email")),
                        "password_hash": self._clean(item.get("password_hash")),
                        "role": "user",
                        "enabled": bool(item.get("enabled", True)),
                        "created_at": self._clean(item.get("created_at")) or _now_iso(),
                        "updated_at": self._clean(item.get("updated_at")) or self._clean(item.get("created_at")) or _now_iso(),
                        "last_used_at": self._clean(item.get("last_used_at")) or None,
                        "last_login_ip": self._clean(item.get("last_login_ip")) or None,
                        "limits": self.normalize_limits(item.get("limits")),
                        "last_checkin_date": self._clean(item.get("last_checkin_date")) or None,
                    }
                )
                auth_keys.append(
                    {
                        "id": self._clean(item.get("key_id")) or user_id,
                        "user_id": user_id,
                        "role": "user",
                        "key_hash": self._clean(item.get("key_hash")),
                        "enabled": bool(item.get("key_enabled", item.get("enabled", True))),
                        "created_at": self._clean(item.get("key_created_at")) or self._clean(item.get("created_at")) or _now_iso(),
                        "last_used_at": self._clean(item.get("last_used_at")) or None,
                        "consumed_at": self._clean(item.get("key_consumed_at")) or None,
                    }
                )
                continue
            auth_keys.append(
                {
                    "id": self._clean(item.get("id")) or uuid.uuid4().hex[:12],
                    "name": self._clean(item.get("name")) or self._default_name(role),
                    "role": "admin" if role == "admin" else "user",
                    "key_hash": self._clean(item.get("key_hash")),
                    "enabled": bool(item.get("enabled", True)),
                    "created_at": self._clean(item.get("created_at")) or _now_iso(),
                    "last_used_at": self._clean(item.get("last_used_at")) or None,
                    "limits": self.normalize_limits(item.get("limits")),
                }
            )
        self.storage.save_users(users)
        self.storage.save_auth_keys(auth_keys)

    def _reload_locked(self) -> None:
        self._items = self._load()

    @staticmethod
    def _public_item(item: dict[str, object]) -> dict[str, object]:
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "email": _normalize_email(item.get("email")),
            "role": item.get("role"),
            "enabled": bool(item.get("enabled", True)),
            "created_at": item.get("created_at"),
            "updated_at": item.get("updated_at"),
            "last_used_at": item.get("last_used_at"),
            "last_login_ip": item.get("last_login_ip"),
            "key_consumed_at": item.get("key_consumed_at"),
            "limits": AuthService.normalize_limits(item.get("limits")),
            "last_checkin_date": item.get("last_checkin_date"),
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

    def _has_email_locked(self, email: str, *, exclude_id: str = "") -> bool:
        candidate = _normalize_email(email)
        if not candidate:
            return False
        for item in self._items:
            if item.get("role") != "user":
                continue
            item_id = self._clean(item.get("id"))
            if exclude_id and item_id == exclude_id:
                continue
            if _normalize_email(item.get("email")) == candidate:
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
                "key_enabled": True,
                "key_consumed_at": None,
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
                if next_role == "user" and "email" in updates and updates.get("email") is not None:
                    normalized_email = _normalize_email(updates.get("email"))
                    if normalized_email and self._has_email_locked(normalized_email, exclude_id=normalized_id):
                        raise ValueError("这个邮箱已经绑定过 ColaAI 账号")
                    next_item["email"] = normalized_email
                if "key" in updates and updates.get("key") is not None:
                    next_item["key_hash"] = self._build_key_hash_locked(str(updates.get("key") or ""), exclude_id=normalized_id)
                    if next_role == "user":
                        next_item["key_enabled"] = True
                        next_item["key_consumed_at"] = None
                if "limits" in updates and updates.get("limits") is not None:
                    next_item["limits"] = self.normalize_limits(updates.get("limits"), current=next_item.get("limits"))
                if next_role == "user" and any(key in updates for key in ("name", "email", "enabled", "limits")):
                    next_item["updated_at"] = _now_iso()
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

    def get_user(self, user_id: str) -> dict[str, object] | None:
        normalized_id = self._clean(user_id)
        if not normalized_id:
            return None
        with self._lock:
            self._reload_locked()
            for item in self._items:
                if item.get("role") == "user" and self._clean(item.get("id")) == normalized_id:
                    return self._public_item(item)
        return None

    def activate_user(
        self,
        access_code: str,
        *,
        email: str,
        password: str,
        name: str = "",
        login_ip: str = "",
    ) -> dict[str, object]:
        candidate_code = self._clean(access_code)
        normalized_email = _normalize_email(email)
        normalized_password = str(password or "")
        if not candidate_code:
            raise ValueError("请输入访问码")
        if not normalized_email or "@" not in normalized_email:
            raise ValueError("请输入有效邮箱")
        if len(normalized_password) < 6:
            raise ValueError("密码至少需要 6 位")
        candidate_hash = _hash_key(candidate_code)
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("role") != "user":
                    continue
                if not bool(item.get("enabled", True)):
                    continue
                if not bool(item.get("key_enabled", True)) or self._clean(item.get("key_consumed_at")):
                    continue
                stored_hash = self._clean(item.get("key_hash"))
                if not stored_hash or not hmac.compare_digest(stored_hash, candidate_hash):
                    continue
                item_id = self._clean(item.get("id"))
                if self._has_email_locked(normalized_email, exclude_id=item_id):
                    raise ValueError("这个邮箱已经绑定过 ColaAI 账号")
                now = datetime.now(timezone.utc)
                next_item = dict(item)
                next_item["email"] = normalized_email
                next_item["password_hash"] = _hash_password(normalized_password)
                next_item["key_enabled"] = False
                next_item["key_consumed_at"] = now.isoformat()
                next_item["last_used_at"] = now.isoformat()
                next_item["last_login_ip"] = self._clean(login_ip) or None
                next_item["updated_at"] = now.isoformat()
                if self._clean(name):
                    next_item["name"] = self._build_name_locked(
                        self._clean(name),
                        role="user",
                        exclude_id=item_id,
                    )
                self._items[index] = next_item
                self._save()
                self._last_used_flush_at[item_id] = now
                return self._public_item(next_item)
        raise ValueError("访问码无效或已经被激活")

    def consume_image_quota(self, user_id: str, amount: int = 1) -> dict[str, object]:
        normalized_id = self._clean(user_id)
        if not normalized_id:
            raise ValueError("user not found")
        try:
            normalized_amount = int(amount)
        except (TypeError, ValueError) as exc:
            raise ValueError("amount must be a positive number") from exc
        if normalized_amount <= 0:
            raise ValueError("amount must be a positive number")
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("role") != "user" or self._clean(item.get("id")) != normalized_id:
                    continue
                if not bool(item.get("enabled", True)):
                    raise ValueError("user is disabled")
                limits = self.normalize_limits(item.get("limits"))
                total = limits.get("images_total")
                if total is None:
                    return self._public_item(item)
                used = int(limits.get("images_used") or 0)
                if used + normalized_amount > int(total):
                    raise ValueError("image total limit exceeded")
                limits["images_used"] = used + normalized_amount
                self._refresh_image_remaining(limits)
                next_item = dict(item)
                next_item["limits"] = limits
                next_item["updated_at"] = _now_iso()
                self._items[index] = next_item
                self._save()
                return self._public_item(next_item)
        raise ValueError("user not found")

    def check_in(self, user_id: str) -> dict[str, object]:
        normalized_id = self._clean(user_id)
        if not normalized_id:
            raise ValueError("user not found")
        today = _today_iso()
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("role") != "user" or self._clean(item.get("id")) != normalized_id:
                    continue
                if not bool(item.get("enabled", True)):
                    raise ValueError("user is disabled")
                next_item = dict(item)
                awarded = self._clean(next_item.get("last_checkin_date")) != today
                bonus_images = 20 if awarded else 0
                if awarded:
                    limits = self.normalize_limits(next_item.get("limits"))
                    total = limits.get("images_total")
                    if total is not None:
                        limits["images_total"] = int(total) + bonus_images
                    self._refresh_image_remaining(limits)
                    next_item["limits"] = limits
                    next_item["last_checkin_date"] = today
                    next_item["updated_at"] = _now_iso()
                    self._items[index] = next_item
                    self._save()
                return {
                    "awarded": awarded,
                    "bonus_images": bonus_images,
                    "bonus_credits": bonus_images,
                    "user": self._public_item(next_item),
                }
        raise ValueError("user not found")

    def _mark_used_locked(
        self,
        item: dict[str, object],
        index: int,
        *,
        consume_access_code: bool = False,
        login_ip: str = "",
    ) -> dict[str, object]:
        next_item = dict(item)
        now = datetime.now(timezone.utc)
        next_item["last_used_at"] = now.isoformat()
        normalized_login_ip = self._clean(login_ip)
        if normalized_login_ip and next_item.get("role") == "user":
            next_item["last_login_ip"] = normalized_login_ip
        if consume_access_code and next_item.get("role") == "user":
            next_item["key_enabled"] = False
            next_item["key_consumed_at"] = now.isoformat()
        self._items[index] = next_item
        item_id = self._clean(next_item.get("id"))
        last_flush_at = self._last_used_flush_at.get(item_id)
        if consume_access_code or last_flush_at is None or (now - last_flush_at).total_seconds() >= 60:
            try:
                self._save()
                self._last_used_flush_at[item_id] = now
            except Exception:
                pass
        return self._public_item(next_item)

    def authenticate(self, raw_key: str, *, login_ip: str = "") -> dict[str, object] | None:
        candidate = self._clean(raw_key)
        if not candidate:
            return None
        candidate_hash = _hash_key(candidate)
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if not bool(item.get("enabled", True)):
                    continue
                if item.get("role") == "user" and (
                    not bool(item.get("key_enabled", True)) or self._clean(item.get("key_consumed_at"))
                ):
                    continue
                stored_hash = self._clean(item.get("key_hash"))
                if not stored_hash or not hmac.compare_digest(stored_hash, candidate_hash):
                    continue
                return self._mark_used_locked(
                    item,
                    index,
                    consume_access_code=item.get("role") == "user",
                    login_ip=login_ip,
                )
        return None

    def authenticate_user_name(self, name: str, *, login_ip: str = "") -> dict[str, object] | None:
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
                return self._mark_used_locked(item, index, login_ip=login_ip)
        return None

    def authenticate_password(self, email: str, password: str, *, login_ip: str = "") -> dict[str, object] | None:
        candidate_email = _normalize_email(email)
        candidate_password = str(password or "")
        if not candidate_email or not candidate_password:
            return None
        with self._lock:
            self._reload_locked()
            for index, item in enumerate(self._items):
                if item.get("role") != "user" or not bool(item.get("enabled", True)):
                    continue
                if _normalize_email(item.get("email")) != candidate_email:
                    continue
                if not _verify_password(candidate_password, item.get("password_hash")):
                    return None
                return self._mark_used_locked(item, index, login_ip=login_ip)
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

    def authenticate_session_token(self, raw_token: str, *, login_ip: str = "") -> dict[str, object] | None:
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
                return self._mark_used_locked(item, index, login_ip=login_ip)
        return None


auth_service = AuthService(config.get_storage_backend())
