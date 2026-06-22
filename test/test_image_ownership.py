from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException

from services import image_asset_service
from services import image_service
from services.protocol import conversation
from services.signed_url_service import verify_signed_url


ADMIN = {"id": "admin", "name": "管理员", "role": "admin"}
USER = {"id": "user-1", "name": "Alice", "role": "user"}
OTHER_USER = {"id": "user-2", "name": "Bob", "role": "user"}
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
PNG_BYTES = base64.b64decode(PNG_B64)


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
        self.tags: dict[str, list[str]] = {}

        def remove_tag(rel: str) -> None:
            self.tags.pop(rel, None)

        patches = [
            mock.patch.object(image_service, "config", self.fake_config),
            mock.patch.object(image_asset_service, "config", self.fake_config),
            mock.patch.object(conversation, "config", self.fake_config),
            mock.patch.object(image_service, "IMAGE_OWNERS_FILE", self.root / "image_owners.json"),
            mock.patch.object(image_asset_service, "IMAGE_ASSETS_FILE", self.root / "image_assets.json"),
            mock.patch.object(image_service, "load_tags", side_effect=lambda: dict(self.tags)),
            mock.patch.object(image_service, "remove_tags", side_effect=remove_tag),
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

    def test_saved_images_record_asset_metadata(self) -> None:
        result = conversation.format_image_result(
            [{"b64_json": PNG_B64, "revised_prompt": "a sharper cat"}],
            "cat",
            "url",
            "http://testserver",
            owner_identity=USER,
            model="gpt-image-2",
            size="1:1",
            mode="generate",
            source_task_id="task-1",
        )
        rel = result["data"][0]["url"].split("/images/", 1)[1]

        assets = image_asset_service.load_assets()
        asset = assets[rel]
        self.assertEqual(asset["owner_id"], "user-1")
        self.assertEqual(asset["prompt"], "cat")
        self.assertEqual(asset["model"], "gpt-image-2")
        self.assertEqual(asset["size"], "1:1")
        self.assertEqual(asset["mode"], "generate")
        self.assertEqual(asset["source_task_id"], "task-1")
        self.assertEqual(asset["revised_prompt"], "a sharper cat")
        self.assertEqual(asset["bytes"], len(PNG_BYTES))
        self.assertEqual(asset["dimensions"], {"width": 1, "height": 1})

    def test_list_images_filters_paginates_and_searches_metadata(self) -> None:
        self.write_image("2026/05/20/cat.png", PNG_BYTES)
        self.write_image("2026/05/20/dog.png", PNG_BYTES)
        image_service.record_image_owner("2026/05/20/cat.png", USER)
        image_service.record_image_owner("2026/05/20/dog.png", OTHER_USER)
        self.tags["2026/05/20/cat.png"] = ["pet", "orange"]
        self.tags["2026/05/20/dog.png"] = ["pet"]
        image_asset_service.upsert_asset(
            "2026/05/20/cat.png",
            file_path=self.images_dir / "2026/05/20/cat.png",
            owner_identity=USER,
            prompt="orange cat on a sofa",
            model="gpt-image-2",
            size="1:1",
            mode="generate",
            tags=self.tags["2026/05/20/cat.png"],
        )
        image_asset_service.upsert_asset(
            "2026/05/20/dog.png",
            file_path=self.images_dir / "2026/05/20/dog.png",
            owner_identity=OTHER_USER,
            prompt="dog in a park",
            model="gpt-image-2",
            size="16:9",
            mode="edit",
            tags=self.tags["2026/05/20/dog.png"],
        )

        filtered = image_service.list_images(
            "http://testserver",
            identity=ADMIN,
            page=1,
            page_size=1,
            search="orange",
            tag="orange",
            owner="user-1",
            mode="generate",
            model="gpt-image-2",
        )

        self.assertEqual(filtered["total"], 1)
        self.assertFalse(filtered["has_more"])
        self.assertEqual(filtered["pages"], 1)
        self.assertEqual(filtered["items"][0]["rel"], "2026/05/20/cat.png")
        self.assertEqual(filtered["items"][0]["prompt"], "orange cat on a sofa")
        self.assertEqual(filtered["items"][0]["dimensions"], {"width": 1, "height": 1})

    def test_list_images_requires_all_comma_separated_tags(self) -> None:
        self.write_image("2026/05/20/cat.png", PNG_BYTES)
        self.write_image("2026/05/20/dog.png", PNG_BYTES)
        self.tags["2026/05/20/cat.png"] = ["pet", "orange"]
        self.tags["2026/05/20/dog.png"] = ["pet"]
        image_asset_service.upsert_asset(
            "2026/05/20/cat.png",
            file_path=self.images_dir / "2026/05/20/cat.png",
            owner_identity=USER,
            tags=self.tags["2026/05/20/cat.png"],
        )
        image_asset_service.upsert_asset(
            "2026/05/20/dog.png",
            file_path=self.images_dir / "2026/05/20/dog.png",
            owner_identity=OTHER_USER,
            tags=self.tags["2026/05/20/dog.png"],
        )

        filtered = image_service.list_images("http://testserver", identity=ADMIN, tag="pet,orange")

        self.assertEqual([item["rel"] for item in filtered["items"]], ["2026/05/20/cat.png"])

    def test_public_discover_images_only_include_dual_tagged_assets_with_signed_urls(self) -> None:
        self.write_image("2026/05/20/public-discover.png", PNG_BYTES)
        self.write_image("2026/05/20/public-only.png", PNG_BYTES)
        self.write_image("2026/05/20/discover-only.png", PNG_BYTES)
        self.write_image("2026/05/20/private.png", PNG_BYTES)
        self.tags["2026/05/20/public-discover.png"] = ["public", "discover", "poster"]
        self.tags["2026/05/20/public-only.png"] = ["public"]
        self.tags["2026/05/20/discover-only.png"] = ["discover"]
        self.tags["2026/05/20/private.png"] = ["poster"]
        image_asset_service.upsert_asset(
            "2026/05/20/public-discover.png",
            file_path=self.images_dir / "2026/05/20/public-discover.png",
            owner_identity=USER,
            prompt="public product poster",
            revised_prompt="polished public product poster",
            tags=self.tags["2026/05/20/public-discover.png"],
        )
        image_asset_service.upsert_asset(
            "2026/05/20/public-only.png",
            file_path=self.images_dir / "2026/05/20/public-only.png",
            owner_identity=USER,
            tags=self.tags["2026/05/20/public-only.png"],
        )
        image_asset_service.upsert_asset(
            "2026/05/20/discover-only.png",
            file_path=self.images_dir / "2026/05/20/discover-only.png",
            owner_identity=OTHER_USER,
            tags=self.tags["2026/05/20/discover-only.png"],
        )
        image_asset_service.upsert_asset(
            "2026/05/20/private.png",
            file_path=self.images_dir / "2026/05/20/private.png",
            owner_identity=OTHER_USER,
            tags=self.tags["2026/05/20/private.png"],
        )

        result = image_service.list_public_discover_images("http://testserver", page_size=12)

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["id"], "2026/05/20/public-discover.png")
        self.assertEqual(result["items"][0]["title"], "public product poster")
        self.assertEqual(result["items"][0]["prompt"], "polished public product poster")
        self.assertIn("/public-images/2026/05/20/public-discover.png?", result["items"][0]["imageUrl"])
        parsed = urlparse(result["items"][0]["imageUrl"])
        params = parse_qs(parsed.query)
        self.assertTrue(verify_signed_url("2026/05/20/public-discover.png", int(params["expires"][0]), params["signature"][0]))

    def test_public_discover_images_include_approved_public_template_previews_without_asset_tags(self) -> None:
        self.write_image("2026/05/20/template-approved.png", PNG_BYTES)
        self.write_image("2026/05/20/template-pending.png", PNG_BYTES)
        self.write_image("2026/05/20/template-private.png", PNG_BYTES)
        fake_prompt_template_service = SimpleNamespace(
            list=lambda identity, **filters: {
                "items": [
                    {
                        "id": "template-approved",
                        "title": "水晶质感产品海报",
                        "description": "适合食品新品首发",
                        "prompt": "晶透玻璃质感的产品海报",
                        "tags": ["product", "poster"],
                        "preview_image": {"url": "/images/2026/05/20/template-approved.png"},
                        "visibility": "public",
                        "review_status": "approved",
                        "created_at": "2026-05-20T10:00:00+00:00",
                        "updated_at": "2026-05-20T10:00:00+00:00",
                    },
                    {
                        "id": "template-pending",
                        "title": "待审核模板",
                        "prompt": "pending template",
                        "preview_image": {"url": "/images/2026/05/20/template-pending.png"},
                        "visibility": "public",
                        "review_status": "pending",
                    },
                    {
                        "id": "template-private",
                        "title": "私有模板",
                        "prompt": "private template",
                        "preview_image": {"url": "/images/2026/05/20/template-private.png"},
                        "visibility": "private",
                        "review_status": "approved",
                    },
                    {
                        "id": "template-external",
                        "title": "外链模板",
                        "prompt": "external template",
                        "preview_image": {"url": "https://example.com/external.png"},
                        "visibility": "public",
                        "review_status": "approved",
                    },
                ]
            }
        )

        with mock.patch("services.prompt_template_service.prompt_template_service", fake_prompt_template_service):
            result = image_service.list_public_discover_images("http://testserver", page_size=12)

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["id"], "2026/05/20/template-approved.png")
        self.assertEqual(result["items"][0]["title"], "水晶质感产品海报")
        self.assertEqual(result["items"][0]["subtitle"], "1 x 1")
        self.assertEqual(result["items"][0]["prompt"], "晶透玻璃质感的产品海报")
        self.assertEqual(result["items"][0]["tags"], ["product", "poster"])
        self.assertIn("/public-images/2026/05/20/template-approved.png?", result["items"][0]["imageUrl"])
        parsed = urlparse(result["items"][0]["imageUrl"])
        params = parse_qs(parsed.query)
        self.assertTrue(verify_signed_url("2026/05/20/template-approved.png", int(params["expires"][0]), params["signature"][0]))

    def test_delete_images_marks_asset_deleted(self) -> None:
        self.write_image("2026/05/20/remove.png", PNG_BYTES)
        image_service.record_image_owner("2026/05/20/remove.png", USER)
        self.tags["2026/05/20/remove.png"] = ["old"]
        image_asset_service.upsert_asset(
            "2026/05/20/remove.png",
            file_path=self.images_dir / "2026/05/20/remove.png",
            owner_identity=USER,
            prompt="remove me",
            tags=self.tags["2026/05/20/remove.png"],
        )

        result = image_service.delete_images(["2026/05/20/remove.png"])

        self.assertEqual(result["removed"], 1)
        self.assertFalse((self.images_dir / "2026/05/20/remove.png").exists())
        self.assertEqual(self.tags, {})
        asset = image_asset_service.load_assets(include_deleted=True)["2026/05/20/remove.png"]
        self.assertTrue(asset["deleted_at"])


if __name__ == "__main__":
    unittest.main()
