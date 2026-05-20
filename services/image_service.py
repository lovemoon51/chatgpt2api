from __future__ import annotations

import io
import json
from threading import RLock
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse
from PIL import Image, ImageOps

from services.config import DATA_DIR, config
from services.image_tags_service import load_tags, remove_tags

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
    value = str(path or "").strip().replace("\\", "/").lstrip("/")
    if not value:
        raise HTTPException(status_code=404, detail="image not found")
    parts = Path(value).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise HTTPException(status_code=404, detail="image not found")
    return Path(*parts).as_posix()


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
    return str((identity or {}).get("role") or "").strip().lower() == "admin"


def _identity_owner_id(identity: dict[str, object] | None) -> str:
    return str((identity or {}).get("id") or "").strip()


def _owner_payload(identity: dict[str, object] | None) -> dict[str, object]:
    return {
        "owner_id": _identity_owner_id(identity),
        "owner_name": str((identity or {}).get("name") or "").strip(),
        "owner_role": str((identity or {}).get("role") or "").strip().lower(),
        "recorded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


def _load_image_owners_locked() -> dict[str, dict[str, object]]:
    try:
        raw = json.loads(IMAGE_OWNERS_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    items = raw.get("items") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
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


def list_images(
    base_url: str,
    start_date: str = "",
    end_date: str = "",
    identity: dict[str, object] | None = None,
) -> dict[str, object]:
    config.cleanup_old_images()
    cleanup_image_thumbnails()
    all_tags = load_tags()
    with _owners_lock:
        owners = _load_image_owners_locked()
    items = []
    for item in _image_items(start_date, end_date):
        path = str(item["path"])
        owner = owners.get(path)
        if not _is_admin(identity):
            owner_id = _identity_owner_id(identity)
            if not owner_id or not owner or str(owner.get("owner_id") or "") != owner_id:
                continue
        items.append({
            **item,
            "url": f"{base_url.rstrip('/')}/images/{path}",
            "thumbnail_url": thumbnail_url(base_url, path),
            "tags": all_tags.get(path, []),
            **({
                "owner_id": owner.get("owner_id"),
                "owner_name": owner.get("owner_name"),
                "owner_role": owner.get("owner_role"),
            } if owner else {}),
        })
    groups: dict[str, list[dict[str, object]]] = {}
    for item in items:
        groups.setdefault(str(item["date"]), []).append(item)
    return {"items": items, "groups": [{"date": key, "items": value} for key, value in groups.items()]}


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
