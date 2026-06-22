from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from threading import RLock
from typing import Any

from PIL import Image

from services.config import DATA_DIR, config
from services.image_metadata_storage import get_image_metadata_storage

IMAGE_ASSETS_FILE = DATA_DIR / "image_assets.json"
_assets_lock = RLock()


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def safe_relative_path(path: str) -> str:
    value = str(path or "").strip().replace("\\", "/").lstrip("/")
    if not value:
        raise ValueError("image path is required")
    parts = Path(value).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("invalid image path")
    return Path(*parts).as_posix()


def owner_payload(identity: dict[str, object] | None) -> dict[str, object]:
    return {
        "owner_id": str((identity or {}).get("id") or (identity or {}).get("owner_id") or "").strip(),
        "owner_name": str((identity or {}).get("name") or (identity or {}).get("owner_name") or "").strip(),
        "owner_role": str((identity or {}).get("role") or (identity or {}).get("owner_role") or "").strip().lower(),
    }


def _clean_tags(tags: object) -> list[str]:
    if not isinstance(tags, list):
        return []
    cleaned: list[str] = []
    for item in tags:
        tag = str(item or "").strip()
        if tag and tag not in cleaned:
            cleaned.append(tag)
    return cleaned


def _clean_item(item: dict[str, Any]) -> dict[str, Any] | None:
    try:
        rel = safe_relative_path(str(item.get("path") or item.get("rel") or ""))
    except ValueError:
        return None
    folder = str(item.get("folder") or "/".join(rel.split("/")[:-1])).strip("/")
    bytes_value = item.get("bytes", item.get("size"))
    try:
        bytes_count = max(0, int(bytes_value or 0))
    except (TypeError, ValueError):
        bytes_count = 0
    dimensions = item.get("dimensions")
    if not isinstance(dimensions, dict):
        dimensions = {}
    width = dimensions.get("width", item.get("width"))
    height = dimensions.get("height", item.get("height"))
    cleaned_dimensions: dict[str, int] = {}
    for key, value in (("width", width), ("height", height)):
        try:
            int_value = int(value or 0)
        except (TypeError, ValueError):
            int_value = 0
        if int_value > 0:
            cleaned_dimensions[key] = int_value
    return {
        "path": rel,
        "owner_id": str(item.get("owner_id") or "").strip(),
        "owner_name": str(item.get("owner_name") or "").strip(),
        "owner_role": str(item.get("owner_role") or "").strip().lower(),
        "prompt": str(item.get("prompt") or "").strip(),
        "model": str(item.get("model") or "").strip(),
        "size": str(item.get("size") or "").strip(),
        "mode": str(item.get("mode") or "").strip(),
        "source_task_id": str(item.get("source_task_id") or "").strip(),
        "revised_prompt": str(item.get("revised_prompt") or "").strip(),
        "created_at": str(item.get("created_at") or "").strip(),
        "bytes": bytes_count,
        "dimensions": cleaned_dimensions,
        "tags": _clean_tags(item.get("tags")),
        "folder": folder,
        "deleted_at": str(item.get("deleted_at") or "").strip(),
    }


def _load_locked() -> dict[str, dict[str, Any]]:
    storage = get_image_metadata_storage()
    if storage is not None:
        raw_assets = storage.load_map("image_assets")
        assets: dict[str, dict[str, Any]] = {}
        for item in raw_assets.values():
            if isinstance(item, dict):
                cleaned = _clean_item(item)
                if cleaned is not None:
                    assets[str(cleaned["path"])] = cleaned
        if assets:
            return assets
        legacy_assets = _load_json_locked()
        if legacy_assets:
            storage.save_map("image_assets", legacy_assets)
        return legacy_assets
    return _load_json_locked()


def _load_json_locked() -> dict[str, dict[str, Any]]:
    try:
        raw = json.loads(IMAGE_ASSETS_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    items = raw.get("items") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return {}
    assets: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        cleaned = _clean_item(item)
        if cleaned is not None:
            assets[str(cleaned["path"])] = cleaned
    return assets


def _save_locked(assets: dict[str, dict[str, Any]]) -> None:
    storage = get_image_metadata_storage()
    if storage is not None:
        storage.save_map("image_assets", assets)
    IMAGE_ASSETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    items = sorted(assets.values(), key=lambda item: str(item.get("created_at") or ""), reverse=True)
    tmp_path = IMAGE_ASSETS_FILE.with_suffix(IMAGE_ASSETS_FILE.suffix + ".tmp")
    tmp_path.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(IMAGE_ASSETS_FILE)


def load_assets(*, include_deleted: bool = False) -> dict[str, dict[str, Any]]:
    with _assets_lock:
        assets = _load_locked()
    if include_deleted:
        return assets
    return {path: item for path, item in assets.items() if not item.get("deleted_at")}


def image_file_metadata(relative_path: str, file_path: Path | None = None) -> dict[str, Any]:
    rel = safe_relative_path(relative_path)
    path = file_path or (config.images_dir / rel)
    metadata: dict[str, Any] = {
        "bytes": 0,
        "dimensions": {},
        "folder": "/".join(rel.split("/")[:-1]),
        "created_at": "",
    }
    try:
        stat = path.stat()
    except OSError:
        return metadata
    metadata["bytes"] = int(stat.st_size)
    metadata["created_at"] = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
    try:
        with Image.open(path) as image:
            metadata["dimensions"] = {"width": int(image.size[0]), "height": int(image.size[1])}
    except Exception:
        metadata["dimensions"] = {}
    return metadata


def upsert_asset(
    relative_path: str,
    *,
    file_path: Path | None = None,
    owner_identity: dict[str, object] | None = None,
    prompt: str | None = None,
    model: str | None = None,
    size: str | None = None,
    mode: str | None = None,
    source_task_id: str | None = None,
    revised_prompt: str | None = None,
    tags: list[str] | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    rel = safe_relative_path(relative_path)
    file_metadata = image_file_metadata(rel, file_path)
    owner = owner_payload(owner_identity)
    with _assets_lock:
        assets = _load_locked()
        current = assets.get(rel, {"path": rel})
        next_item = {
            **current,
            "path": rel,
            "bytes": file_metadata["bytes"] or int(current.get("bytes") or 0),
            "dimensions": file_metadata["dimensions"] or current.get("dimensions") or {},
            "folder": file_metadata["folder"] or current.get("folder") or "",
            "created_at": str(created_at or current.get("created_at") or file_metadata["created_at"] or _now()),
            "deleted_at": "",
        }
        if owner["owner_id"]:
            next_item.update(owner)
        for key, value in {
            "prompt": prompt,
            "model": model,
            "size": size,
            "mode": mode,
            "source_task_id": source_task_id,
            "revised_prompt": revised_prompt,
        }.items():
            if value is not None and str(value).strip():
                next_item[key] = str(value).strip()
        if tags is not None:
            next_item["tags"] = _clean_tags(tags)
        cleaned = _clean_item(next_item) or {"path": rel}
        assets[rel] = cleaned
        _save_locked(assets)
        return dict(cleaned)


def update_asset_tags(relative_path: str, tags: list[str]) -> None:
    rel = safe_relative_path(relative_path)
    with _assets_lock:
        assets = _load_locked()
        current = assets.get(rel)
        if current is None:
            return
        current["tags"] = _clean_tags(tags)
        _save_locked(assets)


def remove_asset_tag(tag: str) -> int:
    value = str(tag or "").strip()
    if not value:
        return 0
    count = 0
    with _assets_lock:
        assets = _load_locked()
        for item in assets.values():
            tags = _clean_tags(item.get("tags"))
            if value not in tags:
                continue
            item["tags"] = [candidate for candidate in tags if candidate != value]
            count += 1
        if count:
            _save_locked(assets)
    return count


def mark_asset_deleted(relative_path: str) -> None:
    rel = safe_relative_path(relative_path)
    with _assets_lock:
        assets = _load_locked()
        current = assets.get(rel)
        if current is None:
            current = {"path": rel, "created_at": _now(), "folder": "/".join(rel.split("/")[:-1])}
            assets[rel] = current
        current["deleted_at"] = current.get("deleted_at") or _now()
        _save_locked(assets)


def mark_missing_assets_deleted(existing_paths: set[str]) -> int:
    existing = {safe_relative_path(path) for path in existing_paths}
    changed = 0
    with _assets_lock:
        assets = _load_locked()
        for path, item in assets.items():
            if item.get("deleted_at") or path in existing:
                continue
            item["deleted_at"] = _now()
            changed += 1
        if changed:
            _save_locked(assets)
    return changed


def purge_asset(relative_path: str) -> None:
    rel = safe_relative_path(relative_path)
    with _assets_lock:
        assets = _load_locked()
        if assets.pop(rel, None) is not None:
            _save_locked(assets)
