from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from services.image_metadata_storage import (
    DatabaseImageMetadataStorage,
    get_image_metadata_storage,
    reset_image_metadata_storage_for_tests,
)


class ImageMetadataStorageTests(unittest.TestCase):
    def tearDown(self) -> None:
        reset_image_metadata_storage_for_tests()

    def test_database_store_round_trips_collection_items_by_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            storage = DatabaseImageMetadataStorage(f"sqlite:///{Path(tmp_dir) / 'metadata.db'}")

            storage.save_map(
                "image_assets",
                {
                    "2026/06/02/a.png": {"path": "2026/06/02/a.png", "tags": ["public"]},
                    "2026/06/02/b.png": {"path": "2026/06/02/b.png", "tags": ["private"]},
                },
            )

            self.assertEqual(
                storage.load_map("image_assets"),
                {
                    "2026/06/02/a.png": {"path": "2026/06/02/a.png", "tags": ["public"]},
                    "2026/06/02/b.png": {"path": "2026/06/02/b.png", "tags": ["private"]},
                },
            )

            storage.upsert_item("image_assets", "2026/06/02/a.png", {"path": "2026/06/02/a.png", "tags": ["featured"]})
            storage.delete_item("image_assets", "2026/06/02/b.png")

            self.assertEqual(
                storage.load_map("image_assets"),
                {"2026/06/02/a.png": {"path": "2026/06/02/a.png", "tags": ["featured"]}},
            )

    def test_get_image_metadata_storage_uses_image_metadata_url_before_postgres_sync_url(self) -> None:
        old_env = {
            "IMAGE_METADATA_DATABASE_URL": os.environ.get("IMAGE_METADATA_DATABASE_URL"),
            "POSTGRES_SYNC_DATABASE_URL": os.environ.get("POSTGRES_SYNC_DATABASE_URL"),
        }
        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                image_metadata_url = f"sqlite:///{Path(tmp_dir) / 'image-meta.db'}"
                postgres_sync_url = f"sqlite:///{Path(tmp_dir) / 'sync.db'}"
                os.environ["IMAGE_METADATA_DATABASE_URL"] = image_metadata_url
                os.environ["POSTGRES_SYNC_DATABASE_URL"] = postgres_sync_url

                storage = get_image_metadata_storage()

            self.assertIsInstance(storage, DatabaseImageMetadataStorage)
            self.assertEqual(storage.database_url, image_metadata_url)
        finally:
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            reset_image_metadata_storage_for_tests()

    def test_image_assets_seed_legacy_json_into_database_when_enabled(self) -> None:
        from services import image_asset_service

        old_env = {
            "IMAGE_METADATA_DATABASE_URL": os.environ.get("IMAGE_METADATA_DATABASE_URL"),
            "POSTGRES_SYNC_DATABASE_URL": os.environ.get("POSTGRES_SYNC_DATABASE_URL"),
        }
        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                root = Path(tmp_dir)
                metadata_url = f"sqlite:///{root / 'metadata.db'}"
                os.environ["IMAGE_METADATA_DATABASE_URL"] = metadata_url
                os.environ.pop("POSTGRES_SYNC_DATABASE_URL", None)
                reset_image_metadata_storage_for_tests()

                legacy_file = root / "image_assets.json"
                legacy_file.write_text(
                    json.dumps(
                        {
                            "items": [
                                {
                                    "path": "2026/06/02/cat.png",
                                    "owner_id": "user-1",
                                    "created_at": "2026-06-02 00:00:00",
                                    "tags": ["public"],
                                }
                            ]
                        }
                    ),
                    encoding="utf-8",
                )

                with mock.patch.object(image_asset_service, "IMAGE_ASSETS_FILE", legacy_file):
                    assets = image_asset_service.load_assets()

                self.assertEqual(assets["2026/06/02/cat.png"]["owner_id"], "user-1")
                storage = DatabaseImageMetadataStorage(metadata_url)
                self.assertIn("2026/06/02/cat.png", storage.load_map("image_assets"))
        finally:
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            reset_image_metadata_storage_for_tests()

    def test_image_tags_seed_legacy_json_into_database_when_enabled(self) -> None:
        from services import image_tags_service

        old_env = {
            "IMAGE_METADATA_DATABASE_URL": os.environ.get("IMAGE_METADATA_DATABASE_URL"),
            "POSTGRES_SYNC_DATABASE_URL": os.environ.get("POSTGRES_SYNC_DATABASE_URL"),
        }
        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                root = Path(tmp_dir)
                metadata_url = f"sqlite:///{root / 'metadata.db'}"
                os.environ["IMAGE_METADATA_DATABASE_URL"] = metadata_url
                os.environ.pop("POSTGRES_SYNC_DATABASE_URL", None)
                reset_image_metadata_storage_for_tests()

                legacy_file = root / "image_tags.json"
                legacy_file.write_text(json.dumps({"2026/06/02/cat.png": ["public", "discover"]}), encoding="utf-8")

                with mock.patch.object(image_tags_service, "TAGS_FILE", legacy_file):
                    tags = image_tags_service.load_tags()

                self.assertEqual(tags, {"2026/06/02/cat.png": ["public", "discover"]})
                storage = DatabaseImageMetadataStorage(metadata_url)
                self.assertEqual(storage.load_map("image_tags"), {"2026/06/02/cat.png": ["public", "discover"]})
        finally:
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            reset_image_metadata_storage_for_tests()

    def test_image_owners_seed_legacy_json_into_database_when_enabled(self) -> None:
        from services import image_service

        old_env = {
            "IMAGE_METADATA_DATABASE_URL": os.environ.get("IMAGE_METADATA_DATABASE_URL"),
            "POSTGRES_SYNC_DATABASE_URL": os.environ.get("POSTGRES_SYNC_DATABASE_URL"),
        }
        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                root = Path(tmp_dir)
                metadata_url = f"sqlite:///{root / 'metadata.db'}"
                os.environ["IMAGE_METADATA_DATABASE_URL"] = metadata_url
                os.environ.pop("POSTGRES_SYNC_DATABASE_URL", None)
                reset_image_metadata_storage_for_tests()

                legacy_file = root / "image_owners.json"
                legacy_file.write_text(
                    json.dumps(
                        {
                            "items": [
                                {
                                    "path": "2026/06/02/cat.png",
                                    "owner_id": "user-1",
                                    "owner_name": "Alice",
                                    "owner_role": "user",
                                }
                            ]
                        }
                    ),
                    encoding="utf-8",
                )

                with mock.patch.object(image_service, "IMAGE_OWNERS_FILE", legacy_file):
                    owners = image_service._load_image_owners_locked()

                self.assertEqual(owners["2026/06/02/cat.png"]["owner_id"], "user-1")
                storage = DatabaseImageMetadataStorage(metadata_url)
                self.assertIn("2026/06/02/cat.png", storage.load_map("image_owners"))
        finally:
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            reset_image_metadata_storage_for_tests()

    def test_image_tasks_seed_legacy_json_into_database_when_enabled(self) -> None:
        from services.image_task_service import ImageTaskService

        old_env = {
            "IMAGE_METADATA_DATABASE_URL": os.environ.get("IMAGE_METADATA_DATABASE_URL"),
            "POSTGRES_SYNC_DATABASE_URL": os.environ.get("POSTGRES_SYNC_DATABASE_URL"),
        }
        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                root = Path(tmp_dir)
                metadata_url = f"sqlite:///{root / 'metadata.db'}"
                os.environ["IMAGE_METADATA_DATABASE_URL"] = metadata_url
                os.environ.pop("POSTGRES_SYNC_DATABASE_URL", None)
                reset_image_metadata_storage_for_tests()

                legacy_file = root / "image_tasks.json"
                legacy_file.write_text(
                    json.dumps(
                        {
                            "tasks": [
                                {
                                    "id": "task-1",
                                    "owner_id": "user-1",
                                    "status": "success",
                                    "mode": "generate",
                                    "model": "gpt-image-2",
                                    "created_at": "2026-06-02 00:00:00",
                                    "updated_at": "2026-06-02 00:00:01",
                                    "data": [{"url": "/images/2026/06/02/cat.png"}],
                                }
                            ]
                        }
                    ),
                    encoding="utf-8",
                )

                service = ImageTaskService(
                    legacy_file,
                    generation_handler=lambda _payload: {"data": [{"url": "/images/new.png"}]},
                    edit_handler=lambda _payload: {"data": [{"url": "/images/edit.png"}]},
                    retention_days_getter=lambda: 30,
                    worker_count=1,
                )

                result = service.list_tasks({"id": "user-1", "role": "user"}, ["task-1"])
                storage = DatabaseImageMetadataStorage(metadata_url)

                self.assertEqual(result["items"][0]["id"], "task-1")
                self.assertIn("user-1:task-1", storage.load_map("image_tasks"))
        finally:
            for key, value in old_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            reset_image_metadata_storage_for_tests()


if __name__ == "__main__":
    unittest.main()
