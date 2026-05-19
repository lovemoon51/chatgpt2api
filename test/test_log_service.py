from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from services.log_service import LOG_TYPE_CALL, REDACTED_VALUE, LogService


class LogServiceSecurityTests(unittest.TestCase):
    def _service(self, path: Path, retention_max_entries: int = 100) -> LogService:
        return LogService(path, retention_max_entries=retention_max_entries)

    def test_add_redacts_sensitive_values_before_writing_and_listing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "logs.jsonl"
            service = self._service(path)

            service.add(
                LOG_TYPE_CALL,
                "Authorization: Bearer user-secret-token x-api-key=header-secret sk-live-secretkey123",
                {
                    "headers": {
                        "Authorization": "Bearer auth-secret-token",
                        "x-api-key": "x-api-key-secret",
                    },
                    "access_token": "access-secret",
                    "refresh_token": "refresh-secret",
                    "session_token": "session-secret",
                    "error": "upstream rejected api_key=query-secret&access_token=query-access sk-proj-secret456",
                },
            )

            raw = path.read_text(encoding="utf-8")
            for secret in (
                "user-secret-token",
                "header-secret",
                "sk-live-secretkey123",
                "auth-secret-token",
                "x-api-key-secret",
                "access-secret",
                "refresh-secret",
                "session-secret",
                "query-secret",
                "query-access",
                "sk-proj-secret456",
            ):
                self.assertNotIn(secret, raw)

            item = json.loads(raw)
            self.assertIn(REDACTED_VALUE, item["summary"])
            self.assertEqual(item["detail"]["headers"]["Authorization"], REDACTED_VALUE)
            self.assertEqual(item["detail"]["headers"]["x-api-key"], REDACTED_VALUE)
            self.assertEqual(item["detail"]["access_token"], REDACTED_VALUE)

            listed = service.list()
            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0]["detail"]["refresh_token"], REDACTED_VALUE)
            self.assertNotIn("session-secret", json.dumps(listed, ensure_ascii=False))

    def test_list_redacts_legacy_plaintext_log_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "logs.jsonl"
            secret = "legacy-secret-token"
            path.write_text(
                json.dumps(
                    {
                        "id": "legacy",
                        "time": "2026-05-19 10:00:00",
                        "type": LOG_TYPE_CALL,
                        "summary": f"failed with Authorization: Bearer {secret}",
                        "detail": {"error": "x-api-key: legacy-api-secret", "access_token": secret},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            items = self._service(path).list()

            self.assertEqual(len(items), 1)
            rendered = json.dumps(items, ensure_ascii=False)
            self.assertNotIn(secret, rendered)
            self.assertNotIn("legacy-api-secret", rendered)
            self.assertEqual(items[0]["detail"]["access_token"], REDACTED_VALUE)

    def test_add_prunes_oldest_lines_after_retention_limit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "logs.jsonl"
            service = self._service(path, retention_max_entries=3)

            for index in range(5):
                service.add(LOG_TYPE_CALL, f"entry-{index}", {"index": index})

            raw_lines = path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(raw_lines), 3)
            stored = [json.loads(line) for line in raw_lines]
            self.assertEqual([item["detail"]["index"] for item in stored], [2, 3, 4])
            self.assertEqual([item["summary"] for item in service.list(limit=10)], ["entry-4", "entry-3", "entry-2"])


if __name__ == "__main__":
    unittest.main()
