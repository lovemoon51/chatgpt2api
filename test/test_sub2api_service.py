from __future__ import annotations

import unittest
from unittest import mock

from services import sub2api_service


class FakeResponse:
    def __init__(self, payload: object, *, ok: bool = True, status_code: int = 200, text: str = "") -> None:
        self._payload = payload
        self.ok = ok
        self.status_code = status_code
        self.text = text

    def json(self) -> object:
        return self._payload


class FakeSession:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.get_calls: list[dict] = []
        self.closed = False

    def get(self, url: str, **kwargs):
        self.get_calls.append({"url": url, **kwargs})
        if not self.responses:
            raise AssertionError("unexpected GET")
        return self.responses.pop(0)

    def close(self) -> None:
        self.closed = True


class Sub2APIServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        sub2api_service._token_cache.clear()

    def test_list_remote_accounts_includes_redacted_accounts_with_token_status(self) -> None:
        session = FakeSession([
            FakeResponse({
                "code": 0,
                "data": {
                    "items": [
                        {
                            "id": 42,
                            "name": "user@example.com",
                            "status": "active",
                            "credentials": {"plan_type": "plus"},
                            "credentials_status": {"has_access_token": True, "has_refresh_token": True},
                        }
                    ],
                    "total": 1,
                },
            })
        ])
        server = {"id": "srv", "base_url": "https://sub2api.example", "api_key": "admin-key"}

        with mock.patch("services.sub2api_service.Session", side_effect=lambda **_: session):
            accounts = sub2api_service.list_remote_accounts(server)

        self.assertEqual(len(accounts), 1)
        self.assertEqual(accounts[0]["id"], "42")
        self.assertTrue(accounts[0]["has_access_token"])
        self.assertTrue(accounts[0]["has_refresh_token"])
        self.assertTrue(session.closed)

    def test_fetch_access_token_for_account_uses_admin_data_export_for_raw_credentials(self) -> None:
        session = FakeSession([
            FakeResponse({
                "code": 0,
                "data": {
                    "accounts": [
                        {
                            "name": "user@example.com",
                            "platform": "openai",
                            "type": "oauth",
                            "credentials": {
                                "access_token": "access-secret",
                                "email": "user@example.com",
                                "plan_type": "plus",
                            },
                        }
                    ]
                },
            })
        ])
        server = {"id": "srv", "base_url": "https://sub2api.example", "api_key": "admin-key"}

        with mock.patch("services.sub2api_service.Session", side_effect=lambda **_: session):
            token, meta = sub2api_service._fetch_access_token_for_account(server, "42")

        self.assertEqual(token, "access-secret")
        self.assertEqual(meta["email"], "user@example.com")
        self.assertEqual(meta["plan_type"], "plus")
        self.assertEqual(session.get_calls[0]["url"], "https://sub2api.example/api/v1/admin/accounts/data")
        self.assertEqual(session.get_calls[0]["params"], {"ids": "42", "include_proxies": "false"})
        self.assertTrue(session.closed)


if __name__ == "__main__":
    unittest.main()
