# Prompt Market Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Studio prompt-template market as a modal that can create, review, favorite, browse, and apply image prompt templates.

**Architecture:** Backend owns the template data in two JSON files behind a focused service and FastAPI router. Frontend adds typed API helpers plus Studio-local modal components; Studio only owns modal state and applies selected template values to the composer.

**Tech Stack:** FastAPI, Pydantic, Python unittest/pytest, JSON file persistence with atomic writes, Next.js React components, Bun tests, Tailwind classes, existing Radix UI wrappers.

---

## File Structure

- Create `services/prompt_template_service.py`: template normalization, ownership checks, scope listing, stats, favorite mutation, review mutation, and atomic JSON persistence.
- Create `api/prompt_market.py`: FastAPI router under `/api/prompt-templates`, request/response models, auth/admin enforcement, and HTTP error mapping.
- Modify `api/app.py`: mount `prompt_market.create_router()`.
- Create `test/test_prompt_template_service.py`: service behavior tests using temporary JSON files.
- Create `test/test_prompt_templates_api.py`: router/auth behavior tests with a fake service.
- Modify `web/src/lib/api.ts`: prompt-template types and request helpers.
- Create `web/src/app/studio/components/prompt-market-utils.ts`: small pure helpers for tag parsing, status labels, apply payloads, and seed form data.
- Create `web/src/app/studio/components/prompt-market-utils.test.ts`: Bun tests for the pure helpers.
- Create `web/src/app/studio/components/prompt-market-modal.tsx`: modal, tabs, stats, display controls, template cards, create/edit form, and review controls.
- Modify `web/src/app/studio/page.tsx`: import modal, add market/form state, open from existing `市场` button, apply templates to composer, and expose `保存为模板` from successful result cards.

## Task 1: Backend Service

**Files:**
- Create: `services/prompt_template_service.py`
- Test: `test/test_prompt_template_service.py`

- [ ] **Step 1: Write failing service tests**

Create tests that instantiate `PromptTemplateService(temp_templates, temp_favorites)` and verify:

```python
def test_public_scope_returns_approved_public_templates_only(self):
    alice = {"id": "alice", "name": "Alice", "role": "user"}
    service.create(alice, {"title": "Private", "prompt": "p", "visibility": "private", "preview_image": {"url": "/a.png"}})
    pending = service.create(alice, {"title": "Pending", "prompt": "p", "visibility": "public", "preview_image": {"url": "/b.png"}})
    approved = service.review({"id": "admin", "name": "Admin", "role": "admin"}, pending["id"], action="approve")

    items = service.list(alice, scope="public")["items"]

    self.assertEqual([item["id"] for item in items], [approved["id"]])
    self.assertEqual(items[0]["review_status"], "approved")
```

Also cover private isolation, favorites per user, submissions starting as pending, admin approve/reject, rejection requiring a reason, owner edit restrictions, and delete restrictions.

- [ ] **Step 2: Run tests and verify RED**

Run: `uv run python -m pytest test/test_prompt_template_service.py -q`

Expected: import failure for missing `services.prompt_template_service`.

- [ ] **Step 3: Implement minimal service**

Implement constants `VISIBILITIES`, `REVIEW_STATUSES`, errors `PromptTemplateNotFound`, `PromptTemplatePermissionError`, `PromptTemplateValidationError`, and class `PromptTemplateService` with:

```python
service = PromptTemplateService(DATA_DIR / "prompt_templates.json", DATA_DIR / "prompt_template_favorites.json")
```

Use an `RLock`, read/write JSON as `{"items": [...]}` and `{"items": [...]}`, atomic `.tmp` replace, generated uuid ids, ISO datetimes, `_owner_id(identity)`, `_owner_name(identity)`, `_is_admin(identity)`, `_public_template(template, favorite_ids)`, `_normalize_payload(payload, existing=None)`, and public methods:

```python
list(identity, *, scope="public", q="", tag="", status="") -> {"items": [...]}
stats(identity) -> dict
create(identity, payload) -> dict
update(identity, template_id, payload) -> dict
delete(identity, template_id) -> {"ok": True}
favorite(identity, template_id) -> dict
unfavorite(identity, template_id) -> dict
review(identity, template_id, *, action, reason="") -> dict
```

- [ ] **Step 4: Run service tests and verify GREEN**

Run: `uv run python -m pytest test/test_prompt_template_service.py -q`

Expected: all service tests pass.

## Task 2: Backend API Router

**Files:**
- Create: `api/prompt_market.py`
- Modify: `api/app.py`
- Test: `test/test_prompt_templates_api.py`

- [ ] **Step 1: Write failing API tests**

Create a `FakePromptTemplateService` with methods matching the service public API. Patch `api.prompt_market.prompt_template_service`, `require_identity`, and `require_admin`. Verify:

```python
response = client.get("/api/prompt-templates?scope=public", headers=AUTH_HEADERS)
self.assertEqual(response.status_code, 200)
self.assertEqual(response.json()["items"], [])
```

Also verify create passes identity and payload, non-admin review queue returns 403, admin review endpoint calls service, and rejection without reason maps to 400.

- [ ] **Step 2: Run tests and verify RED**

Run: `uv run python -m pytest test/test_prompt_templates_api.py -q`

Expected: import failure for missing `api.prompt_market`.

- [ ] **Step 3: Implement router**

Add Pydantic models for preview image, template create/update, and review request. Add endpoints:

```python
GET /api/prompt-templates
GET /api/prompt-templates/stats
POST /api/prompt-templates
PATCH /api/prompt-templates/{template_id}
DELETE /api/prompt-templates/{template_id}
POST /api/prompt-templates/{template_id}/favorite
DELETE /api/prompt-templates/{template_id}/favorite
POST /api/prompt-templates/{template_id}/review
```

Use `require_identity` for normal actions and `require_admin` for review scope/actions. Map validation to 400, permission to 403, missing template to 404.

- [ ] **Step 4: Mount router and run tests**

Modify `api/app.py`:

```python
from api import accounts, ai, image_tasks, openai_keys, prompt_market, register, system
...
app.include_router(prompt_market.create_router())
```

Run:

```bash
uv run python -m pytest test/test_prompt_templates_api.py test/test_prompt_template_service.py -q
```

Expected: all prompt-template backend tests pass.

## Task 3: Frontend API Types And Pure Helpers

**Files:**
- Modify: `web/src/lib/api.ts`
- Create: `web/src/app/studio/components/prompt-market-utils.ts`
- Test: `web/src/app/studio/components/prompt-market-utils.test.ts`

- [ ] **Step 1: Write failing frontend helper tests**

Test:

```typescript
expect(parsePromptTemplateTags("写实, 人像  电影感")).toEqual(["写实", "人像", "电影感"]);
expect(getPromptTemplateStatusLabel("pending")).toBe("待审核");
expect(buildPromptTemplateApplyPayload(template)).toEqual({
  prompt: template.prompt,
  model: template.model,
  size: template.size,
  count: template.count,
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd web; bun test src/app/studio/components/prompt-market-utils.test.ts`

Expected: import failure for missing utility file.

- [ ] **Step 3: Implement helpers and API functions**

Add exported frontend types `PromptTemplate`, `PromptTemplatePreviewImage`, `PromptTemplateScope`, `PromptTemplateStats`, `PromptTemplateInput`, `PromptTemplateReviewInput`, `PromptTemplateApplyPayload`, plus functions:

```typescript
fetchPromptTemplates(filters)
fetchPromptTemplateStats()
createPromptTemplate(payload)
updatePromptTemplate(id, payload)
deletePromptTemplate(id)
favoritePromptTemplate(id)
unfavoritePromptTemplate(id)
reviewPromptTemplate(id, payload)
```

Implement utility helpers with no browser-only APIs so Bun SSR tests can run.

- [ ] **Step 4: Run frontend helper tests**

Run: `cd web; bun test src/app/studio/components/prompt-market-utils.test.ts`

Expected: tests pass.

## Task 4: Prompt Market Modal UI

**Files:**
- Create: `web/src/app/studio/components/prompt-market-modal.tsx`

- [ ] **Step 1: Implement modal component against typed props**

Props:

```typescript
type PromptMarketModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  darkMode?: boolean;
  createSeed?: PromptTemplateSeed | null;
  onCreateSeedConsumed?: () => void;
  onApplyTemplate: (payload: PromptTemplateApplyPayload) => void;
};
```

Use the API helpers to load stats and list data. Tabs are `public`, `private`, `favorites`, `submissions`, and admin-only `review`. Cards render preview, title, description, metadata, tags, apply, favorite, edit/delete for owned templates, and review controls for admin review tab. The form supports `private` or `public` visibility; public submit creates `pending`.

- [ ] **Step 2: Typecheck modal**

Run: `cd web; bun run typecheck`

Expected: no TypeScript errors introduced by modal files.

## Task 5: Studio Integration

**Files:**
- Modify: `web/src/app/studio/page.tsx`

- [ ] **Step 1: Add Studio state and handlers**

Add `promptMarketOpen`, `promptTemplateSeed`, `handleApplyPromptTemplate`, and `openPromptTemplateSeed`. Applying a template must only set:

```typescript
setPrompt(payload.prompt);
setSelectedImageModel(payload.model || "auto");
setImageSize(payload.size || "1:1");
setImageCount(clampImageCount(String(payload.count || 1)));
setCompositionMode(payload.size ? "ratio" : "auto");
```

Do not clear reference images and do not submit.

- [ ] **Step 2: Wire the existing market button**

Existing composer `市场` button opens the modal and closes params/model popovers.

- [ ] **Step 3: Add generated-result save action**

For each successful result image, add a compact icon action with label/title `保存为模板`. Seed values from the turn prompt/model/size/count and the clicked image URL/base64.

- [ ] **Step 4: Render `PromptMarketModal`**

Pass `isAdmin={session.role === "admin"}`, `darkMode={isDarkTheme}`, `createSeed`, and apply callback.

- [ ] **Step 5: Run frontend checks**

Run:

```bash
cd web
bun test src/app/studio/components/prompt-market-utils.test.ts
bun run typecheck
bun run lint
```

Expected: all pass.

## Task 6: End-To-End Verification

**Files:**
- None expected unless verification finds defects.

- [ ] **Step 1: Run backend prompt-template tests**

Run:

```bash
uv run python -m pytest test/test_prompt_template_service.py test/test_prompt_templates_api.py -q
```

Expected: all pass.

- [ ] **Step 2: Run targeted frontend checks**

Run:

```bash
cd web
bun test src/app/studio/components/prompt-market-utils.test.ts
bun run typecheck
bun run lint
```

Expected: all pass.

- [ ] **Step 3: Browser smoke test**

Open `http://127.0.0.1:3000/studio/`, click `市场`, verify modal opens over Studio, normal/admin review visibility follows the current session role, and applying a template updates composer fields without submitting.

## Self-Review

- Spec coverage: backend data model, listing scopes, stats, create/update/delete, favorites, review, Studio modal, apply behavior, save-from-result entry point, and admin-only review are covered by tasks.
- Placeholder scan: no `TBD`, `TODO`, or unspecified "appropriate" steps remain.
- Type consistency: backend uses `preview_image`, `review_status`, `owner_id`, `owner_name`; frontend mirrors the same API fields and maps only `prompt/model/size/count` for apply.
