from __future__ import annotations

from dataclasses import dataclass
import json
import os
import sys
from pathlib import Path
import time

from services.storage.base import StorageBackend

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
CONFIG_FILE = BASE_DIR / "config.json"
VERSION_FILE = BASE_DIR / "VERSION"
BACKUP_STATE_FILE = DATA_DIR / "backup_state.json"

DEFAULT_BACKUP_INCLUDE = {
    "config": True,
    "register": True,
    "cpa": True,
    "sub2api": True,
    "logs": True,
    "image_tasks": True,
    "accounts_snapshot": True,
    "auth_keys_snapshot": True,
    "images": False,
}

DEFAULT_AUTO_REGISTER_SETTINGS = {
    "enabled": True,
    "min_available": 50,
    "target_available": 50,
    "check_interval_seconds": 30,
    "cooldown_seconds": 300,
}

DEFAULT_ACCOUNT_POOL_SETTINGS = {
    "max_total_accounts": 50,
}

DEFAULT_AUTH_SETTINGS = {
    "username_login_enabled": False,
}


def _normalize_bool(value: object, default: bool = False) -> bool:
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    if value is None:
        return default
    return bool(value)


def _normalize_positive_int(value: object, default: int, minimum: int = 0) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        normalized = default
    return max(minimum, normalized)


def _normalize_positive_float(value: object, default: float, minimum: float = 0.0) -> float:
    try:
        normalized = float(value)
    except (TypeError, ValueError):
        normalized = default
    return max(minimum, normalized)


def _normalize_backup_include(value: object) -> dict[str, bool]:
    source = value if isinstance(value, dict) else {}
    normalized = dict(DEFAULT_BACKUP_INCLUDE)
    for key in normalized:
        normalized[key] = _normalize_bool(source.get(key), normalized[key])
    return normalized


def _normalize_backup_settings(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "enabled": _normalize_bool(source.get("enabled"), False),
        "provider": "cloudflare_r2",
        "account_id": str(source.get("account_id") or "").strip(),
        "access_key_id": str(source.get("access_key_id") or "").strip(),
        "secret_access_key": str(source.get("secret_access_key") or "").strip(),
        "bucket": str(source.get("bucket") or "").strip(),
        "prefix": str(source.get("prefix") or "backups").strip().strip("/") or "backups",
        "interval_minutes": _normalize_positive_int(source.get("interval_minutes"), 360, 1),
        "rotation_keep": _normalize_positive_int(source.get("rotation_keep"), 10, 0),
        "encrypt": _normalize_bool(source.get("encrypt"), False),
        "passphrase": str(source.get("passphrase") or "").strip(),
        "include": _normalize_backup_include(source.get("include")),
    }


def _normalize_auto_register_settings(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "enabled": _normalize_bool(source.get("enabled"), bool(DEFAULT_AUTO_REGISTER_SETTINGS["enabled"])),
        "min_available": _normalize_positive_int(
            source.get("min_available"),
            int(DEFAULT_AUTO_REGISTER_SETTINGS["min_available"]),
            1,
        ),
        "target_available": _normalize_positive_int(
            source.get("target_available"),
            int(DEFAULT_AUTO_REGISTER_SETTINGS["target_available"]),
            1,
        ),
        "check_interval_seconds": _normalize_positive_int(
            source.get("check_interval_seconds"),
            int(DEFAULT_AUTO_REGISTER_SETTINGS["check_interval_seconds"]),
            5,
        ),
        "cooldown_seconds": _normalize_positive_int(
            source.get("cooldown_seconds"),
            int(DEFAULT_AUTO_REGISTER_SETTINGS["cooldown_seconds"]),
            30,
        ),
    }


def _normalize_account_pool_settings(value: object, legacy_auto_register: object = None) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    legacy = legacy_auto_register if isinstance(legacy_auto_register, dict) else {}
    return {
        "max_total_accounts": _normalize_positive_int(
            source.get("max_total_accounts", legacy.get("target_available")),
            int(DEFAULT_ACCOUNT_POOL_SETTINGS["max_total_accounts"]),
            1,
        ),
    }


def _normalize_auth_settings(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "username_login_enabled": _normalize_bool(
            source.get("username_login_enabled"),
            bool(DEFAULT_AUTH_SETTINGS["username_login_enabled"]),
        ),
    }


def _nested_get(source: dict[str, object], path: str) -> tuple[bool, object]:
    current: object = source
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return False, None
        current = current[part]
    return True, current


def _diagnostic_value_is_set(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def _diagnostic_value_preview(value: object) -> str | None:
    if not _diagnostic_value_is_set(value):
        return None
    if isinstance(value, bool):
        return "启用" if value else "关闭"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        normalized = value.strip()
        if len(normalized) > 72:
            return f"{normalized[:69]}..."
        return normalized
    if isinstance(value, (list, tuple, set)):
        return f"{len(value)} 项"
    if isinstance(value, dict):
        return f"{len(value)} 项"
    return str(value)


def _merge_dicts(current: object, updates: object) -> object:
    if not isinstance(current, dict) or not isinstance(updates, dict):
        return updates
    merged = dict(current)
    for key, value in updates.items():
        merged[key] = _merge_dicts(merged.get(key), value)
    return merged


def _normalize_backup_state(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "last_started_at": str(source.get("last_started_at") or "").strip() or None,
        "last_finished_at": str(source.get("last_finished_at") or "").strip() or None,
        "last_status": str(source.get("last_status") or "idle").strip() or "idle",
        "last_error": str(source.get("last_error") or "").strip() or None,
        "last_object_key": str(source.get("last_object_key") or "").strip() or None,
    }


@dataclass(frozen=True)
class LoadedSettings:
    auth_key: str
    refresh_account_interval_minute: int


def _normalize_auth_key(value: object) -> str:
    return str(value or "").strip()


def _is_invalid_auth_key(value: object) -> bool:
    return _normalize_auth_key(value) == ""


def _read_json_object(path: Path, *, name: str) -> dict[str, object]:
    if not path.exists():
        return {}
    if path.is_dir():
        print(
            f"Warning: {name} at '{path}' is a directory, ignoring it and falling back to other configuration sources.",
            file=sys.stderr,
        )
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _load_settings() -> LoadedSettings:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    raw_config = _read_json_object(CONFIG_FILE, name="config.json")
    auth_key = _normalize_auth_key(os.getenv("CHATGPT2API_AUTH_KEY") or raw_config.get("auth-key"))
    if _is_invalid_auth_key(auth_key):
        raise ValueError(
            "❌ auth-key 未设置！\n"
            "请在环境变量 CHATGPT2API_AUTH_KEY 中设置，或者在 config.json 中填写 auth-key。"
        )

    try:
        refresh_interval = int(raw_config.get("refresh_account_interval_minute", 5))
    except (TypeError, ValueError):
        refresh_interval = 5

    return LoadedSettings(
        auth_key=auth_key,
        refresh_account_interval_minute=refresh_interval,
    )


class ConfigStore:
    def __init__(self, path: Path):
        self.path = path
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.data = self._load()
        self._storage_backend: StorageBackend | None = None
        if _is_invalid_auth_key(self.auth_key):
            raise ValueError(
                "❌ auth-key 未设置！\n"
                "请按以下任意一种方式解决：\n"
                "1. 在 Render 的 Environment 变量中添加：\n"
                "   CHATGPT2API_AUTH_KEY = your_real_auth_key\n"
                "2. 或者在 config.json 中填写：\n"
                '   "auth-key": "your_real_auth_key"'
            )

    def _load(self) -> dict[str, object]:
        return _read_json_object(self.path, name="config.json")

    def _save(self) -> None:
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    @property
    def auth_key(self) -> str:
        return _normalize_auth_key(os.getenv("CHATGPT2API_AUTH_KEY") or self.data.get("auth-key"))

    @property
    def accounts_file(self) -> Path:
        return DATA_DIR / "accounts.json"

    @property
    def refresh_account_interval_minute(self) -> int:
        try:
            return int(self.data.get("refresh_account_interval_minute", 5))
        except (TypeError, ValueError):
            return 5

    @property
    def image_retention_days(self) -> int:
        try:
            return max(1, int(self.data.get("image_retention_days", 30)))
        except (TypeError, ValueError):
            return 30

    @property
    def image_poll_timeout_secs(self) -> int:
        try:
            return max(1, int(self.data.get("image_poll_timeout_secs", 120)))
        except (TypeError, ValueError):
            return 120

    @property
    def image_account_concurrency(self) -> int:
        try:
            return max(1, int(self.data.get("image_account_concurrency", 3)))
        except (TypeError, ValueError):
            return 3

    @property
    def image_pool_preflight_wait_seconds(self) -> float:
        return _normalize_positive_float(self.data.get("image_pool_preflight_wait_seconds"), 3.0, 0.0)

    @property
    def image_pool_register_timeout_seconds(self) -> float:
        return _normalize_positive_float(self.data.get("image_pool_register_timeout_seconds"), 60.0, 0.001)

    @property
    def image_pool_replenish_debounce_seconds(self) -> float:
        return _normalize_positive_float(self.data.get("image_pool_replenish_debounce_seconds"), 15.0, 0.0)

    @property
    def auto_remove_invalid_accounts(self) -> bool:
        value = self.data.get("auto_remove_invalid_accounts", True)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def auto_remove_rate_limited_accounts(self) -> bool:
        value = self.data.get("auto_remove_rate_limited_accounts", False)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @property
    def log_levels(self) -> list[str]:
        levels = self.data.get("log_levels")
        if not isinstance(levels, list):
            return []
        allowed = {"debug", "info", "warning", "error"}
        return [level for item in levels if (level := str(item or "").strip().lower()) in allowed]

    @property
    def sensitive_words(self) -> list[str]:
        words = self.data.get("sensitive_words")
        return [word for item in words if (word := str(item or "").strip())] if isinstance(words, list) else []

    @property
    def ai_review(self) -> dict[str, object]:
        value = self.data.get("ai_review")
        return value if isinstance(value, dict) else {}

    @property
    def global_system_prompt(self) -> str:
        return str(self.data.get("global_system_prompt") or "").strip()

    @property
    def images_dir(self) -> Path:
        path = DATA_DIR / "images"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def image_thumbnails_dir(self) -> Path:
        path = DATA_DIR / "image_thumbnails"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def cleanup_old_images(self) -> int:
        cutoff = time.time() - self.image_retention_days * 86400
        removed = 0
        for path in self.images_dir.rglob("*"):
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        for path in sorted((p for p in self.images_dir.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            try:
                path.rmdir()
            except OSError:
                pass
        return removed

    @property
    def base_url(self) -> str:
        return str(
            os.getenv("CHATGPT2API_BASE_URL")
            or self.data.get("base_url")
            or ""
        ).strip().rstrip("/")

    @property
    def app_version(self) -> str:
        try:
            value = VERSION_FILE.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return "0.0.0"
        return value or "0.0.0"

    def get(self) -> dict[str, object]:
        data = dict(self.data)
        data["refresh_account_interval_minute"] = self.refresh_account_interval_minute
        data["image_retention_days"] = self.image_retention_days
        data["image_poll_timeout_secs"] = self.image_poll_timeout_secs
        data["image_account_concurrency"] = self.image_account_concurrency
        data["image_pool_register_timeout_seconds"] = self.image_pool_register_timeout_seconds
        data["auto_remove_invalid_accounts"] = self.auto_remove_invalid_accounts
        data["auto_remove_rate_limited_accounts"] = self.auto_remove_rate_limited_accounts
        data["log_levels"] = self.log_levels
        data["sensitive_words"] = self.sensitive_words
        data["ai_review"] = self.ai_review
        data["global_system_prompt"] = self.global_system_prompt
        data["backup"] = self.get_backup_settings()
        data["auto_register"] = self.get_auto_register_settings()
        data["account_pool"] = self.get_account_pool_settings()
        data["auth"] = self.get_auth_settings()
        data.pop("auth-key", None)
        return data

    def diagnostics(self) -> dict[str, object]:
        items: list[dict[str, object]] = []

        def add_item(
            key: str,
            label: str,
            *,
            source: str,
            value: object = None,
            sensitive: bool = False,
            env: str | None = None,
            configured: bool | None = None,
        ) -> None:
            is_set = _diagnostic_value_is_set(value) if configured is None else configured
            item: dict[str, object] = {
                "key": key,
                "label": label,
                "source": source,
                "sensitive": sensitive,
                "configured": is_set,
                "status": "已设置" if is_set else "未设置",
            }
            if env:
                item["env"] = env
            if not sensitive:
                preview = _diagnostic_value_preview(value)
                if preview is not None:
                    item["value"] = preview
            items.append(item)

        def add_config_item(key: str, label: str, default_value: object = None, *, sensitive: bool = False) -> None:
            exists, value = _nested_get(self.data, key)
            source = "config.json" if exists else "default"
            add_item(key, label, source=source, value=value if exists else default_value, sensitive=sensitive)

        env_auth_key = os.getenv("CHATGPT2API_AUTH_KEY")
        config_auth_key = self.data.get("auth-key")
        add_item(
            "auth-key",
            "管理员登录密钥",
            source="env" if _diagnostic_value_is_set(env_auth_key) else "config.json" if _diagnostic_value_is_set(config_auth_key) else "missing",
            value=env_auth_key if _diagnostic_value_is_set(env_auth_key) else config_auth_key,
            sensitive=True,
            env="CHATGPT2API_AUTH_KEY",
        )

        env_base_url = os.getenv("CHATGPT2API_BASE_URL")
        if _diagnostic_value_is_set(env_base_url):
            add_item("base_url", "图片访问地址", source="env", value=self.base_url, env="CHATGPT2API_BASE_URL")
        else:
            add_config_item("base_url", "图片访问地址", "")

        add_config_item("proxy", "全局代理", "")
        add_config_item("log_levels", "控制台日志级别", [])
        add_config_item("auto_register", "图片健康号池巡检", DEFAULT_AUTO_REGISTER_SETTINGS)
        add_config_item("account_pool", "账号池总上限", DEFAULT_ACCOUNT_POOL_SETTINGS)
        add_config_item("auth.username_login_enabled", "用户名登录开关", DEFAULT_AUTH_SETTINGS["username_login_enabled"])
        add_config_item("backup.enabled", "云备份开关", False)
        add_config_item("backup.account_id", "R2 Account ID", "")
        add_config_item("backup.access_key_id", "R2 Access Key ID", "")
        add_config_item("backup.secret_access_key", "R2 Secret Access Key", "", sensitive=True)
        add_config_item("backup.bucket", "R2 Bucket", "")
        add_config_item("backup.passphrase", "备份加密口令", "", sensitive=True)
        add_config_item("ai_review.enabled", "AI 审核开关", False)
        add_config_item("ai_review.base_url", "AI 审核 Base URL", "")
        add_config_item("ai_review.api_key", "AI 审核 API Key", "", sensitive=True)
        add_config_item("ai_review.model", "AI 审核模型", "")

        storage_backend = os.getenv("STORAGE_BACKEND", "json").strip() or "json"
        add_item(
            "storage.backend",
            "账号存储后端",
            source="env" if os.getenv("STORAGE_BACKEND") else "default",
            value=storage_backend,
            env="STORAGE_BACKEND",
        )
        add_item(
            "storage.database_url",
            "数据库连接串",
            source="env" if os.getenv("DATABASE_URL") else "default",
            value=os.getenv("DATABASE_URL"),
            sensitive=True,
            env="DATABASE_URL",
        )
        add_item(
            "storage.git_repo_url",
            "Git 存储仓库",
            source="env" if os.getenv("GIT_REPO_URL") else "default",
            value=os.getenv("GIT_REPO_URL"),
            env="GIT_REPO_URL",
        )
        add_item(
            "storage.git_token",
            "Git 存储令牌",
            source="env" if os.getenv("GIT_TOKEN") else "default",
            value=os.getenv("GIT_TOKEN"),
            sensitive=True,
            env="GIT_TOKEN",
        )

        return {
            "config_file": str(self.path),
            "items": items,
        }

    def get_proxy_settings(self) -> str:
        return str(self.data.get("proxy") or "").strip()

    def update(self, data: dict[str, object]) -> dict[str, object]:
        next_data = dict(self.data)
        incoming = dict(data or {})
        for key in ("backup", "auto_register", "account_pool", "auth"):
            if key in incoming and isinstance(incoming.get(key), dict) and isinstance(next_data.get(key), dict):
                incoming[key] = _merge_dicts(next_data.get(key), incoming.get(key))
        next_data.update(incoming)
        if "backup" in next_data:
            next_data["backup"] = _normalize_backup_settings(next_data.get("backup"))
        if "auto_register" in next_data:
            next_data["auto_register"] = _normalize_auto_register_settings(next_data.get("auto_register"))
        if "account_pool" in next_data:
            next_data["account_pool"] = _normalize_account_pool_settings(
                next_data.get("account_pool"),
                next_data.get("auto_register"),
            )
        if "auth" in next_data:
            next_data["auth"] = _normalize_auth_settings(next_data.get("auth"))
        next_data.pop("backup_state", None)
        self.data = next_data
        self._save()
        return self.get()

    def get_backup_settings(self) -> dict[str, object]:
        return _normalize_backup_settings(self.data.get("backup"))

    def get_auto_register_settings(self) -> dict[str, object]:
        return _normalize_auto_register_settings(self.data.get("auto_register"))

    def get_account_pool_settings(self) -> dict[str, object]:
        return _normalize_account_pool_settings(self.data.get("account_pool"), self.data.get("auto_register"))

    def get_auth_settings(self) -> dict[str, object]:
        return _normalize_auth_settings(self.data.get("auth"))

    def get_storage_backend(self) -> StorageBackend:
        """获取存储后端实例（单例）"""
        if self._storage_backend is None:
            from services.storage.factory import create_storage_backend
            self._storage_backend = create_storage_backend(DATA_DIR)
        return self._storage_backend


def load_backup_state() -> dict[str, object]:
    return _normalize_backup_state(_read_json_object(BACKUP_STATE_FILE, name="backup_state.json"))


def save_backup_state(state: dict[str, object]) -> dict[str, object]:
    normalized = _normalize_backup_state(state)
    BACKUP_STATE_FILE.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return normalized


config = ConfigStore(CONFIG_FILE)
