from __future__ import annotations

import os
import unittest

os.environ.setdefault("CHATGPT2API_AUTH_KEY", "test-auth")


class PromptOptimizerTests(unittest.TestCase):
    def test_optimize_image_prompt_returns_stripped_text_and_builds_expert_messages(self) -> None:
        from services import prompt_optimizer

        captured = {}

        class DummyBackend:
            pass

        def fake_text_backend():
            return DummyBackend()

        def fake_collect_text(backend, request):
            captured["backend"] = backend
            captured["request"] = request
            return "\n优化后的提示词\n"

        original_text_backend = prompt_optimizer.text_backend
        original_collect_text = prompt_optimizer.collect_text
        prompt_optimizer.text_backend = fake_text_backend
        prompt_optimizer.collect_text = fake_collect_text
        try:
            result = prompt_optimizer.optimize_image_prompt("一只猫坐在窗边")
        finally:
            prompt_optimizer.text_backend = original_text_backend
            prompt_optimizer.collect_text = original_collect_text

        self.assertEqual(result, "优化后的提示词")
        request = captured["request"]
        self.assertEqual(request.model, "auto")
        self.assertEqual(request.messages[0]["role"], "system")
        self.assertIn("图像", request.messages[0]["content"])
        self.assertIn("提示词专家", request.messages[0]["content"])
        self.assertEqual(request.messages[1]["role"], "user")
        self.assertIn("一只猫坐在窗边", request.messages[1]["content"])

    def test_optimize_image_prompt_rejects_blank_prompt(self) -> None:
        from services import prompt_optimizer

        with self.assertRaisesRegex(ValueError, "prompt is required"):
            prompt_optimizer.optimize_image_prompt("   ")

    def test_optimize_image_prompt_rejects_empty_upstream_output(self) -> None:
        from services import prompt_optimizer

        def fake_collect_text(_backend, _request):
            return "   "

        original_collect_text = prompt_optimizer.collect_text
        prompt_optimizer.collect_text = fake_collect_text
        try:
            with self.assertRaisesRegex(RuntimeError, "optimizer returned empty prompt"):
                prompt_optimizer.optimize_image_prompt("一只猫")
        finally:
            prompt_optimizer.collect_text = original_collect_text


if __name__ == "__main__":
    unittest.main()
