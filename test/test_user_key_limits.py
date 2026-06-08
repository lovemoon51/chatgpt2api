from __future__ import annotations

import tempfile
import unittest
import json
import hashlib
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.ai as ai_module
import api.accounts as accounts_module
import api.support as support_module
from api.support import image_credit_cost, normalize_image_resolution
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

    def test_legacy_request_daily_limit_is_ignored_for_ordinary_users(self) -> None:
        identity = {"id": "user-1", "role": "user", "limits": {"requests_per_day": 1}}

        with self.service.reserve(identity, model="gpt-4o", kind="text"):
            pass

        with self.service.reserve(identity, model="gpt-4o", kind="text"):
            pass

    def test_image_resolution_credit_costs(self) -> None:
        self.assertEqual(normalize_image_resolution(None), "1k")
        self.assertEqual(normalize_image_resolution(""), "1k")
        self.assertEqual(normalize_image_resolution("1K"), "1k")
        self.assertEqual(image_credit_cost("1k"), 1)
        self.assertEqual(image_credit_cost("2k"), 2)
        self.assertEqual(image_credit_cost("4k"), 3)

    def test_image_resolution_rejects_unknown_when_requested(self) -> None:
        with self.assertRaisesRegex(ValueError, "resolution must be one of 1k, 2k, 4k"):
            normalize_image_resolution("8k", strict=True)
        self.assertEqual(normalize_image_resolution("8k", strict=False), "1k")

    def test_image_total_limit_is_persisted_in_user_record(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            storage = JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json")
            service = AuthService(storage)
            item, _raw_key = service.create_key(role="user", name="Alice", limits={"images_total": 2})

            first = service.consume_image_quota(item["id"])
            second = service.consume_image_quota(item["id"])

            self.assertEqual(first["limits"]["images_used"], 1)
            self.assertEqual(first["limits"]["images_remaining"], 1)
            self.assertEqual(second["limits"]["images_used"], 2)
            self.assertEqual(second["limits"]["images_remaining"], 0)
            with self.assertRaisesRegex(ValueError, "image total limit exceeded"):
                service.consume_image_quota(item["id"])

            reloaded = AuthService(storage).get_user(item["id"])
            self.assertIsNotNone(reloaded)
            self.assertEqual(reloaded["limits"]["images_used"], 2)
            self.assertEqual(reloaded["limits"]["images_remaining"], 0)

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
    def test_user_key_create_persists_separate_user_record(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            storage = JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json")
            service = AuthService(storage)

            item, raw_key = service.create_key(
                role="user",
                name="Alice",
                limits={"images_total": 12, "concurrency": 1, "models": ["gpt-4o"]},
            )

            users = storage.load_users()
            auth_keys = storage.load_auth_keys()
            self.assertEqual(len(users), 1)
            self.assertEqual(users[0]["id"], item["id"])
            self.assertEqual(users[0]["name"], "Alice")
            self.assertEqual(users[0]["role"], "user")
            self.assertTrue(users[0]["enabled"])
            self.assertEqual(users[0]["limits"]["images_total"], 12)
            self.assertEqual(users[0]["limits"]["images_used"], 0)
            self.assertEqual(users[0]["limits"]["images_remaining"], 12)
            self.assertEqual(auth_keys[0]["user_id"], item["id"])
            self.assertTrue(auth_keys[0]["enabled"])
            self.assertFalse(auth_keys[0].get("consumed_at"))
            self.assertTrue(raw_key.startswith("sk-"))

    def test_legacy_user_key_records_are_migrated_to_users(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            auth_keys_path = Path(tmp_dir) / "auth_keys.json"
            raw_key = "sk-legacy-user-key"
            legacy_item = {
                "id": "legacy-user-1",
                "name": "Legacy User",
                "role": "user",
                "key_hash": hashlib.sha256(raw_key.encode("utf-8")).hexdigest(),
                "enabled": True,
                "created_at": "2026-06-01T00:00:00+00:00",
                "last_used_at": None,
                "limits": {"requests_per_day": 3, "images_per_day": 9, "concurrency": None, "models": ["gpt-4o"]},
            }
            auth_keys_path.write_text(json.dumps({"items": [legacy_item]}, ensure_ascii=False), encoding="utf-8")
            storage = JSONStorageBackend(Path(tmp_dir) / "accounts.json", auth_keys_path)

            service = AuthService(storage)

            users = storage.load_users()
            auth_keys = storage.load_auth_keys()
            self.assertEqual(users[0]["id"], "legacy-user-1")
            self.assertEqual(users[0]["name"], "Legacy User")
            self.assertEqual(auth_keys[0]["user_id"], "legacy-user-1")
            self.assertEqual(users[0]["limits"]["images_total"], 9)

            authed = service.authenticate(raw_key)
            self.assertIsNotNone(authed)
            self.assertEqual(authed["id"], "legacy-user-1")
            self.assertEqual(authed["name"], "Legacy User")
            self.assertEqual(authed["limits"]["requests_per_day"], 3)
            self.assertEqual(authed["limits"]["images_total"], 9)

    def test_user_key_create_update_and_authenticate_include_limits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            item, raw_key = service.create_key(
                role="user",
                name="Alice",
                limits={"images_total": 10, "concurrency": 1, "models": ["gpt-4o"]},
            )

            self.assertEqual(item["limits"]["images_total"], 10)
            self.assertEqual(item["limits"]["images_used"], 0)
            self.assertEqual(item["limits"]["images_remaining"], 10)
            self.assertEqual(item["limits"]["concurrency"], 1)
            self.assertEqual(item["limits"]["models"], ["gpt-4o"])

            authed = service.authenticate(raw_key)
            self.assertIsNotNone(authed)
            self.assertEqual(authed["limits"]["models"], ["gpt-4o"])

            updated = service.update_key(item["id"], {"limits": {"images_total": 20, "models": ["gpt-4o-mini"]}}, role="user")
            self.assertIsNotNone(updated)
            self.assertIsNone(updated["limits"]["requests_per_day"])
            self.assertEqual(updated["limits"]["images_total"], 20)
            self.assertEqual(updated["limits"]["images_remaining"], 20)
            self.assertEqual(updated["limits"]["models"], ["gpt-4o-mini"])

    def test_admin_user_profile_includes_balance_login_ip_and_allows_basic_updates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            item, raw_key = service.create_key(
                role="user",
                name="Alice",
                limits={"images_total": 10, "images_used": 2, "concurrency": 1, "models": ["gpt-image-2"]},
            )

            activated = service.activate_user(
                raw_key,
                email="Alice@Example.COM",
                password="correct horse battery",
                login_ip="203.0.113.9",
            )
            listed = service.list_keys(role="user")[0]

            self.assertEqual(activated["id"], item["id"])
            self.assertEqual(listed["email"], "alice@example.com")
            self.assertEqual(listed["last_login_ip"], "203.0.113.9")
            self.assertEqual(listed["limits"]["images_used"], 2)
            self.assertEqual(listed["limits"]["images_remaining"], 8)
            self.assertNotIn("password_hash", listed)
            self.assertNotIn("key_hash", listed)

            updated = service.update_key(
                item["id"],
                {
                    "name": "Alice Renamed",
                    "email": "Alice.Renamed@Example.COM",
                    "enabled": False,
                    "limits": {"images_total": 12, "images_used": 5, "concurrency": 2, "models": ["gpt-image-2"]},
                },
                role="user",
            )

            self.assertIsNotNone(updated)
            self.assertEqual(updated["name"], "Alice Renamed")
            self.assertEqual(updated["email"], "alice.renamed@example.com")
            self.assertFalse(updated["enabled"])
            self.assertEqual(updated["limits"]["images_used"], 5)
            self.assertEqual(updated["limits"]["images_remaining"], 7)
            self.assertEqual(updated["limits"]["concurrency"], 2)

    def test_user_access_code_is_consumed_after_first_login(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, raw_user_key = service.create_key(role="user", name="One Time Guest", limits={"images_total": 5})

            first = service.authenticate(raw_user_key)
            second = service.authenticate(raw_user_key)
            token = service.create_session_token(first)
            session_identity = service.authenticate_session_token(token)

            self.assertIsNotNone(first)
            self.assertIsNone(second)
            self.assertIsNotNone(session_identity)
            self.assertEqual(session_identity["id"], user["id"])
            auth_keys = service.storage.load_auth_keys()
            self.assertFalse(auth_keys[0]["enabled"])
            self.assertTrue(auth_keys[0]["consumed_at"])

    def test_unused_user_keys_keep_copyable_raw_key_until_consumed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, raw_user_key = service.create_key(role="user", name="Invite Guest", limits={"images_total": 5})

            listed = service.list_unused_user_keys()
            public_items = service.list_keys(role="user")
            auth_keys = service.storage.load_auth_keys()

            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0]["id"], user["id"])
            self.assertEqual(listed[0]["key"], raw_user_key)
            self.assertTrue(listed[0]["copyable"])
            self.assertEqual(auth_keys[0]["raw_key"], raw_user_key)
            self.assertNotIn("key", public_items[0])
            self.assertNotIn("raw_key", public_items[0])

            self.assertIsNotNone(service.authenticate(raw_user_key))
            self.assertEqual(service.list_unused_user_keys(), [])
            self.assertNotIn("raw_key", service.storage.load_auth_keys()[0])

    def test_legacy_unused_user_keys_can_be_listed_but_not_copied(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            auth_keys_path = Path(tmp_dir) / "auth_keys.json"
            raw_key = "legacy-unused-key"
            legacy_item = {
                "id": "legacy-unused-user",
                "name": "Legacy Unused",
                "role": "user",
                "key_hash": hashlib.sha256(raw_key.encode("utf-8")).hexdigest(),
                "enabled": True,
                "created_at": "2026-06-01T00:00:00+00:00",
                "last_used_at": None,
                "consumed_at": None,
            }
            auth_keys_path.write_text(json.dumps({"items": [legacy_item]}, ensure_ascii=False), encoding="utf-8")
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", auth_keys_path))

            listed = service.list_unused_user_keys()

            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0]["id"], "legacy-unused-user")
            self.assertEqual(listed[0]["key"], "")
            self.assertFalse(listed[0]["copyable"])

    def test_delete_unused_user_keys_only_removes_unbound_access_codes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            unused, _unused_key = service.create_key(role="user", name="Unused", limits={"images_total": 5})
            consumed, consumed_key = service.create_key(role="user", name="Consumed", limits={"images_total": 5})
            self.assertIsNotNone(service.authenticate(consumed_key))

            result = service.delete_unused_user_keys([unused["id"], consumed["id"]])

            self.assertEqual(result["removed"], 1)
            self.assertEqual(result["removed_ids"], [unused["id"]])
            remaining_ids = {item["id"] for item in service.list_keys(role="user")}
            self.assertNotIn(unused["id"], remaining_ids)
            self.assertIn(consumed["id"], remaining_ids)

    def test_unused_user_keys_exclude_bound_email_even_if_access_code_is_not_consumed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            bound, _raw_key = service.create_key(role="user", name="Bound User", limits={"images_total": 5})

            service.update_key(bound["id"], {"email": "bound@example.com"}, role="user")

            self.assertEqual(service.list_unused_user_keys(), [])
            result = service.delete_unused_user_keys([bound["id"]])
            self.assertEqual(result["removed"], 0)
            self.assertIsNotNone(service.get_user(bound["id"]))

    def test_user_access_code_activation_binds_email_password_once(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, raw_user_key = service.create_key(role="user", name="One Time Guest", limits={"images_total": 5})

            activated = service.activate_user(raw_user_key, email="Creator@Example.COM", password="correct horse battery")
            code_reuse = service.authenticate(raw_user_key)
            password_identity = service.authenticate_password("creator@example.com", "correct horse battery")
            wrong_password_identity = service.authenticate_password("creator@example.com", "wrong password")

            self.assertEqual(activated["id"], user["id"])
            self.assertEqual(activated["email"], "creator@example.com")
            self.assertIsNone(code_reuse)
            self.assertIsNotNone(password_identity)
            self.assertEqual(password_identity["id"], user["id"])
            self.assertEqual(password_identity["email"], "creator@example.com")
            self.assertIsNone(wrong_password_identity)

            stored_user = service.storage.load_users()[0]
            stored_key = service.storage.load_auth_keys()[0]
            self.assertEqual(stored_user["email"], "creator@example.com")
            self.assertNotIn("correct horse battery", json.dumps(stored_user, ensure_ascii=False))
            self.assertTrue(stored_user["password_hash"].startswith("pbkdf2_sha256$"))
            self.assertFalse(stored_key["enabled"])
            self.assertTrue(stored_key["consumed_at"])

    def test_user_checkin_adds_twenty_images_once_per_day(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Daily Guest", limits={"images_total": 5})

            first = service.check_in(user["id"])
            second = service.check_in(user["id"])

            self.assertTrue(first["awarded"])
            self.assertEqual(first["bonus_images"], 20)
            self.assertEqual(first["bonus_credits"], 20)
            self.assertEqual(first["user"]["limits"]["images_total"], 25)
            self.assertEqual(first["user"]["limits"]["images_remaining"], 25)
            self.assertFalse(second["awarded"])
            self.assertEqual(second["bonus_images"], 0)
            self.assertEqual(second["bonus_credits"], 0)
            self.assertEqual(second["user"]["limits"]["images_total"], 25)

    def test_user_checkin_preserves_unlimited_image_quota(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Unlimited Guest", limits={"images_total": None})

            first = service.check_in(user["id"])
            second = service.check_in(user["id"])

            self.assertTrue(first["awarded"])
            self.assertEqual(first["bonus_images"], 20)
            self.assertEqual(first["bonus_credits"], 20)
            self.assertIsNone(first["user"]["limits"]["images_total"])
            self.assertIsNone(first["user"]["limits"]["images_remaining"])
            self.assertFalse(second["awarded"])
            self.assertEqual(second["bonus_images"], 0)
            self.assertEqual(second["bonus_credits"], 0)
            self.assertIsNone(second["user"]["limits"]["images_total"])
            self.assertIsNone(second["user"]["limits"]["images_remaining"])

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
    def test_activate_access_code_then_login_with_email_password(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, raw_user_key = service.create_key(role="user", name="Studio Guest", limits={"images_total": 9})
            app = FastAPI()
            app.include_router(system_module.create_router("test-version"))

            with mock.patch.object(system_module, "auth_service", service):
                client = TestClient(app)
                activate_response = client.post(
                    "/auth/activate",
                    json={
                        "email": "creator@example.com",
                        "password": "correct horse battery",
                        "access_code": raw_user_key,
                    },
                )
                reused_code_response = client.post("/auth/login", json={"login": raw_user_key})
                password_response = client.post(
                    "/auth/login",
                    json={"email": "creator@example.com", "password": "correct horse battery"},
                )

            self.assertEqual(activate_response.status_code, 200, activate_response.text)
            activate_payload = activate_response.json()
            self.assertEqual(activate_payload["role"], "user")
            self.assertEqual(activate_payload["subject_id"], user["id"])
            self.assertEqual(activate_payload["email"], "creator@example.com")
            self.assertTrue(activate_payload["access_token"].startswith("sess-"))

            self.assertEqual(reused_code_response.status_code, 401, reused_code_response.text)

            self.assertEqual(password_response.status_code, 200, password_response.text)
            password_payload = password_response.json()
            self.assertEqual(password_payload["role"], "user")
            self.assertEqual(password_payload["subject_id"], user["id"])
            self.assertEqual(password_payload["email"], "creator@example.com")
            self.assertTrue(password_payload["access_token"].startswith("sess-"))
            self.assertEqual(password_payload["limits"]["images_total"], 9)

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

    def test_checkin_api_adds_image_quota_for_logged_in_user(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest", limits={"images_total": 3})
            app = FastAPI()
            app.include_router(system_module.create_router("test-version"))

            with (
                mock.patch.object(system_module, "auth_service", service),
                mock.patch.object(system_module, "require_identity", return_value=user),
            ):
                client = TestClient(app)
                response = client.post("/api/auth/checkin", headers={"Authorization": "Bearer sess-test"})

            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertTrue(payload["awarded"])
            self.assertEqual(payload["bonus_images"], 20)
            self.assertEqual(payload["bonus_credits"], 20)
            self.assertEqual(payload["user"]["limits"]["images_total"], 23)
            self.assertEqual(payload["user"]["limits"]["images_remaining"], 23)

    def test_checkin_api_preserves_unlimited_image_quota_for_logged_in_user(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest", limits={"images_total": None})
            app = FastAPI()
            app.include_router(system_module.create_router("test-version"))

            with (
                mock.patch.object(system_module, "auth_service", service),
                mock.patch.object(system_module, "require_identity", return_value=user),
            ):
                client = TestClient(app)
                response = client.post("/api/auth/checkin", headers={"Authorization": "Bearer sess-test"})

            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertTrue(payload["awarded"])
            self.assertEqual(payload["bonus_images"], 20)
            self.assertEqual(payload["bonus_credits"], 20)
            self.assertIsNone(payload["user"]["limits"]["images_total"])
            self.assertIsNone(payload["user"]["limits"]["images_remaining"])


class UserKeyManagementApiTests(unittest.TestCase):
    def test_bulk_create_user_keys_returns_once_visible_codes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            app = FastAPI()
            app.include_router(accounts_module.create_router())

            with (
                mock.patch.object(accounts_module, "auth_service", service),
                mock.patch.object(accounts_module, "require_admin", return_value={"id": "admin", "role": "admin"}),
            ):
                client = TestClient(app)
                response = client.post(
                    "/api/auth/users",
                    json={"name": "Batch Guest", "count": 3, "limits": {"images_total": 8, "concurrency": 2}},
                )

            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertEqual(len(payload["keys"]), 3)
            self.assertEqual(len({item["key"] for item in payload["keys"]}), 3)
            self.assertEqual([item["name"] for item in payload["keys"]], ["Batch Guest 1", "Batch Guest 2", "Batch Guest 3"])
            self.assertEqual(len(payload["items"]), 3)
            self.assertEqual(payload["items"][0]["limits"]["images_total"], 8)
            self.assertEqual(payload["items"][0]["limits"]["concurrency"], 2)

    def test_update_user_key_allows_email_and_used_image_quota(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest", limits={"images_total": 9})
            app = FastAPI()
            app.include_router(accounts_module.create_router())

            with (
                mock.patch.object(accounts_module, "auth_service", service),
                mock.patch.object(accounts_module, "require_admin", return_value={"id": "admin", "role": "admin"}),
            ):
                client = TestClient(app)
                response = client.post(
                    f"/api/auth/users/{user['id']}",
                    json={
                        "name": "Studio Creator",
                        "email": "Creator@Example.COM",
                        "limits": {"images_total": 9, "images_used": 4, "concurrency": 2},
                    },
                )

            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertEqual(payload["item"]["name"], "Studio Creator")
            self.assertEqual(payload["item"]["email"], "creator@example.com")
            self.assertEqual(payload["item"]["limits"]["images_used"], 4)
            self.assertEqual(payload["item"]["limits"]["images_remaining"], 5)
            self.assertEqual(payload["items"][0]["email"], "creator@example.com")
            self.assertNotIn("password_hash", payload["item"])
            self.assertNotIn("key_hash", payload["item"])

    def test_unused_user_keys_api_lists_and_deletes_unbound_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            unused, raw_unused_key = service.create_key(role="user", name="Unused API")
            consumed, consumed_key = service.create_key(role="user", name="Consumed API")
            self.assertIsNotNone(service.authenticate(consumed_key))
            app = FastAPI()
            app.include_router(accounts_module.create_router())

            with (
                mock.patch.object(accounts_module, "auth_service", service),
                mock.patch.object(accounts_module, "require_admin", return_value={"id": "admin", "role": "admin"}),
            ):
                client = TestClient(app)
                list_response = client.get("/api/auth/users/unused-keys", headers={"Authorization": "Bearer admin"})
                delete_response = client.request(
                    "DELETE",
                    "/api/auth/users/unused-keys",
                    headers={"Authorization": "Bearer admin"},
                    json={"ids": [unused["id"], consumed["id"]]},
                )

            self.assertEqual(list_response.status_code, 200, list_response.text)
            listed = list_response.json()["items"]
            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0]["id"], unused["id"])
            self.assertEqual(listed[0]["key"], raw_unused_key)
            self.assertTrue(listed[0]["copyable"])

            self.assertEqual(delete_response.status_code, 200, delete_response.text)
            payload = delete_response.json()
            self.assertEqual(payload["removed"], 1)
            self.assertEqual(payload["removed_ids"], [unused["id"]])
            self.assertEqual(payload["unused_items"], [])
            remaining_ids = {item["id"] for item in payload["items"]}
            self.assertNotIn(unused["id"], remaining_ids)
            self.assertIn(consumed["id"], remaining_ids)


class UserKeyLimitApiTests(unittest.TestCase):
    def setUp(self) -> None:
        usage_limit_service.reset()
        app = FastAPI()
        app.include_router(ai_module.create_router())
        self.client = TestClient(app)
        self.addCleanup(usage_limit_service.reset)

        async def no_filter(_call, _text, **_kwargs):
            return None

        self.filter_patcher = mock.patch.object(ai_module, "filter_or_log", no_filter)
        self.filter_patcher.start()
        self.addCleanup(self.filter_patcher.stop)

    def test_chat_completion_entry_ignores_legacy_request_limit(self) -> None:
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
        self.assertEqual(second.status_code, 200, second.text)

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

    def test_image_generation_entry_consumes_persisted_user_image_quota(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest", limits={"images_total": 3})
            identity = service.get_user(user["id"])

            async def no_filter(_call, _text):
                return None

            with (
                mock.patch.object(ai_module, "require_identity", return_value=identity),
                mock.patch.object(ai_module, "filter_or_log", no_filter),
                mock.patch.object(support_module, "auth_service", service),
                mock.patch.object(
                    ai_module.openai_v1_image_generations,
                    "handle",
                    return_value={"created": 1, "data": [{"b64_json": "ZmFrZQ=="}]},
                ),
            ):
                response = self.client.post(
                    "/v1/images/generations",
                    headers={"Authorization": "Bearer user-key"},
                    json={"model": "gpt-image-2", "prompt": "cat", "n": 2},
                )

            self.assertEqual(response.status_code, 200, response.text)
            reloaded = service.get_user(user["id"])
            self.assertEqual(reloaded["limits"]["images_used"], 2)
            self.assertEqual(reloaded["limits"]["images_remaining"], 1)

    def test_image_generation_entry_consumes_resolution_credit_cost(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest", limits={"images_total": 5})
            identity = service.get_user(user["id"])

            with (
                mock.patch.object(ai_module, "require_identity", return_value=identity),
                mock.patch.object(support_module, "auth_service", service),
                mock.patch.object(
                    ai_module.openai_v1_image_generations,
                    "handle",
                    return_value={"created": 1, "data": [{"b64_json": "ZmFrZQ=="}]},
                ),
            ):
                response = self.client.post(
                    "/v1/images/generations",
                    headers={"Authorization": "Bearer user-key"},
                    json={"model": "gpt-image-2", "prompt": "cat", "n": 2, "resolution": "2K"},
                )

            self.assertEqual(response.status_code, 200, response.text)
            reloaded = service.get_user(user["id"])
            self.assertEqual(reloaded["limits"]["images_used"], 4)
            self.assertEqual(reloaded["limits"]["images_remaining"], 1)

    def test_image_generation_entry_defaults_unknown_resolution_to_one_credit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest", limits={"images_total": 3})
            identity = service.get_user(user["id"])

            with (
                mock.patch.object(ai_module, "require_identity", return_value=identity),
                mock.patch.object(support_module, "auth_service", service),
                mock.patch.object(
                    ai_module.openai_v1_image_generations,
                    "handle",
                    return_value={"created": 1, "data": [{"b64_json": "ZmFrZQ=="}]},
                ),
            ):
                response = self.client.post(
                    "/v1/images/generations",
                    headers={"Authorization": "Bearer user-key"},
                    json={"model": "gpt-image-2", "prompt": "cat", "n": 2, "resolution": "8K"},
                )

            self.assertEqual(response.status_code, 200, response.text)
            reloaded = service.get_user(user["id"])
            self.assertEqual(reloaded["limits"]["images_used"], 2)
            self.assertEqual(reloaded["limits"]["images_remaining"], 1)

    def test_image_edit_entry_consumes_resolution_credit_cost(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest", limits={"images_total": 7})
            identity = service.get_user(user["id"])

            with (
                mock.patch.object(ai_module, "require_identity", return_value=identity),
                mock.patch.object(support_module, "auth_service", service),
                mock.patch.object(
                    ai_module.openai_v1_image_edit,
                    "handle",
                    return_value={"created": 1, "data": [{"b64_json": "ZmFrZQ=="}]},
                ),
            ):
                response = self.client.post(
                    "/v1/images/edits",
                    headers={"Authorization": "Bearer user-key"},
                    data={"model": "gpt-image-2", "prompt": "edit cat", "n": "2", "resolution": "4K"},
                    files={"image": ("image.png", b"image", "image/png")},
                )

            self.assertEqual(response.status_code, 200, response.text)
            reloaded = service.get_user(user["id"])
            self.assertEqual(reloaded["limits"]["images_used"], 6)
            self.assertEqual(reloaded["limits"]["images_remaining"], 1)

    def test_image_edit_entry_defaults_unknown_resolution_to_one_credit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            user, _raw_user_key = service.create_key(role="user", name="Studio Guest", limits={"images_total": 3})
            identity = service.get_user(user["id"])

            with (
                mock.patch.object(ai_module, "require_identity", return_value=identity),
                mock.patch.object(support_module, "auth_service", service),
                mock.patch.object(
                    ai_module.openai_v1_image_edit,
                    "handle",
                    return_value={"created": 1, "data": [{"b64_json": "ZmFrZQ=="}]},
                ),
            ):
                response = self.client.post(
                    "/v1/images/edits",
                    headers={"Authorization": "Bearer user-key"},
                    data={"model": "gpt-image-2", "prompt": "edit cat", "n": "2", "resolution": "8K"},
                    files={"image": ("image.png", b"image", "image/png")},
                )

            self.assertEqual(response.status_code, 200, response.text)
            reloaded = service.get_user(user["id"])
            self.assertEqual(reloaded["limits"]["images_used"], 2)
            self.assertEqual(reloaded["limits"]["images_remaining"], 1)

    def test_image_edit_entry_skips_filter_for_outpaint_prompt(self) -> None:
        filter_calls = []

        async def record_filter(_call, text, **kwargs):
            filter_calls.append((text, kwargs.get("skip_ai_review")))

        with (
            mock.patch.object(ai_module, "require_identity", return_value={"id": "admin", "name": "管理员", "role": "admin"}),
            mock.patch.object(ai_module, "filter_or_log", side_effect=record_filter),
            mock.patch.object(
                ai_module.openai_v1_image_edit,
                "handle",
                return_value={"created": 1, "data": [{"b64_json": "ZmFrZQ=="}]},
            ),
        ):
            response = self.client.post(
                "/v1/images/edits",
                headers={"Authorization": "Bearer chatgpt2api"},
                data={"model": "gpt-image-2", "prompt": "扩展这张图", "n": "1", "size": "16:9", "resolution": "4K"},
                files={"image": ("image.png", b"image", "image/png")},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(filter_calls, [("扩展这张图", True)])

    def test_image_edit_entry_still_filters_non_outpaint_prompt(self) -> None:
        filter_calls = []

        async def record_filter(_call, text, **kwargs):
            filter_calls.append((text, kwargs.get("skip_ai_review")))

        with (
            mock.patch.object(ai_module, "require_identity", return_value={"id": "admin", "name": "管理员", "role": "admin"}),
            mock.patch.object(ai_module, "filter_or_log", side_effect=record_filter),
            mock.patch.object(
                ai_module.openai_v1_image_edit,
                "handle",
                return_value={"created": 1, "data": [{"b64_json": "ZmFrZQ=="}]},
            ),
        ):
            response = self.client.post(
                "/v1/images/edits",
                headers={"Authorization": "Bearer chatgpt2api"},
                data={"model": "gpt-image-2", "prompt": "把背景改成夜晚", "n": "1"},
                files={"image": ("image.png", b"image", "image/png")},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(filter_calls, [("把背景改成夜晚", False)])


if __name__ == "__main__":
    unittest.main()
