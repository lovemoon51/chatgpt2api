from __future__ import annotations

from curl_cffi import requests
from fastapi import HTTPException

from services.config import config
from services.proxy_service import proxy_settings

DEFAULT_REVIEW_PROMPT = (
    "判断用户请求是否允许。允许时只回答 ALLOW。拒绝时回答：REJECT: 拒绝原因。建议：用户应如何修改后再提交。"
)


def _text(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(_text(item) for item in value)
    if isinstance(value, dict):
        return "\n".join(_text(value.get(key)) for key in ("text", "input_text", "content", "input", "instructions", "system", "prompt"))
    return ""


def request_text(*values: object) -> str:
    return "\n".join(part for value in values if (part := _text(value).strip()))


def _chat_completions_url(base_url: str) -> str:
    return f"{str(base_url or '').strip().rstrip('/')}/chat/completions"


def _review_rejection_message(result: str) -> str:
    normalized = " ".join(str(result or "").strip().split())
    for prefix in ("reject:", "rejected:", "deny:", "denied:"):
        if normalized.lower().startswith(prefix):
            detail = normalized[len(prefix):].strip()
            if detail:
                return f"AI 审核未通过：{detail}"
    if normalized.startswith(("拒绝：", "拒绝:", "不允许：", "不允许:")):
        detail = normalized.split(":", 1)[-1].strip() if ":" in normalized else normalized.split("：", 1)[-1].strip()
        if detail:
            return f"AI 审核未通过：{detail}"
    return "AI 审核未通过，拒绝本次任务。请调整提示词，避免敏感、违法、侵权或过度真实人物/品牌相关内容后再提交。"


def check_request(text: str, *, skip_ai_review: bool = False) -> None:
    text = str(text or "")
    if not text:
        return
    for word in config.sensitive_words:
        if word in text:
            raise HTTPException(status_code=400, detail={"error": "检测到敏感词，拒绝本次任务"})
    if skip_ai_review:
        return
    review = config.ai_review
    if not review.get("enabled"):
        return
    base_url = str(review.get("base_url") or "").strip().rstrip("/")
    api_key = str(review.get("api_key") or "").strip()
    model = str(review.get("model") or "").strip()
    if not base_url or not api_key or not model:
        raise HTTPException(status_code=400, detail={"error": "ai review config is incomplete"})
    prompt = str(review.get("prompt") or DEFAULT_REVIEW_PROMPT).strip()
    content = f"{prompt}\n\n用户请求:\n{text}\n\n允许时只回答 ALLOW。拒绝时回答：REJECT: 拒绝原因。建议：用户应如何修改后再提交。"
    try:
        response = requests.post(
            _chat_completions_url(base_url),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": [{"role": "user", "content": content}], "temperature": 0},
            timeout=60,
            **proxy_settings.build_session_kwargs(),
        )
        result = str(response.json()["choices"][0]["message"]["content"]).strip().lower()
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"error": f"ai review failed: {exc}"}) from exc
    if result.startswith(("allow", "pass", "true", "yes", "通过", "允许", "安全")):
        return
    raise HTTPException(status_code=400, detail={"error": _review_rejection_message(result)})
