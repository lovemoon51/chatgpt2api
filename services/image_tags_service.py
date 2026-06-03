from __future__ import annotations

import json
from pathlib import Path

from services.config import DATA_DIR
from services.image_metadata_storage import get_image_metadata_storage

TAGS_FILE = DATA_DIR / "image_tags.json"


def _ensure_file() -> None:
    TAGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not TAGS_FILE.exists():
        TAGS_FILE.write_text("{}", encoding="utf-8")


def load_tags() -> dict[str, list[str]]:
    storage = get_image_metadata_storage()
    if storage is not None:
        tags = _clean_tags_map(storage.load_map("image_tags"))
        if tags:
            return tags
        legacy_tags = _load_json_tags()
        if legacy_tags:
            storage.save_map("image_tags", legacy_tags)
        return legacy_tags
    return _load_json_tags()


def _load_json_tags() -> dict[str, list[str]]:
    _ensure_file()
    try:
        data = json.loads(TAGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return _clean_tags_map(data)


def _clean_tags_map(data: object) -> dict[str, list[str]]:
    if not isinstance(data, dict):
        return {}
    cleaned: dict[str, list[str]] = {}
    for key, value in data.items():
        path = str(key or "").strip()
        if not path or not isinstance(value, list):
            continue
        tags = list(dict.fromkeys(str(tag or "").strip() for tag in value if str(tag or "").strip()))
        if tags:
            cleaned[path] = tags
    return cleaned


def save_tags(data: dict[str, list[str]]) -> None:
    cleaned = _clean_tags_map(data)
    storage = get_image_metadata_storage()
    if storage is not None:
        storage.save_map("image_tags", cleaned)
    _ensure_file()
    TAGS_FILE.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def get_tags(image_rel: str) -> list[str]:
    return load_tags().get(image_rel, [])


def set_tags(image_rel: str, tags: list[str]) -> list[str]:
    data = load_tags()
    cleaned = list(dict.fromkeys(t.strip() for t in tags if t.strip()))
    if cleaned:
        data[image_rel] = cleaned
    else:
        data.pop(image_rel, None)
    save_tags(data)
    try:
        from services.image_asset_service import update_asset_tags

        update_asset_tags(image_rel, cleaned)
    except Exception:
        pass
    return cleaned


def remove_tags(image_rel: str) -> None:
    data = load_tags()
    if data.pop(image_rel, None) is not None:
        save_tags(data)
    try:
        from services.image_asset_service import update_asset_tags

        update_asset_tags(image_rel, [])
    except Exception:
        pass


def delete_tag(tag: str) -> int:
    """从所有图片中删除指定标签，返回受影响的图片数。"""
    data = load_tags()
    count = 0
    for rel in list(data):
        if tag in data[rel]:
            data[rel] = [t for t in data[rel] if t != tag]
            if not data[rel]:
                del data[rel]
            count += 1
    if count > 0:
        save_tags(data)
    try:
        from services.image_asset_service import remove_asset_tag

        remove_asset_tag(tag)
    except Exception:
        pass
    return count


def get_all_tags() -> list[str]:
    data = load_tags()
    seen: set[str] = set()
    result: list[str] = []
    for tags in data.values():
        for t in tags:
            if t not in seen:
                seen.add(t)
                result.append(t)
    return result
