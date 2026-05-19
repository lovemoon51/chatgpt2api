from __future__ import annotations

from typing import Any

from curl_cffi import requests

from services.api_key_service import openai_key_service
from services.proxy_service import proxy_settings


OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
PASSTHROUGH_FIELDS = {
    "input",
    "model",
    "encoding_format",
    "dimensions",
    "user",
}


class OpenAIEmbeddingsError(Exception):
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self.payload = payload
        super().__init__(str(payload))


def _error_payload(message: str, error_type: str, code: str | None = None) -> dict[str, Any]:
    return {
        "error": {
            "message": message,
            "type": error_type,
            "param": None,
            "code": code,
        }
    }


def _response_payload(response: Any) -> dict[str, Any]:
    try:
        payload = response.json()
    except Exception:
        payload = {}
    if isinstance(payload, dict):
        return payload
    return {}


def handle(body: dict[str, Any]) -> dict[str, Any]:
    if "input" not in body:
        raise OpenAIEmbeddingsError(
            400,
            _error_payload("Missing required parameter: 'input'.", "invalid_request_error", "missing_required_parameter"),
        )

    secret = openai_key_service.get_available_secret()
    if not secret:
        raise OpenAIEmbeddingsError(
            503,
            _error_payload("No available upstream OpenAI API key.", "server_error", "upstream_api_key_unavailable"),
        )

    payload = {
        key: body[key]
        for key in PASSTHROUGH_FIELDS
        if key in body
    }
    payload["model"] = str(payload.get("model") or DEFAULT_EMBEDDING_MODEL)

    session = requests.Session(**proxy_settings.build_session_kwargs(verify=True))
    try:
        response = session.post(
            OPENAI_EMBEDDINGS_URL,
            headers={
                "Authorization": f"Bearer {secret}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60,
        )
    finally:
        session.close()

    response_payload = _response_payload(response)
    status_code = int(response.status_code)
    if 200 <= status_code < 300:
        return response_payload
    if not response_payload:
        response_payload = _error_payload(f"Upstream OpenAI embeddings request failed with HTTP {status_code}.", "server_error")
    raise OpenAIEmbeddingsError(status_code, response_payload)
