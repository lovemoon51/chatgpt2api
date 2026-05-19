from __future__ import annotations

import io
import json
import tarfile
import unittest
import zipfile
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.system as system_module
from services.backup_service import BackupService


AUTH_HEADERS = {"Authorization": "Bearer test-admin"}


def make_tar(files: dict[str, object | bytes | str]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name, value in files.items():
            if isinstance(value, bytes):
                payload = value
            elif isinstance(value, str):
                payload = value.encode("utf-8")
            else:
                payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
            info = tarfile.TarInfo(name=name)
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
    return buffer.getvalue()


def make_zip(files: dict[str, object | bytes | str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as archive:
        for name, value in files.items():
            if isinstance(value, bytes):
                payload = value
            elif isinstance(value, str):
                payload = value.encode("utf-8")
            else:
                payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
            archive.writestr(name, payload)
    return buffer.getvalue()


class BackupIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = BackupService()

    def test_valid_tar_backup_reports_restorable(self) -> None:
        payload = make_tar({
            "backup-metadata.json": {
                "version": 2,
                "created_at": "2026-05-19T01:00:00Z",
                "trigger": "manual",
                "app_version": "1.2.3",
                "storage_backend": {"type": "json"},
            },
            "snapshots/accounts.json": [{"access_token": "token"}],
            "snapshots/auth_keys.json": [{"id": "key-1"}],
            "data/register.json": {"enabled": False},
            "data/logs.jsonl": '{"time":"now","type":"call"}\n',
        })

        report = self.service._verify_backup_payload("backups/backup-test.tar.gz", payload)

        self.assertTrue(report["ok"])
        self.assertTrue(report["readable"])
        self.assertTrue(report["restorable"])
        self.assertEqual(report["summary"]["errors"], 0)
        self.assertEqual(report["summary"]["files"], 5)
        self.assertEqual(report["summary"]["snapshots"], 2)

    def test_tar_backup_without_metadata_is_not_restorable(self) -> None:
        payload = make_tar({
            "snapshots/accounts.json": [],
            "snapshots/auth_keys.json": [],
        })

        report = self.service._verify_backup_payload("backups/backup-test.tar.gz", payload)

        self.assertFalse(report["ok"])
        self.assertFalse(report["restorable"])
        self.assertIn("metadata_missing", {item["code"] for item in report["errors"]})

    def test_corrupt_archive_returns_clear_error_report(self) -> None:
        report = self.service._verify_backup_payload("backups/backup-test.tar.gz", b"not a tar archive")

        self.assertFalse(report["ok"])
        self.assertFalse(report["readable"])
        self.assertEqual(report["errors"][0]["code"], "archive_invalid")

    def test_zip_backup_is_parsed_and_validated(self) -> None:
        payload = make_zip({
            "backup-metadata.json": {
                "version": 2,
                "created_at": "2026-05-19T01:00:00Z",
                "trigger": "manual",
                "app_version": "1.2.3",
                "storage_backend": {"type": "json"},
            },
            "snapshots/accounts.json": [],
            "snapshots/auth_keys.json": [],
        })

        report = self.service._verify_backup_payload("backups/backup-test.zip", payload)

        self.assertTrue(report["ok"])
        self.assertTrue(report["readable"])
        self.assertEqual(report["summary"]["snapshots"], 2)

    def test_json_backup_is_parsed(self) -> None:
        payload = json.dumps({"metadata": {"version": 1}, "items": []}).encode("utf-8")

        report = self.service._verify_backup_payload("backups/backup-test.json", payload)

        self.assertTrue(report["ok"])
        self.assertTrue(report["readable"])
        self.assertEqual(report["files"][0]["content_type"], "application/json")


class FakeBackupService:
    def verify_backup(self, key: str):
        return {
            "key": key,
            "name": "backup.tar.gz",
            "encrypted": False,
            "ok": True,
            "readable": True,
            "restorable": True,
            "summary": {"errors": 0, "warnings": 0, "files": 1, "snapshots": 0, "size": 123},
            "errors": [],
            "warnings": [],
            "metadata": {},
            "files": [],
            "snapshots": [],
        }


class BackupIntegrityApiTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(system_module.create_router("1.2.3"))
        self.client = TestClient(app)

    def test_verify_backup_endpoint_returns_report(self) -> None:
        with (
            mock.patch.object(system_module, "require_admin", lambda _authorization: {"role": "admin"}),
            mock.patch.object(system_module, "backup_service", FakeBackupService()),
        ):
            response = self.client.post("/api/backups/verify", headers=AUTH_HEADERS, json={"key": "backups/backup.tar.gz"})

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload["report"]["ok"])
        self.assertEqual(payload["report"]["key"], "backups/backup.tar.gz")


if __name__ == "__main__":
    unittest.main()
