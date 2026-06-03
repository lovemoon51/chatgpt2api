from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from services.prompt_template_service import (
    PromptTemplatePermissionError,
    PromptTemplateService,
    PromptTemplateValidationError,
)


ALICE = {"id": "alice", "name": "Alice", "role": "user"}
BOB = {"id": "bob", "name": "Bob", "role": "user"}
ADMIN = {"id": "admin", "name": "Admin", "role": "admin"}


class PromptTemplateServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        base = Path(self.temp_dir.name)
        self.service = PromptTemplateService(
            base / "prompt_templates.json",
            base / "prompt_template_favorites.json",
        )

    def test_public_scope_returns_approved_public_templates_only(self):
        self.service.create(
            ALICE,
            {
                "title": "Private",
                "prompt": "private prompt",
                "visibility": "private",
                "preview_image": {"url": "/private.png"},
            },
        )
        pending = self.service.create(
            ALICE,
            {
                "title": "Pending",
                "prompt": "pending prompt",
                "visibility": "public",
                "preview_image": {"url": "/pending.png"},
            },
        )
        approved = self.service.review(ADMIN, pending["id"], action="approve")

        items = self.service.list(BOB, scope="public")["items"]

        self.assertEqual([item["id"] for item in items], [approved["id"]])
        self.assertEqual(items[0]["review_status"], "approved")

    def test_private_scope_returns_only_current_user_private_templates(self):
        alice_private = self.service.create(
            ALICE,
            {
                "title": "Alice private",
                "prompt": "alice prompt",
                "visibility": "private",
                "preview_image": {"url": "/alice.png"},
            },
        )
        self.service.create(
            BOB,
            {
                "title": "Bob private",
                "prompt": "bob prompt",
                "visibility": "private",
                "preview_image": {"url": "/bob.png"},
            },
        )

        items = self.service.list(ALICE, scope="private")["items"]

        self.assertEqual([item["id"] for item in items], [alice_private["id"]])

    def test_favorites_are_scoped_to_current_user(self):
        pending = self.service.create(
            ALICE,
            {
                "title": "Public",
                "prompt": "public prompt",
                "visibility": "public",
                "preview_image": {"url": "/public.png"},
            },
        )
        approved = self.service.review(ADMIN, pending["id"], action="approve")
        self.service.favorite(BOB, approved["id"])

        self.assertEqual(self.service.list(ALICE, scope="favorites")["items"], [])
        bob_items = self.service.list(BOB, scope="favorites")["items"]
        self.assertEqual([item["id"] for item in bob_items], [approved["id"]])
        self.assertTrue(bob_items[0]["is_favorited"])

        self.service.unfavorite(BOB, approved["id"])
        self.assertEqual(self.service.list(BOB, scope="favorites")["items"], [])

    def test_public_submission_starts_pending_and_appears_in_submissions(self):
        submission = self.service.create(
            ALICE,
            {
                "title": "Submit",
                "prompt": "submit prompt",
                "visibility": "public",
                "preview_image": {"url": "/submit.png"},
            },
        )

        self.assertEqual(submission["review_status"], "pending")
        self.assertEqual(self.service.list(ALICE, scope="submissions")["items"][0]["id"], submission["id"])
        self.assertEqual(self.service.list(BOB, scope="public")["items"], [])

    def test_admin_can_reject_and_rejection_requires_reason(self):
        submission = self.service.create(
            ALICE,
            {
                "title": "Submit",
                "prompt": "submit prompt",
                "visibility": "public",
                "preview_image": {"url": "/submit.png"},
            },
        )

        with self.assertRaises(PromptTemplateValidationError):
            self.service.review(ADMIN, submission["id"], action="reject", reason="")

        rejected = self.service.review(ADMIN, submission["id"], action="reject", reason="Too vague")

        self.assertEqual(rejected["review_status"], "rejected")
        self.assertEqual(rejected["review_reason"], "Too vague")
        self.assertEqual(rejected["reviewed_by"], "admin")

    def test_non_owner_cannot_update_or_delete_private_template(self):
        private = self.service.create(
            ALICE,
            {
                "title": "Private",
                "prompt": "private prompt",
                "visibility": "private",
                "preview_image": {"url": "/private.png"},
            },
        )

        with self.assertRaises(PromptTemplatePermissionError):
            self.service.update(BOB, private["id"], {"title": "Nope"})

        with self.assertRaises(PromptTemplatePermissionError):
            self.service.delete(BOB, private["id"])

    def test_owner_cannot_delete_approved_public_template_but_admin_can(self):
        submission = self.service.create(
            ALICE,
            {
                "title": "Submit",
                "prompt": "submit prompt",
                "visibility": "public",
                "preview_image": {"url": "/submit.png"},
            },
        )
        approved = self.service.review(ADMIN, submission["id"], action="approve")

        with self.assertRaises(PromptTemplatePermissionError):
            self.service.delete(ALICE, approved["id"])

        result = self.service.delete(ADMIN, approved["id"])
        self.assertEqual(result, {"ok": True})


if __name__ == "__main__":
    unittest.main()
