from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import scripts.migrate_storage as migrate_storage


class FakeStorage:
    def __init__(self, accounts: list[dict] | None = None, auth_keys: list[dict] | None = None, users: list[dict] | None = None):
        self.accounts = list(accounts or [])
        self.auth_keys = list(auth_keys or [])
        self.users = list(users or [])
        self.saved_accounts: list[dict] | None = None
        self.saved_auth_keys: list[dict] | None = None
        self.saved_users: list[dict] | None = None

    def load_accounts(self) -> list[dict]:
        return list(self.accounts)

    def save_accounts(self, accounts: list[dict]) -> None:
        self.saved_accounts = list(accounts)

    def load_auth_keys(self) -> list[dict]:
        return list(self.auth_keys)

    def save_auth_keys(self, auth_keys: list[dict]) -> None:
        self.saved_auth_keys = list(auth_keys)

    def load_users(self) -> list[dict]:
        return list(self.users)

    def save_users(self, users: list[dict]) -> None:
        self.saved_users = list(users)


class MigrateStorageTests(unittest.TestCase):
    def test_migrate_data_copies_accounts_and_auth_keys(self) -> None:
        source = FakeStorage(
            accounts=[{"access_token": "token-1"}],
            auth_keys=[{"id": "user-1", "name": "Alice"}],
            users=[{"id": "user-1", "name": "Alice"}],
        )
        target = FakeStorage()

        def fake_create_storage(_data_dir: Path) -> FakeStorage:
            if os.environ["STORAGE_BACKEND"] == "json":
                return source
            if os.environ["STORAGE_BACKEND"] == "postgres":
                return target
            raise AssertionError("unexpected backend")

        original_backend = os.environ.get("STORAGE_BACKEND")
        try:
            os.environ.pop("STORAGE_BACKEND", None)
            with mock.patch.object(migrate_storage, "create_storage_backend", fake_create_storage):
                migrate_storage.migrate_data("json", "postgres")
        finally:
            if original_backend is None:
                os.environ.pop("STORAGE_BACKEND", None)
            else:
                os.environ["STORAGE_BACKEND"] = original_backend

        self.assertEqual(target.saved_accounts, [{"access_token": "token-1"}])
        self.assertEqual(target.saved_auth_keys, [{"id": "user-1", "name": "Alice"}])
        self.assertEqual(target.saved_users, [{"id": "user-1", "name": "Alice"}])

    def test_export_and_import_include_auth_keys(self) -> None:
        source = FakeStorage(
            accounts=[{"access_token": "token-1"}],
            auth_keys=[{"id": "user-1", "name": "Alice"}],
            users=[{"id": "user-1", "name": "Alice"}],
        )
        target = FakeStorage()

        with tempfile.TemporaryDirectory() as tmp_dir:
            export_path = Path(tmp_dir) / "backup.json"

            with mock.patch.object(migrate_storage, "create_storage_backend", return_value=source):
                migrate_storage.export_to_json(str(export_path))

            exported = json.loads(export_path.read_text(encoding="utf-8"))
            self.assertEqual(exported["accounts"], [{"access_token": "token-1"}])
            self.assertEqual(exported["auth_keys"], [{"id": "user-1", "name": "Alice"}])
            self.assertEqual(exported["users"], [{"id": "user-1", "name": "Alice"}])

            with mock.patch.object(migrate_storage, "create_storage_backend", return_value=target):
                migrate_storage.import_from_json(str(export_path))

        self.assertEqual(target.saved_accounts, [{"access_token": "token-1"}])
        self.assertEqual(target.saved_auth_keys, [{"id": "user-1", "name": "Alice"}])
        self.assertEqual(target.saved_users, [{"id": "user-1", "name": "Alice"}])

    def test_import_keeps_legacy_account_array_format(self) -> None:
        target = FakeStorage()

        with tempfile.TemporaryDirectory() as tmp_dir:
            import_path = Path(tmp_dir) / "accounts.json"
            import_path.write_text(json.dumps([{"access_token": "token-1"}]), encoding="utf-8")

            with mock.patch.object(migrate_storage, "create_storage_backend", return_value=target):
                migrate_storage.import_from_json(str(import_path))

        self.assertEqual(target.saved_accounts, [{"access_token": "token-1"}])
        self.assertEqual(target.saved_auth_keys, [])
        self.assertEqual(target.saved_users, [])


if __name__ == "__main__":
    unittest.main()
