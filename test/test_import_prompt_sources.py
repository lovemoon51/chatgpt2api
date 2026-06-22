from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.import_prompt_sources import build_prompt_templates, upsert_prompt_templates


class ImportPromptSourcesTests(unittest.TestCase):
    def test_builds_public_approved_templates_from_both_github_sources(self):
        banana_payload = [
            {
                "title": "苹果风格海报",
                "preview": "https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/images/apple.png",
                "prompt": "生成苹果风格海报",
                "author": "Official",
                "mode": "image",
                "category": "工作",
                "sub_category": "海报",
                "created": "2026-01-06",
            },
        ]
        evolink_payload = {
            "records": [
            ],
        }
        evolink_markdowns = {
            "cases/portrait.md": """### Case 1: [Convenience Store Neon Portrait](https://x.com/BubbleBrain/status/2045167461147042202) (by [@BubbleBrain](https://x.com/BubbleBrain))

| Output |
| :----: |
| <img src="https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/portrait_case1/output.jpg" width="300" alt="Output image"> |

**Prompt:**

```
35mm film photography with neon signs
```
""",
        }

        templates = build_prompt_templates(banana_payload, evolink_payload, evolink_markdowns)

        self.assertEqual([template["id"] for template in templates], ["banana-0001", "evolink-portrait-case1"])
        self.assertEqual({template["visibility"] for template in templates}, {"public"})
        self.assertEqual({template["review_status"] for template in templates}, {"approved"})
        self.assertEqual(templates[0]["owner_name"], "Official · banana-prompt-quicker")
        self.assertEqual(templates[0]["tags"], ["工作", "海报", "image"])
        self.assertEqual(templates[0]["preview_image"]["url"], "https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/images/apple.png")
        self.assertEqual(templates[1]["owner_name"], "@BubbleBrain · awesome-gpt-image-2")
        self.assertEqual(templates[1]["preview_image"]["url"], "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/portrait_case1/output.jpg")

    def test_limits_imports_to_300_templates_balanced_across_sources(self):
        banana_payload = [
            {
                "title": f"Banana {index}",
                "prompt": f"banana prompt {index}",
                "author": "Official",
                "mode": "image",
                "category": "poster",
            }
            for index in range(200)
        ]
        evolink_markdowns = {
            "cases/poster.md": "\n".join(
                f"""### Case {index}: [Poster {index}](https://example.com/{index}) (by [@Creator](https://x.com/creator))

| Output |
| :----: |
| <img src="https://example.com/poster_case{index}/output.jpg" width="300" alt="Output image"> |

**Prompt:**

```
evolink prompt {index}
```
"""
                for index in range(1, 201)
            ),
        }

        templates = build_prompt_templates(banana_payload, {"records": []}, evolink_markdowns)

        self.assertEqual(len(templates), 300)
        self.assertEqual(sum(1 for template in templates if template["id"].startswith("banana-")), 150)
        self.assertEqual(sum(1 for template in templates if template["id"].startswith("evolink-")), 150)

    def test_upsert_keeps_existing_templates_and_replaces_imported_ids(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "prompt_templates.json"
            path.write_text(
                """{
  "items": [
    {
      "id": "custom-template",
      "title": "Custom",
      "prompt": "custom prompt",
      "visibility": "public",
      "review_status": "approved",
      "updated_at": "2026-01-01T00:00:00+00:00"
    },
    {
      "id": "banana-0001",
      "title": "Old Banana",
      "prompt": "old prompt",
      "visibility": "public",
      "review_status": "approved",
      "updated_at": "2026-01-01T00:00:00+00:00"
    }
  ]
}
""",
                encoding="utf-8",
            )
            imported = [
                {
                    "id": "banana-0001",
                    "title": "New Banana",
                    "prompt": "new prompt",
                    "description": "source",
                    "model": "gpt-image-2",
                    "size": "1:1",
                    "count": 1,
                    "tags": ["poster"],
                    "preview_image": {"url": "https://example.com/banana.png"},
                    "owner_id": "github-import",
                    "owner_name": "Official · banana-prompt-quicker",
                    "visibility": "public",
                    "review_status": "approved",
                    "review_reason": "",
                    "reviewed_by": "github-import",
                    "reviewed_at": "2026-06-02T00:00:00+00:00",
                    "created_at": "2026-06-02T00:00:00+00:00",
                    "updated_at": "2026-06-02T00:00:00+00:00",
                }
            ]

            result = upsert_prompt_templates(path, imported)
            second_result = upsert_prompt_templates(path, imported)

            self.assertEqual(result, {"added": 0, "updated": 1, "removed": 0, "total": 2})
            self.assertEqual(second_result, {"added": 0, "updated": 1, "removed": 0, "total": 2})
            saved = path.read_text(encoding="utf-8")
            self.assertIn('"id": "custom-template"', saved)
            self.assertIn('"title": "New Banana"', saved)
            self.assertNotIn("Old Banana", saved)

    def test_upsert_removes_stale_github_imports(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "prompt_templates.json"
            path.write_text(
                """{
  "items": [
    {
      "id": "custom-template",
      "title": "Custom",
      "prompt": "custom prompt",
      "visibility": "public",
      "review_status": "approved",
      "updated_at": "2026-01-01T00:00:00+00:00"
    },
    {
      "id": "banana-0001",
      "title": "Old Banana",
      "prompt": "old prompt",
      "owner_id": "github-import",
      "visibility": "public",
      "review_status": "approved",
      "updated_at": "2026-01-01T00:00:00+00:00"
    },
    {
      "id": "evolink-old",
      "title": "Old EvoLink",
      "prompt": "old prompt",
      "owner_id": "github-import",
      "visibility": "public",
      "review_status": "approved",
      "updated_at": "2026-01-01T00:00:00+00:00"
    }
  ]
}
""",
                encoding="utf-8",
            )

            result = upsert_prompt_templates(path, [])

            self.assertEqual(result, {"added": 0, "updated": 0, "removed": 2, "total": 1})
            saved = path.read_text(encoding="utf-8")
            self.assertIn('"id": "custom-template"', saved)
            self.assertNotIn("Old Banana", saved)
            self.assertNotIn("Old EvoLink", saved)


if __name__ == "__main__":
    unittest.main()
