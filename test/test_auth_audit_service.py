from __future__ import annotations

import json
import unittest
from copy import deepcopy
from unittest import mock

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import api.support as support_module
import api.system as system_module
from services.auth_audit_service import AuthAuditService, auth_audit_service, key_hint


class AuthAuditServiceTests(unittest.TestCase):
    def test_key_hint_masks_secret_without_full_key(self) -> None:
        secret = "sk-test-secret-abcdef123456"

        hint = key_hint(secret)

        self.assertEqual(hint, "sk-...3456")
        self.assertNotIn("test-secret-abcdef", hint)

    def test_records_failure_and_blocks_after_threshold(self) -> None:
        service = AuthAuditService(max_failures=2, window_seconds=60, block_seconds=5)

        first_blocked, first_retry_after = service.record_failure(
            source="ip:127.0.0.1",
            interface="openai",
            subject_role="identity",
            reason="invalid_or_disabled_key",
            key_hint="sk-...0001",
        )
        second_blocked, second_retry_after = service.record_failure(
            source="ip:127.0.0.1",
            interface="openai",
            subject_role="identity",
            reason="invalid_or_disabled_key",
            key_hint="sk-...0002",
        )

        self.assertFalse(first_blocked)
        self.assertEqual(first_retry_after, 0)
        self.assertTrue(second_blocked)
        self.assertGreater(second_retry_after, 0)
        self.assertEqual(len(service.list_events()), 2)
        self.assertTrue(service.list_events()[-1]["blocked"])

    def test_records_non_failure_audit_event(self) -> None:
        service = AuthAuditService()

        service.record_event(
            source="key:abc",
            interface="management",
            subject_role="admin",
            reason="settings_changed",
            key_hint="sk-...1234",
            detail={"changes": [{"field": "account_pool.max_total_accounts"}]},
        )

        events = service.list_events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["reason"], "settings_changed")
        self.assertEqual(events[0]["detail"]["changes"][0]["field"], "account_pool.max_total_accounts")


class RequireIdentityAuthAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        auth_audit_service.reset()
        auth_audit_service.configure(max_failures=2, window_seconds=60, block_seconds=5)
        self.addCleanup(auth_audit_service.reset)
        self.addCleanup(
            auth_audit_service.configure,
            max_failures=10,
            window_seconds=60,
            block_seconds=60,
            max_events=200,
        )

    def test_require_identity_audits_invalid_key_without_leaking_secret(self) -> None:
        secret = "sk-test-secret-abcdef123456"
        with (
            mock.patch.object(support_module, "_legacy_admin_identity", return_value=None),
            mock.patch.object(support_module.auth_service, "authenticate", return_value=None),
        ):
            with self.assertRaises(HTTPException) as caught:
                support_module.require_identity(f"Bearer {secret}", interface="openai", subject_role="identity")

        events = auth_audit_service.list_events()
        self.assertEqual(caught.exception.status_code, 401)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["interface"], "openai")
        self.assertEqual(events[0]["subject_role"], "identity")
        self.assertEqual(events[0]["reason"], "invalid_or_disabled_key")
        self.assertEqual(events[0]["key_hint"], "sk-...3456")
        self.assertNotIn(secret, json.dumps(events, ensure_ascii=False))

    def test_require_identity_rate_limits_repeated_failed_source(self) -> None:
        with (
            mock.patch.object(support_module, "_legacy_admin_identity", return_value=None),
            mock.patch.object(support_module.auth_service, "authenticate", return_value=None),
        ):
            with self.assertRaises(HTTPException) as first:
                support_module.require_identity("Bearer bad-key", source="ip:127.0.0.1", interface="openai")
            with self.assertRaises(HTTPException) as second:
                support_module.require_identity("Bearer another-bad-key", source="ip:127.0.0.1", interface="openai")
            with self.assertRaises(HTTPException) as third:
                support_module.require_identity("Bearer yet-another-bad-key", source="ip:127.0.0.1", interface="openai")

        self.assertEqual(first.exception.status_code, 401)
        self.assertEqual(second.exception.status_code, 429)
        self.assertEqual(third.exception.status_code, 429)
        self.assertIn("Retry-After", second.exception.headers)

    def test_openai_response_keeps_rate_limit_error_shape_for_auth_block(self) -> None:
        exc = HTTPException(status_code=429, detail={"error": "认证失败次数过多，请稍后再试"})

        response = support_module.openai_response_from_http_exception(exc)

        self.assertEqual(response.status_code, 429)
        self.assertEqual(json.loads(response.body)["error"]["type"], "rate_limit_error")

    def test_require_admin_audits_user_key_permission_failure(self) -> None:
        with mock.patch.object(
            support_module,
            "require_identity",
            return_value={"id": "user-1", "name": "Alice", "role": "user"},
        ):
            with self.assertRaises(HTTPException) as caught:
                support_module.require_admin("Bearer sk-user-secret-abcdef")

        events = auth_audit_service.list_events()
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["interface"], "management")
        self.assertEqual(events[0]["subject_role"], "admin")
        self.assertEqual(events[0]["reason"], "admin_required")


class FakeSettingsConfig:
    def __init__(self) -> None:
        self.data = {
            "proxy": "",
            "auto_register": {
                "enabled": True,
                "min_available": 50,
                "target_available": 50,
                "check_interval_seconds": 30,
                "cooldown_seconds": 300,
            },
            "account_pool": {"max_total_accounts": 50},
            "auth": {"username_login_enabled": False},
        }

    def get(self) -> dict[str, object]:
        return deepcopy(self.data)

    def update(self, updates: dict[str, object]) -> dict[str, object]:
        for key, value in updates.items():
            if isinstance(value, dict) and isinstance(self.data.get(key), dict):
                self.data[key] = {**self.data[key], **value}
            else:
                self.data[key] = value
        return self.get()


class SettingsApiAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        auth_audit_service.reset()
        self.addCleanup(auth_audit_service.reset)

    def test_settings_update_filters_unknown_fields_and_audits_sensitive_changes(self) -> None:
        app = FastAPI()
        app.include_router(system_module.create_router("test-version"))
        fake_config = FakeSettingsConfig()

        with (
            mock.patch.object(system_module, "config", fake_config),
            mock.patch.object(system_module, "require_admin", return_value={"id": "admin", "role": "admin"}),
        ):
            client = TestClient(app)
            response = client.post(
                "/api/settings",
                headers={"Authorization": "Bearer admin-secret"},
                json={
                    "unknown_root": "should-not-persist",
                    "account_pool": {"max_total_accounts": "120", "unknown_nested": "drop"},
                    "auth": {"username_login_enabled": True, "unknown_nested": "drop"},
                    "backup_state": {"running": True},
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["config"]
        self.assertNotIn("unknown_root", payload)
        self.assertNotIn("backup_state", payload)
        self.assertNotIn("unknown_nested", payload["account_pool"])
        self.assertEqual(payload["account_pool"]["max_total_accounts"], "120")
        self.assertTrue(payload["auth"]["username_login_enabled"])

        events = auth_audit_service.list_events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["reason"], "settings_changed")
        changed_fields = {item["field"] for item in events[0]["detail"]["changes"]}
        self.assertIn("account_pool.max_total_accounts", changed_fields)
        self.assertIn("auth.username_login_enabled", changed_fields)


if __name__ == "__main__":
    unittest.main()
