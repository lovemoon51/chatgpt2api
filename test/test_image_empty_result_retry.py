from __future__ import annotations

import os
import threading
import time
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


class ReusableSingleAccountService(FakeAccountService):
    def __init__(self) -> None:
        super().__init__(["token-1"])
        self._lock = threading.Lock()
        self._inflight = 0
        self._first_checkouts = 0
        self._first_checkout_barrier = threading.Barrier(2)

    def get_available_access_token(self, excluded_tokens: set[str] | None = None) -> str:
        excluded = set(excluded_tokens or set())
        if "token-1" in excluded:
            raise RuntimeError("no available image quota")
        with self._lock:
            if self._inflight >= 2:
                raise RuntimeError("no available image quota")
            self._inflight += 1
            should_wait = self._first_checkouts < 2
            if should_wait:
                self._first_checkouts += 1
        if should_wait:
            self._first_checkout_barrier.wait(timeout=2)
        return "token-1"

    def release_image_slot(self, access_token: str) -> None:
        if not access_token:
            return
        with self._lock:
            self._inflight = max(0, self._inflight - 1)

    def mark_image_result(self, access_token: str, success: bool) -> None:
        self.release_image_slot(access_token)
        super().mark_image_result(access_token, success)


class ReusableRaceAccountService(FakeAccountService):
    def __init__(self) -> None:
        super().__init__(["token-1"])
        self._lock = threading.Lock()
        self._inflight = 0

    def get_available_access_token(self, excluded_tokens: set[str] | None = None) -> str:
        if "token-1" in set(excluded_tokens or set()):
            raise RuntimeError("no available image quota")
        with self._lock:
            if self._inflight >= 2:
                raise RuntimeError("no available image quota")
            self._inflight += 1
        return "token-1"

    def release_image_slot(self, access_token: str) -> None:
        if not access_token:
            return
        with self._lock:
            self._inflight = max(0, self._inflight - 1)

    def mark_image_result(self, access_token: str, success: bool) -> None:
        self.release_image_slot(access_token)
        super().mark_image_result(access_token, success)


class ImageEmptyResultRetryTests(unittest.TestCase):
    def patch_image_race_config(self, *, parallelism: int = 2, max_inflight: int = 2):
        return mock.patch.dict(
            conversation.config.data,
            {
                "image_race_parallelism": parallelism,
                "image_race_max_inflight": max_inflight,
            },
        )

    def test_image_race_config_defaults_disable_racing(self) -> None:
        original_config = dict(conversation.config.data)
        try:
            conversation.config.data.pop("image_race_parallelism", None)
            conversation.config.data.pop("image_race_max_inflight", None)

            self.assertEqual(conversation.image_race_parallelism_limit(), 1)
            self.assertEqual(conversation.image_race_max_inflight_limit(3), 3)
        finally:
            conversation.config.data.clear()
            conversation.config.data.update(original_config)

    def test_image_race_config_enables_bounded_racing(self) -> None:
        with self.patch_image_race_config(parallelism=4, max_inflight=5):
            self.assertEqual(conversation.image_race_parallelism_limit(), 4)
            self.assertEqual(conversation.image_race_max_inflight_limit(3), 5)
            self.assertEqual(conversation.image_race_max_inflight_limit(1), 4)

    def test_single_image_request_races_accounts_and_returns_first_success(self) -> None:
        fake_accounts = FakeAccountService(["slow-token", "fast-token"])
        stream_tokens: list[str] = []
        stream_lock = threading.Lock()
        slow_can_finish = threading.Event()

        def fake_stream(_backend, request, index, total):
            token = getattr(_backend, "access_token", "")
            with stream_lock:
                stream_tokens.append(token)
            if token == "slow-token":
                slow_can_finish.wait(timeout=1)
                return iter([
                    conversation.ImageOutput(
                        kind="result",
                        model=request.model,
                        index=index,
                        total=total,
                        data=[{"url": "http://example.test/slow.png"}],
                    )
                ])
            time.sleep(0.05)
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": "http://example.test/fast.png"}],
                )
            ])

        with (
            self.patch_image_race_config(parallelism=2, max_inflight=2),
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            started = time.perf_counter()
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat", n=1)
                )
            )
            elapsed = time.perf_counter() - started

        result_outputs = [output for output in outputs if output.kind == "result"]
        self.assertLess(elapsed, 0.3)
        self.assertEqual(result_outputs[0].data[0]["url"], "http://example.test/fast.png")
        self.assertEqual(set(stream_tokens), {"slow-token", "fast-token"})
        self.assertIn(("fast-token", True), fake_accounts.marked)

    def test_multi_image_racing_respects_global_inflight_limit(self) -> None:
        fake_accounts = FakeAccountService(["slot-1-slow", "slot-2", "slot-3", "slot-1-fast", "extra"])
        active = 0
        max_active = 0
        active_lock = threading.Lock()
        slow_can_finish = threading.Event()
        slow_done = threading.Event()

        def fake_stream(_backend, request, index, total):
            nonlocal active, max_active
            token = getattr(_backend, "access_token", "")
            with active_lock:
                active += 1
                max_active = max(max_active, active)
            try:
                if token == "slot-1-slow":
                    slow_can_finish.wait(timeout=1)
                    return iter([
                        conversation.ImageOutput(
                            kind="result",
                            model=request.model,
                            index=index,
                            total=total,
                            data=[{"url": "http://example.test/slot-1-slow.png"}],
                        )
                    ])
                time.sleep(0.05)
                return iter([
                    conversation.ImageOutput(
                        kind="result",
                        model=request.model,
                        index=index,
                        total=total,
                        data=[{"url": f"http://example.test/{token}.png"}],
                    )
                ])
            finally:
                with active_lock:
                    active -= 1
                if token == "slot-1-slow":
                    slow_done.set()

        with (
            self.patch_image_race_config(parallelism=2, max_inflight=4),
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            started = time.perf_counter()
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat", n=3)
                )
            )
            elapsed = time.perf_counter() - started
            slow_can_finish.set()
            slow_done.wait(timeout=2)

        result_outputs = [output for output in outputs if output.kind == "result"]
        urls = [output.data[0]["url"] for output in result_outputs]
        self.assertLess(elapsed, 0.3)
        self.assertEqual([output.index for output in result_outputs], [1, 2, 3])
        self.assertEqual(len(result_outputs), 3)
        self.assertLessEqual(max_active, 4)
        self.assertIn("http://example.test/slot-1-fast.png", urls)
        self.assertNotIn("http://example.test/extra.png", urls)

    def test_racing_tracks_running_losers_when_cancel_fails(self) -> None:
        fake_accounts = FakeAccountService(["slot-1-slow", "slot-2", "slot-3", "slot-1-fast", "slot-2-race", "slot-3-race"])
        active = 0
        max_active = 0
        active_lock = threading.Lock()
        slow_can_finish = threading.Event()
        other_can_finish = threading.Event()
        stream_tokens: list[str] = []

        def fake_stream(_backend, request, index, total):
            nonlocal active, max_active
            token = getattr(_backend, "access_token", "")
            with active_lock:
                active += 1
                max_active = max(max_active, active)
                stream_tokens.append(token)
            try:
                if token == "slot-1-slow":
                    slow_can_finish.wait(timeout=1)
                elif token != "slot-1-fast":
                    other_can_finish.wait(timeout=1)
                else:
                    time.sleep(0.05)
                return iter([
                    conversation.ImageOutput(
                        kind="result",
                        model=request.model,
                        index=index,
                        total=total,
                        data=[{"url": f"http://example.test/{token}.png"}],
                    )
                ])
            finally:
                with active_lock:
                    active -= 1

        with (
            self.patch_image_race_config(parallelism=2, max_inflight=4),
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat", n=3)
                )
            )
            slow_can_finish.set()
            other_can_finish.set()

        result_outputs = [output for output in outputs if output.kind == "result"]
        self.assertEqual([output.index for output in result_outputs], [1, 2, 3])
        self.assertLessEqual(max_active, 4)

    def test_racing_preserves_cross_slot_account_reuse_when_pool_is_small(self) -> None:
        fake_accounts = ReusableRaceAccountService()

        def fake_stream(_backend, request, index, total):
            time.sleep(0.05)
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": f"http://example.test/reused-{index}.png"}],
                )
            ])

        with (
            self.patch_image_race_config(parallelism=2, max_inflight=3),
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat", n=2)
                )
            )

        result_outputs = [output for output in outputs if output.kind == "result"]
        self.assertEqual([output.index for output in result_outputs], [1, 2])
        self.assertEqual(fake_accounts.marked, [("token-1", True), ("token-1", True)])

    def test_multi_image_request_runs_images_in_parallel(self) -> None:
        fake_accounts = FakeAccountService(["token-1", "token-2", "token-3"])
        stream_tokens: list[str] = []
        stream_lock = threading.Lock()
        stream_barrier = threading.Barrier(3)

        def fake_stream(_backend, request, index, total):
            with stream_lock:
                stream_tokens.append(getattr(_backend, "access_token", ""))
            stream_barrier.wait(timeout=2)
            time.sleep(0.35 - (index * 0.08))
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": f"http://example.test/image-{index}.png"}],
                )
            ])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            started = time.perf_counter()
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat", n=3)
                )
            )
            elapsed = time.perf_counter() - started

        result_outputs = [output for output in outputs if output.kind == "result"]
        self.assertLess(elapsed, 0.45)
        self.assertEqual([output.index for output in result_outputs], [1, 2, 3])
        self.assertEqual(len(set(stream_tokens)), 3)
        self.assertEqual(sorted(success for _, success in fake_accounts.marked), [True, True, True])

    def test_parallel_request_can_reuse_single_account_when_concurrency_allows(self) -> None:
        fake_accounts = ReusableSingleAccountService()

        def fake_stream(_backend, request, index, total):
            time.sleep(0.05)
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": f"http://example.test/reused-{index}.png"}],
                )
            ])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat", n=2)
                )
            )

        result_outputs = [output for output in outputs if output.kind == "result"]
        self.assertEqual([output.index for output in result_outputs], [1, 2])
        self.assertEqual(fake_accounts.marked, [("token-1", True), ("token-1", True)])

    def test_parallel_request_returns_quickly_when_one_image_fails(self) -> None:
        fake_accounts = FakeAccountService(["token-1", "token-2"])
        slow_done = threading.Event()

        def fake_stream(_backend, request, index, total):
            if index == 1:
                raise conversation.ImageGenerationError("boom")
            time.sleep(0.6)
            slow_done.set()
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": "http://example.test/slow.png"}],
                )
            ])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            started = time.perf_counter()
            with self.assertRaisesRegex(conversation.ImageGenerationError, "boom"):
                list(
                    conversation.stream_image_outputs_with_pool(
                        conversation.ConversationRequest(model="gpt-image-2", prompt="cat", n=2)
                    )
                )
            elapsed = time.perf_counter() - started
            slow_done.wait(timeout=2)

        self.assertLess(elapsed, 0.3)

    def test_parallel_request_message_stops_batch_like_serial_path(self) -> None:
        fake_accounts = FakeAccountService(["token-1", "token-2"])
        slow_done = threading.Event()

        def fake_stream(_backend, request, index, total):
            if index == 1:
                time.sleep(0.05)
                return iter([
                    conversation.ImageOutput(
                        kind="message",
                        model=request.model,
                        index=index,
                        total=total,
                        text="blocked",
                    )
                ])
            time.sleep(0.6)
            slow_done.set()
            return iter([
                conversation.ImageOutput(
                    kind="result",
                    model=request.model,
                    index=index,
                    total=total,
                    data=[{"url": "http://example.test/slow.png"}],
                )
            ])

        with (
            mock.patch.object(conversation, "account_service", fake_accounts),
            mock.patch.object(conversation, "OpenAIBackendAPI", side_effect=lambda access_token: type("Backend", (), {"access_token": access_token})()),
            mock.patch.object(conversation, "stream_image_outputs", side_effect=fake_stream),
        ):
            started = time.perf_counter()
            outputs = list(
                conversation.stream_image_outputs_with_pool(
                    conversation.ConversationRequest(model="gpt-image-2", prompt="cat", n=2)
                )
            )
            elapsed = time.perf_counter() - started
            slow_done.wait(timeout=2)

        self.assertLess(elapsed, 0.3)
        self.assertEqual([output.kind for output in outputs], ["message"])
        self.assertEqual(outputs[0].text, "blocked")

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

    def test_retryable_first_empty_result_attempt_uses_shorter_poll_timeout(self) -> None:
        original_config = dict(conversation.config.data)
        conversation.config.data.update({
            "image_poll_timeout_secs": 300,
            "image_first_attempt_poll_timeout_secs": 90,
            "image_empty_result_retry_limit": 2,
        })
        fake_accounts = FakeAccountService(["token-1", "token-2"])
        seen_timeouts: list[int | None] = []

        def fake_stream(_backend, request, index, total):
            seen_timeouts.append(request.image_poll_timeout_secs)
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

        try:
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
        finally:
            conversation.config.data.clear()
            conversation.config.data.update(original_config)

        self.assertEqual(outputs[0].data[0]["url"], "http://example.test/image.png")
        self.assertEqual(seen_timeouts, [90, 300])

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
