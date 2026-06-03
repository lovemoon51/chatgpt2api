from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.config import DATA_DIR

VISIBILITIES = {"private", "public"}
REVIEW_STATUSES = {"draft", "pending", "approved", "rejected"}


class PromptTemplateNotFound(KeyError):
    pass


class PromptTemplatePermissionError(PermissionError):
    pass


class PromptTemplateValidationError(ValueError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _clean(value: object, default: str = "") -> str:
    return str(value if value is not None else default).strip()


def _owner_id(identity: dict[str, object]) -> str:
    return _clean(identity.get("id")) or "anonymous"


def _owner_name(identity: dict[str, object]) -> str:
    return _clean(identity.get("name")) or _owner_id(identity)


def _is_admin(identity: dict[str, object]) -> bool:
    return identity.get("role") == "admin"


def _unique_tags(value: object) -> list[str]:
    raw_items: list[object]
    if isinstance(value, str):
        raw_items = value.replace("，", ",").split(",")
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = []
    tags: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        tag = _clean(item)
        if not tag or tag in seen:
            continue
        tags.append(tag)
        seen.add(tag)
    return tags


def _normalize_count(value: object, default: int = 1) -> int:
    try:
        count = int(value)
    except (TypeError, ValueError):
        count = default
    return max(1, min(8, count))


def _normalize_preview_image(value: object) -> dict[str, str]:
    source = value if isinstance(value, dict) else {}
    preview = {"url": _clean(source.get("url"))}
    thumbnail_url = _clean(source.get("thumbnail_url"))
    source_image_id = _clean(source.get("source_image_id"))
    if thumbnail_url:
        preview["thumbnail_url"] = thumbnail_url
    if source_image_id:
        preview["source_image_id"] = source_image_id
    return preview


class PromptTemplateService:
    def __init__(self, templates_path: Path, favorites_path: Path):
        self.templates_path = templates_path
        self.favorites_path = favorites_path
        self._lock = threading.RLock()
        self.templates_path.parent.mkdir(parents=True, exist_ok=True)
        self.favorites_path.parent.mkdir(parents=True, exist_ok=True)

    def list(
        self,
        identity: dict[str, object],
        *,
        scope: str = "public",
        q: str = "",
        tag: str = "",
        status: str = "",
    ) -> dict[str, list[dict[str, Any]]]:
        clean_scope = _clean(scope, "public")
        owner = _owner_id(identity)
        query = _clean(q).lower()
        clean_tag = _clean(tag)
        clean_status = _clean(status)
        with self._lock:
            templates = self._load_templates_locked()
            favorite_ids = self._favorite_ids_locked(owner)
            if clean_scope == "public":
                items = [
                    item
                    for item in templates
                    if item.get("visibility") == "public" and item.get("review_status") == "approved"
                ]
            elif clean_scope == "private":
                items = [
                    item
                    for item in templates
                    if item.get("owner_id") == owner and item.get("visibility") == "private"
                ]
            elif clean_scope == "favorites":
                public_ids = {
                    item.get("id")
                    for item in templates
                    if item.get("visibility") == "public" and item.get("review_status") == "approved"
                }
                items = [item for item in templates if item.get("id") in favorite_ids and item.get("id") in public_ids]
            elif clean_scope == "submissions":
                items = [
                    item
                    for item in templates
                    if item.get("owner_id") == owner and item.get("visibility") == "public"
                ]
            elif clean_scope == "review":
                if not _is_admin(identity):
                    raise PromptTemplatePermissionError("admin required")
                items = [item for item in templates if item.get("visibility") == "public"]
            else:
                raise PromptTemplateValidationError("unsupported scope")

            if clean_status:
                items = [item for item in items if item.get("review_status") == clean_status]
            if clean_tag:
                items = [item for item in items if clean_tag in item.get("tags", [])]
            if query:
                items = [item for item in items if self._matches_query(item, query)]

            items = sorted(items, key=lambda item: str(item.get("updated_at") or ""), reverse=True)
            return {"items": [self._public_template(item, favorite_ids) for item in items]}

    def stats(self, identity: dict[str, object]) -> dict[str, int]:
        owner = _owner_id(identity)
        with self._lock:
            templates = self._load_templates_locked()
            favorite_ids = self._favorite_ids_locked(owner)
            stats = {
                "public": sum(
                    1
                    for item in templates
                    if item.get("visibility") == "public" and item.get("review_status") == "approved"
                ),
                "private": sum(
                    1
                    for item in templates
                    if item.get("owner_id") == owner and item.get("visibility") == "private"
                ),
                "favorites": sum(1 for item in templates if item.get("id") in favorite_ids),
                "submissions": sum(
                    1
                    for item in templates
                    if item.get("owner_id") == owner and item.get("visibility") == "public"
                ),
            }
            if _is_admin(identity):
                stats["review"] = sum(
                    1
                    for item in templates
                    if item.get("visibility") == "public" and item.get("review_status") == "pending"
                )
            return stats

    def create(self, identity: dict[str, object], payload: dict[str, Any]) -> dict[str, Any]:
        owner = _owner_id(identity)
        now = _now_iso()
        template = self._normalize_payload(payload)
        template.update(
            {
                "id": uuid.uuid4().hex,
                "owner_id": owner,
                "owner_name": _owner_name(identity),
                "review_reason": "",
                "reviewed_by": "",
                "reviewed_at": "",
                "created_at": now,
                "updated_at": now,
            }
        )
        template["review_status"] = "pending" if template["visibility"] == "public" else "draft"
        with self._lock:
            templates = self._load_templates_locked()
            templates.append(template)
            self._save_templates_locked(templates)
            favorite_ids = self._favorite_ids_locked(owner)
            return self._public_template(template, favorite_ids)

    def update(self, identity: dict[str, object], template_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        owner = _owner_id(identity)
        with self._lock:
            templates = self._load_templates_locked()
            index, current = self._find_template_locked(templates, template_id)
            is_owner = current.get("owner_id") == owner
            if not self._can_update(identity, current):
                raise PromptTemplatePermissionError("template cannot be updated")
            updated = self._normalize_payload(payload, existing=current)
            if (
                is_owner
                and updated["visibility"] == "public"
                and updated.get("review_status") in {"rejected", "draft"}
            ):
                updated["review_status"] = "pending"
                updated["review_reason"] = ""
                updated["reviewed_by"] = ""
                updated["reviewed_at"] = ""
            updated["updated_at"] = _now_iso()
            templates[index] = updated
            self._save_templates_locked(templates)
            return self._public_template(updated, self._favorite_ids_locked(owner))

    def delete(self, identity: dict[str, object], template_id: str) -> dict[str, bool]:
        owner = _owner_id(identity)
        with self._lock:
            templates = self._load_templates_locked()
            _index, current = self._find_template_locked(templates, template_id)
            if not _is_admin(identity):
                if current.get("owner_id") != owner:
                    raise PromptTemplatePermissionError("template cannot be deleted")
                if current.get("visibility") == "public" and current.get("review_status") == "approved":
                    raise PromptTemplatePermissionError("approved public template cannot be deleted by owner")
            next_templates = [item for item in templates if item.get("id") != _clean(template_id)]
            self._save_templates_locked(next_templates)
            self._remove_favorites_for_template_locked(template_id)
            return {"ok": True}

    def favorite(self, identity: dict[str, object], template_id: str) -> dict[str, Any]:
        owner = _owner_id(identity)
        with self._lock:
            templates = self._load_templates_locked()
            _index, template = self._find_template_locked(templates, template_id)
            if template.get("visibility") != "public" or template.get("review_status") != "approved":
                raise PromptTemplatePermissionError("only approved public templates can be favorited")
            favorites = self._load_favorites_locked()
            if not any(item.get("user_id") == owner and item.get("template_id") == template.get("id") for item in favorites):
                favorites.append(
                    {
                        "template_id": template.get("id"),
                        "user_id": owner,
                        "created_at": _now_iso(),
                    }
                )
                self._save_favorites_locked(favorites)
            return self._public_template(template, self._favorite_ids_locked(owner))

    def unfavorite(self, identity: dict[str, object], template_id: str) -> dict[str, Any]:
        owner = _owner_id(identity)
        with self._lock:
            templates = self._load_templates_locked()
            _index, template = self._find_template_locked(templates, template_id)
            favorites = self._load_favorites_locked()
            next_favorites = [
                item
                for item in favorites
                if not (item.get("user_id") == owner and item.get("template_id") == template.get("id"))
            ]
            if len(next_favorites) != len(favorites):
                self._save_favorites_locked(next_favorites)
            return self._public_template(template, self._favorite_ids_locked(owner))

    def review(self, identity: dict[str, object], template_id: str, *, action: str, reason: str = "") -> dict[str, Any]:
        if not _is_admin(identity):
            raise PromptTemplatePermissionError("admin required")
        clean_action = _clean(action)
        clean_reason = _clean(reason)
        if clean_action not in {"approve", "reject"}:
            raise PromptTemplateValidationError("review action must be approve or reject")
        if clean_action == "reject" and not clean_reason:
            raise PromptTemplateValidationError("rejection reason is required")
        with self._lock:
            templates = self._load_templates_locked()
            index, template = self._find_template_locked(templates, template_id)
            if template.get("visibility") != "public":
                raise PromptTemplateValidationError("only public submissions can be reviewed")
            reviewed = dict(template)
            reviewed["review_status"] = "approved" if clean_action == "approve" else "rejected"
            reviewed["review_reason"] = "" if clean_action == "approve" else clean_reason
            reviewed["reviewed_by"] = _owner_id(identity)
            reviewed["reviewed_at"] = _now_iso()
            reviewed["updated_at"] = _now_iso()
            templates[index] = reviewed
            self._save_templates_locked(templates)
            return self._public_template(reviewed, self._favorite_ids_locked(_owner_id(identity)))

    def _normalize_payload(self, payload: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
        source = dict(payload or {})
        current = dict(existing or {})
        title = _clean(source.get("title", current.get("title")))
        prompt = _clean(source.get("prompt", current.get("prompt")))
        if not title:
            raise PromptTemplateValidationError("title is required")
        if not prompt:
            raise PromptTemplateValidationError("prompt is required")
        visibility = _clean(source.get("visibility", current.get("visibility") or "private"))
        if visibility not in VISIBILITIES:
            raise PromptTemplateValidationError("visibility must be private or public")
        review_status = _clean(current.get("review_status") or ("pending" if visibility == "public" else "draft"))
        if review_status not in REVIEW_STATUSES:
            review_status = "pending" if visibility == "public" else "draft"
        if visibility == "private":
            review_status = "draft"
        elif current and current.get("visibility") == "private":
            review_status = "pending"

        normalized = {
            **current,
            "title": title,
            "description": _clean(source.get("description", current.get("description"))),
            "prompt": prompt,
            "model": _clean(source.get("model", current.get("model") or "gpt-image-2"), "gpt-image-2"),
            "size": _clean(source.get("size", current.get("size") or "1:1"), "1:1"),
            "count": _normalize_count(source.get("count", current.get("count") or 1)),
            "tags": _unique_tags(source.get("tags", current.get("tags") or [])),
            "preview_image": _normalize_preview_image(source.get("preview_image", current.get("preview_image") or {})),
            "visibility": visibility,
            "review_status": review_status,
            "review_reason": _clean(current.get("review_reason")),
            "reviewed_by": _clean(current.get("reviewed_by")),
            "reviewed_at": _clean(current.get("reviewed_at")),
        }
        return normalized

    def _can_update(self, identity: dict[str, object], template: dict[str, Any]) -> bool:
        if _is_admin(identity):
            return True
        if template.get("owner_id") != _owner_id(identity):
            return False
        if template.get("visibility") == "private":
            return True
        return template.get("review_status") in {"pending", "rejected"}

    def _public_template(self, template: dict[str, Any], favorite_ids: set[str]) -> dict[str, Any]:
        item = {
            "id": _clean(template.get("id")),
            "title": _clean(template.get("title")),
            "description": _clean(template.get("description")),
            "prompt": _clean(template.get("prompt")),
            "model": _clean(template.get("model"), "gpt-image-2"),
            "size": _clean(template.get("size")),
            "count": _normalize_count(template.get("count")),
            "tags": _unique_tags(template.get("tags")),
            "preview_image": _normalize_preview_image(template.get("preview_image")),
            "owner_id": _clean(template.get("owner_id")),
            "owner_name": _clean(template.get("owner_name")),
            "visibility": _clean(template.get("visibility"), "private"),
            "review_status": _clean(template.get("review_status"), "draft"),
            "review_reason": _clean(template.get("review_reason")),
            "reviewed_by": _clean(template.get("reviewed_by")),
            "reviewed_at": _clean(template.get("reviewed_at")),
            "created_at": _clean(template.get("created_at")),
            "updated_at": _clean(template.get("updated_at")),
        }
        item["is_favorited"] = item["id"] in favorite_ids
        return item

    def _matches_query(self, template: dict[str, Any], query: str) -> bool:
        haystack = " ".join(
            [
                _clean(template.get("title")),
                _clean(template.get("description")),
                _clean(template.get("prompt")),
                " ".join(_unique_tags(template.get("tags"))),
                _clean(template.get("model")),
            ]
        ).lower()
        return query in haystack

    def _find_template_locked(self, templates: list[dict[str, Any]], template_id: str) -> tuple[int, dict[str, Any]]:
        clean_id = _clean(template_id)
        for index, item in enumerate(templates):
            if item.get("id") == clean_id:
                return index, item
        raise PromptTemplateNotFound("prompt template not found")

    def _load_templates_locked(self) -> list[dict[str, Any]]:
        raw = self._read_json_locked(self.templates_path)
        items = raw.get("items") if isinstance(raw, dict) else []
        return [self._public_template(item, set()) for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    def _save_templates_locked(self, items: list[dict[str, Any]]) -> None:
        self._write_json_locked(self.templates_path, {"items": items})

    def _load_favorites_locked(self) -> list[dict[str, str]]:
        raw = self._read_json_locked(self.favorites_path)
        items = raw.get("items") if isinstance(raw, dict) else []
        if not isinstance(items, list):
            return []
        favorites: list[dict[str, str]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            template_id = _clean(item.get("template_id"))
            user_id = _clean(item.get("user_id"))
            if template_id and user_id:
                favorites.append(
                    {
                        "template_id": template_id,
                        "user_id": user_id,
                        "created_at": _clean(item.get("created_at")),
                    }
                )
        return favorites

    def _save_favorites_locked(self, items: list[dict[str, str]]) -> None:
        self._write_json_locked(self.favorites_path, {"items": items})

    def _favorite_ids_locked(self, owner: str) -> set[str]:
        return {
            item["template_id"]
            for item in self._load_favorites_locked()
            if item.get("user_id") == owner and item.get("template_id")
        }

    def _remove_favorites_for_template_locked(self, template_id: str) -> None:
        clean_id = _clean(template_id)
        favorites = self._load_favorites_locked()
        next_favorites = [item for item in favorites if item.get("template_id") != clean_id]
        if len(next_favorites) != len(favorites):
            self._save_favorites_locked(next_favorites)

    def _read_json_locked(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _write_json_locked(self, path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(path)


prompt_template_service = PromptTemplateService(
    DATA_DIR / "prompt_templates.json",
    DATA_DIR / "prompt_template_favorites.json",
)
