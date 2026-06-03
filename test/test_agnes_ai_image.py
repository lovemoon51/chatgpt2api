from __future__ import annotations

import base64
from io import BytesIO
import unittest
from unittest import mock

from services.protocol import agnes_ai_image
from services.protocol.conversation import ConversationRequest, ImageOutput, collect_image_outputs, stream_image_outputs_with_pool


class AgnesAIImageTests(unittest.TestCase):
    def test_builds_text_to_image_payload(self) -> None:
        payload = agnes_ai_image.build_agnes_image_payload(
            ConversationRequest(
                model=agnes_ai_image.AGNES_IMAGE_MODEL,
                prompt="A clean product poster",
                size="1024x768",
            )
        )

        self.assertEqual(payload["model"], agnes_ai_image.AGNES_IMAGE_MODEL)
        self.assertEqual(payload["prompt"], "A clean product poster")
        self.assertEqual(payload["size"], "1024x768")
        self.assertNotIn("tags", payload)
        self.assertNotIn("extra_body", payload)

    def test_builds_image_to_image_payload_with_reference_urls(self) -> None:
        payload = agnes_ai_image.build_agnes_image_payload(
            ConversationRequest(
                model=agnes_ai_image.AGNES_IMAGE_MODEL,
                prompt="Use the same character in a night scene",
                size="1:1",
                images=["https://cdn.example.test/reference.png"],
            )
        )

        self.assertEqual(payload["tags"], ["img2img"])
        self.assertEqual(payload["extra_body"], {
            "image": ["https://cdn.example.test/reference.png"],
            "response_format": "url",
        })

    def test_rejects_local_image_references_for_agnes_img2img(self) -> None:
        with self.assertRaisesRegex(agnes_ai_image.AgnesAIImageError, "publicly accessible image URL"):
            agnes_ai_image.build_agnes_image_payload(
                ConversationRequest(
                    model=agnes_ai_image.AGNES_IMAGE_MODEL,
                    prompt="Use this image",
                    images=[base64.b64encode(b"local-image").decode("ascii")],
                )
            )

    def test_request_agnes_image_rotates_keys_after_rate_limit(self) -> None:
        request = ConversationRequest(
            model=agnes_ai_image.AGNES_IMAGE_MODEL,
            prompt="A clean product poster",
        )
        responses = [
            mock.Mock(status_code=429),
            mock.Mock(status_code=200),
        ]
        responses[0].json.return_value = {"error": {"message": "rate limited"}}
        responses[1].json.return_value = {"data": [{"url": "https://agnes.example/result.png"}]}

        with (
            mock.patch(
                "services.protocol.agnes_ai_image.agnes_ai_settings",
                return_value={
                    "api_keys": [
                        {"name": "key-a", "api_key": "key-a", "enabled": True},
                        {"name": "key-b", "api_key": "key-b", "enabled": True},
                    ],
                    "base_url": "https://agnes.example/v1",
                },
            ),
            mock.patch("services.protocol.agnes_ai_image.requests.post", side_effect=responses) as post,
        ):
            result = agnes_ai_image.request_agnes_image(request)

        self.assertEqual(result["data"], [{"url": "https://agnes.example/result.png"}])
        self.assertEqual(post.call_count, 2)
        self.assertEqual(post.call_args_list[0].kwargs["headers"]["Authorization"], "Bearer key-a")
        self.assertEqual(post.call_args_list[1].kwargs["headers"]["Authorization"], "Bearer key-b")

    def test_test_agnes_ai_connection_reports_success_without_leaking_key(self) -> None:
        response = mock.Mock(status_code=200)
        response.json.return_value = {
            "data": [
                {"id": agnes_ai_image.AGNES_IMAGE_MODEL},
                {"id": "agnes-2.0-flash"},
            ]
        }

        with mock.patch("services.protocol.agnes_ai_image.requests.get", return_value=response) as get:
            result = agnes_ai_image.test_agnes_ai_connection({
                "base_url": "https://agnes.example/v1",
                "api_keys": [{"name": "主 key", "api_key": "secret-key", "enabled": True}],
            })

        self.assertEqual(result, {
            "ok": True,
            "status": 200,
            "key_name": "主 key",
            "error": None,
            "models": [agnes_ai_image.AGNES_IMAGE_MODEL, "agnes-2.0-flash"],
            "image_model_available": True,
        })
        self.assertEqual(get.call_args.kwargs["headers"]["Authorization"], "Bearer secret-key")
        self.assertNotIn("secret-key", str(result))

    def test_download_image_bytes_falls_back_when_curl_rejects_content_encoding(self) -> None:
        def fake_urlopen(request, timeout=0):
            headers = {key.lower(): value for key, value in request.header_items()}
            self.assertEqual(headers["accept-encoding"], "identity")
            return BytesIO(b"image-bytes")

        with (
            mock.patch(
                "services.protocol.agnes_ai_image.requests.get",
                side_effect=RuntimeError("Unrecognized content encoding type"),
            ),
            mock.patch("services.protocol.agnes_ai_image.urlopen", side_effect=fake_urlopen),
        ):
            images = agnes_ai_image.download_image_bytes(["https://cdn.example/image.png"])

        self.assertEqual(images, [b"image-bytes"])

    def test_stream_image_outputs_with_pool_routes_agnes_without_account_pool(self) -> None:
        request = ConversationRequest(
            model=agnes_ai_image.AGNES_IMAGE_MODEL,
            prompt="A clean product poster",
            response_format="url",
        )
        with (
            mock.patch("services.protocol.conversation.account_service.begin_image_request") as begin_image_request,
            mock.patch("services.protocol.conversation.account_service.ensure_image_capacity") as ensure_image_capacity,
            mock.patch(
                "services.protocol.conversation.stream_agnes_image_outputs",
                return_value=iter([
                    ImageOutput(
                        kind="result",
                        model=agnes_ai_image.AGNES_IMAGE_MODEL,
                        index=1,
                        total=1,
                        data=[{"url": "https://agnes.example.test/result.png"}],
                    )
                ]),
            ) as stream_agnes,
        ):
            result = collect_image_outputs(stream_image_outputs_with_pool(request))

        self.assertEqual(result["data"], [{"url": "https://agnes.example.test/result.png"}])
        stream_agnes.assert_called_once_with(request)
        begin_image_request.assert_not_called()
        ensure_image_capacity.assert_not_called()


if __name__ == "__main__":
    unittest.main()
