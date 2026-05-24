from __future__ import annotations

import unittest
from unittest import mock

import services.openai_backend_api as backend_module
from services.openai_backend_api import ChatGPTCheckoutRequiredError, OpenAIBackendAPI, _image_poll_delay, _json_response


class FakeCheckoutResponse:
    status_code = 200
    url = "https://chatgpt.com/checkout/openai_llc/cs_live_test"
    headers = {}
    history = []


class FakeUndecodableResponse:
    status_code = 200
    headers = {"content-type": "application/json"}
    content = b"\x9bnot json"
    encoding = "utf-8"

    @property
    def text(self) -> str:
        raise UnicodeDecodeError("utf-8", self.content, 0, 1, "invalid start byte")

    def json(self) -> dict:
        raise UnicodeDecodeError("utf-8", self.content, 0, 1, "invalid start byte")


class OpenAIBackendCheckoutTests(unittest.TestCase):
    def test_checkout_redirect_is_rejected_even_when_http_ok(self) -> None:
        backend = OpenAIBackendAPI.__new__(OpenAIBackendAPI)

        with self.assertRaisesRegex(ChatGPTCheckoutRequiredError, "checkout"):
            backend._raise_if_checkout_response(FakeCheckoutResponse(), "/backend-api/f/conversation")

    def test_json_response_wraps_unicode_decode_errors(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "returned undecodable or non-JSON response"):
            _json_response(FakeUndecodableResponse(), "/backend-api/me")

    def test_image_poll_delay_is_fast_then_backs_off(self) -> None:
        self.assertEqual(_image_poll_delay(0.0, 1, 120.0), 0.5)
        self.assertEqual(_image_poll_delay(6.0, 5, 120.0), 1.0)
        self.assertEqual(_image_poll_delay(20.0, 8, 120.0), 1.5)
        self.assertEqual(_image_poll_delay(60.0, 20, 120.0), 3.0)
        self.assertAlmostEqual(_image_poll_delay(119.8, 20, 120.0), 0.2)

    def test_image_poll_progress_callback_errors_do_not_break_polling(self) -> None:
        backend = OpenAIBackendAPI.__new__(OpenAIBackendAPI)
        attempts = {"count": 0}
        sleeps: list[float] = []
        clock = {"now": 0.0}

        def fake_get_conversation(_conversation_id: str):
            attempts["count"] += 1
            if attempts["count"] < 3:
                return {"mapping": {}}
            return {
                "mapping": {
                    "tool-message": {
                        "message": {
                            "author": {"role": "tool"},
                            "metadata": {"async_task_type": "image_gen"},
                            "content": {
                                "content_type": "multimodal_text",
                                "parts": [{"asset_pointer": "file-service://file-123"}],
                            },
                            "create_time": 1,
                        }
                    }
                }
            }

        def fake_sleep(delay: float) -> None:
            sleeps.append(delay)
            clock["now"] += delay

        backend._get_conversation = fake_get_conversation
        with (
            mock.patch.object(backend_module.time, "time", side_effect=lambda: clock["now"]),
            mock.patch.object(backend_module.time, "sleep", side_effect=fake_sleep),
        ):
            file_ids, sediment_ids = backend._poll_image_results(
                "conversation-1",
                timeout_secs=10,
                progress_callback=lambda _event: (_ for _ in ()).throw(RuntimeError("boom")),
            )

        self.assertEqual(file_ids, ["file-123"])
        self.assertEqual(sediment_ids, [])
        self.assertEqual(sleeps, [0.5, 0.5])


if __name__ == "__main__":
    unittest.main()
