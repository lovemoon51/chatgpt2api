from __future__ import annotations

import os
from pathlib import Path

from services.storage.base import StorageBackend
from services.storage.database_storage import DatabaseStorageBackend
from services.storage.git_storage import GitStorageBackend
from services.storage.json_storage import JSONStorageBackend
from services.storage.postgres_sync_storage import PostgresSyncStorageBackend


def create_storage_backend(data_dir: Path) -> StorageBackend:
    """
    根据环境变量创建存储后端
    
    环境变量：
    - STORAGE_BACKEND: json|sqlite|postgres|git (默认 json)
    - DATABASE_URL: 数据库连接字符串 (用于 sqlite/postgres)
    - POSTGRES_SYNC_DATABASE_URL: PostgreSQL 镜像同步连接字符串
    - GIT_REPO_URL: Git 仓库地址 (用于 git)
    - GIT_TOKEN: Git 访问令牌 (用于 git)
    - GIT_BRANCH: Git 分支 (默认 main)
    - GIT_FILE_PATH: Git 仓库中的文件路径 (默认 accounts.json)
    """
    backend_type = os.getenv("STORAGE_BACKEND", "json").lower().strip()

    print(f"[storage] Initializing storage backend: {backend_type}")

    database_url = os.getenv("DATABASE_URL", "").strip()
    primary_is_postgres = backend_type in ("postgres", "postgresql") or (
        backend_type in ("database", "mysql", "sqlite")
        and _is_postgres_url(database_url)
    )

    if backend_type == "json":
        # 本地 JSON 文件存储
        file_path = data_dir / "accounts.json"
        auth_keys_path = data_dir / "auth_keys.json"
        print(f"[storage] Using JSON storage: {file_path}")
        backend = JSONStorageBackend(file_path, auth_keys_path)

    elif backend_type in ("sqlite", "postgres", "postgresql", "mysql", "database"):
        # 数据库存储
        if not database_url:
            # 如果没有指定 DATABASE_URL，使用本地 SQLite
            database_url = f"sqlite:///{data_dir / 'accounts.db'}"
            print(f"[storage] No DATABASE_URL provided, using local SQLite: {database_url}")
        else:
            print(f"[storage] Using database storage: {_mask_password(database_url)}")

        backend = DatabaseStorageBackend(database_url)

    elif backend_type == "git":
        # Git 仓库存储
        repo_url = os.getenv("GIT_REPO_URL", "").strip()
        token = os.getenv("GIT_TOKEN", "").strip()
        branch = os.getenv("GIT_BRANCH", "main").strip()
        file_path = os.getenv("GIT_FILE_PATH", "accounts.json").strip()
        auth_keys_file_path = os.getenv("GIT_AUTH_KEYS_FILE_PATH", "auth_keys.json").strip()
        users_file_path = os.getenv("GIT_USERS_FILE_PATH", "users.json").strip()

        if not repo_url:
            raise ValueError(
                "GIT_REPO_URL is required when using git storage backend. "
                "Please set GIT_REPO_URL environment variable."
            )

        print(f"[storage] Using Git storage: {_mask_token(repo_url)}, branch: {branch}, file: {file_path}")

        cache_dir = data_dir / "git_cache"
        backend = GitStorageBackend(
            repo_url=repo_url,
            token=token,
            branch=branch,
            file_path=file_path,
            auth_keys_file_path=auth_keys_file_path,
            users_file_path=users_file_path,
            local_cache_dir=cache_dir,
        )

    else:
        raise ValueError(
            f"Unknown storage backend: {backend_type}. "
            f"Supported backends: json, sqlite, postgres, git"
        )

    sync_database_url = os.getenv("POSTGRES_SYNC_DATABASE_URL", "").strip()
    if sync_database_url and not primary_is_postgres:
        print(f"[storage] Enabling PostgreSQL sync storage: {_mask_password(sync_database_url)}")
        return PostgresSyncStorageBackend(
            primary=backend,
            postgres=DatabaseStorageBackend(sync_database_url),
        )

    return backend


def _mask_password(url: str) -> str:
    """隐藏数据库连接字符串中的密码"""
    if "://" not in url:
        return url
    try:
        protocol, rest = url.split("://", 1)
        if "@" in rest:
            credentials, host = rest.split("@", 1)
            if ":" in credentials:
                username, _ = credentials.split(":", 1)
                return f"{protocol}://{username}:****@{host}"
        return url
    except Exception:
        return url


def _is_postgres_url(url: str) -> bool:
    normalized = url.lower().strip()
    return normalized.startswith("postgres://") or normalized.startswith("postgresql://")


def _mask_token(url: str) -> str:
    """隐藏 URL 中的 token"""
    if "@" in url and "://" in url:
        protocol, rest = url.split("://", 1)
        if "@" in rest:
            _, host = rest.split("@", 1)
            return f"{protocol}://****@{host}"
    return url
