from __future__ import annotations

import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.system as system_module


AUTH_HEADERS = {"Authorization": "Bearer test-admin"}


class FakeStorage:
    def __init__(self, healthy: bool = True):
        self.healthy = healthy

    def get_backend_info(self):
        return {"type": "fake", "description": "Fake storage"}

    def health_check(self):
        if self.healthy:
            return {"status": "healthy", "backend": "fake"}
        return {"status": "unhealthy", "backend": "fake", "error": "disk full"}


class FakeConfig:
    def __init__(self, storage: FakeStorage):
        self.storage = storage

    def get_storage_backend(self):
        return self.storage


class FakeAccountService:
    def list_accounts(self):
        return [
            {"access_token": "token-1", "status": "正常", "quota": 3, "image_quota_unknown": False},
            {"access_token": "token-2", "status": "限流", "quota": 0, "image_quota_unknown": False},
            {"access_token": "token-3", "status": "异常", "quota": 0, "image_quota_unknown": False},
            {"access_token": "token-4", "status": "禁用", "quota": 5, "image_quota_unknown": False},
            {"access_token": "token-5", "status": "正常", "quota": 0, "image_quota_unknown": True},
        ]


class FakeLogService:
    def list(self, type: str = "", start_date: str = "", end_date: str = "", limit: int = 200):
        return [
            {
                "time": "2026-05-19 10:00:00",
                "type": "call",
                "summary": "文生图调用完成",
                "detail": {"endpoint": "/v1/images/generations", "status": "success", "duration_ms": 120},
            },
            {
                "time": "2026-05-19 09:59:00",
                "type": "text",
                "detail": {"endpoint": "/v1/chat/completions", "status": "failed", "duration_ms": 360, "error": "timeout"},
            },
            {"time": "2026-05-19 09:58:00", "type": "account", "detail": {"status": "success"}},
        ]


class FakeBackupService:
    def get_status(self):
        return {
            "running": False,
            "last_status": "success",
            "last_started_at": "2026-05-19T01:00:00Z",
            "last_finished_at": "2026-05-19T01:00:02Z",
            "last_error": None,
            "last_object_key": "backups/backup.tar.gz",
        }

    def get_settings(self):
        return {"enabled": True, "provider": "cloudflare_r2"}


class SystemStatusApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(system_module.create_router("1.2.3"))
        self.client = TestClient(app)

    def test_healthz_returns_ok_without_auth_when_storage_is_healthy(self):
        with mock.patch.object(system_module, "config", FakeConfig(FakeStorage(healthy=True))):
            response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["version"], "1.2.3")
        self.assertTrue(payload["storage"]["ok"])
        self.assertEqual(payload["storage"]["backend"]["type"], "fake")

    def test_healthz_returns_503_when_storage_is_unhealthy(self):
        with mock.patch.object(system_module, "config", FakeConfig(FakeStorage(healthy=False))):
            response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 503, response.text)
        payload = response.json()
        self.assertEqual(payload["status"], "degraded")
        self.assertFalse(payload["storage"]["ok"])
        self.assertEqual(payload["storage"]["health"]["error"], "disk full")

    def test_dashboard_returns_basic_admin_structure(self):
        with (
            mock.patch.object(system_module, "require_admin", lambda _authorization: {"role": "admin"}),
            mock.patch.object(system_module, "config", FakeConfig(FakeStorage(healthy=True))),
            mock.patch.object(system_module, "account_service", FakeAccountService()),
            mock.patch.object(system_module, "log_service", FakeLogService()),
            mock.patch.object(system_module, "backup_service", FakeBackupService()),
        ):
            response = self.client.get("/api/dashboard", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["version"], "1.2.3")
        self.assertEqual(payload["accounts"]["total"], 5)
        self.assertEqual(payload["accounts"]["available"], 2)
        self.assertEqual(payload["accounts"]["limited"], 1)
        self.assertEqual(payload["accounts"]["error"], 1)
        self.assertEqual(payload["accounts"]["disabled"], 1)
        self.assertTrue(payload["accounts"]["image_quota"]["unknown"])
        self.assertEqual(payload["accounts"]["image_available"], 2)
        self.assertEqual(payload["calls"]["total"], 2)
        self.assertEqual(payload["calls"]["success"], 1)
        self.assertEqual(payload["calls"]["failed"], 1)
        self.assertEqual(payload["calls"]["average_duration_ms"], 240)
        self.assertEqual(payload["calls"]["image"]["total"], 1)
        self.assertEqual(payload["calls"]["image"]["success"], 1)
        self.assertEqual(payload["calls"]["failure_reasons"][0]["reason"], "请求超时")
        self.assertEqual(payload["health"]["level"], "warning")
        self.assertIn("可用图片账号偏低", payload["health"]["reasons"][0])
        self.assertTrue(payload["backup"]["enabled"])
        self.assertTrue(payload["storage"]["ok"])

    def test_dashboard_health_reports_critical_when_no_image_accounts(self):
        class EmptyImageAccountService:
            def list_accounts(self):
                return [{"access_token": "token-1", "status": "正常", "quota": 0, "image_quota_unknown": False}]

        with (
            mock.patch.object(system_module, "require_admin", lambda _authorization: {"role": "admin"}),
            mock.patch.object(system_module, "config", FakeConfig(FakeStorage(healthy=True))),
            mock.patch.object(system_module, "account_service", EmptyImageAccountService()),
            mock.patch.object(system_module, "log_service", FakeLogService()),
            mock.patch.object(system_module, "backup_service", FakeBackupService()),
        ):
            response = self.client.get("/api/dashboard", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["accounts"]["available"], 1)
        self.assertEqual(payload["accounts"]["image_available"], 0)
        self.assertEqual(payload["health"]["level"], "critical")
        self.assertIn("当前无可用图片账号", payload["health"]["reasons"])


if __name__ == "__main__":
    unittest.main()
