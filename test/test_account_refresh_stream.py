from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from services.account_service import AccountService
from services.storage.json_storage import JSONStorageBackend


class AccountRefreshStreamTests(unittest.TestCase):
    def test_runtime_403_error_is_treated_as_invalid_and_removed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["reauth-token", "good-token"])

            def fake_fetch(token: str) -> dict:
                if token == "reauth-token":
                    raise RuntimeError("/backend-api/me failed: HTTP 403")
                return {"email": f"{token}@example.com", "quota": 25, "status": "\u6b63\u5e38"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)

            with mock.patch.object(service, "_sync_cpa_delete") as sync_delete:
                result = service.refresh_accounts(["reauth-token", "good-token"])

            self.assertEqual(result["removed_failed"], 1)
            self.assertEqual(result["refreshed"], 1)
            self.assertEqual(service.list_tokens(), ["good-token"])
            sync_delete.assert_called_once()

    def test_unauthorized_text_error_is_treated_as_invalid_and_removed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            service.add_accounts(["login-required-token", "good-token"])

            def fake_fetch(token: str) -> dict:
                if token == "login-required-token":
                    raise RuntimeError("upstream said: please log in again")
                return {"email": f"{token}@example.com", "quota": 5, "status": "\u6b63\u5e38"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)

            with mock.patch.object(service, "_sync_cpa_delete") as sync_delete:
                result = service.refresh_accounts(["login-required-token", "good-token"])

            self.assertEqual(result["removed_failed"], 1)
            self.assertEqual(service.list_tokens(), ["good-token"])
            sync_delete.assert_called_once()

    def test_iter_refresh_accounts_emits_progress_per_batch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            tokens = [f"t{i}" for i in range(7)]
            service.add_accounts(tokens)

            def fake_fetch(token: str) -> dict:
                return {"email": f"{token}@example.com", "quota": 1, "status": "\u6b63\u5e38"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)

            # Disable batch sleep to keep the test fast.
            object.__setattr__(service, "refresh_batch_size", staticmethod(lambda: 3))
            object.__setattr__(service, "refresh_batch_interval_seconds", staticmethod(lambda: 0.0))

            events = list(service.iter_refresh_accounts(tokens))

            types = [event["type"] for event in events]
            self.assertEqual(types[0], "start")
            self.assertEqual(types[-1], "done")
            batch_events = [event for event in events if event["type"] == "batch"]
            self.assertGreater(len(batch_events), 1, "\u5e94\u8be5\u5206\u6210\u591a\u4e2a\u6279\u6b21")
            for event in batch_events:
                self.assertLessEqual(event["completed"], event["requested"])
            self.assertEqual(events[-1]["refreshed"], len(tokens))
            self.assertEqual(events[-1]["requested"], len(tokens))
            self.assertEqual(events[-1]["completed"], len(tokens))

    def test_iter_refresh_accounts_streams_invalid_tokens_immediately(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            tokens = ["a", "b", "c", "d", "e"]
            service.add_accounts(tokens)

            def fake_fetch(token: str) -> dict:
                if token in {"b", "d"}:
                    raise RuntimeError("/backend-api/me failed: HTTP 401")
                return {"email": f"{token}@example.com", "quota": 1, "status": "\u6b63\u5e38"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)
            object.__setattr__(service, "refresh_batch_interval_seconds", staticmethod(lambda: 0.0))

            with mock.patch.object(service, "_sync_cpa_delete") as sync_delete:
                events = list(service.iter_refresh_accounts(tokens))

            removed_tokens_per_batch = [
                event["removed_tokens"]
                for event in events
                if event["type"] == "batch"
            ]
            removed_total = sum(len(item) for item in removed_tokens_per_batch)
            self.assertEqual(removed_total, 2)
            done = events[-1]
            self.assertEqual(done["removed_failed"], 2)
            self.assertEqual(sorted(service.list_tokens()), ["a", "c", "e"])
            self.assertEqual(sync_delete.call_count, 2)


if __name__ == "__main__":
    unittest.main()
