from __future__ import annotations

import io
import json
import zipfile
import base64
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any

CPA_BATCH_SIZE = 100
CPA_TIMEZONE = timezone(timedelta(hours=8))
CPA_AUTH_CLAIM = "https://api.openai.com/auth"
CPA_PROFILE_CLAIM = "https://api.openai.com/profile"


def convert_cpa_time(value: object) -> str:
    time_str = str(value or "").strip()
    if not time_str:
        return ""
    try:
        dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
        return dt.astimezone(CPA_TIMEZONE).isoformat()
    except Exception:
        return time_str


def safe_cpa_email_filename(value: object) -> str:
    email = str(value or "unknown_email")
    safe_email = "".join(char for char in email if char.isalnum() or char in "@._-")
    return safe_email or "unknown_email"


def sanitize_cpa_filename_part(value: object) -> str:
    text = str(value or "").strip() or "unknown"
    for char in '\\/:*?"<>|':
        text = text.replace(char, "-")
    return text or "unknown"


def _decode_jwt_payload(token: object) -> dict[str, Any]:
    value = str(token or "").strip()
    parts = value.split(".")
    if len(parts) < 2 or not parts[1]:
        return {}
    payload = parts[1]
    payload += "=" * (-len(payload) % 4)
    try:
        data = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _token_payloads(item: dict[str, Any]) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for key in ("access_token", "id_token", "oauth_id_token"):
        payload = _decode_jwt_payload(item.get(key))
        if payload:
            payloads.append(payload)
    return payloads


def _first_string(*values: object) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _auth_claims(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    for payload in payloads:
        claims = payload.get(CPA_AUTH_CLAIM)
        if isinstance(claims, dict):
            return claims
    return {}


def _profile_claims(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    for payload in payloads:
        claims = payload.get(CPA_PROFILE_CLAIM)
        if isinstance(claims, dict):
            return claims
    return {}


def _epoch_from_value(value: object) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        return int(float(text))
    except (TypeError, ValueError):
        pass
    try:
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())
    except Exception:
        return 0


def _iso_from_epoch(value: object) -> str:
    epoch = _epoch_from_value(value)
    if epoch <= 0:
        return ""
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace("+00:00", "Z")


def _expires_from_item(item: dict[str, Any], payloads: list[dict[str, Any]]) -> str:
    direct = _first_string(item.get("expires"), item.get("expired"))
    if direct:
        return direct
    for payload in payloads:
        expires = _iso_from_epoch(payload.get("exp"))
        if expires:
            return expires
    return ""


def _base64_url_json(value: dict[str, Any]) -> str:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def build_synthetic_id_token(
        email: str,
        account_id: str,
        plan_type: str,
        user_id: str,
        expires: object,
        *,
        now_epoch: int | None = None,
) -> str:
    if not account_id:
        return ""

    now = int(now_epoch if now_epoch is not None else datetime.now(timezone.utc).timestamp())
    exp = _epoch_from_value(expires) or now + 90 * 24 * 60 * 60
    auth_info: dict[str, Any] = {"chatgpt_account_id": account_id}
    if plan_type:
        auth_info["chatgpt_plan_type"] = plan_type
    if user_id:
        auth_info["chatgpt_user_id"] = user_id
        auth_info["user_id"] = user_id

    payload: dict[str, Any] = {
        "iat": now,
        "exp": exp,
        CPA_AUTH_CLAIM: auth_info,
    }
    if email:
        payload["email"] = email

    return f"{_base64_url_json({'alg': 'none', 'typ': 'JWT', 'cpa_synthetic': True})}.{_base64_url_json(payload)}."


def account_to_cpa_item(item: dict[str, Any], *, now_epoch: int | None = None) -> dict[str, Any]:
    access_token = str(item.get("access_token") or "")
    payloads = _token_payloads(item)
    auth = _auth_claims(payloads)
    profile = _profile_claims(payloads)
    email = _first_string(item.get("email"), profile.get("email"), "unknown_email")
    account_id = _first_string(
        item.get("account_id"),
        item.get("chatgpt_account_id"),
        auth.get("chatgpt_account_id"),
        item.get("user_id"),
        auth.get("user_id"),
    )
    user_id = _first_string(item.get("user_id"), auth.get("chatgpt_user_id"), auth.get("user_id"))
    plan_type = _first_string(item.get("plan_type"), item.get("type"), auth.get("chatgpt_plan_type"))
    expires = _expires_from_item(item, payloads)
    return {
        "access_token": access_token,
        "account_id": account_id,
        "email": email,
        "expired": expires,
        "chatgpt_account_id": account_id,
        "plan_type": plan_type,
        "chatgpt_plan_type": plan_type,
        "session_token": str(item.get("session_token") or ""),
        "last_refresh": str(item.get("last_refresh") or ""),
        "refresh_token": "",
        "type": "codex",
        "disabled": False,
        "id_token_synthetic": True,
        "id_token": build_synthetic_id_token(email, account_id, plan_type, user_id, expires, now_epoch=now_epoch),
    }


def build_cpa_auth_filename(item: dict[str, Any]) -> str:
    email = sanitize_cpa_filename_part(item.get("email") or "unknown-email")
    plan = sanitize_cpa_filename_part(item.get("plan_type") or "unknown-plan")
    return f"codex-{email}-{plan}.json"


def build_cpa_export_zip(items: list[dict[str, Any]]) -> io.BytesIO:
    entries: OrderedDict[str, str] = OrderedDict()
    folder_index = 1
    file_count = 0

    for item in items:
        cpa_item = account_to_cpa_item(item)
        folder = f"batch_{folder_index}"
        filename = build_cpa_auth_filename(cpa_item)
        path = f"{folder}/{filename}"
        entries[path] = json.dumps(cpa_item, ensure_ascii=False, indent=4)

        file_count += 1
        if file_count >= CPA_BATCH_SIZE:
            folder_index += 1
            file_count = 0

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in entries.items():
            zf.writestr(path, content)
    buf.seek(0)
    return buf
