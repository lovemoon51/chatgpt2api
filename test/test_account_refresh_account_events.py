import os, tempfile, time, threading, unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from services.account_service import AccountService
from services.storage.json_storage import JSONStorageBackend


class AccountRefreshAccountEventTests(unittest.TestCase):
    def test_iter_refresh_emits_account_event_for_each_token(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            tokens = ["a", "b", "c", "d"]
            service.add_accounts(tokens)

            def fake_fetch(token: str) -> dict:
                return {"email": f"{token}@example.com", "quota": 1, "status": "\u6b63\u5e38"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)
            object.__setattr__(service, "refresh_batch_interval_seconds", staticmethod(lambda: 0.0))

            events = list(service.iter_refresh_accounts(tokens))

            account_events = [event for event in events if event["type"] == "account"]
            self.assertEqual(len(account_events), len(tokens))
            self.assertTrue(all(event["outcome"] == "succeeded" for event in account_events))
            self.assertEqual([event["completed"] for event in account_events], list(range(1, len(tokens) + 1)))
            self.assertTrue(all(event["requested"] == len(tokens) for event in account_events))

    def test_iter_refresh_account_event_marks_invalid_outcome(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            tokens = ["good", "bad"]
            service.add_accounts(tokens)

            def fake_fetch(token: str) -> dict:
                if token == "bad":
                    raise RuntimeError("/backend-api/me failed: HTTP 401")
                return {"email": f"{token}@example.com", "quota": 1, "status": "\u6b63\u5e38"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)
            object.__setattr__(service, "refresh_batch_interval_seconds", staticmethod(lambda: 0.0))

            with mock.patch.object(service, "_sync_cpa_delete"):
                events = list(service.iter_refresh_accounts(tokens))

            account_events = [event for event in events if event["type"] == "account"]
            outcomes = sorted(event["outcome"] for event in account_events)
            self.assertEqual(outcomes, ["invalid", "succeeded"])

    def test_iter_refresh_account_event_streams_progressively(self) -> None:
        """Slow fetches should not block faster ones \u2014 events arrive as soon as a token finishes."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = AccountService(JSONStorageBackend(Path(tmp_dir) / "accounts.json"))
            tokens = ["slow", "fast"]
            service.add_accounts(tokens)

            def fake_fetch(token: str) -> dict:
                if token == "slow":
                    time.sleep(0.2)
                return {"email": f"{token}@example.com", "quota": 1, "status": "\u6b63\u5e38"}

            service._fetch_remote_user_info = staticmethod(fake_fetch)
            object.__setattr__(service, "refresh_batch_interval_seconds", staticmethod(lambda: 0.0))
            # Force a single batch so both tokens are fetched concurrently with workers >= 2.
            object.__setattr__(service, "refresh_fast_path_threshold", staticmethod(lambda: 8))

            arrived: list[str] = []
            for event in service.iter_refresh_accounts(tokens):
                if event["type"] == "account":
                    arrived.append(event["token"])

            # Two account events arrived; the fast one finishes first.
            self.assertEqual(len(arrived), 2)


if __name__ == "__main__":
    unittest.main()