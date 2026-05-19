from __future__ import annotations

import json
import unittest
from unittest import mock

from services import cpa_service


class FakeResponse:
    ok = True
    status_code = 200

    def json(self) -> dict:
        return {"ok": True}


class FakeSession:
    def __init__(self) -> None:
        self.post_call: dict | None = None
        self.delete_call: dict | None = None
        self.closed = False

    def post(self, url: str, **kwargs):
        self.post_call = {"url": url, **kwargs}
        return FakeResponse()

    def delete(self, url: str, **kwargs):
        self.delete_call = {"url": url, **kwargs}
        return FakeResponse()

    def close(self) -> None:
        self.closed = True


class FakeMultipart:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class CPAUploadServiceTests(unittest.TestCase):
    def test_upload_auth_file_posts_session_to_json_payload(self) -> None:
        session = FakeSession()
        multipart = FakeMultipart()
        pool = {
            "id": "pool-1",
            "name": "主池",
            "base_url": "https://cpa.example.test/",
            "secret_key": "secret",
        }
        account = {
            "access_token": "access",
            "account_id": "account-1",
            "user_id": "user-1",
            "email": "user@example.com",
            "type": "free",
            "expires": "2026-05-18T19:00:44+00:00",
        }

        with (
            mock.patch("services.cpa_service.Session", side_effect=lambda **_: session),
            mock.patch("services.cpa_service.CurlMime.from_list", return_value=multipart) as from_list,
        ):
            result = cpa_service.upload_auth_file(pool, account)

        self.assertEqual(result["filename"], "codex-user@example.com-free.json")
        self.assertTrue(session.closed)
        self.assertTrue(multipart.closed)
        self.assertIsNotNone(session.post_call)
        assert session.post_call is not None
        self.assertEqual(session.post_call["url"], "https://cpa.example.test/v0/management/auth-files")
        self.assertEqual(session.post_call["headers"]["Authorization"], "Bearer secret")
        self.assertIs(session.post_call["multipart"], multipart)
        from_list.assert_called_once()
        part = from_list.call_args.args[0][0]
        self.assertEqual(part["name"], "file")
        self.assertEqual(part["filename"], "codex-user@example.com-free.json")
        self.assertEqual(part["content_type"], "application/json")
        content = part["data"]
        payload = json.loads(content.decode("utf-8"))
        self.assertEqual(payload["access_token"], "access")
        self.assertEqual(payload["account_id"], "account-1")
        self.assertEqual(payload["chatgpt_plan_type"], "free")
        self.assertTrue(payload["id_token_synthetic"])

    def test_upload_account_to_configured_pools_collects_errors(self) -> None:
        pools = [
            {"id": "ok", "name": "ok", "base_url": "https://ok.example", "secret_key": "secret"},
            {"id": "bad", "name": "bad", "base_url": "https://bad.example", "secret_key": "secret"},
            {"id": "ignored", "name": "ignored", "base_url": "", "secret_key": "secret"},
        ]

        with (
            mock.patch.object(cpa_service.cpa_config, "list_pools", return_value=pools),
            mock.patch(
                "services.cpa_service.upload_auth_file",
                side_effect=[{"pool_id": "ok", "filename": "a.json"}, RuntimeError("upload failed")],
            ),
        ):
            result = cpa_service.upload_account_to_configured_pools({"access_token": "access"})

        self.assertEqual(result["configured"], 2)
        self.assertEqual(result["uploaded"], 1)
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(result["errors"][0]["pool_id"], "bad")
        self.assertIn("upload failed", result["errors"][0]["error"])

    def test_delete_remote_auth_file_deletes_by_name(self) -> None:
        session = FakeSession()
        pool = {
            "id": "pool-1",
            "name": "主池",
            "base_url": "https://cpa.example.test/",
            "secret_key": "secret",
        }

        with mock.patch("services.cpa_service.Session", side_effect=lambda **_: session):
            result = cpa_service.delete_remote_auth_file(pool, "codex-user@example.com-free.json")

        self.assertTrue(session.closed)
        self.assertIsNotNone(session.delete_call)
        assert session.delete_call is not None
        self.assertEqual(session.delete_call["url"], "https://cpa.example.test/v0/management/auth-files")
        self.assertEqual(session.delete_call["headers"]["Authorization"], "Bearer secret")
        self.assertEqual(session.delete_call["params"], {"name": "codex-user@example.com-free.json"})
        self.assertEqual(result["filename"], "codex-user@example.com-free.json")

    def test_delete_account_from_configured_pools_collects_errors(self) -> None:
        pools = [
            {"id": "ok", "name": "ok", "base_url": "https://ok.example", "secret_key": "secret"},
            {"id": "bad", "name": "bad", "base_url": "https://bad.example", "secret_key": "secret"},
            {"id": "ignored", "name": "ignored", "base_url": "", "secret_key": "secret"},
        ]

        with (
            mock.patch.object(cpa_service.cpa_config, "list_pools", return_value=pools),
            mock.patch(
                "services.cpa_service.delete_remote_auth_file",
                side_effect=[{"pool_id": "ok", "filename": "a.json"}, RuntimeError("delete failed")],
            ),
        ):
            result = cpa_service.delete_account_from_configured_pools({
                "access_token": "access",
                "email": "user@example.com",
                "type": "free",
            })

        self.assertEqual(result["configured"], 2)
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["filename"], "codex-user@example.com-free.json")
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(result["errors"][0]["pool_id"], "bad")
        self.assertIn("delete failed", result["errors"][0]["error"])


if __name__ == "__main__":
    unittest.main()
