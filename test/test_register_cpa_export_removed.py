from __future__ import annotations

import io
import json
import base64
import unittest
import zipfile
from unittest import mock

from fastapi.testclient import TestClient

from api.app import create_app
from services.config import config as app_config
from services.cpa_export_service import account_to_cpa_item, build_cpa_export_zip, build_cpa_auth_filename


def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {app_config.auth_key}"}


def decode_jwt_payload(token: str) -> dict:
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


class CpaExportTests(unittest.TestCase):
    def test_register_config_no_longer_exposes_cpa_auto_import(self) -> None:
        from services.register_service import _default_config

        config = _default_config()

        self.assertNotIn("cpa_auto_import", config)

    def test_cpa_item_matches_export_script_mapping(self) -> None:
        item = account_to_cpa_item(
            {
                "access_token": "access",
                "account_id": "account-1",
                "user_id": "user-1",
                "type": "plus",
                "email": "user@example.com",
                "expires": "2026-05-18T19:00:44.047695+00:00",
                "session_token": "session-1",
            },
            now_epoch=1000,
        )

        self.assertEqual(item["access_token"], "access")
        self.assertEqual(item["account_id"], "account-1")
        self.assertEqual(item["email"], "user@example.com")
        self.assertEqual(item["expired"], "2026-05-18T19:00:44.047695+00:00")
        self.assertEqual(item["chatgpt_account_id"], "account-1")
        self.assertEqual(item["plan_type"], "plus")
        self.assertEqual(item["chatgpt_plan_type"], "plus")
        self.assertEqual(item["session_token"], "session-1")
        self.assertEqual(item["last_refresh"], "")
        self.assertEqual(item["refresh_token"], "")
        self.assertEqual(item["type"], "codex")
        self.assertFalse(item["disabled"])
        self.assertTrue(item["id_token_synthetic"])

        id_payload = decode_jwt_payload(item["id_token"])
        self.assertEqual(id_payload["iat"], 1000)
        self.assertEqual(id_payload["email"], "user@example.com")
        self.assertEqual(id_payload["https://api.openai.com/auth"]["chatgpt_account_id"], "account-1")
        self.assertEqual(id_payload["https://api.openai.com/auth"]["chatgpt_user_id"], "user-1")

    def test_cpa_filename_matches_session_to_json_convention(self) -> None:
        self.assertEqual(
            build_cpa_auth_filename({"email": "user@example.com", "plan_type": "free"}),
            "codex-user@example.com-free.json",
        )

    def test_cpa_export_zip_uses_batch_folders(self) -> None:
        items = [
            {"access_token": f"token-{idx}", "email": f"user-{idx}@example.com", "status": "正常", "type": "free"}
            for idx in range(1, 102)
        ]

        buf = build_cpa_export_zip(items)

        with zipfile.ZipFile(buf) as zf:
            names = zf.namelist()
            self.assertIn("batch_1/codex-user-1@example.com-free.json", names)
            self.assertIn("batch_1/codex-user-100@example.com-free.json", names)
            self.assertIn("batch_2/codex-user-101@example.com-free.json", names)

    def test_accounts_api_exports_cpa_zip(self) -> None:
        app = create_app()
        client = TestClient(app)
        accounts = [
            {
                "access_token": "token-one",
                "account_id": "account-one",
                "user_id": "user-one",
                "type": "free",
                "status": "正常",
                "email": "one@example.com",
                "restore_at": "2026-05-18T19:00:44.047695+00:00",
                "last_used_at": None,
            },
            {
                "access_token": "token-two",
                "account_id": "account-two",
                "user_id": "user-two",
                "type": "plus",
                "status": "禁用",
                "email": "two@example.com",
                "restore_at": "",
                "last_used_at": "",
            },
        ]

        with mock.patch("api.accounts.account_service.list_accounts", return_value=accounts):
            response = client.post(
                "/api/accounts/export/cpa",
                headers=auth_headers(),
                json={"access_tokens": ["token-two"]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            self.assertEqual(zf.namelist(), ["batch_1/codex-two@example.com-plus.json"])
            payload = json.loads(zf.read("batch_1/codex-two@example.com-plus.json").decode("utf-8"))

        self.assertEqual(payload["access_token"], "token-two")
        self.assertEqual(payload["account_id"], "account-two")
        self.assertFalse(payload["disabled"])
        self.assertEqual(payload["refresh_token"], "")
        self.assertEqual(payload["type"], "codex")
        self.assertTrue(payload["id_token_synthetic"])


if __name__ == "__main__":
    unittest.main()
