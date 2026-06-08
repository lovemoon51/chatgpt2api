from __future__ import annotations


OUTPAINT_KEYWORDS = (
    "扩图",
    "扩展",
    "拓展",
    "延展",
    "扩大画布",
    "扩展画布",
    "拓展画布",
    "补画布",
    "画布扩展",
    "画布拓展",
    "outpaint",
    "outpainting",
    "extend canvas",
    "expand canvas",
)


def is_outpaint_prompt(prompt: str) -> bool:
    text = str(prompt or "").strip().lower()
    return bool(text) and any(keyword in text for keyword in OUTPAINT_KEYWORDS)
