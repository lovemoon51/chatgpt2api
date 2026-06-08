from __future__ import annotations

import unittest

from fastapi import HTTPException


class ContentFilterTests(unittest.TestCase):
    def test_chat_completions_url_appends_endpoint_to_versioned_base_url(self) -> None:
        from services.content_filter import _chat_completions_url

        self.assertEqual(
            _chat_completions_url("https://apihub.agnes-ai.com/v1"),
            "https://apihub.agnes-ai.com/v1/chat/completions",
        )

    def test_chat_completions_url_strips_trailing_slash(self) -> None:
        from services.content_filter import _chat_completions_url

        self.assertEqual(
            _chat_completions_url("https://apihub.agnes-ai.com/v1/"),
            "https://apihub.agnes-ai.com/v1/chat/completions",
        )

    def test_check_request_includes_ai_review_rejection_reason_and_advice(self) -> None:
        from services import content_filter

        class DummyResponse:
            @staticmethod
            def json() -> dict[str, object]:
                return {
                    "choices": [
                        {
                            "message": {
                                "content": "REJECT: 包含可能侵权的名人肖像请求。建议：改为描述原创虚构人物。"
                            }
                        }
                    ]
                }

        original_config = content_filter.config
        original_post = content_filter.requests.post
        try:
            content_filter.config = type(
                "DummyConfig",
                (),
                {
                    "sensitive_words": [],
                    "ai_review": {
                        "enabled": True,
                        "base_url": "https://review.example/v1",
                        "api_key": "review-key",
                        "model": "review-model",
                        "prompt": "",
                    },
                },
            )()
            content_filter.requests.post = lambda *args, **kwargs: DummyResponse()

            with self.assertRaises(HTTPException) as ctx:
                content_filter.check_request("生成图片")
        finally:
            content_filter.config = original_config
            content_filter.requests.post = original_post

        self.assertEqual(ctx.exception.status_code, 400)
        message = ctx.exception.detail["error"]
        self.assertIn("包含可能侵权的名人肖像请求", message)
        self.assertIn("改为描述原创虚构人物", message)

    def test_check_request_can_skip_ai_review_but_keeps_sensitive_words(self) -> None:
        from services import content_filter

        post_calls = []

        original_config = content_filter.config
        original_post = content_filter.requests.post
        try:
            content_filter.config = type(
                "DummyConfig",
                (),
                {
                    "sensitive_words": ["禁止词"],
                    "ai_review": {
                        "enabled": True,
                        "base_url": "https://review.example/v1",
                        "api_key": "review-key",
                        "model": "review-model",
                        "prompt": "",
                    },
                },
            )()
            content_filter.requests.post = lambda *args, **kwargs: post_calls.append((args, kwargs))

            content_filter.check_request("扩展这张图", skip_ai_review=True)
            with self.assertRaises(HTTPException):
                content_filter.check_request("扩展这张图 禁止词", skip_ai_review=True)
        finally:
            content_filter.config = original_config
            content_filter.requests.post = original_post

        self.assertEqual(post_calls, [])


if __name__ == "__main__":
    unittest.main()
