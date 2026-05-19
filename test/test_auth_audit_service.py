from __future__ import annotations

import json
import unittest
from unittest import mock

from fastapi import HTTPException

import api.support as support_module
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


if __name__ == "__main__":
    unittest.main()
