from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from services.account_service import AccountService, IMAGE_POOL_REPLENISH_HIGH, IMAGE_POOL_REPLENISH_LOW
from services import account_service as account_module
from services.auth_service import AuthService
from services.storage.json_storage import JSONStorageBackend
from utils.helper import anonymize_token


class AccountCapabilityTests(unittest.TestCase):
    def test_unknown_quota_accounts_are_available_only_when_not_throttled(self) -> None:
        self.assertFalse(
            AccountService._is_image_account_available(
                {"status": "限流", "image_quota_unknown": True, "quota": 0}
            )
        )
        self.assertTrue(
            AccountService._is_image_account_available(
                {"status": "正常", "image_quota_unknown": True, "quota": 0}
            )
        )

    def test_checkout_blocked_accounts_are_not_available_for_images(self) -> None:
        self.assertFalse(
            AccountService._is_image_account_available(
                {
                    "status": "正常",
                    "image_quota_unknown": True,
                    "quota": 25,
                    "image_blocked_reason": "checkout_required",
                }
            )
        )

    def test_prolite_variants_are_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            self.assertEqual(service._normalize_account_type("prolite"), "ProLite")
            self.assertEqual(service._normalize_account_type("pro_lite"), "ProLite")

    def test_search_account_type_ignores_unrelated_scalar_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            self.assertIsNone(
                service._search_account_type(
                    {
                        "amr": ["pwd", "otp", "mfa"],
                        "chatgpt_compute_residency": "no_constraint",
                        "chatgpt_data_residency": "no_constraint",
                        "user_id": "user-I52GFfLGFM0dokFk2dBiKEBn",
                    }
                )
            )

    def test_mark_image_result_does_not_consume_unknown_quota(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["token-1"])
            service.update_account(
                "token-1",
                {
                    "status": "正常",
                    "quota": 0,
                    "image_quota_unknown": True,
                },
            )

            updated = service.mark_image_result("token-1", success=True)

            self.assertIsNotNone(updated)
            self.assertEqual(updated["quota"], 0)
            self.assertEqual(updated["status"], "正常")
            self.assertTrue(updated["image_quota_unknown"])

    def test_mark_image_checkout_required_blocks_future_image_use(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["token-1"])
            service.update_account("token-1", {"status": "正常", "quota": 25})

            updated = service.mark_image_checkout_required("token-1", "checkout")

            self.assertIsNone(updated)
            self.assertEqual(service.list_tokens(), [])

    def test_mark_image_usage_limit_preserves_account_even_when_rate_limited_removal_enabled(self) -> None:
        old_value = account_module.config.data.get("auto_remove_rate_limited_accounts")
        account_module.config.data["auto_remove_rate_limited_accounts"] = True
        with tempfile.TemporaryDirectory() as tmp_dir:
            try:
                service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
                service.add_accounts(["token-1"])
                service.update_account(
                    "token-1",
                    {
                        "status": "正常",
                        "quota": 25,
                        "image_quota_unknown": True,
                    },
                )

                updated = service.mark_image_usage_limit(
                    "token-1",
                    "usage_limit_reached",
                    resets_in_seconds=3600,
                )

                self.assertIsNotNone(updated)
                self.assertEqual(service.list_tokens(), ["token-1"])
                self.assertEqual(updated["status"], "限流")
                self.assertEqual(updated["quota"], 0)
                self.assertFalse(updated["image_quota_unknown"])
                self.assertTrue(updated["restore_at"])
            finally:
                if old_value is None:
                    account_module.config.data.pop("auto_remove_rate_limited_accounts", None)
                else:
                    account_module.config.data["auto_remove_rate_limited_accounts"] = old_value

    def test_get_available_access_token_uses_cached_pool_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["token-1"])
            service.update_account("token-1", {"status": "正常", "quota": 25})

            with mock.patch.object(service, "fetch_remote_info", side_effect=AssertionError("should not refresh")):
                token = service.get_available_access_token()

            self.assertEqual(token, "token-1")
            service.release_image_slot(token)

    def test_get_available_access_token_can_still_verify_remote_when_requested(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["token-1"])
            service.update_account("token-1", {"status": "正常", "quota": 25})

            with mock.patch.object(
                service,
                "fetch_remote_info",
                return_value={"status": "正常", "quota": 25},
            ) as fetch:
                token = service.get_available_access_token(verify_remote=True)

            self.assertEqual(token, "token-1")
            fetch.assert_called_once()
            service.release_image_slot(token)

    def test_peek_text_access_token_uses_available_text_pool_without_advancing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["disabled-token", "ready-token"])
            service.update_account("disabled-token", {"status": "禁用"})

            first = service.peek_text_access_token()
            second = service.peek_text_access_token()

            self.assertEqual(first, "ready-token")
            self.assertEqual(second, "ready-token")

    def test_ensure_image_capacity_uses_cached_ready_account_without_refresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["token-1"])
            service.update_account("token-1", {"status": "正常", "quota": 25})

            with mock.patch.object(service, "schedule_image_pool_replenish", side_effect=AssertionError("should not replenish")):
                self.assertTrue(service.ensure_image_capacity(timeout_seconds=0.01))

    def test_ensure_image_capacity_replenishes_due_limited_account(self) -> None:
        old_remove = account_module.config.data.get("auto_remove_rate_limited_accounts")
        account_module.config.data["auto_remove_rate_limited_accounts"] = False
        with tempfile.TemporaryDirectory() as tmp_dir:
            try:
                service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
                service.add_accounts(["token-1"])
                service.update_account(
                    "token-1",
                    {"status": "限流", "quota": 0, "image_quota_unknown": False, "restore_at": "2000-01-01 00:00:00"},
                )

                with mock.patch.object(
                    service,
                    "_fetch_remote_user_info",
                    return_value={"status": "正常", "quota": 25, "image_quota_unknown": False},
                ) as fetch:
                    self.assertTrue(service.ensure_image_capacity(timeout_seconds=1.0))

                thread = service._image_pool_replenish_thread
                if thread is not None:
                    thread.join(timeout=2.0)
                fetch.assert_called_once_with("token-1")
                self.assertEqual(service.get_account("token-1")["status"], "正常")
            finally:
                if old_remove is None:
                    account_module.config.data.pop("auto_remove_rate_limited_accounts", None)
                else:
                    account_module.config.data["auto_remove_rate_limited_accounts"] = old_remove

    def test_ensure_image_capacity_times_out_when_replenish_has_no_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))

            started = time.time()
            self.assertFalse(service.ensure_image_capacity(timeout_seconds=0.01))

            self.assertLess(time.time() - started, 0.5)

    def test_low_priority_replenish_stops_when_image_request_is_active(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["token-1", "token-2"])
            service.update_account("token-1", {"status": "限流", "quota": 0, "restore_at": "2000-01-01 00:00:00"})
            service.update_account("token-2", {"status": "限流", "quota": 0, "restore_at": "2000-01-01 00:00:00"})
            with service._image_slot_condition:
                service._active_image_requests = 1

            with mock.patch.object(service, "_fetch_remote_user_info", side_effect=AssertionError("should yield to image request")):
                service._run_image_pool_replenish(["token-1", "token-2"], "test", IMAGE_POOL_REPLENISH_LOW)

            with service._image_slot_condition:
                service._active_image_requests = 0

    def test_schedule_image_pool_replenish_deduplicates_running_job(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["token-1"])
            service.update_account("token-1", {"status": "限流", "quota": 0, "restore_at": "2000-01-01 00:00:00"})
            with service._image_slot_condition:
                service._image_pool_replenish_running = True

            self.assertFalse(service.schedule_image_pool_replenish("test", priority=IMAGE_POOL_REPLENISH_HIGH))

            with service._image_slot_condition:
                service._image_pool_replenish_running = False

    def test_request_register_respects_total_account_cap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts([f"token-{index}" for index in range(50)])

            with (
                mock.patch.object(account_module.config, "get_auto_register_settings", return_value={"target_available": 50}),
                mock.patch("services.register.openai_register.worker", side_effect=AssertionError("should not register")),
            ):
                with self.assertRaisesRegex(RuntimeError, "account limit reached"):
                    service.register_image_account_for_request(reason="test")

    def test_request_register_times_out_and_releases_running_state(self) -> None:
        old_timeout = account_module.config.data.get("image_pool_register_timeout_seconds")
        account_module.config.data["image_pool_register_timeout_seconds"] = 0.05
        with tempfile.TemporaryDirectory() as tmp_dir:
            try:
                service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))

                def slow_worker(_index: int) -> dict:
                    time.sleep(0.3)
                    return {"ok": True, "result": {"access_token": "late-token"}}

                started = time.time()
                with mock.patch("services.register.openai_register.worker", side_effect=slow_worker):
                    with self.assertRaisesRegex(TimeoutError, "image pool register timed out"):
                        service.register_image_account_for_request(reason="test")

                self.assertLess(time.time() - started, 0.5)
                with service._image_slot_condition:
                    self.assertFalse(service._image_pool_register_running)
            finally:
                if old_timeout is None:
                    account_module.config.data.pop("image_pool_register_timeout_seconds", None)
                else:
                    account_module.config.data["image_pool_register_timeout_seconds"] = old_timeout

    def test_request_register_wait_for_running_job_has_timeout_boundary(self) -> None:
        old_timeout = account_module.config.data.get("image_pool_register_timeout_seconds")
        account_module.config.data["image_pool_register_timeout_seconds"] = 0.05
        with tempfile.TemporaryDirectory() as tmp_dir:
            try:
                service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
                with service._image_slot_condition:
                    service._image_pool_register_running = True
                    service._image_pool_register_generation = 1

                started = time.time()
                with mock.patch("services.register.openai_register.worker", side_effect=AssertionError("should not start another worker")):
                    with self.assertRaisesRegex(RuntimeError, "image pool register timed out"):
                        service.register_image_account_for_request(reason="test")

                self.assertLess(time.time() - started, 0.5)
                with service._image_slot_condition:
                    self.assertFalse(service._image_pool_register_running)
            finally:
                if old_timeout is None:
                    account_module.config.data.pop("image_pool_register_timeout_seconds", None)
                else:
                    account_module.config.data["image_pool_register_timeout_seconds"] = old_timeout


class TokenLogTests(unittest.TestCase):
    def test_anonymize_token_hides_raw_value(self) -> None:
        token = "super-secret-token"
        token_ref = anonymize_token(token)

        self.assertTrue(token_ref.startswith("token:"))
        self.assertNotIn(token, token_ref)


class AuthServiceTests(unittest.TestCase):
    def test_create_authenticate_disable_and_delete_user_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))

            item, raw_key = service.create_key(role="user", name="Alice")

            self.assertEqual(item["role"], "user")
            self.assertEqual(item["name"], "Alice")
            self.assertTrue(item["enabled"])
            self.assertTrue(raw_key.startswith("sk-"))

            authed = service.authenticate(raw_key)
            self.assertIsNotNone(authed)
            self.assertEqual(authed["id"], item["id"])
            self.assertEqual(authed["role"], "user")
            self.assertIsNotNone(authed["last_used_at"])

            updated = service.update_key(item["id"], {"enabled": False}, role="user")
            self.assertIsNotNone(updated)
            self.assertFalse(updated["enabled"])
            self.assertIsNone(service.authenticate(raw_key))

            self.assertTrue(service.delete_key(item["id"], role="user"))
            self.assertFalse(service.delete_key(item["id"], role="user"))
            self.assertEqual(service.list_keys(role="user"), [])

    def test_authenticate_ignores_last_used_save_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            item, raw_key = service.create_key(role="user", name="Alice")

            def fail_save() -> None:
                raise OSError("disk unavailable")

            service._save = fail_save

            authed = service.authenticate(raw_key)

            self.assertIsNotNone(authed)
            self.assertEqual(authed["id"], item["id"])
            self.assertIsNotNone(authed["last_used_at"])

    def test_update_user_key_replaces_raw_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            item, raw_key = service.create_key(role="user", name="Alice")

            updated = service.update_key(item["id"], {"key": "sk-user-custom-key"}, role="user")

            self.assertIsNotNone(updated)
            self.assertIsNone(service.authenticate(raw_key))

            authed = service.authenticate("sk-user-custom-key")
            self.assertIsNotNone(authed)
            self.assertEqual(authed["id"], item["id"])

    def test_user_key_name_must_be_unique(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AuthService(JSONStorageBackend(Path(tmp_dir) / "accounts.json", Path(tmp_dir) / "auth_keys.json"))
            first, _ = service.create_key(role="user", name="Alice")
            second, _ = service.create_key(role="user", name="Bob")

            with self.assertRaisesRegex(ValueError, "这个名称已经在使用中了"):
                service.create_key(role="user", name="Alice")

            with self.assertRaisesRegex(ValueError, "这个名称已经在使用中了"):
                service.update_key(second["id"], {"name": "Alice"}, role="user")

            updated = service.update_key(first["id"], {"name": "Alice"}, role="user")
            self.assertIsNotNone(updated)
            self.assertEqual(updated["name"], "Alice")


if __name__ == "__main__":
    unittest.main()
