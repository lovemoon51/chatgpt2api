from __future__ import annotations

import unittest
from unittest import mock

from services.protocol import openai_v1_image_edit, openai_v1_image_generations


class ImageResolutionProtocolTests(unittest.TestCase):
    def test_generation_handler_passes_resolution_to_conversation_request(self) -> None:
        captured = []

        def fake_stream(request):
            captured.append(request)
            return iter(())

        with (
            mock.patch.object(openai_v1_image_generations, "stream_image_outputs_with_pool", fake_stream),
            mock.patch.object(openai_v1_image_generations, "collect_image_outputs", lambda _outputs: {"data": []}),
        ):
            openai_v1_image_generations.handle({"prompt": "cat", "model": "gpt-image-2", "resolution": "2k"})

        self.assertEqual(captured[0].resolution, "2k")

    def test_edit_handler_passes_resolution_to_conversation_request(self) -> None:
        captured = []

        def fake_stream(request):
            captured.append(request)
            return iter(())

        with (
            mock.patch.object(openai_v1_image_edit, "stream_image_outputs_with_pool", fake_stream),
            mock.patch.object(openai_v1_image_edit, "collect_image_outputs", lambda _outputs: {"data": []}),
        ):
            openai_v1_image_edit.handle(
                {
                    "prompt": "edit",
                    "images": [(b"image", "image.png", "image/png")],
                    "model": "gpt-image-2",
                    "resolution": "4k",
                }
            )

        self.assertEqual(captured[0].resolution, "4k")


if __name__ == "__main__":
    unittest.main()
