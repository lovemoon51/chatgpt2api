from __future__ import annotations

from services.protocol.conversation import ConversationRequest, collect_text, text_backend

PROMPT_OPTIMIZER_MODEL = "gpt-5.5"
IMAGE_PROMPT_OPTIMIZER_SYSTEM_PROMPT = """你是一名图像生成提示词专家。请优化用户提供的作画提示词，保留原始意图和主体，不添加与原意矛盾的新内容。增强画面主体、场景、构图、光影、风格、材质、色彩、氛围与细节，让提示词更适合图像生成。默认保持用户原语言。只输出优化后的提示词，不要解释，不要 Markdown，不要标题，不要引号，不要多个候选。"""


def optimize_image_prompt(prompt: str, model: str = PROMPT_OPTIMIZER_MODEL) -> str:
    source_prompt = prompt.strip()
    if not source_prompt:
        raise ValueError("prompt is required")

    request = ConversationRequest(
        model=model or PROMPT_OPTIMIZER_MODEL,
        messages=[
            {"role": "system", "content": IMAGE_PROMPT_OPTIMIZER_SYSTEM_PROMPT},
            {"role": "user", "content": f"请优化这个图像生成提示词：\n{source_prompt}"},
        ],
    )
    optimized_prompt = collect_text(text_backend(), request).strip()
    if not optimized_prompt:
        raise RuntimeError("optimizer returned empty prompt")
    return optimized_prompt
