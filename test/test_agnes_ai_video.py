from __future__ import annotations

import unittest
from unittest import mock

from services.protocol import agnes_ai_video


class AgnesAIVideoTests(unittest.TestCase):
    def test_builds_text_to_video_payload(self) -> None:
        payload = agnes_ai_video.build_agnes_video_payload(
            agnes_ai_video.AgnesVideoRequest(
                prompt="A cinematic cat walks on the beach",
                size="16:9",
            )
        )

        self.assertEqual(payload["model"], "agnes-video-v2.0")
        self.assertEqual(payload["prompt"], "A cinematic cat walks on the beach")
        self.assertEqual(payload["width"], 1152)
        self.assertEqual(payload["height"], 768)
        self.assertEqual(payload["num_frames"], 121)
        self.assertEqual(payload["frame_rate"], 24)
        self.assertNotIn("image", payload)
        self.assertNotIn("extra_body", payload)

    def test_builds_image_to_video_payload(self) -> None:
        payload = agnes_ai_video.build_agnes_video_payload(
            agnes_ai_video.AgnesVideoRequest(
                prompt="Animate this product photo",
                image_urls=["https://cdn.example.test/product.png"],
            )
        )

        self.assertEqual(payload["image"], "https://cdn.example.test/product.png")
        self.assertNotIn("extra_body", payload)

    def test_builds_multi_image_video_payload(self) -> None:
        payload = agnes_ai_video.build_agnes_video_payload(
            agnes_ai_video.AgnesVideoRequest(
                prompt="Create a smooth transformation",
                image_urls=[
                    "https://cdn.example.test/start.png",
                    "https://cdn.example.test/end.png",
                ],
            )
        )

        self.assertEqual(payload["extra_body"], {
            "image": [
                "https://cdn.example.test/start.png",
                "https://cdn.example.test/end.png",
            ],
        })
        self.assertNotIn("image", payload)

    def test_rejects_non_public_image_references(self) -> None:
        with self.assertRaisesRegex(agnes_ai_video.AgnesAIVideoError, "publicly accessible"):
            agnes_ai_video.build_agnes_video_payload(
                agnes_ai_video.AgnesVideoRequest(
                    prompt="Animate this",
                    image_urls=["data:image/png;base64,aW1hZ2U="],
                )
            )

    def test_request_agnes_video_polls_completed_result(self) -> None:
        create_response = mock.Mock(status_code=200)
        create_response.json.return_value = {
            "id": "task_123",
            "object": "video",
            "model": agnes_ai_video.AGNES_VIDEO_MODEL,
            "status": "queued",
            "progress": 0,
        }
        poll_response = mock.Mock(status_code=200)
        poll_response.json.return_value = {
            "id": "task_123",
            "object": "video",
            "model": agnes_ai_video.AGNES_VIDEO_MODEL,
            "status": "completed",
            "progress": 100,
            "video_url": "https://cdn.example.test/result.mp4",
            "size": "1152x768",
            "seconds": "5.0",
        }

        with (
            mock.patch(
                "services.protocol.agnes_ai_video.agnes_ai_settings",
                return_value={
                    "api_keys": [{"name": "video-key", "api_key": "secret-key", "enabled": True}],
                    "base_url": "https://agnes.example/v1",
                },
            ),
            mock.patch("services.protocol.agnes_ai_video.requests.post", return_value=create_response) as post,
            mock.patch("services.protocol.agnes_ai_video.requests.get", return_value=poll_response) as get,
        ):
            result = agnes_ai_video.request_agnes_video(
                agnes_ai_video.AgnesVideoRequest(prompt="A cinematic cat walks")
            )

        self.assertEqual(result["data"], [{
            "url": "https://cdn.example.test/result.mp4",
            "video_url": "https://cdn.example.test/result.mp4",
            "revised_prompt": "A cinematic cat walks",
        }])
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer secret-key")
        self.assertEqual(get.call_args.kwargs["headers"]["Authorization"], "Bearer secret-key")
        self.assertEqual(get.call_args.args[0], "https://agnes.example/v1/videos/task_123")

    def test_request_agnes_video_raises_for_failed_task(self) -> None:
        create_response = mock.Mock(status_code=200)
        create_response.json.return_value = {"id": "task_failed", "status": "queued"}
        poll_response = mock.Mock(status_code=200)
        poll_response.json.return_value = {
            "id": "task_failed",
            "status": "failed",
            "error": {"message": "video generation failed"},
        }

        with (
            mock.patch(
                "services.protocol.agnes_ai_video.agnes_ai_settings",
                return_value={
                    "api_keys": [{"name": "video-key", "api_key": "secret-key", "enabled": True}],
                    "base_url": "https://agnes.example/v1",
                },
            ),
            mock.patch("services.protocol.agnes_ai_video.requests.post", return_value=create_response),
            mock.patch("services.protocol.agnes_ai_video.requests.get", return_value=poll_response),
        ):
            with self.assertRaisesRegex(agnes_ai_video.AgnesAIVideoError, "video generation failed"):
                agnes_ai_video.request_agnes_video(
                    agnes_ai_video.AgnesVideoRequest(prompt="A cinematic cat walks")
                )


if __name__ == "__main__":
    unittest.main()
