from __future__ import annotations

from typing import Any, Callable

from services.storage.base import StorageBackend


class PostgresSyncStorageBackend(StorageBackend):
    """Prefer PostgreSQL reads while keeping the existing storage backend in sync."""

    def __init__(self, primary: StorageBackend, postgres: StorageBackend):
        self.primary = primary
        self.postgres = postgres

    def load_accounts(self) -> list[dict[str, Any]]:
        return self._load_prefer_postgres(
            load_primary=self.primary.load_accounts,
            load_postgres=self.postgres.load_accounts,
            save_postgres=self.postgres.save_accounts,
        )

    def save_accounts(self, accounts: list[dict[str, Any]]) -> None:
        self.postgres.save_accounts(accounts)
        self._best_effort_primary_sync(self.primary.save_accounts, accounts, "accounts")

    def load_auth_keys(self) -> list[dict[str, Any]]:
        return self._load_prefer_postgres(
            load_primary=self.primary.load_auth_keys,
            load_postgres=self.postgres.load_auth_keys,
            save_postgres=self.postgres.save_auth_keys,
        )

    def save_auth_keys(self, auth_keys: list[dict[str, Any]]) -> None:
        self.postgres.save_auth_keys(auth_keys)
        self._best_effort_primary_sync(self.primary.save_auth_keys, auth_keys, "auth_keys")

    def load_users(self) -> list[dict[str, Any]]:
        return self._load_prefer_postgres(
            load_primary=self.primary.load_users,
            load_postgres=self.postgres.load_users,
            save_postgres=self.postgres.save_users,
        )

    def save_users(self, users: list[dict[str, Any]]) -> None:
        self.postgres.save_users(users)
        self._best_effort_primary_sync(self.primary.save_users, users, "users")

    @staticmethod
    def _best_effort_primary_sync(
        save_primary: Callable[[list[dict[str, Any]]], None],
        items: list[dict[str, Any]],
        label: str,
    ) -> None:
        try:
            save_primary(items)
        except Exception as exc:
            print(f"[postgres-sync] primary {label} sync failed after postgres write: {exc}")

    @staticmethod
    def _load_prefer_postgres(
        *,
        load_primary: Callable[[], list[dict[str, Any]]],
        load_postgres: Callable[[], list[dict[str, Any]]],
        save_postgres: Callable[[list[dict[str, Any]]], None],
    ) -> list[dict[str, Any]]:
        try:
            postgres_items = load_postgres()
        except Exception:
            return load_primary()
        if postgres_items:
            return postgres_items

        primary_items = load_primary()
        if primary_items:
            try:
                save_postgres(primary_items)
            except Exception:
                pass
        return primary_items

    def health_check(self) -> dict[str, Any]:
        primary_health = self.primary.health_check()
        postgres_health = self.postgres.health_check()
        primary_ok = primary_health.get("status") == "healthy"
        postgres_ok = postgres_health.get("status") == "healthy"
        return {
            "status": "healthy" if primary_ok and postgres_ok else "unhealthy",
            "backend": "postgres_sync",
            "primary": primary_health,
            "postgres": postgres_health,
        }

    def get_backend_info(self) -> dict[str, Any]:
        return {
            "type": "postgres_sync",
            "description": "PostgreSQL 优先读取，并同步写入原存储和 PostgreSQL",
            "primary": self.primary.get_backend_info(),
            "postgres": self.postgres.get_backend_info(),
        }
