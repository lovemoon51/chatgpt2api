from __future__ import annotations

import os
import unittest
from unittest import mock

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import api.ai as ai_module

AUTH_HEADERS = {"Authorization": "Bearer user-key"}


class PromptOptimizeApiTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(ai_module.create_router())
        self.client = TestClient(app)

    def test_prompt_optimize_requires_authentication(self) -> None:
        with mock.patch.object(ai_module, "require_identity", side_effect=HTTPException(status_code=401, detail="Unauthorized")):
            response = self.client.post("/api/prompts/optimize", json={"prompt": "一只猫"})

        self.assertEqual(response.status_code, 401)

    def test_prompt_optimize_rejects_blank_prompt(self) -> None:
        with mock.patch.object(ai_module, "require_identity", return_value={"id": "user-1", "role": "user"}):
            response = self.client.post("/api/prompts/optimize", headers=AUTH_HEADERS, json={"prompt": "   "})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["param"], "prompt")

    def test_prompt_optimize_returns_optimized_prompt(self) -> None:
        async def fake_filter_or_log(_call, _text):
            return None

        class FakeUsageLimit:
            def __enter__(self):
                return lambda: None

            def __exit__(self, exc_type, exc, tb):
                return False

        with (
            mock.patch.object(ai_module, "require_identity", return_value={"id": "user-1", "role": "user"}),
            mock.patch.object(ai_module, "filter_or_log", side_effect=fake_filter_or_log),
            mock.patch.object(ai_module, "usage_limited_call", return_value=FakeUsageLimit()),
            mock.patch.object(ai_module, "optimize_image_prompt", return_value="电影感窗边猫咪，柔和逆光，细节丰富", create=True) as optimize,
        ):
            response = self.client.post(
                "/api/prompts/optimize",
                headers=AUTH_HEADERS,
                json={"prompt": "一只猫坐在窗边"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"optimized_prompt": "电影感窗边猫咪，柔和逆光，细节丰富", "model": "auto"},
        )
        optimize.assert_called_once_with("一只猫坐在窗边", model="auto")


if __name__ == "__main__":
    unittest.main()
