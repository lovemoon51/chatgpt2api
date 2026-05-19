from __future__ import annotations

from typing import Any

from services.account_service import account_service
from services.openai_backend_api import OpenAIBackendAPI
from services.protocol.openai_v1_embeddings import DEFAULT_EMBEDDING_MODEL
from utils.helper import IMAGE_MODELS


LOCAL_MODEL_ALIASES = {*IMAGE_MODELS, DEFAULT_EMBEDDING_MODEL}


def list_models() -> dict[str, Any]:
    access_token = account_service.peek_text_access_token()
    try:
        result = OpenAIBackendAPI(access_token=access_token).list_models()
    except Exception:
        if not access_token:
            raise
        result = OpenAIBackendAPI().list_models()
    data = result.get("data")
    if not isinstance(data, list):
        return result
    seen = {str(item.get("id") or "").strip() for item in data if isinstance(item, dict)}
    for model in sorted(LOCAL_MODEL_ALIASES):
        if model not in seen:
            data.append({
                "id": model,
                "object": "model",
                "created": 0,
                "owned_by": "chatgpt2api",
                "permission": [],
                "root": model,
                "parent": None,
            })
    return result
