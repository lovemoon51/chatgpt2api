from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from services import image_service
from services.protocol import conversation


ADMIN = {"id": "admin", "name": "管理员", "role": "admin"}
USER = {"id": "user-1", "name": "Alice", "role": "user"}
OTHER_USER = {"id": "user-2", "name": "Bob", "role": "user"}


class ImageOwnershipTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.images_dir = self.root / "images"
        self.thumbnails_dir = self.root / "image_thumbnails"
        self.images_dir.mkdir(parents=True)
        self.thumbnails_dir.mkdir(parents=True)
        self.fake_config = SimpleNamespace(
            images_dir=self.images_dir,
            image_thumbnails_dir=self.thumbnails_dir,
            base_url="",
            cleanup_old_images=lambda: 0,
        )
        patches = [
            mock.patch.object(image_service, "config", self.fake_config),
            mock.patch.object(conversation, "config", self.fake_config),
            mock.patch.object(image_service, "IMAGE_OWNERS_FILE", self.root / "image_owners.json"),
            mock.patch.object(image_service, "load_tags", return_value={}),
            mock.patch.object(image_service, "remove_tags", return_value=None),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def write_image(self, rel: str, payload: bytes = b"image") -> None:
        path = self.images_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

    def test_user_gallery_only_lists_owned_images(self) -> None:
        self.write_image("2026/05/20/user.png")
        self.write_image("2026/05/20/other.png")
        self.write_image("2026/05/20/legacy.png")
        image_service.record_image_owner("2026/05/20/user.png", USER)
        image_service.record_image_owner("2026/05/20/other.png", OTHER_USER)

        user_items = image_service.list_images("http://testserver", identity=USER)["items"]
        other_items = image_service.list_images("http://testserver", identity=OTHER_USER)["items"]
        admin_items = image_service.list_images("http://testserver", identity=ADMIN)["items"]

        self.assertEqual([item["rel"] for item in user_items], ["2026/05/20/user.png"])
        self.assertEqual([item["rel"] for item in other_items], ["2026/05/20/other.png"])
        self.assertEqual(
            sorted(item["rel"] for item in admin_items),
            ["2026/05/20/legacy.png", "2026/05/20/other.png", "2026/05/20/user.png"],
        )

    def test_download_requires_matching_owner_for_users(self) -> None:
        self.write_image("2026/05/20/private.png")
        image_service.record_image_owner("2026/05/20/private.png", USER)

        response = image_service.get_image_download_response("2026/05/20/private.png", USER)
        self.assertTrue(str(response.path).endswith("private.png"))

        with self.assertRaises(HTTPException) as caught:
            image_service.get_image_download_response("2026/05/20/private.png", OTHER_USER)
        self.assertEqual(caught.exception.status_code, 404)

    def test_saved_images_record_owner(self) -> None:
        url = conversation.save_image_bytes(b"generated-image", "http://testserver", USER)
        rel = url.split("/images/", 1)[1]

        self.assertTrue((self.images_dir / rel).is_file())
        self.assertTrue(image_service.can_access_image(USER, rel))
        self.assertFalse(image_service.can_access_image(OTHER_USER, rel))


if __name__ == "__main__":
    unittest.main()
