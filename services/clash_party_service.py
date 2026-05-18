from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse

import requests
from curl_cffi import requests as curl_requests


DEFAULT_CONTROLLER_URL = "http://127.0.0.1:9090"
DEFAULT_PROXY_URL = "http://127.0.0.1:7890"
DEFAULT_KEYWORDS = ["日本", "东京", "大阪", "JP", "JPN", "Japan", "Tokyo", "Osaka", "🇯🇵"]


class ClashPartyError(RuntimeError):
    pass


@dataclass(frozen=True)
class ClashSelection:
    controller_url: str
    group: str
    proxy: str
    active_proxy: str
    proxy_url: str
    latency_ms: int
    config_path: str = ""

    def to_dict(self) -> dict[str, object]:
        return {
            "controller_url": self.controller_url,
            "group": self.group,
            "proxy": self.proxy,
            "active_proxy": self.active_proxy,
            "proxy_url": self.proxy_url,
            "latency_ms": self.latency_ms,
            "config_path": self.config_path,
        }


def _clean(value: object) -> str:
    return str(value or "").strip()


def _normalize_bool(value: object, default: bool = False) -> bool:
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    if value is None:
        return default
    return bool(value)


def _normalize_timeout(value: object) -> float:
    try:
        timeout = float(value)
    except (TypeError, ValueError):
        timeout = 5.0
    return min(30.0, max(1.0, timeout))


def _normalize_keywords(value: object) -> list[str]:
    if isinstance(value, str):
        items = re.split(r"[\n,]", value)
    elif isinstance(value, list):
        items = [str(item or "") for item in value]
    else:
        items = DEFAULT_KEYWORDS
    keywords = []
    seen = set()
    for item in items:
        keyword = item.strip()
        key = keyword.lower()
        if keyword and key not in seen:
            seen.add(key)
            keywords.append(keyword)
    return keywords or list(DEFAULT_KEYWORDS)


def normalize_clash_settings(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    return {
        "enabled": _normalize_bool(source.get("enabled"), False),
        "controller_url": normalize_controller_url(source.get("controller_url") or DEFAULT_CONTROLLER_URL),
        "secret": _clean(source.get("secret")),
        "group": _clean(source.get("group")),
        "selected_proxy": _clean(source.get("selected_proxy") or source.get("node")),
        "proxy": _clean(source.get("proxy") or source.get("proxy_url") or DEFAULT_PROXY_URL),
        "keywords": _normalize_keywords(source.get("keywords")),
        "timeout": _normalize_timeout(source.get("timeout")),
    }


def normalize_controller_url(value: object) -> str:
    controller_url = _clean(value) or DEFAULT_CONTROLLER_URL
    if controller_url.startswith(":"):
        controller_url = f"127.0.0.1{controller_url}"
    if not re.match(r"^https?://", controller_url, flags=re.IGNORECASE):
        controller_url = f"http://{controller_url}"
    return controller_url.rstrip("/")


def _candidate_config_paths() -> list[Path]:
    paths: list[Path] = []
    for env_name in ("CLASH_PARTY_CONFIG", "CLASH_CONFIG"):
        env_value = _clean(os.getenv(env_name))
        if env_value:
            paths.append(Path(env_value).expanduser())

    home = Path.home()
    appdata = _clean(os.getenv("APPDATA"))
    localappdata = _clean(os.getenv("LOCALAPPDATA"))
    candidates = [
        home / ".config" / "clash-party" / "config.yaml",
        home / ".config" / "clash-party" / "config.yml",
        home / ".config" / "clash" / "config.yaml",
        home / ".config" / "clash" / "config.yml",
    ]
    if appdata:
        candidates.extend(
            [
                Path(appdata) / "clash-party" / "config.yaml",
                Path(appdata) / "clash-party" / "config.yml",
                Path(appdata) / "Clash Party" / "config.yaml",
                Path(appdata) / "Clash Party" / "config.yml",
            ]
        )
    if localappdata:
        candidates.extend(
            [
                Path(localappdata) / "clash-party" / "config.yaml",
                Path(localappdata) / "clash-party" / "config.yml",
                Path(localappdata) / "Clash Party" / "config.yaml",
                Path(localappdata) / "Clash Party" / "config.yml",
            ]
        )

    seen = set()
    unique: list[Path] = []
    for path in paths + candidates:
        key = str(path)
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def _extract_yaml_scalar(text: str, key: str) -> str:
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*:\s*(.*?)\s*$", re.MULTILINE)
    match = pattern.search(text)
    if not match:
        return ""
    value = match.group(1).strip()
    if value.startswith(('"', "'")) and value.endswith(('"', "'")) and len(value) >= 2:
        value = value[1:-1]
    return value.strip()


def discover_local_settings() -> dict[str, str]:
    for path in _candidate_config_paths():
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        controller = _extract_yaml_scalar(text, "external-controller")
        secret = _extract_yaml_scalar(text, "secret")
        port = _extract_yaml_scalar(text, "mixed-port") or _extract_yaml_scalar(text, "port")
        discovered: dict[str, str] = {"config_path": str(path)}
        if controller:
            discovered["controller_url"] = normalize_controller_url(controller)
        if secret:
            discovered["secret"] = secret
        if port and port.isdigit():
            discovered["proxy"] = f"http://127.0.0.1:{port}"
        return discovered
    return {}


def _auth_headers(secret: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"} if secret else {}


def _request_json(method: str, url: str, *, secret: str, timeout: float, **kwargs) -> dict:
    try:
        response = requests.request(method, url, headers=_auth_headers(secret), timeout=timeout, **kwargs)
    except requests.RequestException as exc:
        raise ClashPartyError(f"Clash Party 控制器连接失败：{exc}") from exc
    if response.status_code == 401:
        raise ClashPartyError("Clash Party 控制器鉴权失败，请检查 Secret")
    if response.status_code >= 400:
        raise ClashPartyError(f"Clash Party 控制器返回 HTTP {response.status_code}: {response.text[:200]}")
    if not response.text.strip():
        return {}
    try:
        data = response.json()
    except ValueError as exc:
        raise ClashPartyError("Clash Party 控制器返回了非 JSON 内容") from exc
    return data if isinstance(data, dict) else {}


def _load_proxies(controller_url: str, secret: str, timeout: float) -> dict[str, dict]:
    data = _request_json("GET", f"{controller_url}/proxies", secret=secret, timeout=timeout)
    proxies = data.get("proxies") if isinstance(data.get("proxies"), dict) else data
    if not isinstance(proxies, dict) or not proxies:
        raise ClashPartyError("未从 Clash Party 读取到代理节点")
    return {str(name): meta for name, meta in proxies.items() if isinstance(meta, dict)}


def _load_proxy_meta(controller_url: str, secret: str, timeout: float, name: str) -> dict:
    data = _request_json("GET", f"{controller_url}/proxies/{quote(name, safe='')}", secret=secret, timeout=timeout)
    return data if isinstance(data, dict) else {}


def _matches_keyword(name: str, keywords: list[str]) -> bool:
    if not name:
        return False
    lowered = name.lower()
    for keyword in keywords:
        key = keyword.strip().lower()
        if not key:
            continue
        if key in {"jp", "jpn"}:
            if re.search(r"(^|[^a-z0-9])jpn?([^a-z0-9]|$)", lowered):
                return True
            continue
        if key in lowered:
            return True
    return False


def _group_items(meta: dict) -> list[str]:
    items = meta.get("all")
    if isinstance(items, list):
        return [str(item) for item in items if str(item or "").strip()]
    return []


def _is_selectable_group(meta: dict) -> bool:
    proxy_type = str(meta.get("type") or "").lower()
    return proxy_type == "selector" or bool(_group_items(meta))


def _candidate_groups(proxies: dict[str, dict]) -> list[tuple[str, dict]]:
    groups = [(name, meta) for name, meta in proxies.items() if _is_selectable_group(meta)]
    return sorted(groups, key=lambda item: (str(item[1].get("type") or "").lower() != "selector", item[0].lower()))


def _find_proxy_in_group(group_name: str, group_meta: dict, keywords: list[str], proxies: dict[str, dict]) -> str:
    for candidate in _group_items(group_meta):
        if _matches_keyword(candidate, keywords):
            return candidate

    for candidate in _group_items(group_meta):
        nested = proxies.get(candidate)
        if isinstance(nested, dict) and _matches_keyword(str(nested.get("name") or candidate), keywords):
            return candidate
    return ""


def _choose_group_and_proxy(proxies: dict[str, dict], group: str, keywords: list[str]) -> tuple[str, str]:
    if group:
        meta = proxies.get(group)
        if not isinstance(meta, dict):
            raise ClashPartyError(f"未找到 Clash Party 节点组：{group}")
        proxy = _find_proxy_in_group(group, meta, keywords, proxies)
        if not proxy:
            raise ClashPartyError(f"节点组 {group} 中未找到日本线路")
        return group, proxy

    scored: list[tuple[int, str, str]] = []
    for group_name, group_meta in _candidate_groups(proxies):
        proxy = _find_proxy_in_group(group_name, group_meta, keywords, proxies)
        if not proxy:
            continue
        score = 0
        lowered = group_name.lower()
        if "global" in lowered or "proxy" in lowered or "节点" in group_name or "选择" in group_name:
            score += 10
        if str(group_meta.get("type") or "").lower() == "selector":
            score += 5
        scored.append((score, group_name, proxy))

    if not scored:
        raise ClashPartyError("未找到匹配日本关键词的 Clash Party 线路")
    scored.sort(key=lambda item: (-item[0], item[1].lower()))
    _, selected_group, selected_proxy = scored[0]
    return selected_group, selected_proxy


def _validate_controller_url(controller_url: str) -> None:
    parsed = urlparse(controller_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ClashPartyError("Clash Party 控制器地址不合法")


def _resolved_settings(settings: object) -> dict[str, object]:
    source = settings if isinstance(settings, dict) else {}
    normalized = normalize_clash_settings(settings)
    discovered = discover_local_settings()
    controller_url = normalize_controller_url(source.get("controller_url") or discovered.get("controller_url") or DEFAULT_CONTROLLER_URL)
    secret = _clean(source.get("secret") or discovered.get("secret"))
    proxy_url = _clean(source.get("proxy") or source.get("proxy_url") or discovered.get("proxy") or DEFAULT_PROXY_URL)
    _validate_controller_url(controller_url)
    return {
        **normalized,
        "controller_url": controller_url,
        "secret": secret,
        "proxy": proxy_url,
        "timeout": _normalize_timeout(normalized.get("timeout")),
        "config_path": _clean(discovered.get("config_path")),
    }


def _node_meta(name: str, proxies: dict[str, dict]) -> dict[str, object]:
    meta = proxies.get(name)
    if not isinstance(meta, dict):
        meta = {}
    node: dict[str, object] = {
        "name": name,
        "type": _clean(meta.get("type")),
        "now": _clean(meta.get("now")),
    }
    if isinstance(meta.get("alive"), bool):
        node["alive"] = bool(meta.get("alive"))
    history = meta.get("history")
    if isinstance(history, list) and history:
        latest = history[-1]
        if isinstance(latest, dict) and latest.get("delay") is not None:
            node["delay"] = latest.get("delay")
    return node


def list_proxy_groups(settings: object) -> dict[str, object]:
    resolved = _resolved_settings(settings)
    controller_url = str(resolved["controller_url"])
    secret = str(resolved["secret"])
    proxy_url = str(resolved["proxy"])
    timeout = float(resolved["timeout"])
    configured_group = _clean(resolved.get("group"))

    started = time.perf_counter()
    proxies = _load_proxies(controller_url, secret, timeout)
    groups: list[dict[str, object]] = []
    for group_name, group_meta in _candidate_groups(proxies):
        items = _group_items(group_meta)
        if not items:
            continue
        groups.append(
            {
                "name": group_name,
                "type": _clean(group_meta.get("type")),
                "now": _clean(group_meta.get("now")),
                "all": items,
                "nodes": [_node_meta(item, proxies) for item in items],
            }
        )

    if not groups:
        raise ClashPartyError("未从 Clash 控制器读取到可选择的节点组")

    selected_group = configured_group if any(item["name"] == configured_group for item in groups) else str(groups[0]["name"])
    active_proxy = ""
    for group in groups:
        if group["name"] == selected_group:
            active_proxy = _clean(group.get("now")) or _clean(resolved.get("selected_proxy"))
            break

    return {
        "controller_url": controller_url,
        "proxy_url": proxy_url,
        "group": selected_group,
        "proxy": active_proxy,
        "active_proxy": active_proxy,
        "groups": groups,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "config_path": str(resolved.get("config_path") or ""),
    }


def select_proxy(settings: object, group: str, proxy: str) -> dict[str, object]:
    resolved = _resolved_settings(settings)
    controller_url = str(resolved["controller_url"])
    secret = str(resolved["secret"])
    proxy_url = str(resolved["proxy"])
    timeout = float(resolved["timeout"])
    group_name = _clean(group)
    proxy_name = _clean(proxy)
    if not group_name:
        raise ClashPartyError("请选择 Clash 节点组")
    if not proxy_name:
        raise ClashPartyError("请选择 Clash 节点")

    started = time.perf_counter()
    proxies = _load_proxies(controller_url, secret, timeout)
    group_meta = proxies.get(group_name)
    if not isinstance(group_meta, dict) or not _is_selectable_group(group_meta):
        raise ClashPartyError(f"未找到 Clash 节点组：{group_name}")
    if proxy_name not in _group_items(group_meta):
        raise ClashPartyError(f"节点 {proxy_name} 不在节点组 {group_name} 中")

    _request_json(
        "PUT",
        f"{controller_url}/proxies/{quote(group_name, safe='')}",
        secret=secret,
        timeout=timeout,
        json={"name": proxy_name},
    )
    active_proxy = proxy_name
    try:
        next_group_meta = _load_proxy_meta(controller_url, secret, timeout, group_name)
        active_proxy = _clean(next_group_meta.get("now")) or proxy_name
    except ClashPartyError:
        active_proxy = proxy_name

    return ClashSelection(
        controller_url=controller_url,
        group=group_name,
        proxy=proxy_name,
        active_proxy=active_proxy,
        proxy_url=proxy_url,
        latency_ms=int((time.perf_counter() - started) * 1000),
        config_path=str(resolved.get("config_path") or ""),
    ).to_dict()


def switch_to_japan(settings: object) -> dict[str, object]:
    source = settings if isinstance(settings, dict) else {}
    normalized = normalize_clash_settings(settings)
    discovered = discover_local_settings()
    controller_url = normalize_controller_url(source.get("controller_url") or discovered.get("controller_url") or DEFAULT_CONTROLLER_URL)
    secret = _clean(source.get("secret") or discovered.get("secret"))
    proxy_url = _clean(source.get("proxy") or source.get("proxy_url") or discovered.get("proxy") or DEFAULT_PROXY_URL)
    group = _clean(normalized.get("group"))
    keywords = _normalize_keywords(normalized.get("keywords"))
    timeout = _normalize_timeout(normalized.get("timeout"))

    _validate_controller_url(controller_url)
    started = time.perf_counter()
    proxies = _load_proxies(controller_url, secret, timeout)
    group_name, proxy_name = _choose_group_and_proxy(proxies, group, keywords)
    _request_json(
        "PUT",
        f"{controller_url}/proxies/{quote(group_name, safe='')}",
        secret=secret,
        timeout=timeout,
        json={"name": proxy_name},
    )
    active_proxy = proxy_name
    try:
        group_meta = _load_proxy_meta(controller_url, secret, timeout, group_name)
        active_proxy = _clean(group_meta.get("now")) or proxy_name
    except ClashPartyError:
        active_proxy = proxy_name
    latency_ms = int((time.perf_counter() - started) * 1000)
    selection = ClashSelection(
        controller_url=controller_url,
        group=group_name,
        proxy=proxy_name,
        active_proxy=active_proxy,
        proxy_url=proxy_url,
        latency_ms=latency_ms,
        config_path=_clean(discovered.get("config_path")),
    )
    return selection.to_dict()


def get_current_selection(settings: object) -> dict[str, object]:
    source = settings if isinstance(settings, dict) else {}
    normalized = normalize_clash_settings(settings)
    discovered = discover_local_settings()
    controller_url = normalize_controller_url(source.get("controller_url") or discovered.get("controller_url") or DEFAULT_CONTROLLER_URL)
    secret = _clean(source.get("secret") or discovered.get("secret"))
    proxy_url = _clean(source.get("proxy") or source.get("proxy_url") or discovered.get("proxy") or DEFAULT_PROXY_URL)
    group = _clean(normalized.get("group"))
    timeout = _normalize_timeout(normalized.get("timeout"))

    _validate_controller_url(controller_url)
    started = time.perf_counter()
    if group:
        group_meta = _load_proxy_meta(controller_url, secret, timeout, group)
        active_proxy = _clean(group_meta.get("now"))
        if not active_proxy:
            raise ClashPartyError(f"节点组 {group} 未返回当前选中节点")
        return {
            "controller_url": controller_url,
            "group": group,
            "proxy": active_proxy,
            "active_proxy": active_proxy,
            "proxy_url": proxy_url,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "config_path": _clean(discovered.get("config_path")),
        }

    proxies = _load_proxies(controller_url, secret, timeout)
    candidates: list[tuple[int, str, str]] = []
    for group_name, group_meta in _candidate_groups(proxies):
        active_proxy = _clean(group_meta.get("now"))
        if not active_proxy or active_proxy.upper() in {"DIRECT", "REJECT"}:
            continue
        score = 0
        lowered = group_name.lower()
        if "global" not in lowered:
            score += 5
        if _matches_keyword(active_proxy, _normalize_keywords(normalized.get("keywords"))):
            score += 10
        candidates.append((score, group_name, active_proxy))
    if not candidates:
        raise ClashPartyError("未读取到当前选中的代理节点")
    candidates.sort(key=lambda item: (-item[0], item[1].lower()))
    _, group_name, active_proxy = candidates[0]
    return {
        "controller_url": controller_url,
        "group": group_name,
        "proxy": active_proxy,
        "active_proxy": active_proxy,
        "proxy_url": proxy_url,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "config_path": _clean(discovered.get("config_path")),
    }


def detect_outbound_ip(proxy_url: str = "", *, timeout: float = 8.0) -> dict[str, object]:
    proxy_url = _clean(proxy_url)
    last_error = ""
    endpoints = [
        "https://ipinfo.io/json",
        "https://ipwho.is/",
    ]
    for endpoint in endpoints:
        try:
            kwargs: dict[str, object] = {
                "timeout": timeout,
                "headers": {"user-agent": "chatgpt2api/register-ip-check"},
            }
            if proxy_url:
                kwargs["proxy"] = proxy_url
            response = curl_requests.get(endpoint, **kwargs)
            if response.status_code >= 400:
                last_error = f"HTTP {response.status_code}"
                continue
            data = response.json()
            if not isinstance(data, dict):
                last_error = "invalid json"
                continue
            ip = _clean(data.get("ip"))
            country_code = _clean(data.get("country_code") or data.get("country")).upper()
            country = _clean(data.get("country_name") or data.get("country"))
            if endpoint.startswith("https://ipwho.is"):
                country = _clean(data.get("country"))
                country_code = _clean(data.get("country_code")).upper()
            if not ip:
                last_error = "missing ip"
                continue
            connection = data.get("connection")
            org = _clean(data.get("org"))
            if not org and isinstance(connection, dict):
                org = _clean(connection.get("org"))
            return {
                "ok": True,
                "ip": ip,
                "country_code": country_code,
                "country": country,
                "region": _clean(data.get("region")),
                "city": _clean(data.get("city")),
                "org": org,
                "proxy_url": proxy_url,
            }
        except Exception as exc:
            last_error = str(exc) or exc.__class__.__name__
    return {"ok": False, "error": last_error or "ip check failed", "proxy_url": proxy_url}
