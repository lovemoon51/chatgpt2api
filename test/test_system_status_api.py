from __future__ import annotations

import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.system as system_module
import services.system_status_service as status_module


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
        self.auth_key = "test-admin"

    def get(self):
        return {
            "proxy": "",
            "base_url": "https://public.example",
            "backup": {"secret_access_key": ""},
        }

    def diagnostics(self):
        return {
            "config_file": "config.json",
            "items": [
                {
                    "key": "auth-key",
                    "label": "管理员登录密钥",
                    "source": "env",
                    "sensitive": True,
                    "configured": True,
                    "status": "已设置",
                    "env": "CHATGPT2API_AUTH_KEY",
                }
            ],
        }

    def get_storage_backend(self):
        return self.storage

    def get_auth_settings(self):
        return {"username_login_enabled": False}


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


class FakeImageLatencyLogService:
    def list(self, type: str = "", start_date: str = "", end_date: str = "", limit: int = 200):
        return [
            {
                "time": f"2026-05-19 10:0{index}:00",
                "type": "call",
                "summary": "文生图调用完成",
                "detail": {
                    "endpoint": "/v1/images/generations",
                    "status": "success",
                    "duration_ms": duration_ms,
                },
            }
            for index, duration_ms in enumerate([100, 200, 300, 400, 1000])
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

    def get_worker_status(self):
        return {
            "name": "backup",
            "running": True,
            "started_at": "2026-05-19T01:00:00",
            "last_heartbeat": "2026-05-19T01:00:01",
            "last_error": None,
        }


class FakeImageTaskService:
    def get_worker_statuses(self):
        return [
            {
                "name": "image-task-worker-1",
                "running": True,
                "started_at": "2026-05-19T01:00:00",
                "last_heartbeat": "2026-05-19T01:00:01",
                "last_error": None,
            }
        ]


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

    def test_livez_returns_ok_without_deep_checks(self):
        response = self.client.get("/livez")

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["version"], "1.2.3")
        self.assertNotIn("storage", payload)

    def test_readyz_returns_ok_with_storage_writable_and_workers_running(self):
        old_workers = dict(status_module._WORKERS)
        status_module._WORKERS.clear()
        status_module.worker_started("limited-account-watcher")
        status_module.worker_started("auto-register-watcher")
        try:
            with (
                mock.patch.object(system_module, "config", FakeConfig(FakeStorage(healthy=True))),
                mock.patch.object(system_module, "backup_service", FakeBackupService()),
                mock.patch.object(system_module, "_image_task_service", lambda: FakeImageTaskService()),
            ):
                response = self.client.get("/readyz")
        finally:
            status_module._WORKERS.clear()
            status_module._WORKERS.update(old_workers)

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertTrue(payload["storage"]["ok"])
        self.assertTrue(payload["writable"]["ok"])
        worker_names = {item["name"] for item in payload["workers"]["items"]}
        self.assertIn("limited-account-watcher", worker_names)
        self.assertIn("auto-register-watcher", worker_names)
        self.assertIn("backup", worker_names)
        self.assertIn("image-task-worker-1", worker_names)

    def test_readyz_returns_503_when_required_worker_is_missing(self):
        old_workers = dict(status_module._WORKERS)
        status_module._WORKERS.clear()
        try:
            with (
                mock.patch.object(system_module, "config", FakeConfig(FakeStorage(healthy=True))),
                mock.patch.object(system_module, "backup_service", FakeBackupService()),
                mock.patch.object(system_module, "_image_task_service", lambda: FakeImageTaskService()),
            ):
                response = self.client.get("/readyz")
        finally:
            status_module._WORKERS.clear()
            status_module._WORKERS.update(old_workers)

        self.assertEqual(response.status_code, 503, response.text)
        payload = response.json()
        self.assertEqual(payload["status"], "unhealthy")
        self.assertIn("workers", payload["unhealthy"])
        self.assertIn("limited-account-watcher", payload["workers"]["missing"])

    def test_dashboard_returns_basic_admin_structure(self):
        old_workers = dict(status_module._WORKERS)
        status_module._WORKERS.clear()
        status_module.worker_started("limited-account-watcher")
        status_module.worker_started("auto-register-watcher")
        try:
            with (
                mock.patch.object(system_module, "require_admin", lambda _authorization: {"role": "admin"}),
                mock.patch.object(system_module, "config", FakeConfig(FakeStorage(healthy=True))),
                mock.patch.object(system_module, "account_service", FakeAccountService()),
                mock.patch.object(system_module, "log_service", FakeLogService()),
                mock.patch.object(system_module, "backup_service", FakeBackupService()),
                mock.patch.object(system_module, "_image_task_service", lambda: FakeImageTaskService()),
            ):
                response = self.client.get("/api/dashboard", headers=AUTH_HEADERS)
        finally:
            status_module._WORKERS.clear()
            status_module._WORKERS.update(old_workers)

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
        self.assertEqual(payload["calls"]["p90_duration_ms"], 336)
        self.assertEqual(payload["calls"]["p99_duration_ms"], 358)
        self.assertEqual(payload["calls"]["image"]["total"], 1)
        self.assertEqual(payload["calls"]["image"]["success"], 1)
        self.assertEqual(payload["calls"]["image"]["p90_duration_ms"], 120)
        self.assertEqual(payload["calls"]["image"]["p99_duration_ms"], 120)
        self.assertEqual(payload["calls"]["failure_reasons"][0]["reason"], "请求超时")
        self.assertEqual(payload["health"]["level"], "warning")
        self.assertIn("可用图片账号偏低", payload["health"]["reasons"][0])
        self.assertTrue(payload["backup"]["enabled"])
        self.assertTrue(payload["storage"]["ok"])
        self.assertEqual(payload["workers"]["status"], "ok")

    def test_dashboard_reports_image_duration_percentiles(self):
        old_workers = dict(status_module._WORKERS)
        status_module._WORKERS.clear()
        status_module.worker_started("limited-account-watcher")
        status_module.worker_started("auto-register-watcher")
        try:
            with (
                mock.patch.object(system_module, "require_admin", lambda _authorization: {"role": "admin"}),
                mock.patch.object(system_module, "config", FakeConfig(FakeStorage(healthy=True))),
                mock.patch.object(system_module, "account_service", FakeAccountService()),
                mock.patch.object(system_module, "log_service", FakeImageLatencyLogService()),
                mock.patch.object(system_module, "backup_service", FakeBackupService()),
                mock.patch.object(system_module, "_image_task_service", lambda: FakeImageTaskService()),
            ):
                response = self.client.get("/api/dashboard", headers=AUTH_HEADERS)
        finally:
            status_module._WORKERS.clear()
            status_module._WORKERS.update(old_workers)

        self.assertEqual(response.status_code, 200, response.text)
        image_calls = response.json()["calls"]["image"]
        self.assertEqual(image_calls["total"], 5)
        self.assertEqual(image_calls["average_duration_ms"], 400)
        self.assertEqual(image_calls["p90_duration_ms"], 760)
        self.assertEqual(image_calls["p99_duration_ms"], 976)

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
            mock.patch.object(system_module, "_image_task_service", lambda: FakeImageTaskService()),
        ):
            response = self.client.get("/api/dashboard", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["accounts"]["available"], 1)
        self.assertEqual(payload["accounts"]["image_available"], 0)
        self.assertEqual(payload["health"]["level"], "critical")
        self.assertIn("当前无可用图片账号", payload["health"]["reasons"])

    def test_settings_returns_safe_config_diagnostics(self):
        with (
            mock.patch.object(system_module, "require_admin", lambda _authorization: {"role": "admin"}),
            mock.patch.object(system_module, "config", FakeConfig(FakeStorage(healthy=True))),
        ):
            response = self.client.get("/api/settings", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["config"]["base_url"], "https://public.example")
        self.assertNotIn("auth-key", payload["config"])
        self.assertEqual(payload["diagnostics"]["items"][0]["key"], "auth-key")
        self.assertEqual(payload["diagnostics"]["items"][0]["status"], "已设置")
        self.assertNotIn("test-admin", response.text)

    def test_login_user_response_includes_limits(self):
        class FakeAuthService:
            def authenticate(self, value: str):
                self.last_value = value
                return {
                    "id": "user-1",
                    "name": "Alice",
                    "role": "user",
                    "limits": {
                        "requests_per_day": 20,
                        "images_per_day": 5,
                        "concurrency": 2,
                        "models": ["gpt-image-2"],
                    },
                }

            def authenticate_session_token(self, _value: str):
                return None

            def authenticate_user_name(self, _value: str):
                return None

            def create_session_token(self, _identity: dict[str, object]):
                return "sess-test"

        with (
            mock.patch.object(system_module, "config", FakeConfig(FakeStorage(healthy=True))),
            mock.patch.object(system_module, "auth_service", FakeAuthService()),
        ):
            response = self.client.post("/auth/login", json={"login": "sk-user"})

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["access_token"], "sess-test")
        self.assertEqual(payload["role"], "user")
        self.assertEqual(payload["limits"]["images_per_day"], 5)
        self.assertEqual(payload["limits"]["concurrency"], 2)

    def test_get_images_accepts_frontend_filter_aliases(self):
        captured: dict[str, object] = {}

        def fake_list_images(*_args, **kwargs):
            captured.update(kwargs)
            return {"items": [], "groups": [], "page": 2, "page_size": 24, "pages": 1, "total": 0}

        with (
            mock.patch.object(system_module, "require_identity", lambda _authorization: {"role": "admin"}),
            mock.patch.object(system_module, "resolve_image_base_url", lambda _request: "http://testserver"),
            mock.patch.object(system_module, "list_images", side_effect=fake_list_images),
        ):
            response = self.client.get(
                "/api/images?page=2&page_size=24&q=cat&tags=pet,orange&sort=size&order=asc",
                headers=AUTH_HEADERS,
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(captured["page"], 2)
        self.assertEqual(captured["page_size"], 24)
        self.assertEqual(captured["search"], "cat")
        self.assertEqual(captured["tag"], "pet,orange")
        self.assertEqual(captured["sort"], "+size")


if __name__ == "__main__":
    unittest.main()
