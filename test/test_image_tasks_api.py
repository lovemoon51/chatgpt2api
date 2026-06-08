from __future__ import annotations

import base64
import tempfile
import unittest
from unittest import mock
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.image_tasks as image_tasks_module
from services.protocol.conversation import format_image_result
from services.usage_limit_service import UsageLimitError


AUTH_HEADERS = {"Authorization": "Bearer chatgpt2api"}
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


async def _noop_filter(*_args, **_kwargs):
    return None


class FakeImageTaskService:
    def __init__(self):
        self.generation_calls = []
        self.edit_calls = []
        self.video_calls = []
        self.cancel_calls = []
        self.timing_calls = []
        self.releases = []

    def submit_generation(self, identity, **kwargs):
        if kwargs.get("acquire_usage_limit") is not None:
            kwargs["release_usage_limit"] = kwargs["acquire_usage_limit"]()
        self.generation_calls.append((identity, kwargs))
        return {
            "id": kwargs["client_task_id"],
            "status": "success",
            "phase": "success",
            "phase_label": "已完成",
            "mode": "generate",
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
            "timings": {"queue_wait_ms": 1, "worker_total_ms": 2},
            "timing_ms": {"queue_wait_ms": 1, "worker_total_ms": 2},
            "data": [{"url": f"{kwargs['base_url']}/images/fake.png"}],
        }

    def submit_edit(self, identity, **kwargs):
        if kwargs.get("acquire_usage_limit") is not None:
            kwargs["release_usage_limit"] = kwargs["acquire_usage_limit"]()
        self.edit_calls.append((identity, kwargs))
        return {
            "id": kwargs["client_task_id"],
            "status": "queued",
            "phase": "queued",
            "phase_label": "排队中",
            "mode": "edit",
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
            "timings": {},
            "timing_ms": {},
        }

    def submit_video(self, identity, **kwargs):
        if kwargs.get("acquire_usage_limit") is not None:
            kwargs["release_usage_limit"] = kwargs["acquire_usage_limit"]()
        self.video_calls.append((identity, kwargs))
        return {
            "id": kwargs["client_task_id"],
            "status": "queued",
            "phase": "queued",
            "phase_label": "排队中",
            "mode": "video",
            "media_type": "video",
            "model": kwargs["model"],
            "size": kwargs["size"],
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
            "timings": {},
            "timing_ms": {},
        }

    def cancel_task(self, identity, task_id):
        self.cancel_calls.append((identity, task_id))
        release = None
        for _identity, kwargs in [*self.generation_calls, *self.edit_calls]:
            if kwargs["client_task_id"] == task_id:
                release = kwargs.get("release_usage_limit")
                break
        if release is not None:
            release()
        return {
            "id": task_id,
            "status": "cancelled",
            "phase": "cancelled",
            "phase_label": "已取消",
            "mode": "generate",
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
            "timings": {"queue_wait_ms": 1, "worker_total_ms": 0},
            "timing_ms": {"queue_wait_ms": 1, "worker_total_ms": 0},
        }

    def report_timing(self, identity, task_id, **kwargs):
        self.timing_calls.append((identity, task_id, kwargs))
        if task_id == "missing":
            raise image_tasks_module.ImageTaskNotFound("image task not found")
        return {
            "id": task_id,
            "status": "success",
            "phase": "success",
            "phase_label": "已完成",
            "mode": "generate",
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
            "timings": {"queue_wait_ms": 1, "worker_total_ms": 2, kwargs["timing_key"]: int(kwargs["duration_ms"])},
            "timing_ms": {"queue_wait_ms": 1, "worker_total_ms": 2, kwargs["timing_key"]: int(kwargs["duration_ms"])},
            "data": [{"url": "http://testserver/images/fake.png"}],
        }

    def queue_overview(self):
        return {
            "queued": 1,
            "running": 2,
            "capacity": 100,
            "available": 97,
            "workers": 3,
            "oldest_queue_duration_ms": 42,
        }

    def list_tasks(self, _identity, ids, _base_url=""):
        return {
            "items": [
                {
                    "id": task_id,
                    "status": "success",
                    "phase": "success",
                    "phase_label": "已完成",
                    "mode": "generate",
                    "created_at": "2026-01-01 00:00:00",
                    "updated_at": "2026-01-01 00:00:00",
                    "timings": {"queue_wait_ms": 1, "worker_total_ms": 2},
                    "timing_ms": {"queue_wait_ms": 1, "worker_total_ms": 2},
                    "data": [{"url": "http://testserver/images/fake.png"}],
                }
                for task_id in ids
                if task_id != "missing"
            ],
            "missing_ids": [task_id for task_id in ids if task_id == "missing"],
        }


class ImageTasksApiTests(unittest.TestCase):
    def setUp(self):
        self.fake_service = FakeImageTaskService()
        self.limit_error = None
        self.service_patcher = mock.patch.object(image_tasks_module, "image_task_service", self.fake_service)
        self.service_patcher.start()
        self.addCleanup(self.service_patcher.stop)
        self.identity_patcher = mock.patch.object(
            image_tasks_module,
            "require_identity",
            return_value={"id": "admin", "name": "管理员", "role": "admin"},
        )
        self.identity_patcher.start()
        self.addCleanup(self.identity_patcher.stop)

        def acquire_limit(*_args, **_kwargs):
            if self.limit_error is not None:
                raise self.limit_error
            released = False

            def release():
                nonlocal released
                if released:
                    return
                released = True
                self.fake_service.releases.append("released")

            return release

        self.limits_patcher = mock.patch.object(image_tasks_module.usage_limit_service, "acquire", acquire_limit)
        self.limits_patcher.start()
        self.addCleanup(self.limits_patcher.stop)
        self.filter_patcher = mock.patch.object(image_tasks_module, "filter_or_log", _noop_filter)
        self.filter_patcher.start()
        self.addCleanup(self.filter_patcher.stop)
        app = FastAPI()
        app.include_router(image_tasks_module.create_router())
        self.client = TestClient(app)

    def test_create_generation_task(self):
        response = self.client.post(
            "/api/image-tasks/generations",
            headers=AUTH_HEADERS,
            json={"client_task_id": "task-1", "prompt": "cat", "model": "gpt-image-2"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["id"], "task-1")
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["phase"], "success")
        self.assertEqual(payload["timings"]["worker_total_ms"], 2)
        self.assertEqual(len(self.fake_service.generation_calls), 1)
        self.assertEqual(self.fake_service.releases, [])

    def test_create_public_generation_task_passes_public_flag(self):
        response = self.client.post(
            "/api/image-tasks/generations",
            headers=AUTH_HEADERS,
            json={"client_task_id": "task-public", "prompt": "cat", "model": "gpt-image-2", "public": True},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.fake_service.generation_calls), 1)
        self.assertIs(self.fake_service.generation_calls[0][1]["public"], True)

    def test_create_generation_task_passes_resolution_and_uses_credit_cost(self):
        captured_amounts = []

        def consume(_identity, _release, *, amount=1):
            captured_amounts.append(amount)

        with mock.patch.object(image_tasks_module, "consume_persistent_image_quota", consume):
            response = self.client.post(
                "/api/image-tasks/generations",
                headers=AUTH_HEADERS,
                json={"client_task_id": "task-2k", "prompt": "cat", "model": "gpt-image-2", "resolution": "2K"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(captured_amounts, [2])
        self.assertEqual(self.fake_service.generation_calls[0][1]["resolution"], "2k")

    def test_create_generation_task_rejects_unknown_resolution(self):
        response = self.client.post(
            "/api/image-tasks/generations",
            headers=AUTH_HEADERS,
            json={"client_task_id": "task-8k", "prompt": "cat", "model": "gpt-image-2", "resolution": "8k"},
        )

        self.assertEqual(response.status_code, 400, response.text)

    def test_create_edit_task_passes_resolution_and_uses_credit_cost(self):
        captured_amounts = []

        def consume(_identity, _release, *, amount=1):
            captured_amounts.append(amount)

        with mock.patch.object(image_tasks_module, "consume_persistent_image_quota", consume):
            response = self.client.post(
                "/api/image-tasks/edits",
                headers=AUTH_HEADERS,
                data={"client_task_id": "edit-4k", "prompt": "edit", "model": "gpt-image-2", "resolution": "4K"},
                files=[("image", ("one.png", b"one", "image/png"))],
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(captured_amounts, [3])
        self.assertEqual(self.fake_service.edit_calls[0][1]["resolution"], "4k")

    def test_create_edit_task_rejects_unknown_resolution(self):
        response = self.client.post(
            "/api/image-tasks/edits",
            headers=AUTH_HEADERS,
            data={"client_task_id": "edit-8k", "prompt": "edit", "model": "gpt-image-2", "resolution": "8k"},
            files=[("image", ("one.png", b"one", "image/png"))],
        )

        self.assertEqual(response.status_code, 400, response.text)

    def test_create_edit_task_accepts_multiple_images(self):
        response = self.client.post(
            "/api/image-tasks/edits",
            headers=AUTH_HEADERS,
            data={"client_task_id": "edit-1", "prompt": "edit", "model": "gpt-image-2"},
            files=[
                ("image", ("one.png", b"one", "image/png")),
                ("image", ("two.png", b"two", "image/png")),
            ],
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["id"], "edit-1")
        self.assertEqual(len(self.fake_service.edit_calls), 1)
        images = self.fake_service.edit_calls[0][1]["images"]
        self.assertEqual(len(images), 2)

    def test_create_public_edit_task_passes_public_flag(self):
        response = self.client.post(
            "/api/image-tasks/edits",
            headers=AUTH_HEADERS,
            data={"client_task_id": "edit-public", "prompt": "edit", "model": "gpt-image-2", "public": "true"},
            files=[("image", ("one.png", b"one", "image/png"))],
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.fake_service.edit_calls), 1)
        self.assertIs(self.fake_service.edit_calls[0][1]["public"], True)

    def test_create_edit_task_skips_ai_review_for_outpaint_prompt(self):
        review_calls = []

        async def record_filter(_call, text, **kwargs):
            review_calls.append((text, kwargs.get("skip_ai_review")))

        self.filter_patcher.stop()
        try:
            with mock.patch.object(image_tasks_module, "filter_or_log", side_effect=record_filter):
                response = self.client.post(
                    "/api/image-tasks/edits",
                    headers=AUTH_HEADERS,
                    data={"client_task_id": "edit-outpaint", "prompt": "扩展这张图", "model": "gpt-image-2", "size": "16:9", "resolution": "4K"},
                    files=[("image", ("one.png", b"one", "image/png"))],
                )
        finally:
            self.filter_patcher.start()

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(review_calls, [("扩展这张图", True)])
        self.assertEqual(len(self.fake_service.edit_calls), 1)
        self.assertEqual(self.fake_service.edit_calls[0][1]["size"], "16:9")
        self.assertEqual(self.fake_service.edit_calls[0][1]["resolution"], "4k")

    def test_create_edit_task_still_reviews_non_outpaint_prompt(self):
        review_calls = []

        async def record_filter(_call, text, **kwargs):
            review_calls.append((text, kwargs.get("skip_ai_review")))

        self.filter_patcher.stop()
        try:
            with mock.patch.object(image_tasks_module, "filter_or_log", side_effect=record_filter):
                response = self.client.post(
                    "/api/image-tasks/edits",
                    headers=AUTH_HEADERS,
                    data={"client_task_id": "edit-normal", "prompt": "把背景改成夜晚", "model": "gpt-image-2"},
                    files=[("image", ("one.png", b"one", "image/png"))],
                )
        finally:
            self.filter_patcher.start()

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(review_calls, [("把背景改成夜晚", False)])

    def test_create_video_task_passes_reference_urls(self):
        response = self.client.post(
            "/api/image-tasks/videos",
            headers=AUTH_HEADERS,
            json={
                "client_task_id": "video-1",
                "prompt": "animate the product",
                "model": "agnes-video-v2.0",
                "size": "16:9",
                "reference_image_urls": ["https://cdn.example.test/product.png"],
                "duration_seconds": 12,
                "resolution": "720p",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["id"], "video-1")
        self.assertEqual(payload["mode"], "video")
        self.assertEqual(payload["media_type"], "video")
        self.assertEqual(len(self.fake_service.video_calls), 1)
        self.assertEqual(self.fake_service.video_calls[0][1]["model"], "agnes-video-v2.0")
        self.assertEqual(self.fake_service.video_calls[0][1]["size"], "16:9")
        self.assertEqual(self.fake_service.video_calls[0][1]["reference_image_urls"], ["https://cdn.example.test/product.png"])
        self.assertEqual(self.fake_service.video_calls[0][1]["duration_seconds"], 12)
        self.assertEqual(self.fake_service.video_calls[0][1]["resolution"], "720p")

    def test_create_video_task_passes_custom_resolution(self):
        response = self.client.post(
            "/api/image-tasks/videos",
            headers=AUTH_HEADERS,
            json={
                "client_task_id": "video-custom",
                "prompt": "animate the product",
                "model": "agnes-video-v2.0",
                "size": "16:9",
                "duration_seconds": 16,
                "resolution": "custom",
                "custom_width": 1024,
                "custom_height": 576,
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        call = self.fake_service.video_calls[0][1]
        self.assertEqual(call["duration_seconds"], 16)
        self.assertEqual(call["resolution"], "custom")
        self.assertEqual(call["custom_width"], 1024)
        self.assertEqual(call["custom_height"], 576)

    def test_cancel_task_releases_background_limit(self):
        create_response = self.client.post(
            "/api/image-tasks/generations",
            headers=AUTH_HEADERS,
            json={"client_task_id": "task-1", "prompt": "cat", "model": "gpt-image-2"},
        )
        self.assertEqual(create_response.status_code, 200, create_response.text)

        cancel_response = self.client.delete("/api/image-tasks/task-1", headers=AUTH_HEADERS)

        self.assertEqual(cancel_response.status_code, 200, cancel_response.text)
        self.assertEqual(cancel_response.json()["status"], "cancelled")
        self.assertEqual(self.fake_service.releases, ["released"])
        self.assertEqual(self.fake_service.cancel_calls[0][1], "task-1")

    def test_report_task_timing_returns_updated_task(self):
        response = self.client.post(
            "/api/image-tasks/task-1/timings",
            headers=AUTH_HEADERS,
            json={"timing_key": "frontend_render_ms", "duration_ms": 456, "phase": "image_onload"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["id"], "task-1")
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["timings"]["frontend_render_ms"], 456)
        self.assertEqual(self.fake_service.timing_calls[0][1], "task-1")

    def test_report_task_timing_missing_task_returns_404(self):
        response = self.client.post(
            "/api/image-tasks/missing/timings",
            headers=AUTH_HEADERS,
            json={"timing_key": "frontend_render_ms", "duration_ms": 456},
        )

        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()["detail"]["error"], "image task not found")

    def test_report_task_timing_requires_auth(self):
        self.identity_patcher.stop()
        try:
            response = self.client.post(
                "/api/image-tasks/task-1/timings",
                json={"timing_key": "frontend_render_ms", "duration_ms": 456},
            )
        finally:
            self.identity_patcher.start()

        self.assertEqual(response.status_code, 401, response.text)

    def test_queue_overview_endpoint(self):
        response = self.client.get("/api/image-tasks/queue", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["queued"], 1)
        self.assertEqual(payload["running"], 2)
        self.assertEqual(payload["workers"], 3)

    def test_generation_limit_error_uses_openai_error_shape(self):
        self.limit_error = UsageLimitError("concurrency limit exceeded", status_code=429)

        response = self.client.post(
            "/api/image-tasks/generations",
            headers=AUTH_HEADERS,
            json={"client_task_id": "task-1", "prompt": "cat", "model": "gpt-image-2"},
        )

        self.assertEqual(response.status_code, 429, response.text)
        self.assertEqual(response.json()["error"]["message"], "concurrency limit exceeded")
        self.assertEqual(response.json()["error"]["code"], "usage_limit_exceeded")

    def test_list_tasks_reports_missing_ids(self):
        response = self.client.get("/api/image-tasks?ids=task-1,missing", headers=AUTH_HEADERS)

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual([item["id"] for item in payload["items"]], ["task-1"])
        self.assertEqual(payload["missing_ids"], ["missing"])


class ImageTaskPublicPersistenceTests(unittest.TestCase):
    def test_public_image_result_tags_saved_images_for_discover(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            tags_file = tmp_path / "image_tags.json"
            assets_file = tmp_path / "image_assets.json"

            with (
                mock.patch("services.config.DATA_DIR", tmp_path),
                mock.patch("services.protocol.conversation.config.cleanup_old_images", lambda: None),
                mock.patch("services.image_tags_service.TAGS_FILE", tags_file),
                mock.patch("services.image_asset_service.IMAGE_ASSETS_FILE", assets_file),
            ):
                result = format_image_result(
                    [{"b64_json": base64.b64encode(PNG_BYTES).decode("ascii"), "revised_prompt": "revised cat"}],
                    "cat",
                    "url",
                    "http://testserver",
                    owner_identity={"id": "user-1", "name": "Creator", "role": "user"},
                    model="gpt-image-2",
                    size="1024x1024",
                    mode="generate",
                    source_task_id="task-public",
                    public=True,
                )
                self.assertEqual(len(result["data"]), 1)

                from services.image_tags_service import load_tags

                tags = load_tags()
            self.assertEqual(len(tags), 1)
            self.assertEqual(next(iter(tags.values())), ["public", "discover"])


if __name__ == "__main__":
    unittest.main()
