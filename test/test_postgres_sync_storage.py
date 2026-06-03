from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from services.storage.base import StorageBackend
from services.storage.database_storage import DatabaseStorageBackend
from services.storage.factory import create_storage_backend
from services.storage.postgres_sync_storage import PostgresSyncStorageBackend


class MemoryStorageBackend(StorageBackend):
    def __init__(
        self,
        *,
        accounts: list[dict] | None = None,
        auth_keys: list[dict] | None = None,
        users: list[dict] | None = None,
        healthy: bool = True,
        backend_type: str = "memory",
    ):
        self.accounts = list(accounts or [])
        self.auth_keys = list(auth_keys or [])
        self.users = list(users or [])
        self.healthy = healthy
        self.backend_type = backend_type
        self.saved_accounts: list[list[dict]] = []
        self.saved_auth_keys: list[list[dict]] = []
        self.saved_users: list[list[dict]] = []

    def load_accounts(self) -> list[dict]:
        if not self.healthy:
            raise RuntimeError(f"{self.backend_type} unavailable")
        return list(self.accounts)

    def save_accounts(self, accounts: list[dict]) -> None:
        if not self.healthy:
            raise RuntimeError(f"{self.backend_type} unavailable")
        self.accounts = list(accounts)
        self.saved_accounts.append(list(accounts))

    def load_auth_keys(self) -> list[dict]:
        if not self.healthy:
            raise RuntimeError(f"{self.backend_type} unavailable")
        return list(self.auth_keys)

    def save_auth_keys(self, auth_keys: list[dict]) -> None:
        if not self.healthy:
            raise RuntimeError(f"{self.backend_type} unavailable")
        self.auth_keys = list(auth_keys)
        self.saved_auth_keys.append(list(auth_keys))

    def load_users(self) -> list[dict]:
        if not self.healthy:
            raise RuntimeError(f"{self.backend_type} unavailable")
        return list(self.users)

    def save_users(self, users: list[dict]) -> None:
        if not self.healthy:
            raise RuntimeError(f"{self.backend_type} unavailable")
        self.users = list(users)
        self.saved_users.append(list(users))

    def health_check(self) -> dict:
        return {"status": "healthy" if self.healthy else "unhealthy", "backend": self.backend_type}

    def get_backend_info(self) -> dict:
        return {"type": self.backend_type, "description": f"{self.backend_type} storage"}


class SeedFailingStorageBackend(MemoryStorageBackend):
    def save_accounts(self, accounts: list[dict]) -> None:
        raise RuntimeError("seed sync failed")


class PostgresSyncStorageTests(unittest.TestCase):
    def test_database_storage_persists_users_table(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            storage = DatabaseStorageBackend(f"sqlite:///{Path(tmp_dir) / 'accounts.db'}")
            users = [{"id": "user-1", "name": "Alice", "role": "user", "enabled": True}]

            storage.save_users(users)

            self.assertEqual(storage.load_users(), users)
            self.assertEqual(storage.health_check()["user_count"], 1)

    def test_load_accounts_prefers_postgres_data(self) -> None:
        primary = MemoryStorageBackend(accounts=[{"access_token": "json-token"}], backend_type="json")
        postgres = MemoryStorageBackend(accounts=[{"access_token": "pg-token"}], backend_type="database")
        storage = PostgresSyncStorageBackend(primary, postgres)

        accounts = storage.load_accounts()

        self.assertEqual(accounts, [{"access_token": "pg-token"}])
        self.assertEqual(postgres.saved_accounts, [])

    def test_load_accounts_seeds_postgres_from_primary_when_postgres_is_empty(self) -> None:
        primary_accounts = [{"access_token": "json-token"}]
        primary = MemoryStorageBackend(accounts=primary_accounts, backend_type="json")
        postgres = MemoryStorageBackend(accounts=[], backend_type="database")
        storage = PostgresSyncStorageBackend(primary, postgres)

        accounts = storage.load_accounts()

        self.assertEqual(accounts, primary_accounts)
        self.assertEqual(postgres.saved_accounts, [primary_accounts])

    def test_load_auth_keys_prefers_postgres_and_seeds_when_empty(self) -> None:
        primary_keys = [{"id": "user-1", "name": "Primary User"}]
        primary = MemoryStorageBackend(auth_keys=primary_keys, backend_type="json")
        postgres = MemoryStorageBackend(auth_keys=[], backend_type="database")
        storage = PostgresSyncStorageBackend(primary, postgres)

        auth_keys = storage.load_auth_keys()

        self.assertEqual(auth_keys, primary_keys)
        self.assertEqual(postgres.saved_auth_keys, [primary_keys])

        postgres.auth_keys = [{"id": "user-2", "name": "Postgres User"}]
        self.assertEqual(storage.load_auth_keys(), [{"id": "user-2", "name": "Postgres User"}])

    def test_load_users_prefers_postgres_and_seeds_when_empty(self) -> None:
        primary_users = [{"id": "user-1", "name": "Primary User"}]
        primary = MemoryStorageBackend(users=primary_users, backend_type="json")
        postgres = MemoryStorageBackend(users=[], backend_type="database")
        storage = PostgresSyncStorageBackend(primary, postgres)

        users = storage.load_users()

        self.assertEqual(users, primary_users)
        self.assertEqual(postgres.saved_users, [primary_users])

        postgres.users = [{"id": "user-2", "name": "Postgres User"}]
        self.assertEqual(storage.load_users(), [{"id": "user-2", "name": "Postgres User"}])

    def test_save_accounts_and_auth_keys_write_primary_then_postgres(self) -> None:
        primary = MemoryStorageBackend(backend_type="json")
        postgres = MemoryStorageBackend(backend_type="database")
        storage = PostgresSyncStorageBackend(primary, postgres)
        accounts = [{"access_token": "token-1"}]
        auth_keys = [{"id": "user-1", "key_hash": "hash"}]
        users = [{"id": "user-1", "name": "Alice"}]

        storage.save_accounts(accounts)
        storage.save_auth_keys(auth_keys)
        storage.save_users(users)

        self.assertEqual(primary.saved_accounts, [accounts])
        self.assertEqual(postgres.saved_accounts, [accounts])
        self.assertEqual(primary.saved_auth_keys, [auth_keys])
        self.assertEqual(postgres.saved_auth_keys, [auth_keys])
        self.assertEqual(primary.saved_users, [users])
        self.assertEqual(postgres.saved_users, [users])

    def test_save_ignores_primary_sync_failure_after_postgres_write(self) -> None:
        primary = MemoryStorageBackend(healthy=False, backend_type="json")
        postgres = MemoryStorageBackend(backend_type="database")
        storage = PostgresSyncStorageBackend(primary, postgres)
        users = [{"id": "user-1", "name": "Alice"}]

        storage.save_users(users)

        self.assertEqual(postgres.saved_users, [users])
        self.assertEqual(primary.saved_users, [])

    def test_load_falls_back_to_primary_when_postgres_is_unavailable(self) -> None:
        primary = MemoryStorageBackend(accounts=[{"access_token": "json-token"}], backend_type="json")
        postgres = MemoryStorageBackend(healthy=False, backend_type="database")
        storage = PostgresSyncStorageBackend(primary, postgres)

        self.assertEqual(storage.load_accounts(), [{"access_token": "json-token"}])

    def test_load_returns_primary_data_when_postgres_seed_sync_fails(self) -> None:
        primary = MemoryStorageBackend(accounts=[{"access_token": "json-token"}], backend_type="json")
        postgres = SeedFailingStorageBackend(accounts=[], backend_type="database")
        storage = PostgresSyncStorageBackend(primary, postgres)

        self.assertEqual(storage.load_accounts(), [{"access_token": "json-token"}])

    def test_save_raises_without_changing_primary_when_postgres_sync_fails(self) -> None:
        primary = MemoryStorageBackend(backend_type="json")
        postgres = MemoryStorageBackend(healthy=False, backend_type="database")
        storage = PostgresSyncStorageBackend(primary, postgres)
        accounts = [{"access_token": "token-1"}]

        with self.assertRaisesRegex(RuntimeError, "database unavailable"):
            storage.save_accounts(accounts)

        self.assertEqual(primary.saved_accounts, [])

    def test_factory_wraps_primary_storage_when_postgres_sync_url_is_configured(self) -> None:
        old_env = {
            "STORAGE_BACKEND": os.environ.get("STORAGE_BACKEND"),
            "POSTGRES_SYNC_DATABASE_URL": os.environ.get("POSTGRES_SYNC_DATABASE_URL"),
            "DATABASE_URL": os.environ.get("DATABASE_URL"),
        }
        try:
            os.environ["STORAGE_BACKEND"] = "json"
            os.environ["POSTGRES_SYNC_DATABASE_URL"] = "postgresql://user:pass@localhost:5432/app"
            os.environ.pop("DATABASE_URL", None)
            with tempfile.TemporaryDirectory() as tmp_dir:
                with mock.patch("services.storage.factory.DatabaseStorageBackend") as database_cls:
                    database_cls.return_value = MemoryStorageBackend(backend_type="database")

                    storage = create_storage_backend(Path(tmp_dir))

            self.assertIsInstance(storage, PostgresSyncStorageBackend)
            database_cls.assert_called_once_with("postgresql://user:pass@localhost:5432/app")
            self.assertEqual(storage.get_backend_info()["type"], "postgres_sync")
        finally:
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_factory_does_not_wrap_when_postgres_is_primary_storage(self) -> None:
        old_env = {
            "STORAGE_BACKEND": os.environ.get("STORAGE_BACKEND"),
            "POSTGRES_SYNC_DATABASE_URL": os.environ.get("POSTGRES_SYNC_DATABASE_URL"),
            "DATABASE_URL": os.environ.get("DATABASE_URL"),
        }
        try:
            os.environ["STORAGE_BACKEND"] = "postgres"
            os.environ["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/app"
            os.environ["POSTGRES_SYNC_DATABASE_URL"] = "postgresql://user:pass@localhost:5432/app"
            with tempfile.TemporaryDirectory() as tmp_dir:
                with mock.patch("services.storage.factory.DatabaseStorageBackend") as database_cls:
                    database_cls.return_value = MemoryStorageBackend(backend_type="database")

                    storage = create_storage_backend(Path(tmp_dir))

            self.assertNotIsInstance(storage, PostgresSyncStorageBackend)
            database_cls.assert_called_once_with("postgresql://user:pass@localhost:5432/app")
        finally:
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_factory_does_not_wrap_database_alias_when_database_url_is_postgres(self) -> None:
        old_env = {
            "STORAGE_BACKEND": os.environ.get("STORAGE_BACKEND"),
            "POSTGRES_SYNC_DATABASE_URL": os.environ.get("POSTGRES_SYNC_DATABASE_URL"),
            "DATABASE_URL": os.environ.get("DATABASE_URL"),
        }
        try:
            os.environ["STORAGE_BACKEND"] = "database"
            os.environ["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/app"
            os.environ["POSTGRES_SYNC_DATABASE_URL"] = "postgresql://user:pass@localhost:5432/app"
            with tempfile.TemporaryDirectory() as tmp_dir:
                with mock.patch("services.storage.factory.DatabaseStorageBackend") as database_cls:
                    database_cls.return_value = MemoryStorageBackend(backend_type="database")

                    storage = create_storage_backend(Path(tmp_dir))

            self.assertNotIsInstance(storage, PostgresSyncStorageBackend)
            database_cls.assert_called_once_with("postgresql://user:pass@localhost:5432/app")
        finally:
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
