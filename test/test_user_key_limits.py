from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.ai as ai_module
import api.support as support_module
import api.system as system_module
from services.auth_service import AuthService
from services.storage.json_storage import JSONStorageBackend
from services.usage_limit_service import UsageLimitError, UsageLimitService, usage_limit_service


class UserKeyLimitServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = UsageLimitService()

    def test_default_limits_are_unlimited(self) -> None:
        identity = {"id": "user-1", "role": "user", "limits": {}}

        for _ in range(3):
            with self.service.reserve(identity, model="gpt-4o", kind="text"):
                pass

    def test_request_daily_limit(self) -> None:
        identity = {"id": "user-1", "role": "user", "limits": {"requests_per_day": 1}}

        with self.service.reserve(identity, model="gpt-4o", kind="text"):
            pass

        with self.assertRaisesRegex(UsageLimitError, "request daily limit exceeded") as caught:
            with self.service.reserve(identity, model="gpt-4o", kind="text"):
                pass
        self.assertEqual(caught.exception.status_code, 429)

    def test_image_daily_limit(self) -> None:
        identity = {"id": "user-1", "role": "user", "limits": {"images_per_day": 1}}

        with self.service.reserve(identity, model="gpt-image-2", kind="image"):
            pass

        with self.assertRaisesRegex(UsageLimitError, "image daily limit exceeded") as caught:
            with self.service.reserve(identity, model="gpt-image-2", kind="image"):
                pass
        self.assertEqual(caught.exception.status_code, 429)

    def test_model_allowlist(self) -> None:
        identity = {"id": "user-1", "role": "user", "limits": {"models": ["gpt-4o-mini"]}}

        with self.service.reserve(identity, model="gpt-4o-mini", kind="text"):
            pass

        with self.assertRaisesRegex(UsageLimitError, "model is not allowed") as caught:
            with self.service.reserve(identity, model="gpt-4o", kind="text"):
                pass
        self.assertEqual(caught.exception.status_code, 403)

    def test_concurrency_enters_and_releases(self) -> None:
        identity = {"id": "user-1", "role": "user", "limits": {"concurrency": 1}}

        first = self.service.reserve(identity, model="gpt-4o", kind="text")
        first.__enter__()
        try:
            with self.assertRaisesRegex(UsageLimitError, "concurrency limit exceeded"):
                with self.service.reserve(identity, model="gpt-4o", kind="text"):
                    pass
        finally:
            first.__exit__(None, None, None)

        with self.service.reserve(identity, model="gpt-4o", kind="text"):
            pass

    def test_manual_acquire_holds_until_release(self) -> None:
        identity = {"id": "user-1", "role": "user", "limits": {"concurrency": 1}}

        release = self.service.acquire(identity, model="gpt-4o", kind="text")
        try:
            with self.assertRaisesRegex(UsageLimitError, "concurrency limit exceeded"):
                self.service.acquire(identity, model="gpt-4o", kind="text")
        finally:
            release()

        next_release = self.service.acquire(identity, model="gpt-4o", kind="text")
        next_release()
        next_release()


class UserKeyAuthServiceLimitTests(unittest.TestCase):
    def test_user_key_create_update_and_authenticate_include_limits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            item, raw_key = service.create_key(
                role="user",
                name="Alice",
                limits={"requests_per_day": 2, "images_per_day": 1, "concurrency": 1, "models": ["gpt-4o"]},
            )

            self.assertEqual(item["limits"]["requests_per_day"], 2)
            self.assertEqual(item["limits"]["images_per_day"], 1)
            self.assertEqual(item["limits"]["concurrency"], 1)
            self.assertEqual(item["limits"]["models"], ["gpt-4o"])

            authed = service.authenticate(raw_key)
            self.assertIsNotNone(authed)
            self.assertEqual(authed["limits"]["models"], ["gpt-4o"])

            updated = service.update_key(item["id"], {"limits": {"models": ["gpt-4o-mini"]}}, role="user")
            self.assertIsNotNone(updated)
            self.assertIsNone(updated["limits"]["requests_per_day"])
            self.assertEqual(updated["limits"]["models"], ["gpt-4o-mini"])

    def test_user_name_login_only_matches_enabled_user_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest")
            admin, _raw_admin_key = service.create_key(role="admin", name="Admin Display Name")

            authed = service.authenticate_user_name("Studio Guest")

            self.assertIsNotNone(authed)
            self.assertEqual(authed["id"], user["id"])
            self.assertEqual(authed["role"], "user")
            self.assertIsNone(service.authenticate_user_name("Admin Display Name"))

            service.update_key(user["id"], {"enabled": False}, role="user")

            self.assertIsNone(service.authenticate_user_name("Studio Guest"))
            self.assertIsNotNone(admin)

    def test_session_token_authenticates_user_and_respects_disabled_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest")

            token = service.create_session_token(user)
            authed = service.authenticate_session_token(token)

            self.assertIsNotNone(authed)
            self.assertEqual(authed["id"], user["id"])
            self.assertEqual(authed["role"], "user")

            service.update_key(user["id"], {"enabled": False}, role="user")

            self.assertIsNone(service.authenticate_session_token(token))


class UserNameLoginApiTests(unittest.TestCase):
    def test_login_by_user_key_name_returns_session_token(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest")
            app = FastAPI()
            app.include_router(system_module.create_router("test-version"))

            with (
                mock.patch.object(system_module, "auth_service", service),
                mock.patch.object(system_module.config, "get_auth_settings", return_value={"username_login_enabled": True}),
            ):
                client = TestClient(app)
                response = client.post("/auth/login", json={"login": "Studio Guest"})

            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertEqual(payload["role"], "user")
            self.assertEqual(payload["subject_id"], user["id"])
            self.assertEqual(payload["name"], "Studio Guest")
            self.assertTrue(payload["access_token"].startswith("sess-"))

    def test_login_by_user_key_name_is_disabled_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            service.create_key(role="user", name="Studio Guest")
            app = FastAPI()
            app.include_router(system_module.create_router("test-version"))

            with (
                mock.patch.object(system_module, "auth_service", service),
                mock.patch.object(system_module.config, "get_auth_settings", return_value={"username_login_enabled": False}),
            ):
                client = TestClient(app)
                response = client.post("/auth/login", json={"login": "Studio Guest"})

            self.assertEqual(response.status_code, 401, response.text)

    def test_session_token_from_name_login_can_authorize_followup_requests(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest")
            token = service.create_session_token(user)

            with (
                mock.patch.object(support_module, "_legacy_admin_identity", return_value=None),
                mock.patch.object(support_module, "auth_service", service),
            ):
                identity = support_module.require_identity(f"Bearer {token}")

            self.assertEqual(identity["id"], user["id"])
            self.assertEqual(identity["role"], "user")


class UserKeyLimitApiTests(unittest.TestCase):
    def setUp(self) -> None:
        usage_limit_service.reset()
        app = FastAPI()
        app.include_router(ai_module.create_router())
        self.client = TestClient(app)
        self.addCleanup(usage_limit_service.reset)

        async def no_filter(_call, _text):
            return None

        self.filter_patcher = mock.patch.object(ai_module, "filter_or_log", no_filter)
        self.filter_patcher.start()
        self.addCleanup(self.filter_patcher.stop)

    def test_chat_completion_entry_enforces_request_limit(self) -> None:
        identity = {"id": "user-1", "name": "Alice", "role": "user", "limits": {"requests_per_day": 1}}
        self.addCleanup(mock.patch.stopall)
        with (
            mock.patch.object(ai_module, "require_identity", return_value=identity),
            mock.patch.object(ai_module.openai_v1_chat_complete, "handle", return_value={"id": "ok", "choices": []}),
        ):
            first = self.client.post(
                "/v1/chat/completions",
                headers={"Authorization": "Bearer user-key"},
                json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]},
            )
            second = self.client.post(
                "/v1/chat/completions",
                headers={"Authorization": "Bearer user-key"},
                json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]},
            )

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 429, second.text)
        self.assertEqual(second.json()["error"]["message"], "request daily limit exceeded")
        self.assertEqual(second.json()["error"]["type"], "rate_limit_error")
        self.assertEqual(second.json()["error"]["code"], "usage_limit_exceeded")

    def test_image_generation_entry_enforces_model_allowlist(self) -> None:
        identity = {"id": "user-1", "name": "Alice", "role": "user", "limits": {"models": ["gpt-4o"]}}
        with mock.patch.object(ai_module, "require_identity", return_value=identity):
            response = self.client.post(
                "/v1/images/generations",
                headers={"Authorization": "Bearer user-key"},
                json={"model": "gpt-image-2", "prompt": "cat"},
            )

        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["error"]["message"], "model is not allowed")
        self.assertEqual(response.json()["error"]["type"], "permission_error")
        self.assertEqual(response.json()["error"]["code"], "model_not_allowed")


if __name__ == "__main__":
    unittest.main()
