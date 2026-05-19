from __future__ import annotations

import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.ai as ai_module
from services.protocol import openai_v1_embeddings
from services.usage_limit_service import usage_limit_service


class FakeResponse:
    def __init__(self, status_code: int, payload: object) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> object:
        return self._payload


class FakeSession:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.closed = False
        self.post_calls: list[dict[str, object]] = []

    def post(self, url: str, **kwargs: object) -> FakeResponse:
        self.post_calls.append({"url": url, **kwargs})
        return self.response

    def close(self) -> None:
        self.closed = True


class EmbeddingsTests(unittest.TestCase):
    def test_handle_returns_400_when_input_missing(self) -> None:
        with self.assertRaises(openai_v1_embeddings.OpenAIEmbeddingsError) as ctx:
            openai_v1_embeddings.handle({"model": "text-embedding-3-large"})

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.payload["error"]["type"], "invalid_request_error")

    def test_handle_returns_503_when_no_saved_key(self) -> None:
        fake_key_service = mock.Mock(get_available_secret=mock.Mock(return_value=""))
        with mock.patch.object(openai_v1_embeddings, "openai_key_service", fake_key_service):
            with self.assertRaises(openai_v1_embeddings.OpenAIEmbeddingsError) as ctx:
                openai_v1_embeddings.handle({"input": "hello"})

        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(ctx.exception.payload["error"]["code"], "upstream_api_key_unavailable")

    def test_handle_forwards_request_and_returns_success_payload(self) -> None:
        upstream_payload = {
            "object": "list",
            "data": [{"object": "embedding", "index": 0, "embedding": [0.1, 0.2]}],
            "model": "text-embedding-3-small",
            "usage": {"prompt_tokens": 1, "total_tokens": 1},
        }
        session = FakeSession(FakeResponse(200, upstream_payload))
        fake_key_service = mock.Mock(get_available_secret=mock.Mock(return_value="sk-test-secret"))

        with (
            mock.patch.object(openai_v1_embeddings, "openai_key_service", fake_key_service),
            mock.patch.object(openai_v1_embeddings.requests, "Session", mock.Mock(return_value=session)),
        ):
            result = openai_v1_embeddings.handle({
                "input": ["hello"],
                "encoding_format": "float",
                "dimensions": 256,
                "ignored": "not forwarded",
            })

        self.assertEqual(result, upstream_payload)
        self.assertTrue(session.closed)
        self.assertEqual(len(session.post_calls), 1)
        call = session.post_calls[0]
        self.assertEqual(call["url"], openai_v1_embeddings.OPENAI_EMBEDDINGS_URL)
        self.assertEqual(call["headers"]["Authorization"], "Bearer sk-test-secret")
        self.assertEqual(call["json"], {
            "input": ["hello"],
            "encoding_format": "float",
            "dimensions": 256,
            "model": "text-embedding-3-small",
        })

    def test_handle_raises_with_upstream_error_payload(self) -> None:
        error_payload = {
            "error": {
                "message": "Incorrect API key provided",
                "type": "invalid_request_error",
                "param": None,
                "code": "invalid_api_key",
            }
        }
        session = FakeSession(FakeResponse(401, error_payload))
        fake_key_service = mock.Mock(get_available_secret=mock.Mock(return_value="sk-test-secret"))

        with (
            mock.patch.object(openai_v1_embeddings, "openai_key_service", fake_key_service),
            mock.patch.object(openai_v1_embeddings.requests, "Session", mock.Mock(return_value=session)),
        ):
            with self.assertRaises(openai_v1_embeddings.OpenAIEmbeddingsError) as ctx:
                openai_v1_embeddings.handle({"input": "hello", "model": "text-embedding-3-large"})

        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(ctx.exception.payload, error_payload)


class EmbeddingsApiTests(unittest.TestCase):
    def setUp(self) -> None:
        usage_limit_service.reset()
        app = FastAPI()
        app.include_router(ai_module.create_router())
        self.client = TestClient(app)
        self.addCleanup(usage_limit_service.reset)

    def test_route_returns_success_payload(self) -> None:
        identity = {"id": "user-1", "name": "Alice", "role": "user", "limits": {}}
        payload = {
            "object": "list",
            "data": [{"object": "embedding", "index": 0, "embedding": [0.1]}],
            "model": "text-embedding-3-small",
        }
        with (
            mock.patch.object(ai_module, "require_identity", return_value=identity),
            mock.patch.object(ai_module.openai_v1_embeddings, "handle", return_value=payload),
        ):
            response = self.client.post(
                "/v1/embeddings",
                headers={"Authorization": "Bearer user-key"},
                json={"input": "hello"},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), payload)

    def test_route_returns_openai_error_when_no_upstream_key(self) -> None:
        identity = {"id": "user-1", "name": "Alice", "role": "user", "limits": {}}
        error = openai_v1_embeddings.OpenAIEmbeddingsError(
            503,
            {
                "error": {
                    "message": "No available upstream OpenAI API key.",
                    "type": "server_error",
                    "param": None,
                    "code": "upstream_api_key_unavailable",
                }
            },
        )
        with (
            mock.patch.object(ai_module, "require_identity", return_value=identity),
            mock.patch.object(ai_module.openai_v1_embeddings, "handle", side_effect=error),
        ):
            response = self.client.post(
                "/v1/embeddings",
                headers={"Authorization": "Bearer user-key"},
                json={"input": "hello"},
            )

        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()["error"]["code"], "upstream_api_key_unavailable")

    def test_route_enforces_model_allowlist(self) -> None:
        identity = {
            "id": "user-1",
            "name": "Alice",
            "role": "user",
            "limits": {"models": ["gpt-4o-mini"]},
        }
        with mock.patch.object(ai_module, "require_identity", return_value=identity):
            response = self.client.post(
                "/v1/embeddings",
                headers={"Authorization": "Bearer user-key"},
                json={"input": "hello", "model": "text-embedding-3-small"},
            )

        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["error"]["type"], "permission_error")
        self.assertEqual(response.json()["error"]["code"], "model_not_allowed")


if __name__ == "__main__":
    unittest.main()
