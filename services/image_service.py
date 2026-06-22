from __future__ import annotations

import io
import json
from threading import RLock
import zipfile
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

from fastapi import HTTPException
from fastapi.responses import FileResponse
from PIL import Image, ImageOps

from services.config import DATA_DIR, config
from services.image_metadata_storage import get_image_metadata_storage
from services.image_asset_service import (
    load_assets,
    mark_asset_deleted,
    mark_missing_assets_deleted,
    safe_relative_path,
    upsert_asset,
)
from services.image_tags_service import load_tags, remove_tags
from services.signed_url_service import generate_signed_image_url

THUMBNAIL_SIZE = (320, 320)
IMAGE_OWNERS_FILE = DATA_DIR / "image_owners.json"
_owners_lock = RLock()


def _cleanup_empty_dirs(root: Path) -> None:
    for path in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        try:
            path.rmdir()
        except OSError:
            pass


def _safe_relative_path(path: str) -> str:
    try:
        return safe_relative_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="image not found") from exc


def _safe_image_path(relative_path: str) -> Path:
    rel = _safe_relative_path(relative_path)
    root = config.images_dir.resolve()
    path = (root / rel).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="image not found") from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="image not found")
    return path


def _is_admin(identity: dict[str, object] | None) -> bool:
    return str((identity or {}).get("role") or (identity or {}).get("owner_role") or "").strip().lower() == "admin"


def _identity_owner_id(identity: dict[str, object] | None) -> str:
    return str((identity or {}).get("id") or (identity or {}).get("owner_id") or "").strip()


def _owner_payload(identity: dict[str, object] | None) -> dict[str, object]:
    return {
        "owner_id": _identity_owner_id(identity),
        "owner_name": str((identity or {}).get("name") or (identity or {}).get("owner_name") or "").strip(),
        "owner_role": str((identity or {}).get("role") or (identity or {}).get("owner_role") or "").strip().lower(),
        "recorded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def _load_image_owners_locked() -> dict[str, dict[str, object]]:
    storage = get_image_metadata_storage()
    if storage is not None:
        owners = _clean_image_owners(storage.load_map("image_owners").values())
        if owners:
            return owners
        legacy_owners = _load_json_image_owners_locked()
        if legacy_owners:
            storage.save_map("image_owners", legacy_owners)
        return legacy_owners
    return _load_json_image_owners_locked()


def _load_json_image_owners_locked() -> dict[str, dict[str, object]]:
    try:
        raw = json.loads(IMAGE_OWNERS_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    items = raw.get("items") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return {}
    return _clean_image_owners(items)


def _clean_image_owners(items: object) -> dict[str, dict[str, object]]:
    if not isinstance(items, list) and not hasattr(items, "__iter__"):
        return {}
    owners: dict[str, dict[str, object]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            rel = _safe_relative_path(str(item.get("path") or item.get("rel") or ""))
        except HTTPException:
            continue
        owner_id = str(item.get("owner_id") or "").strip()
        if not owner_id:
            continue
        owners[rel] = {
            "path": rel,
            "owner_id": owner_id,
            "owner_name": str(item.get("owner_name") or "").strip(),
            "owner_role": str(item.get("owner_role") or "").strip().lower(),
            "recorded_at": str(item.get("recorded_at") or "").strip(),
        }
    return owners


def _save_image_owners_locked(owners: dict[str, dict[str, object]]) -> None:
    storage = get_image_metadata_storage()
    if storage is not None:
        storage.save_map("image_owners", owners)
    IMAGE_OWNERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    items = sorted(owners.values(), key=lambda item: str(item.get("path") or ""))
    tmp_path = IMAGE_OWNERS_FILE.with_suffix(IMAGE_OWNERS_FILE.suffix + ".tmp")
    tmp_path.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(IMAGE_OWNERS_FILE)


def record_image_owner(relative_path: str, identity: dict[str, object] | None) -> None:
    rel = _safe_relative_path(relative_path)
    owner = _owner_payload(identity)
    if not owner["owner_id"]:
        return
    with _owners_lock:
        owners = _load_image_owners_locked()
        owners[rel] = {"path": rel, **owner}
        _save_image_owners_locked(owners)
    try:
        upsert_asset(rel, owner_identity=identity)
    except Exception:
        pass


def forget_image_owner(relative_path: str) -> None:
    rel = _safe_relative_path(relative_path)
    with _owners_lock:
        owners = _load_image_owners_locked()
        if owners.pop(rel, None) is not None:
            _save_image_owners_locked(owners)


def _image_owner(relative_path: str) -> dict[str, object] | None:
    rel = _safe_relative_path(relative_path)
    with _owners_lock:
        return _load_image_owners_locked().get(rel)


def can_access_image(identity: dict[str, object] | None, relative_path: str) -> bool:
    if _is_admin(identity):
        return True
    owner_id = _identity_owner_id(identity)
    if not owner_id:
        return False
    owner = _image_owner(relative_path)
    return bool(owner and str(owner.get("owner_id") or "") == owner_id)


def require_image_access(identity: dict[str, object] | None, relative_path: str) -> str:
    rel = _safe_relative_path(relative_path)
    if not can_access_image(identity, rel):
        raise HTTPException(status_code=404, detail="image not found")
    return rel


def _thumbnail_path(relative_path: str) -> Path:
    rel = _safe_relative_path(relative_path)
    return config.image_thumbnails_dir / f"{rel}.png"


def thumbnail_url(base_url: str, relative_path: str) -> str:
    return f"{base_url.rstrip('/')}/image-thumbnails/{_safe_relative_path(relative_path)}"


def _image_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        with Image.open(path) as image:
            return image.size
    except Exception:
        return None


def ensure_thumbnail(relative_path: str) -> Path:
    source = _safe_image_path(relative_path)
    target = _thumbnail_path(relative_path)
    source_mtime = source.stat().st_mtime
    if target.exists() and target.stat().st_mtime >= source_mtime:
        return target

    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image)
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            image.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            image.save(target, format="PNG", optimize=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="failed to create thumbnail") from exc
    return target


def get_thumbnail_response(relative_path: str, identity: dict[str, object] | None = None) -> FileResponse:
    require_image_access(identity, relative_path)
    return FileResponse(ensure_thumbnail(relative_path))


def get_image_download_response(relative_path: str, identity: dict[str, object] | None = None) -> FileResponse:
    # 如果 identity 不为 None，则进行权限检查
    # 如果 identity 为 None，说明是通过签名 URL 访问，跳过权限检查
    if identity is not None:
        require_image_access(identity, relative_path)
    path = _safe_image_path(relative_path)
    return FileResponse(path, filename=path.name)


def cleanup_image_thumbnails() -> int:
    thumbnails_root = config.image_thumbnails_dir
    images_root = config.images_dir
    removed = 0
    for path in thumbnails_root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(thumbnails_root).as_posix()
        if not rel.endswith(".png") or not (images_root / rel[:-4]).exists():
            path.unlink()
            removed += 1
    _cleanup_empty_dirs(thumbnails_root)
    return removed


def _image_items(start_date: str = "", end_date: str = "") -> list[dict[str, object]]:
    items = []
    root = config.images_dir
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        parts = rel.split("/")
        day = "-".join(parts[:3]) if len(parts) >= 4 else datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d")
        if start_date and day < start_date:
            continue
        if end_date and day > end_date:
            continue
        dimensions = _image_dimensions(path)
        items.append({
            "rel": rel,
            "path": rel,
            "name": path.name,
            "date": day,
            "size": path.stat().st_size,
            "created_at": datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            **({"width": dimensions[0], "height": dimensions[1]} if dimensions else {}),
        })
    items.sort(key=lambda item: str(item["created_at"]), reverse=True)
    return items


def _all_image_paths() -> set[str]:
    root = config.images_dir
    return {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}


def _asset_list_item(asset: dict[str, object], disk_item: dict[str, object], base_url: str) -> dict[str, object]:
    path = str(disk_item.get("path") or asset.get("path") or "")
    dimensions = asset.get("dimensions") if isinstance(asset.get("dimensions"), dict) else {}
    width = dimensions.get("width") if isinstance(dimensions, dict) else None
    height = dimensions.get("height") if isinstance(dimensions, dict) else None
    normalized_dimensions = {"width": int(width), "height": int(height)} if width and height else {}
    created_at = str(asset.get("created_at") or disk_item.get("created_at") or "")
    return {
        **disk_item,
        "size": int(asset.get("bytes") or disk_item.get("size") or 0),
        "bytes": int(asset.get("bytes") or disk_item.get("size") or 0),
        "dimensions": normalized_dimensions,
        "created_at": created_at,
        "folder": str(asset.get("folder") or "/".join(path.split("/")[:-1])),
        "prompt": str(asset.get("prompt") or ""),
        "model": str(asset.get("model") or ""),
        "mode": str(asset.get("mode") or ""),
        "source_task_id": str(asset.get("source_task_id") or ""),
        "revised_prompt": str(asset.get("revised_prompt") or ""),
        "deleted_at": str(asset.get("deleted_at") or ""),
        **normalized_dimensions,
        "url": f"{base_url.rstrip('/')}/images/{path}",
        "thumbnail_url": thumbnail_url(base_url, path),
    }


def _normalize_sort(sort: str) -> tuple[str, bool]:
    value = str(sort or "").strip()
    descending = True
    if value.startswith("-"):
        field = value[1:]
    elif value.startswith("+"):
        field = value[1:]
        descending = False
    else:
        field = value
    if field in {"created_at", "date", "name", "size", "bytes", "model", "mode", "owner_id", "folder"}:
        return field, descending
    if field == "oldest":
        return "created_at", False
    if field == "name_asc":
        return "name", False
    if field == "size_desc":
        return "bytes", True
    if field == "size_asc":
        return "bytes", False
    return "created_at", True


def _matches_query(item: dict[str, object], query: str) -> bool:
    if not query:
        return True
    haystack = " ".join(
        str(item.get(key) or "")
        for key in ("path", "name", "prompt", "revised_prompt", "model", "mode", "source_task_id", "folder", "owner_name", "owner_id")
    )
    tags = item.get("tags")
    if isinstance(tags, list):
        haystack += " " + " ".join(str(tag) for tag in tags)
    return query.lower() in haystack.lower()


def _cleanup_missing_image_records(existing_paths: set[str]) -> None:
    with _owners_lock:
        owners = _load_image_owners_locked()
        removed_owner = False
        for path in list(owners):
            if path in existing_paths:
                continue
            owners.pop(path, None)
            removed_owner = True
        if removed_owner:
            _save_image_owners_locked(owners)
    all_tags = load_tags()
    for path in list(all_tags):
        if path not in existing_paths:
            remove_tags(path)
    mark_missing_assets_deleted(existing_paths)


def list_images(
    base_url: str,
    start_date: str = "",
    end_date: str = "",
    identity: dict[str, object] | None = None,
    page: int = 1,
    page_size: int = 0,
    search: str = "",
    tag: str = "",
    owner: str = "",
    mode: str = "",
    model: str = "",
    sort: str = "",
) -> dict[str, object]:
    config.cleanup_old_images()
    cleanup_image_thumbnails()
    _cleanup_missing_image_records(_all_image_paths())
    all_tags = load_tags()
    with _owners_lock:
        owners = _load_image_owners_locked()
    assets = load_assets()
    disk_items = _image_items(start_date, end_date)
    items = []
    for item in disk_items:
        path = str(item["path"])
        owner_record = owners.get(path)
        asset = assets.get(path)
        if asset is None:
            try:
                asset = upsert_asset(
                    path,
                    file_path=config.images_dir / path,
                    owner_identity=owner_record,
                    tags=all_tags.get(path, []),
                    created_at=str(item.get("created_at") or ""),
                )
            except Exception:
                asset = {}
        if asset and not owner_record and asset.get("owner_id"):
            owner_record = asset
        merged = _asset_list_item(asset or {}, item, base_url)
        tags = all_tags.get(path) or (asset.get("tags", []) if isinstance(asset, dict) else [])
        merged["tags"] = tags if isinstance(tags, list) else []
        if not _is_admin(identity):
            owner_id = _identity_owner_id(identity)
            if not owner_id or not owner_record or str(owner_record.get("owner_id") or "") != owner_id:
                continue
        if owner_record:
            merged.update({
                "owner_id": owner_record.get("owner_id"),
                "owner_name": owner_record.get("owner_name"),
                "owner_role": owner_record.get("owner_role"),
            })
        if owner_record and str(owner_record.get("owner_id") or "") and not merged.get("owner_id"):
            merged["owner_id"] = owner_record.get("owner_id")
        if search and not _matches_query(merged, search.strip()):
            continue
        required_tags = [
            candidate.strip()
            for candidate in tag.split(",")
            if candidate.strip()
        ]
        if required_tags and not all(candidate in merged.get("tags", []) for candidate in required_tags):
            continue
        if owner.strip():
            owner_value = owner.strip()
            if owner_value not in {str(merged.get("owner_id") or ""), str(merged.get("owner_name") or "")}:
                continue
        if mode.strip() and str(merged.get("mode") or "") != mode.strip():
            continue
        if model.strip() and str(merged.get("model") or "") != model.strip():
            continue
        items.append(merged)
    sort_field, descending = _normalize_sort(sort)
    items.sort(key=lambda item: item.get("bytes" if sort_field == "size" else sort_field) or "", reverse=descending)
    total = len(items)
    normalized_page = max(1, int(page or 1))
    normalized_page_size = max(0, min(500, int(page_size or 0)))
    if normalized_page_size:
        start = (normalized_page - 1) * normalized_page_size
        end = start + normalized_page_size
        items = items[start:end]
    groups: dict[str, list[dict[str, object]]] = {}
    for item in items:
        groups.setdefault(str(item["date"]), []).append(item)
    pages = max(1, (total + normalized_page_size - 1) // normalized_page_size) if normalized_page_size else 1
    return {
        "items": items,
        "groups": [{"date": key, "items": value} for key, value in groups.items()],
        "page": normalized_page,
        "page_size": normalized_page_size or total,
        "pages": pages,
        "total": total,
        "has_more": normalized_page_size > 0 and normalized_page * normalized_page_size < total,
    }


def _public_discover_item(item: dict[str, object], base_url: str) -> dict[str, object]:
    path = str(item.get("path") or item.get("rel") or "")
    prompt = str(item.get("prompt") or "").strip()
    revised_prompt = str(item.get("revised_prompt") or "").strip()
    title = str(item.get("title") or "").strip() or prompt or str(item.get("name") or path.rsplit("/", 1)[-1]).rsplit(".", 1)[0] or "公共精选"
    width = item.get("width")
    height = item.get("height")
    subtitle = f"{width} x {height}" if width and height else str(item.get("subtitle") or "").strip() or "ColaAI 公共精选"
    signed_url = generate_signed_image_url(path, base_url.rstrip("/"), expires_in=3600)
    return {
        "id": path,
        "title": title,
        "subtitle": subtitle,
        "prompt": revised_prompt or prompt or "复用这张公共精选的视觉风格继续创作。",
        "imageUrl": signed_url,
        "imageFallbackUrl": signed_url,
        "path": path,
        "created_at": str(item.get("created_at") or ""),
        "tags": item.get("tags") if isinstance(item.get("tags"), list) else [],
    }


def _path_from_public_preview_url(value: object) -> str | None:
    raw_value = str(value or "").strip()
    if not raw_value:
        return None
    parsed_path = urlparse(raw_value).path if "://" in raw_value or raw_value.startswith("//") else raw_value
    path = unquote(parsed_path.split("?", 1)[0].split("#", 1)[0]).lstrip("/")
    if path.startswith("images/"):
        return path.removeprefix("images/")
    if path.startswith("image-thumbnails/"):
        return path.removeprefix("image-thumbnails/")
    return None


def _existing_public_preview_path(preview: object) -> str | None:
    if not isinstance(preview, dict):
        return None
    for key in ("url", "thumbnail_url"):
        candidate = _path_from_public_preview_url(preview.get(key))
        if not candidate:
            continue
        for rel in (candidate, candidate.removesuffix(".png") if candidate.endswith(".png") else ""):
            if not rel:
                continue
            try:
                safe_rel = _safe_relative_path(rel)
            except HTTPException:
                continue
            if (config.images_dir / safe_rel).is_file():
                return safe_rel
    return None


def _public_template_preview_items() -> list[dict[str, object]]:
    from services.prompt_template_service import prompt_template_service

    try:
        templates = prompt_template_service.list(
            {"id": "public-discover", "name": "ColaAI", "role": "user"},
            scope="public",
        ).get("items", [])
    except Exception:
        return []

    items: list[dict[str, object]] = []
    for template in templates:
        if not isinstance(template, dict):
            continue
        if template.get("visibility") != "public" or template.get("review_status") != "approved":
            continue
        path = _existing_public_preview_path(template.get("preview_image"))
        if not path:
            continue
        dimensions = _image_dimensions(config.images_dir / path)
        tags = template.get("tags")
        item: dict[str, object] = {
            "path": path,
            "rel": path,
            "name": Path(path).name,
            "title": str(template.get("title") or "").strip(),
            "subtitle": str(template.get("description") or "").strip() or "ColaAI 公共精选",
            "prompt": str(template.get("prompt") or "").strip(),
            "created_at": str(template.get("updated_at") or template.get("created_at") or ""),
            "tags": tags if isinstance(tags, list) else [],
        }
        if dimensions:
            item.update({"width": dimensions[0], "height": dimensions[1]})
        items.append(item)
    return items


def list_public_discover_images(base_url: str, page: int = 1, page_size: int = 12) -> dict[str, object]:
    normalized_page = max(1, int(page or 1))
    normalized_page_size = max(1, min(48, int(page_size or 12)))
    tagged_result = list_images(
        base_url,
        identity={"role": "admin"},
        page=1,
        page_size=0,
        tag="public,discover",
        sort="-created_at",
    )
    merged_items: list[dict[str, object]] = []
    seen_paths: set[str] = set()
    for item in [*tagged_result["items"], *_public_template_preview_items()]:
        path = str(item.get("path") or item.get("rel") or "").strip()
        if not path or path in seen_paths:
            continue
        seen_paths.add(path)
        merged_items.append(item)
    merged_items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    total = len(merged_items)
    start = (normalized_page - 1) * normalized_page_size
    end = start + normalized_page_size
    items = [_public_discover_item(item, base_url) for item in merged_items[start:end]]
    pages = max(1, (total + normalized_page_size - 1) // normalized_page_size)
    return {
        "items": items,
        "groups": [],
        "page": normalized_page,
        "page_size": normalized_page_size,
        "pages": pages,
        "total": total,
        "has_more": normalized_page * normalized_page_size < total,
    }


def delete_images(paths: list[str] | None = None, start_date: str = "", end_date: str = "", all_matching: bool = False) -> dict[str, int]:
    root = config.images_dir.resolve()
    targets = [str(item["path"]) for item in _image_items(start_date, end_date)] if all_matching else (paths or [])
    removed = 0
    for item in targets:
        path = (root / item).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            continue
        if path.is_file():
            path.unlink()
            for thumbnail in (_thumbnail_path(item), config.image_thumbnails_dir / _safe_relative_path(item)):
                if thumbnail.is_file():
                    thumbnail.unlink()
            remove_tags(item)
            forget_image_owner(item)
            try:
                mark_asset_deleted(item)
            except Exception:
                pass
            removed += 1
    _cleanup_empty_dirs(root)
    _cleanup_empty_dirs(config.image_thumbnails_dir)
    return {"removed": removed}


def download_images_zip(paths: list[str]) -> io.BytesIO:
    root = config.images_dir.resolve()
    buf = io.BytesIO()
    added = 0
    used_names: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in paths:
            rel = _safe_relative_path(item)
            path = (root / rel).resolve()
            try:
                path.relative_to(root)
            except ValueError:
                continue
            if not path.is_file():
                continue
            name = path.name
            if name in used_names:
                stem = path.stem
                suffix = path.suffix
                counter = 2
                while f"{stem}_{counter}{suffix}" in used_names:
                    counter += 1
                name = f"{stem}_{counter}{suffix}"
            used_names.add(name)
            zf.write(path, name)
            added += 1
    if added == 0:
        raise HTTPException(status_code=404, detail="no images found")
    buf.seek(0)
    return buf
