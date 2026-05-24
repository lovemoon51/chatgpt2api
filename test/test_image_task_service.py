from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path
from threading import Event

from services.image_task_service import ImageTaskQueueFull, ImageTaskService


OWNER = {"id": "owner-1", "name": "Owner", "role": "admin"}
OTHER_OWNER = {"id": "owner-2", "name": "Other", "role": "user"}


def wait_for_task(service: ImageTaskService, identity: dict[str, object], task_id: str, status: str, timeout: float = 2.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        result = service.list_tasks(identity, [task_id])
        last = (result.get("items") or [None])[0]
        if last and last.get("status") == status:
            return last
        time.sleep(0.02)
    raise AssertionError(f"task {task_id} did not reach {status}, last={last}")


class ImageTaskServiceTests(unittest.TestCase):
    def make_service(self, path: Path, handler=None, *, worker_count: int = 3, max_queue_size: int = 100) -> ImageTaskService:
        return ImageTaskService(
            path,
            generation_handler=handler or (lambda _payload: {"data": [{"url": "http://example.test/image.png"}]}),
            edit_handler=handler or (lambda _payload: {"data": [{"url": "http://example.test/edit.png"}]}),
            retention_days_getter=lambda: 30,
            worker_count=worker_count,
            max_queue_size=max_queue_size,
        )

    def test_duplicate_submit_uses_existing_task(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            calls = 0

            def handler(_payload):
                nonlocal calls
                calls += 1
                time.sleep(0.05)
                return {"data": [{"url": "http://example.test/image.png"}]}

            service = self.make_service(Path(tmp_dir) / "image_tasks.json", handler)
            first = service.submit_generation(
                OWNER,
                client_task_id="task-1",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )
            second = service.submit_generation(
                OWNER,
                client_task_id="task-1",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )

            self.assertEqual(first["id"], "task-1")
            self.assertEqual(second["id"], "task-1")
            task = wait_for_task(service, OWNER, "task-1", "success")
            self.assertEqual(task["data"][0]["url"], "http://example.test/image.png")
            self.assertEqual(calls, 1)

    def test_success_task_reports_timing_breakdown(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = self.make_service(Path(tmp_dir) / "image_tasks.json")
            service.submit_generation(
                OWNER,
                client_task_id="timed-task",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )

            task = wait_for_task(service, OWNER, "timed-task", "success")

            self.assertIsInstance(task["duration_ms"], int)
            self.assertGreaterEqual(task["duration_ms"], 0)
            self.assertIsInstance(task["queue_duration_ms"], int)
            self.assertGreaterEqual(task["queue_duration_ms"], 0)
            self.assertEqual(task["phase"], "success")
            self.assertEqual(task["phase_label"], "已完成")
            self.assertIsInstance(task["timings"], dict)
            self.assertIsInstance(task["timing_ms"], dict)
            self.assertGreaterEqual(task["timings"]["queue_wait_ms"], 0)
            self.assertGreaterEqual(task["timings"]["worker_total_ms"], 0)
            self.assertTrue(task["queued_at"])
            self.assertTrue(task["started_at"])
            self.assertTrue(task["finished_at"])
            overview = service.queue_overview()
            self.assertEqual(overview["total"], 1)
            self.assertIsInstance(overview["p90_wait_ms"], int)
            self.assertIsInstance(overview["p99_duration_ms"], int)

    def test_progress_callback_updates_phase_timings_and_ignores_bad_events(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            callbacks = []

            def handler(payload):
                callback = payload.get("progress_callback")
                callbacks.append(callback)
                callback(
                    {
                        "phase": "uploading",
                        "label": "上传中",
                        "timing_key": "upload_ms",
                        "duration_ms": 123,
                        "metadata": {"step": "upload"},
                    }
                )
                callback("bad-event")
                return {"data": [{"url": "http://example.test/image.png"}]}

            service = self.make_service(Path(tmp_dir) / "image_tasks.json", handler)
            service.submit_generation(
                OWNER,
                client_task_id="progress-task",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )

            task = wait_for_task(service, OWNER, "progress-task", "success")

            self.assertTrue(callable(callbacks[0]))
            self.assertEqual(task["phase"], "success")
            self.assertEqual(task["timings"]["upload_ms"], 123)
            self.assertIn("worker_elapsed_ms", task["timings"])

    def test_report_timing_appends_frontend_render_to_success_task(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = self.make_service(Path(tmp_dir) / "image_tasks.json")
            service.submit_generation(
                OWNER,
                client_task_id="frontend-task",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )
            wait_for_task(service, OWNER, "frontend-task", "success")

            updated = service.report_timing(
                OWNER,
                "frontend-task",
                timing_key="frontend_render_ms",
                duration_ms=456,
                phase="image_onload",
            )

            self.assertEqual(updated["status"], "success")
            self.assertEqual(updated["phase"], "success")
            self.assertEqual(updated["timings"]["frontend_render_ms"], 456)
            self.assertEqual(updated["timing_ms"]["frontend_render_ms"], 456)
            self.assertEqual(updated["timings"]["worker_total_ms"], updated["duration_ms"])

    def test_report_timing_rejects_bad_duration_without_polluting_task(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = self.make_service(Path(tmp_dir) / "image_tasks.json")
            service.submit_generation(
                OWNER,
                client_task_id="bad-duration-task",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )
            wait_for_task(service, OWNER, "bad-duration-task", "success")

            with self.assertRaises(ValueError):
                service.report_timing(
                    OWNER,
                    "bad-duration-task",
                    timing_key="frontend_render_ms",
                    duration_ms=-1,
                )

            task = service.list_tasks(OWNER, ["bad-duration-task"])["items"][0]
            self.assertNotIn("frontend_render_ms", task["timings"])

    def test_report_timing_records_terminal_error_and_cancelled_without_status_change(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "image_tasks.json"
            now = time.strftime("%Y-%m-%d %H:%M:%S")
            path.write_text(
                json.dumps(
                    {
                        "tasks": [
                            {
                                "id": "error-task",
                                "owner_id": "owner-1",
                                "status": "error",
                                "phase": "error",
                                "mode": "generate",
                                "model": "gpt-image-2",
                                "created_at": now,
                                "updated_at": now,
                                "duration_ms": 10,
                            },
                            {
                                "id": "cancelled-task",
                                "owner_id": "owner-1",
                                "status": "cancelled",
                                "phase": "cancelled",
                                "mode": "generate",
                                "model": "gpt-image-2",
                                "created_at": now,
                                "updated_at": now,
                                "duration_ms": 0,
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )
            service = self.make_service(path)

            error_task = service.report_timing(OWNER, "error-task", timing_key="reveal_duration_ms", duration_ms=11)
            cancelled_task = service.report_timing(OWNER, "cancelled-task", timing_key="frontend_render_ms", duration_ms=22)

            self.assertEqual(error_task["status"], "error")
            self.assertEqual(error_task["phase"], "error")
            self.assertEqual(error_task["timings"]["reveal_duration_ms"], 11)
            self.assertEqual(cancelled_task["status"], "cancelled")
            self.assertEqual(cancelled_task["phase"], "cancelled")
            self.assertEqual(cancelled_task["timings"]["frontend_render_ms"], 22)

    def test_report_timing_for_other_owner_is_not_found(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = self.make_service(Path(tmp_dir) / "image_tasks.json")
            service.submit_generation(
                OWNER,
                client_task_id="private-timing-task",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )
            wait_for_task(service, OWNER, "private-timing-task", "success")

            with self.assertRaises(KeyError):
                service.report_timing(
                    OTHER_OWNER,
                    "private-timing-task",
                    timing_key="frontend_render_ms",
                    duration_ms=456,
                )

    def test_task_payload_includes_source_task_id(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            payloads = []

            def handler(payload):
                payloads.append(payload)
                return {"data": [{"url": "http://example.test/image.png"}]}

            service = self.make_service(Path(tmp_dir) / "image_tasks.json", handler)
            service.submit_generation(
                OWNER,
                client_task_id="source-task",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )

            wait_for_task(service, OWNER, "source-task", "success")

            self.assertEqual(payloads[0]["source_task_id"], "source-task")

    def test_single_worker_leaves_later_tasks_queued(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            started = Event()
            release = Event()

            def handler(_payload):
                started.set()
                release.wait(2)
                return {"data": [{"url": "http://example.test/image.png"}]}

            service = self.make_service(Path(tmp_dir) / "image_tasks.json", handler, worker_count=1, max_queue_size=2)
            service.submit_generation(
                OWNER,
                client_task_id="task-1",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )
            self.assertTrue(started.wait(1))
            second = service.submit_generation(
                OWNER,
                client_task_id="task-2",
                prompt="dog",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )

            self.assertEqual(second["status"], "queued")
            overview = service.queue_overview()
            self.assertEqual(overview["queued"], 1)
            self.assertEqual(overview["running"], 1)
            self.assertEqual(overview["phase_counts"]["queued"], 1)
            self.assertEqual(overview["polling"], 1)
            release.set()
            wait_for_task(service, OWNER, "task-2", "success")

    def test_queue_full_rejects_new_task_and_releases_limit(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            started = Event()
            release = Event()
            release_calls = 0

            def release_limit():
                nonlocal release_calls
                release_calls += 1

            def handler(_payload):
                started.set()
                release.wait(2)
                return {"data": [{"url": "http://example.test/image.png"}]}

            service = self.make_service(Path(tmp_dir) / "image_tasks.json", handler, worker_count=1, max_queue_size=1)
            service.submit_generation(
                OWNER,
                client_task_id="task-1",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )
            self.assertTrue(started.wait(1))
            service.submit_generation(
                OWNER,
                client_task_id="task-2",
                prompt="dog",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )

            with self.assertRaisesRegex(ImageTaskQueueFull, "queue is full"):
                service.submit_generation(
                    OWNER,
                    client_task_id="task-3",
                    prompt="bird",
                    model="gpt-image-2",
                    size=None,
                    base_url="http://local.test",
                    release_usage_limit=release_limit,
                )
            self.assertEqual(release_calls, 1)
            result = service.list_tasks(OWNER, ["task-3"])
            self.assertEqual(result["items"], [])
            self.assertEqual(result["missing_ids"], ["task-3"])
            release.set()
            wait_for_task(service, OWNER, "task-2", "success")

    def test_cancel_queued_task_releases_limit_and_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            started = Event()
            release = Event()
            release_calls = 0

            def release_limit():
                nonlocal release_calls
                release_calls += 1

            def handler(_payload):
                started.set()
                release.wait(2)
                return {"data": [{"url": "http://example.test/image.png"}]}

            service = self.make_service(Path(tmp_dir) / "image_tasks.json", handler, worker_count=1, max_queue_size=2)
            service.submit_generation(
                OWNER,
                client_task_id="task-1",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )
            self.assertTrue(started.wait(1))
            service.submit_generation(
                OWNER,
                client_task_id="task-2",
                prompt="dog",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
                release_usage_limit=release_limit,
            )

            cancelled = service.cancel_task(OWNER, "task-2")

            self.assertEqual(cancelled["status"], "cancelled")
            self.assertEqual(cancelled["phase"], "cancelled")
            self.assertEqual(cancelled["timings"]["worker_total_ms"], 0)
            self.assertEqual(release_calls, 1)
            release.set()
            time.sleep(0.05)
            task = service.list_tasks(OWNER, ["task-2"])["items"][0]
            self.assertEqual(task["status"], "cancelled")

    def test_cancel_running_task_finishes_as_cancelled_and_releases_limit(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            started = Event()
            release = Event()
            release_calls = 0

            def release_limit():
                nonlocal release_calls
                release_calls += 1

            def handler(_payload):
                started.set()
                release.wait(2)
                return {"data": [{"url": "http://example.test/image.png"}]}

            service = self.make_service(Path(tmp_dir) / "image_tasks.json", handler, worker_count=1)
            service.submit_generation(
                OWNER,
                client_task_id="running-task",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
                release_usage_limit=release_limit,
            )
            running = wait_for_task(service, OWNER, "running-task", "running")
            self.assertEqual(running["status"], "running")

            requested = service.cancel_task(OWNER, "running-task")
            self.assertEqual(requested["status"], "running")
            release.set()
            cancelled = wait_for_task(service, OWNER, "running-task", "cancelled")

            self.assertEqual(cancelled["status"], "cancelled")
            self.assertEqual(cancelled["phase"], "cancelled")
            self.assertGreaterEqual(cancelled["timings"]["worker_total_ms"], 0)
            self.assertEqual(release_calls, 1)

    def test_different_owner_cannot_query_task(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = self.make_service(Path(tmp_dir) / "image_tasks.json")
            service.submit_generation(
                OWNER,
                client_task_id="private-task",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )

            wait_for_task(service, OWNER, "private-task", "success")
            result = service.list_tasks(OTHER_OWNER, ["private-task"])

            self.assertEqual(result["items"], [])
            self.assertEqual(result["missing_ids"], ["private-task"])

    def test_success_task_persists_to_new_service_instance(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "image_tasks.json"
            service = self.make_service(path)
            service.submit_generation(
                OWNER,
                client_task_id="persisted-task",
                prompt="cat",
                model="gpt-image-2",
                size=None,
                base_url="http://local.test",
            )
            wait_for_task(service, OWNER, "persisted-task", "success")

            reloaded = self.make_service(path)
            result = reloaded.list_tasks(OWNER, ["persisted-task"])

            self.assertEqual(result["missing_ids"], [])
            self.assertEqual(result["items"][0]["status"], "success")
            self.assertEqual(result["items"][0]["data"][0]["url"], "http://example.test/image.png")

    def test_startup_marks_unfinished_tasks_as_error(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "image_tasks.json"
            path.write_text(
                json.dumps(
                    {
                        "tasks": [
                            {
                                "id": "queued-task",
                                "owner_id": "owner-1",
                                "status": "queued",
                                "mode": "generate",
                                "model": "gpt-image-2",
                                "created_at": "2099-01-01 00:00:00",
                                "updated_at": "2099-01-01 00:00:00",
                            },
                            {
                                "id": "running-task",
                                "owner_id": "owner-1",
                                "status": "running",
                                "mode": "generate",
                                "model": "gpt-image-2",
                                "created_at": "2099-01-01 00:00:00",
                                "updated_at": "2099-01-01 00:00:00",
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )

            service = self.make_service(path)
            result = service.list_tasks(OWNER, ["queued-task", "running-task"])

            self.assertEqual([item["status"] for item in result["items"]], ["error", "error"])
            self.assertEqual([item["phase"] for item in result["items"]], ["error", "error"])
            self.assertTrue(all("已中断" in item.get("error", "") for item in result["items"]))


if __name__ == "__main__":
    unittest.main()
