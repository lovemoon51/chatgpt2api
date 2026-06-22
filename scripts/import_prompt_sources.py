from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BANANA_PROMPTS_URL = "https://raw.githubusercontent.com/glidea/banana-prompt-quicker/main/prompts.json"
EVOLINK_RECORDS_URL = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/data/ingested_tweets.json"
EVOLINK_RAW_BASE = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main"
EVOLINK_CASE_MARKDOWN_PATHS = (
    "cases/ad-creative.md",
    "cases/character.md",
    "cases/comparison.md",
    "cases/ecommerce.md",
    "cases/portrait.md",
    "cases/poster.md",
    "cases/ui.md",
)
EVOLINK_CASE_CATEGORY_LABELS = {
    "ad-creative": "Ad Creative",
    "character": "Character Design",
    "comparison": "Comparison",
    "ecommerce": "E-commerce",
    "portrait": "Portrait & Photography",
    "poster": "Poster & Illustration",
    "ui": "UI & Social Media",
}
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DEFAULT_OUTPUT_PATH = DATA_DIR / "prompt_templates.json"
GITHUB_IMPORT_OWNER_ID = "github-import"
DEFAULT_IMPORT_LIMIT = 300


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _clean(value: object, default: str = "") -> str:
    return str(value if value is not None else default).strip()


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized or "prompt"


def _unique_tags(values: list[object]) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for value in values:
        tag = _clean(value)
        if not tag or tag in seen:
            continue
        tags.append(tag)
        seen.add(tag)
    return tags[:8]


def _load_json_url(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "chatgpt2api-prompt-importer"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def _load_text_url(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "chatgpt2api-prompt-importer"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8")


def _template(
    *,
    template_id: str,
    title: str,
    prompt: str,
    description: str,
    owner_name: str,
    tags: list[str],
    preview_url: str = "",
    created_at: str = "",
    updated_at: str = "",
) -> dict[str, Any]:
    timestamp = _clean(updated_at or created_at) or _now_iso()
    return {
        "id": template_id,
        "title": title,
        "description": description,
        "prompt": prompt,
        "model": "gpt-image-2",
        "size": "1:1",
        "count": 1,
        "tags": tags,
        "preview_image": {"url": preview_url},
        "owner_id": GITHUB_IMPORT_OWNER_ID,
        "owner_name": owner_name,
        "visibility": "public",
        "review_status": "approved",
        "review_reason": "",
        "reviewed_by": GITHUB_IMPORT_OWNER_ID,
        "reviewed_at": timestamp,
        "created_at": _clean(created_at) or timestamp,
        "updated_at": timestamp,
    }


def _normalize_evolink_image_url(value: object) -> str:
    if isinstance(value, list):
        value = value[0] if value else ""
    raw = _clean(value)
    if not raw:
        return ""
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    return f"{EVOLINK_RAW_BASE}/{raw.lstrip('/')}"


def _evolink_case_id(record: dict[str, Any], index: int) -> str:
    for source in (_clean(record.get("case_id")), _clean(record.get("image_dir"))):
        if source:
            return source.rsplit("/", 1)[-1].replace("_", "-")
    anchor = _clean(record.get("case_anchor")).lstrip("#")
    case_match = re.search(r"case-(\d+)", anchor)
    if case_match:
        return f"case-{case_match.group(1)}"
    return f"record-{index + 1:04d}"


def _extract_case_prompts(markdown: str) -> dict[str, str]:
    prompts: dict[str, str] = {}
    matches = list(re.finditer(r"(?m)^### Case\s+(\d+):.*$", markdown))
    for position, match in enumerate(matches):
        case_number = match.group(1)
        start = match.end()
        end = matches[position + 1].start() if position + 1 < len(matches) else len(markdown)
        block = markdown[start:end]
        prompt_match = re.search(r"\*\*Prompt:\*\*\s*```(?:[a-zA-Z0-9_-]+)?\s*(.*?)\s*```", block, flags=re.S)
        if prompt_match:
            prompts[f"case-{case_number}"] = prompt_match.group(1).strip()
    return prompts


def _readme_prompt_lookup(markdowns: dict[str, str]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for markdown in markdowns.values():
        lookup.update(_extract_case_prompts(markdown))
    return lookup


def _title_from_case_heading(heading: str, case_number: str) -> str:
    linked_title = re.search(rf"^### Case\s+{re.escape(case_number)}:\s+\[(.*?)\]\(", heading)
    if linked_title:
        return linked_title.group(1).strip()
    raw_title = heading.split(":", 1)[1] if ":" in heading else heading
    return re.sub(r"\s+\(by\s+.*$", "", raw_title).strip()


def _author_from_case_heading(heading: str) -> str:
    author = re.search(r"\(by\s+\[?(@?[^]\)]+)\]?", heading)
    if not author:
        return "@Community"
    value = author.group(1).strip()
    return value if value.startswith("@") else f"@{value}"


def _preview_url_from_case_block(block: str) -> str:
    image = re.search(r'<img\s+[^>]*src="([^"]+)"', block)
    return image.group(1).strip() if image else ""


def _evolink_case_id_from_preview(preview_url: str, category_slug: str, case_number: str) -> str:
    image_dir = re.search(r"/images/([^/]+)/", preview_url)
    if image_dir:
        return image_dir.group(1).replace("_", "-")
    return f"{category_slug}-case-{case_number}"


def _extract_evolink_case_templates(path: str, markdown: str) -> list[dict[str, Any]]:
    category_slug = Path(path).stem
    category_label = EVOLINK_CASE_CATEGORY_LABELS.get(category_slug, "EvoLink Cases")
    templates: list[dict[str, Any]] = []
    matches = list(re.finditer(r"(?m)^### Case\s+(\d+):.*$", markdown))
    for position, match in enumerate(matches):
        case_number = match.group(1)
        start = match.start()
        end = matches[position + 1].start() if position + 1 < len(matches) else len(markdown)
        block = markdown[start:end]
        prompt_match = re.search(r"\*\*Prompt:\*\*\s*```(?:[a-zA-Z0-9_-]+)?\s*(.*?)\s*```", block, flags=re.S)
        if not prompt_match:
            continue
        prompt = prompt_match.group(1).strip()
        if not prompt:
            continue
        heading = match.group(0)
        title = _title_from_case_heading(heading, case_number) or f"EvoLink Case {case_number}"
        author = _author_from_case_heading(heading)
        preview_url = _preview_url_from_case_block(block)
        templates.append(
            _template(
                template_id=f"evolink-{_evolink_case_id_from_preview(preview_url, category_slug, case_number)}",
                title=title,
                prompt=prompt,
                description="来自 EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
                owner_name=f"{author} · awesome-gpt-image-2",
                tags=_unique_tags([category_label, category_slug, "gpt-image-2"]),
                preview_url=preview_url,
            )
        )
    return templates


def _build_banana_templates(payload: Any) -> list[dict[str, Any]]:
    items = payload if isinstance(payload, list) else []
    templates: list[dict[str, Any]] = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        title = _clean(item.get("title")) or f"Banana Prompt {index}"
        prompt = _clean(item.get("prompt"))
        if not prompt:
            continue
        category = _clean(item.get("category"))
        sub_category = _clean(item.get("sub_category"))
        mode = _clean(item.get("mode"))
        author = _clean(item.get("author"), "Community")
        tags = _unique_tags([category, sub_category, mode])
        templates.append(
            _template(
                template_id=f"banana-{index:04d}",
                title=title,
                prompt=prompt,
                description="来自 glidea/banana-prompt-quicker",
                owner_name=f"{author} · banana-prompt-quicker",
                tags=tags or ["banana-prompt-quicker"],
                preview_url=_clean(item.get("preview")),
                created_at=_clean(item.get("created")),
            )
        )
    return templates


def _build_evolink_templates(payload: Any, prompt_lookup: dict[str, str]) -> list[dict[str, Any]]:
    records = payload.get("records") if isinstance(payload, dict) else []
    records = records if isinstance(records, list) else []
    templates: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            continue
        case_id = _evolink_case_id(record, index)
        title = _clean(record.get("title")) or f"EvoLink Prompt {index + 1}"
        prompt = _clean(record.get("prompt")) or prompt_lookup.get(case_id, "")
        if not prompt:
            continue
        category = _clean(record.get("category")).replace(" Cases", "")
        author = _clean(record.get("author") or record.get("author_handle"), "Community")
        if not author.startswith("@"):
            author = f"@{author}"
        tags = _unique_tags([category, *list(record.get("tags") if isinstance(record.get("tags"), list) else [])])
        templates.append(
            _template(
                template_id=f"evolink-{case_id}",
                title=title,
                prompt=prompt,
                description="来自 EvoLinkAI/awesome-gpt-image-2-API-and-Prompts",
                owner_name=f"{author} · awesome-gpt-image-2",
                tags=tags or ["awesome-gpt-image-2"],
                preview_url=_normalize_evolink_image_url(record.get("images") or f"{_clean(record.get('image_dir'))}/output.jpg"),
                created_at=_clean(record.get("created_at") or record.get("added_at")),
            )
        )
    return templates


def _build_evolink_markdown_templates(markdowns: dict[str, str]) -> list[dict[str, Any]]:
    templates: list[dict[str, Any]] = []
    for path, markdown in markdowns.items():
        if path not in EVOLINK_CASE_MARKDOWN_PATHS:
            continue
        templates.extend(_extract_evolink_case_templates(path, markdown))
    return templates


def build_prompt_templates(
    banana_payload: Any,
    evolink_payload: Any,
    evolink_markdowns: dict[str, str] | None = None,
    *,
    limit: int = DEFAULT_IMPORT_LIMIT,
) -> list[dict[str, Any]]:
    prompt_lookup = _readme_prompt_lookup(evolink_markdowns or {})
    banana_templates = _build_banana_templates(banana_payload)
    evolink_templates = [
        *_build_evolink_markdown_templates(evolink_markdowns or {}),
        *_build_evolink_templates(evolink_payload, prompt_lookup),
    ]
    templates = _limit_balanced_templates([banana_templates, evolink_templates], limit)
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for template in templates:
        template_id = _clean(template.get("id"))
        if not template_id or template_id in seen:
            continue
        seen.add(template_id)
        unique.append(template)
    return unique


def _limit_balanced_templates(source_groups: list[list[dict[str, Any]]], limit: int) -> list[dict[str, Any]]:
    if limit <= 0:
        return []
    groups = [group for group in source_groups if group]
    if not groups:
        return []
    share = limit // len(groups)
    remainder = limit % len(groups)
    selected_groups: list[list[dict[str, Any]]] = []
    overflow: list[dict[str, Any]] = []
    for index, group in enumerate(groups):
        group_limit = share + (1 if index < remainder else 0)
        selected_groups.append(group[:group_limit])
        overflow.extend(group[group_limit:])
    selected = [template for group in selected_groups for template in group]
    if len(selected) < limit:
        selected.extend(overflow[: limit - len(selected)])
    return selected[:limit]


def upsert_prompt_templates(path: Path, imported: list[dict[str, Any]]) -> dict[str, int]:
    if path.exists():
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            current = {}
    else:
        current = {}
    current_items = current.get("items") if isinstance(current, dict) else []
    current_items = current_items if isinstance(current_items, list) else []
    imported_by_id = {_clean(item.get("id")): item for item in imported if _clean(item.get("id"))}
    updated = 0
    removed = 0
    next_items: list[dict[str, Any]] = []
    for item in current_items:
        item_id = _clean(item.get("id")) if isinstance(item, dict) else ""
        if item_id in imported_by_id:
            next_items.append(imported_by_id.pop(item_id))
            updated += 1
        elif isinstance(item, dict) and item.get("owner_id") == GITHUB_IMPORT_OWNER_ID:
            removed += 1
        elif isinstance(item, dict):
            next_items.append(item)
    added = len(imported_by_id)
    next_items.extend(imported_by_id.values())
    next_items.sort(key=lambda item: _clean(item.get("updated_at")), reverse=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"items": next_items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"added": added, "updated": updated, "removed": removed, "total": len(next_items)}


def fetch_evolink_markdowns(records_payload: Any) -> dict[str, str]:
    markups: dict[str, str] = {}
    for filename in EVOLINK_CASE_MARKDOWN_PATHS:
        try:
            markups[filename] = _load_text_url(f"{EVOLINK_RAW_BASE}/{filename}")
        except Exception as exc:
            print(f"warning: failed to fetch {filename}: {exc}", file=sys.stderr)
    return markups


def import_prompt_sources(output_path: Path = DEFAULT_OUTPUT_PATH, *, limit: int = DEFAULT_IMPORT_LIMIT) -> dict[str, int]:
    banana_payload = _load_json_url(BANANA_PROMPTS_URL)
    evolink_payload = _load_json_url(EVOLINK_RECORDS_URL)
    evolink_markdowns = fetch_evolink_markdowns(evolink_payload)
    templates = build_prompt_templates(banana_payload, evolink_payload, evolink_markdowns, limit=limit)
    if not templates:
        raise RuntimeError("no prompt templates were imported")
    return upsert_prompt_templates(output_path, templates)


def main() -> int:
    parser = argparse.ArgumentParser(description="Import GitHub community prompt sources into data/prompt_templates.json.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH, help="Prompt template JSON path.")
    parser.add_argument("--limit", type=int, default=DEFAULT_IMPORT_LIMIT, help="Maximum imported GitHub templates to keep.")
    args = parser.parse_args()
    result = import_prompt_sources(args.output, limit=args.limit)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
