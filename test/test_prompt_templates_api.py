from __future__ import annotations

import unittest
from unittest import mock

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import api.prompt_market as prompt_market_module
from services.prompt_template_service import (
    PromptTemplateNotFound,
    PromptTemplatePermissionError,
    PromptTemplateValidationError,
)


AUTH_HEADERS = {"Authorization": "Bearer test-user"}


class FakePromptTemplateService:
    def __init__(self):
        self.list_calls = []
        self.stats_calls = []
        self.create_calls = []
        self.review_calls = []
        self.favorite_calls = []
        self.unfavorite_calls = []

    def list(self, identity, **kwargs):
        self.list_calls.append((identity, kwargs))
        return {"items": []}

    def stats(self, identity):
        self.stats_calls.append(identity)
        return {"public": 0, "private": 0, "favorites": 0, "submissions": 0}

    def create(self, identity, payload):
        self.create_calls.append((identity, payload))
        return {
            "id": "template-1",
            "title": payload["title"],
            "description": payload.get("description", ""),
            "prompt": payload["prompt"],
            "model": payload.get("model", "gpt-image-2"),
            "size": payload.get("size", "1:1"),
            "count": payload.get("count", 1),
            "tags": payload.get("tags", []),
            "preview_image": payload.get("preview_image", {"url": ""}),
            "visibility": payload.get("visibility", "private"),
            "review_status": "draft",
        }

    def update(self, _identity, template_id, _payload):
        if template_id == "missing":
            raise PromptTemplateNotFound("prompt template not found")
        return {"id": template_id}

    def delete(self, _identity, template_id):
        if template_id == "forbidden":
            raise PromptTemplatePermissionError("template cannot be deleted")
        return {"ok": True}

    def favorite(self, identity, template_id):
        self.favorite_calls.append((identity, template_id))
        return {"id": template_id, "is_favorited": True}

    def unfavorite(self, identity, template_id):
        self.unfavorite_calls.append((identity, template_id))
        return {"id": template_id, "is_favorited": False}

    def review(self, identity, template_id, **kwargs):
        self.review_calls.append((identity, template_id, kwargs))
        if kwargs.get("action") == "reject" and not kwargs.get("reason"):
            raise PromptTemplateValidationError("rejection reason is required")
        return {"id": template_id, "review_status": "approved"}


class PromptTemplatesApiTests(unittest.TestCase):
    def setUp(self):
        self.fake_service = FakePromptTemplateService()
        self.service_patcher = mock.patch.object(prompt_market_module, "prompt_template_service", self.fake_service)
        self.identity_patcher = mock.patch.object(
            prompt_market_module,
            "require_identity",
            return_value={"id": "user-1", "name": "User", "role": "user"},
        )

        def require_admin(authorization, *, source="", interface="management"):
            if authorization == "Bearer admin":
                return {"id": "admin", "name": "Admin", "role": "admin"}
            raise HTTPException(status_code=403, detail={"error": "需要管理员权限才能执行这个操作"})

        self.admin_patcher = mock.patch.object(prompt_market_module, "require_admin", require_admin)
        self.service_patcher.start()
        self.identity_patcher.start()
        self.admin_patcher.start()
        self.addCleanup(self.service_patcher.stop)
        self.addCleanup(self.identity_patcher.stop)
        self.addCleanup(self.admin_patcher.stop)
        app = FastAPI()
        app.include_router(prompt_market_module.create_router())
        self.client = TestClient(app)

    def test_list_public_templates(self):
        response = self.client.get("/api/prompt-templates?scope=public", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["items"], [])
        self.assertEqual(self.fake_service.list_calls[0][1]["scope"], "public")

    def test_create_template_passes_identity_and_payload(self):
        response = self.client.post(
            "/api/prompt-templates",
            headers=AUTH_HEADERS,
            json={
                "title": "Portrait",
                "prompt": "cinematic portrait",
                "model": "gpt-image-2",
                "size": "1:1",
                "count": 2,
                "tags": ["人像"],
                "visibility": "private",
                "preview_image": {"url": "/images/one.png"},
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["item"]["title"], "Portrait")
        identity, payload = self.fake_service.create_calls[0]
        self.assertEqual(identity["id"], "user-1")
        self.assertEqual(payload["prompt"], "cinematic portrait")
        self.assertEqual(payload["preview_image"]["url"], "/images/one.png")

    def test_review_scope_requires_admin(self):
        response = self.client.get("/api/prompt-templates?scope=review", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 403, response.text)

    def test_admin_review_endpoint_calls_service(self):
        response = self.client.post(
            "/api/prompt-templates/template-1/review",
            headers={"Authorization": "Bearer admin"},
            json={"action": "approve"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["item"]["review_status"], "approved")
        self.assertEqual(self.fake_service.review_calls[0][0]["id"], "admin")
        self.assertEqual(self.fake_service.review_calls[0][1], "template-1")
        self.assertEqual(self.fake_service.review_calls[0][2]["action"], "approve")

    def test_rejection_without_reason_returns_400(self):
        response = self.client.post(
            "/api/prompt-templates/template-1/review",
            headers={"Authorization": "Bearer admin"},
            json={"action": "reject"},
        )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["detail"]["error"], "rejection reason is required")


if __name__ == "__main__":
    unittest.main()
