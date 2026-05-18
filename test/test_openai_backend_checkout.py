from __future__ import annotations

import unittest

from services.openai_backend_api import ChatGPTCheckoutRequiredError, OpenAIBackendAPI


class FakeCheckoutResponse:
    status_code = 200
    url = "https://chatgpt.com/checkout/openai_llc/cs_live_test"
    headers = {}
    history = []


class OpenAIBackendCheckoutTests(unittest.TestCase):
    def test_checkout_redirect_is_rejected_even_when_http_ok(self) -> None:
        backend = OpenAIBackendAPI.__new__(OpenAIBackendAPI)

        with self.assertRaisesRegex(ChatGPTCheckoutRequiredError, "checkout"):
            backend._raise_if_checkout_response(FakeCheckoutResponse(), "/backend-api/f/conversation")


if __name__ == "__main__":
    unittest.main()
