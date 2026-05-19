from __future__ import annotations

import os
import unittest
from unittest import mock

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from services import account_service as account_module
from services.account_service import AccountService
from services.storage.json_storage import JSONStorageBackend
from services.openai_backend_api import InvalidAccessTokenError
from pathlib import Path
import tempfile


class AccountRefreshErrorTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_proxy = account_module.config.data.get("proxy")

    def tearDown(self) -> None:
        if self._old_proxy is None:
            account_module.config.data.pop("proxy", None)
        else:
            account_module.config.data["proxy"] = self._old_proxy

    def test_timeout_without_proxy_suggests_configuring_proxy(self) -> None:
        account_module.config.data["proxy"] = ""
        message = account_module._format_refresh_error(
            RuntimeError("Failed to perform, curl: (28) Connection timed out after 20010 milliseconds.")
        )

        self.assertIn("未配置全局代理", message)
        self.assertIn("chatgpt.com", message)

    def test_timeout_with_proxy_suggests_testing_proxy(self) -> None:
        account_module.config.data["proxy"] = "http://127.0.0.1:7890"
        message = account_module._format_refresh_error(
            RuntimeError("Failed to perform, curl: (28) Connection timed out after 20010 milliseconds.")
        )

        self.assertIn("已配置全局代理", message)
        self.assertIn("测试代理", message)

    def test_refresh_accounts_fetches_concurrently_and_saves_once(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["token-1", "token-2", "token-3"])
            save_calls = 0
            original_save = service._save_accounts

            def counted_save() -> None:
                nonlocal save_calls
                save_calls += 1
                original_save()

            def fake_fetch(token: str) -> dict:
                return {"email": f"{token}@example.com", "quota": 25, "status": "正常"}

            service._save_accounts = counted_save
            service._fetch_remote_user_info = staticmethod(fake_fetch)

            result = service.refresh_accounts(["token-1", "token-2", "token-3"])

            self.assertEqual(result["refreshed"], 3)
            self.assertEqual(result["errors"], [])
            self.assertEqual(save_calls, 1)
            emails = {item["email"] for item in result["items"]}
            self.assertEqual(emails, {"token-1@example.com", "token-2@example.com", "token-3@example.com"})

    def test_refresh_accounts_removes_invalid_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["good-token", "bad-token"])

            def fake_fetch(token: str) -> dict:
                if token == "bad-token":
                    raise InvalidAccessTokenError("token invalid")
                return {"email": f"{token}@example.com", "quota": 25, "status": "正常"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)

            result = service.refresh_accounts(["good-token", "bad-token"])

            self.assertEqual(result["refreshed"], 1)
            self.assertEqual(len(result["errors"]), 1)
            self.assertEqual(result["removed_failed"], 1)
            self.assertEqual(service.list_tokens(), ["good-token"])
            self.assertEqual([item["access_token"] for item in result["items"]], ["good-token"])

    def test_refresh_accounts_syncs_cpa_delete_for_invalid_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["good-token", "bad-token"])
            service.update_account("bad-token", {"email": "bad@example.com", "type": "free"})

            def fake_fetch(token: str) -> dict:
                if token == "bad-token":
                    raise InvalidAccessTokenError("token invalid")
                return {"email": f"{token}@example.com", "quota": 25, "status": "正常"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)

            with mock.patch.object(service, "_sync_cpa_delete") as sync_delete:
                result = service.refresh_accounts(["good-token", "bad-token"])

            self.assertEqual(result["removed_failed"], 1)
            sync_delete.assert_called_once()
            account, event = sync_delete.call_args.args
            self.assertEqual(account["access_token"], "bad-token")
            self.assertEqual(account["email"], "bad@example.com")
            self.assertEqual(event, "refresh_accounts_invalid")

    def test_remove_invalid_token_marks_only_when_auto_remove_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["bad-token"])
            old_value = account_module.config.data.get("auto_remove_invalid_accounts")
            account_module.config.data["auto_remove_invalid_accounts"] = False
            try:
                with mock.patch.object(service, "_sync_cpa_delete") as sync_delete:
                    removed = service.remove_invalid_token("bad-token", "test")
            finally:
                if old_value is None:
                    account_module.config.data.pop("auto_remove_invalid_accounts", None)
                else:
                    account_module.config.data["auto_remove_invalid_accounts"] = old_value

            self.assertFalse(removed)
            sync_delete.assert_not_called()
            account = service.get_account("bad-token")
            self.assertIsNotNone(account)
            assert account is not None
            self.assertEqual(account["status"], "异常")

    def test_remove_unusable_image_token_syncs_cpa_delete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["bad-token"])
            service.update_account("bad-token", {"email": "bad@example.com", "type": "free"})

            with mock.patch.object(service, "_sync_cpa_delete") as sync_delete:
                removed = service.remove_unusable_image_token("bad-token", "image_stream_invalid_token", "invalidated")

            self.assertTrue(removed)
            sync_delete.assert_called_once()
            account, event = sync_delete.call_args.args
            self.assertEqual(account["access_token"], "bad-token")
            self.assertEqual(account["email"], "bad@example.com")
            self.assertEqual(event, "image_stream_invalid_token")

    def test_refresh_accounts_batches_large_refresh_but_keeps_small_fast_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            tokens = [f"token-{index}" for index in range(5)]
            service.add_accounts(tokens)
            old_values = {
                key: account_module.config.data.get(key)
                for key in (
                    "refresh_account_fast_path_threshold",
                    "refresh_account_batch_size",
                    "refresh_account_batch_interval_seconds",
                )
            }
            account_module.config.data["refresh_account_fast_path_threshold"] = 3
            account_module.config.data["refresh_account_batch_size"] = 2
            account_module.config.data["refresh_account_batch_interval_seconds"] = 0.25

            def fake_fetch(token: str) -> dict:
                return {"email": f"{token}@example.com", "quota": 25, "status": "正常"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)
            try:
                with mock.patch.object(account_module.time, "sleep") as sleep:
                    large_result = service.refresh_accounts(tokens)
                with mock.patch.object(account_module.time, "sleep") as small_sleep:
                    small_result = service.refresh_accounts(tokens[:3])
            finally:
                for key, value in old_values.items():
                    if value is None:
                        account_module.config.data.pop(key, None)
                    else:
                        account_module.config.data[key] = value

            self.assertEqual(large_result["refreshed"], 5)
            self.assertEqual(sleep.call_count, 2)
            sleep.assert_any_call(0.25)
            self.assertEqual(small_result["refreshed"], 3)
            small_sleep.assert_not_called()

    def test_refresh_accounts_keeps_transient_failures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["good-token", "slow-token"])

            def fake_fetch(token: str) -> dict:
                if token == "slow-token":
                    raise RuntimeError("refresh failed")
                return {"email": f"{token}@example.com", "quota": 25, "status": "正常"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)

            result = service.refresh_accounts(["good-token", "slow-token"])

            self.assertEqual(result["refreshed"], 1)
            self.assertEqual(len(result["errors"]), 1)
            self.assertEqual(result["removed_failed"], 0)
            self.assertEqual(set(service.list_tokens()), {"good-token", "slow-token"})
            self.assertEqual(
                {item["access_token"] for item in result["items"]},
                {"good-token", "slow-token"},
            )

    def test_refresh_accounts_writes_one_final_log_for_refresh_all(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["good-token", "slow-token"])

            def fake_fetch(token: str) -> dict:
                if token == "slow-token":
                    raise RuntimeError("refresh failed")
                return {"email": f"{token}@example.com", "quota": 25, "status": "正常"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)

            with mock.patch.object(account_module.log_service, "add") as add_log:
                result = service.refresh_accounts(["good-token", "slow-token"], "一键刷新所有账号信息和额度")

            self.assertEqual(result["refreshed"], 1)
            self.assertEqual(len(result["errors"]), 1)
            self.assertEqual(add_log.call_count, 1)
            log_type, summary, detail = add_log.call_args.args
            self.assertEqual(log_type, account_module.LOG_TYPE_ACCOUNT)
            self.assertIn("一键刷新所有账号信息和额度", summary)
            self.assertIn("刷新完成：成功 1 个，失败 1 个", summary)
            self.assertIn("首个错误：refresh failed", summary)
            self.assertIn("耗时", summary)
            self.assertEqual(detail["requested"], 2)
            self.assertEqual(detail["refreshed"], 1)
            self.assertEqual(detail["failed"], 1)
            self.assertEqual(detail["first_error"], "refresh failed")
            self.assertIn("started_at", detail)
            self.assertIn("ended_at", detail)
            self.assertIsInstance(detail["duration_ms"], int)
            self.assertGreaterEqual(detail["duration_ms"], 0)


if __name__ == "__main__":
    unittest.main()
