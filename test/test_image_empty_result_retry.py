from __future__ import annotations

import os
import unittest
from unittest import mock

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")

from services.protocol import conversation


class FakeAccountService:
    def __init__(self, tokens: list[str]) -> None:
        self.tokens = tokens
        self.registered_tokens: list[str] = []
        self.marked: list[tuple[str, bool]] = []
        self.checkout_blocked: list[str] = []
        self.removed_unusable: list[tuple[str, str]] = []
        self.usage_limited: list[tuple[str, int | None, int | None]] = []
        self.begun = 0
        self.ended = 0

    def get_available_access_token(self, excluded_tokens: set[str] | None = None) -> str:
        excluded = set(excluded_tokens or set())
        for token in self.tokens:
            if token not in excluded:
                return token
        raise RuntimeError("no available image quota")

    def begin_image_request(self) -> None:
        self.begun += 1

    def end_image_request(self) -> None:
        self.ended += 1

    def ensure_image_capacity(self, timeout_seconds: float | None = None) -> bool:
        return bool(self.tokens)

    def register_image_account_for_request(self, excluded_tokens: set[str] | None = None, reason: str = "image_first_failure") -> str:
        if not self.registered_tokens:
            raise RuntimeError("register failed")
        return self.registered_tokens.pop(0)

    def mark_image_result(self, access_token: str, success: bool) -> None:
        self.marked.append((access_token, success))

    def mark_image_checkout_required(self, access_token: str, reason: str = "") -> None:
        self.checkout_blocked.append(access_token)

    def remove_unusable_image_token(self, access_token: str, event: str, reason: str = "") -> None:
        self.removed_unusable.append((access_token, event))

    def mark_image_usage_limit(
            self,
            access_token: str,
            reason: str = "",
            *,
            resets_at: int | None = None,
            resets_in_seconds: int | None = None,
    ) -> None:
        self.usage_limited.append((access_token, resets_at, resets_in_seconds))


class ImageEmptyResultRetryTests(unittest.TestCase):
    def test_empty_result_retries_next_account(self) -> None:
        fake_accounts = FakeAccountService(["token-1", "token-2"])

        def fake_stream(_backend, request, index, total):
            if getattr(_backend, "access_token", "") == "token-1":
                return iter(())
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": "http://example.test/image.png"}],
                )
            ])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat")
                )
            )

        self.assertEqual(outputs[0].data[0]["url"], "http://example.test/image.png")
        self.assertEqual(fake_accounts.marked, [("token-1", False), ("token-2", True)])

    def test_empty_result_reports_clear_timeout_message(self) -> None:
        fake_accounts = FakeAccountService(["token-1"])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", return_value=iter(())),
        ):
            with self.assertRaisesRegex(conversation.ImageGenerationError, "没有返回图片数据"):
                list(
                    conversation.stream_image_outputs_with_pool(
                        conversation.ConversationRequest(model="gpt-image-2", prompt="cat")
                    )
                )

        self.assertEqual(fake_accounts.marked, [("token-1", False)])

    def test_checkout_required_retries_next_account_and_blocks_first(self) -> None:
        fake_accounts = FakeAccountService(["token-1", "token-2"])

        def fake_stream(_backend, request, index, total):
            if getattr(_backend, "access_token", "") == "token-1":
                raise conversation.ChatGPTCheckoutRequiredError(
                    "redirected to ChatGPT checkout: https://chatgpt.com/checkout/openai_llc/cs_live_test"
                )
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": "http://example.test/image.png"}],
                )
            ])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat")
                )
            )

        self.assertEqual(outputs[0].data[0]["url"], "http://example.test/image.png")
        self.assertEqual(fake_accounts.checkout_blocked, ["token-1"])
        self.assertEqual(fake_accounts.marked, [("token-2", True)])

    def test_checkout_required_reports_clear_message_when_pool_exhausted(self) -> None:
        fake_accounts = FakeAccountService(["token-1"])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(
                conversation,
                "stream_image_outputs",
                side_effect=conversation.ChatGPTCheckoutRequiredError(
                    "redirected to ChatGPT checkout: https://chatgpt.com/checkout/openai_llc/cs_live_test"
                ),
            ),
        ):
            with self.assertRaisesRegex(conversation.ImageGenerationError, "Plus 结账页"):
                list(
                    conversation.stream_image_outputs_with_pool(
                        conversation.ConversationRequest(model="gpt-image-2", prompt="cat")
                    )
                )
        self.assertEqual(fake_accounts.checkout_blocked, ["token-1"])

    def test_usage_limit_retries_next_account_without_marking_failure(self) -> None:
        fake_accounts = FakeAccountService(["token-1", "token-2"])
        usage_limit = (
            '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached",'
            '"resets_at":1779121012,"resets_in_seconds":9097}}'
        )

        def fake_stream(_backend, request, index, total):
            if getattr(_backend, "access_token", "") == "token-1":
                raise conversation.ImageUsageLimitReachedError(usage_limit)
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": "http://example.test/image.png"}],
                )
            ])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat")
                )
            )

        self.assertEqual(outputs[0].data[0]["url"], "http://example.test/image.png")
        self.assertEqual(fake_accounts.usage_limited, [("token-1", 1779121012, 9097)])
        self.assertEqual(fake_accounts.marked, [("token-2", True)])

    def test_usage_limit_reports_quota_message_when_pool_exhausted(self) -> None:
        fake_accounts = FakeAccountService(["token-1"])
        usage_limit = '{"error":{"type":"usage_limit_reached","resets_in_seconds":9097}}'

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(
                conversation,
                "stream_image_outputs",
                side_effect=conversation.ImageUsageLimitReachedError(usage_limit),
            ),
        ):
            with self.assertRaisesRegex(conversation.ImageGenerationError, "额度已用尽"):
                list(
                    conversation.stream_image_outputs_with_pool(
                        conversation.ConversationRequest(model="gpt-image-2", prompt="cat")
                    )
                )

        self.assertEqual(fake_accounts.usage_limited, [("token-1", None, 9097)])

    def test_text_only_image_response_retries_next_account(self) -> None:
        fake_accounts = FakeAccountService(["token-1", "token-2"])

        def fake_stream(_backend, request, index, total):
            if getattr(_backend, "access_token", "") == "token-1":
                raise conversation.TextOnlyImageResponseError("上游返回了文字而不是图片：描述文本")
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": "http://example.test/image.png"}],
                )
            ])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat")
                )
            )

        self.assertEqual(outputs[0].data[0]["url"], "http://example.test/image.png")
        self.assertEqual(fake_accounts.marked, [("token-1", False), ("token-2", True)])

    def test_invalid_token_is_removed_and_next_account_is_used(self) -> None:
        fake_accounts = FakeAccountService(["token-1", "token-2"])

        def fake_stream(_backend, request, index, total):
            if getattr(_backend, "access_token", "") == "token-1":
                raise RuntimeError("token_invalidated")
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": "http://example.test/image.png"}],
                )
            ])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat")
                )
            )

        self.assertEqual(outputs[0].data[0]["url"], "http://example.test/image.png")
        self.assertEqual(fake_accounts.removed_unusable, [("token-1", "image_stream_invalid_token")])
        self.assertEqual(fake_accounts.marked, [("token-2", True)])

    def test_first_failure_registers_fresh_account_before_trying_stale_pool(self) -> None:
        fake_accounts = FakeAccountService(["token-1", "stale-token"])
        fake_accounts.registered_tokens = ["fresh-token"]

        def fake_stream(_backend, request, index, total):
            token = getattr(_backend, "access_token", "")
            if token == "token-1":
                raise RuntimeError("token_invalidated")
            if token == "stale-token":
                raise AssertionError("stale pool token should not be tried before the fresh registered account")
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": "http://example.test/fresh.png"}],
                )
            ])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat")
                )
            )

        self.assertEqual(outputs[0].data[0]["url"], "http://example.test/fresh.png")
        self.assertEqual(fake_accounts.removed_unusable, [("token-1", "image_stream_invalid_token")])
        self.assertEqual(fake_accounts.marked, [("fresh-token", True)])

    def test_image_prompt_forces_image_output(self) -> None:
        prompt = conversation.build_image_prompt("生成一张二次元猫娘", None)

        self.assertIn("请直接生成图片", prompt)
        self.assertIn("不要只回复文字描述", prompt)
        self.assertIn("生成一张二次元猫娘", prompt)


if __name__ == "__main__":
    unittest.main()
