from __future__ import annotations

from typing import Any, Iterator

from services.protocol.conversation import (
    ConversationRequest,
    collect_image_outputs,
    stream_image_chunks,
    stream_image_outputs_with_pool,
)


def handle(body: dict[str, Any]) -> dict[str, Any] | Iterator[dict[str, Any]]:
    prompt = str(body.get("prompt") or "")
    model = str(body.get("model") or "gpt-image-2")
    n = int(body.get("n") or 1)
    size = body.get("size")
    resolution = body.get("resolution")
    response_format = str(body.get("response_format") or "b64_json")
    base_url = str(body.get("base_url") or "") or None
    owner_identity = body.get("owner_identity") if isinstance(body.get("owner_identity"), dict) else None
    source_task_id = str(body.get("source_task_id") or "").strip()
    public = bool(body.get("public"))
    progress_callback = body.get("progress_callback") if callable(body.get("progress_callback")) else None
    outputs = stream_image_outputs_with_pool(ConversationRequest(
        prompt=prompt,
        model=model,
        n=n,
        size=size,
        resolution=resolution,
        response_format=response_format,
        base_url=base_url,
        message_as_error=True,
        owner_identity=owner_identity,
        source_task_id=source_task_id,
        public=public,
        progress_callback=progress_callback,
    ))
    if body.get("stream"):
        return stream_image_chunks(outputs)
    return collect_image_outputs(outputs)
