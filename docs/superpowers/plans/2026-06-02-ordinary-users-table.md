# Ordinary Users Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist ordinary user identity in a dedicated users store while keeping the existing access-code login and `/api/auth/users` management behavior compatible.

**Architecture:** Add `load_users` / `save_users` to the storage abstraction and implement it for JSON, database, Git, and PostgreSQL sync storage. `AuthService` owns the migration from legacy `auth_keys` user entries to users records, keeps user profile fields in users, and keeps access credentials in `auth_keys` linked by `user_id`.

**Tech Stack:** Python, FastAPI, SQLAlchemy, existing JSON/Git/database storage backends, unittest/pytest.

---

### Task 1: Storage Contract And Migration Tests

**Files:**
- Modify: `test/test_user_key_limits.py`
- Modify: `test/test_postgres_sync_storage.py`
- Modify: `test/test_migrate_storage.py`

- [ ] Write failing tests proving ordinary users are saved separately from auth keys.
- [ ] Write failing tests proving legacy `auth_keys` user records are migrated into users records.
- [ ] Write failing tests proving storage migration/export/import copies users.

### Task 2: Storage Backends

**Files:**
- Modify: `services/storage/base.py`
- Modify: `services/storage/json_storage.py`
- Modify: `services/storage/database_storage.py`
- Modify: `services/storage/git_storage.py`
- Modify: `services/storage/postgres_sync_storage.py`
- Modify: `services/storage/factory.py`

- [ ] Add `load_users` and `save_users` to the storage contract.
- [ ] Add a `users` table to database storage.
- [ ] Add `users.json` support to JSON and Git storage.
- [ ] Sync users in PostgreSQL mirror storage.

### Task 3: Auth Service

**Files:**
- Modify: `services/auth_service.py`

- [ ] Load auth keys and users together.
- [ ] Create a users record for every new ordinary user.
- [ ] Link ordinary-user auth keys with `user_id`.
- [ ] Migrate legacy ordinary-user auth keys into users records on load.
- [ ] Authenticate access codes, username login, and session tokens against the users record.

### Task 4: Data Portability

**Files:**
- Modify: `scripts/migrate_storage.py`
- Modify: `services/backup_service.py`
- Modify: `services/config.py` if backup defaults need a new include key.

- [ ] Export/import users with accounts and auth keys.
- [ ] Include users in logical backup snapshots.
- [ ] Verify backup integrity recognizes `snapshots/users.json`.

### Task 5: Verification

**Commands:**
- `uv run pytest test/test_user_key_limits.py test/test_account_image_capabilities.py test/test_postgres_sync_storage.py test/test_migrate_storage.py test/test_backup_integrity.py -q`
- `uv run pytest test/test_system_status_api.py test/test_auth_audit_service.py -q`
