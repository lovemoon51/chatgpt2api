# Image Credit Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert ordinary-user image quota from image count to resolution-based credits, including access-code/user management and ColaAI generation flows.

**Architecture:** Keep existing `images_total`, `images_used`, and `images_remaining` as backend storage and wire fields, but treat them as credit totals. Add a dedicated `resolution` field separate from composition `size`; backend quota code computes credit cost from resolution and frontend sends/persists that resolution.

**Tech Stack:** FastAPI/Pydantic/Python unittest for backend; Next.js/React/TypeScript/Bun tests for frontend.

---

## File Structure

- Modify `api/support.py`: add shared resolution normalization and credit cost helpers used by image quota consumers.
- Modify `api/ai.py`: accept `resolution` in OpenAI-compatible image endpoints and deduct `cost * n`.
- Modify `api/image_tasks.py`: accept `resolution`, reject invalid task API values, deduct per-task credit cost, pass resolution to task service.
- Modify `services/image_task_service.py`: persist `resolution` on queued/listed image tasks and pass it through handler payloads.
- Modify `services/protocol/openai_v1_image_generations.py` and `services/protocol/openai_v1_image_edit.py`: pass `resolution` through the protocol payload.
- Modify `services/auth_service.py`: add `bonus_credits` to check-in response while keeping `bonus_images`.
- Modify `test/test_user_key_limits.py` and `test/test_image_tasks_api.py`: backend TDD coverage for credit cost, quota deduction, default behavior, and invalid task resolution.
- Modify `web/src/lib/api.ts`: add `resolution` types and API payload support.
- Modify `web/src/store/auth.ts`: rename frontend session limit aliases toward credits while preserving existing image aliases.
- Modify `web/src/app/settings/components/user-keys-card.tsx` and `.test.tsx`: update access-code/user management copy from images to credits.
- Modify `web/src/app/ColaAI/components/generate-task-submission.ts` and `.test.ts`: include/preserve resolution in task submission and retry.
- Modify `web/src/app/ColaAI/components/cola-ai-workbench.tsx` and `.test.tsx`: add resolution selector, send resolution, decrement local credits by accepted cost, update quota/check-in copy.

Current workspace note: the repository has many pre-existing modified files, including files touched by this plan. Implementation should not use broad `git add` or production-code commits unless explicitly reviewed, because that could include unrelated user edits.

## Task 1: Backend Resolution Credit Helpers

**Files:**
- Modify: `api/support.py`
- Test: `test/test_user_key_limits.py`

- [ ] **Step 1: Write failing helper tests**

Add tests near backend quota tests:

```python
from api.support import image_credit_cost, normalize_image_resolution

def test_image_resolution_credit_costs(self) -> None:
    self.assertEqual(normalize_image_resolution(None), "1k")
    self.assertEqual(normalize_image_resolution(""), "1k")
    self.assertEqual(normalize_image_resolution("1K"), "1k")
    self.assertEqual(image_credit_cost("1k"), 1)
    self.assertEqual(image_credit_cost("2k"), 2)
    self.assertEqual(image_credit_cost("4k"), 3)

def test_image_resolution_rejects_unknown_when_requested(self) -> None:
    with self.assertRaisesRegex(ValueError, "resolution must be one of 1k, 2k, 4k"):
        normalize_image_resolution("8k", strict=True)
    self.assertEqual(normalize_image_resolution("8k", strict=False), "1k")
```

- [ ] **Step 2: Run helper tests to verify RED**

Run: `python -m unittest test.test_user_key_limits.UserKeyLimitServiceTests.test_image_resolution_credit_costs test.test_user_key_limits.UserKeyLimitServiceTests.test_image_resolution_rejects_unknown_when_requested`

Expected: FAIL because helpers are not defined.

- [ ] **Step 3: Implement helpers**

Add to `api/support.py`:

```python
IMAGE_RESOLUTION_CREDIT_COSTS = {"1k": 1, "2k": 2, "4k": 3}

def normalize_image_resolution(value: object, *, strict: bool = False) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return "1k"
    if normalized in IMAGE_RESOLUTION_CREDIT_COSTS:
        return normalized
    if strict:
        raise ValueError("resolution must be one of 1k, 2k, 4k")
    return "1k"

def image_credit_cost(value: object, *, strict: bool = False) -> int:
    return IMAGE_RESOLUTION_CREDIT_COSTS[normalize_image_resolution(value, strict=strict)]
```

- [ ] **Step 4: Run helper tests to verify GREEN**

Run the same unittest command.

Expected: PASS.

## Task 2: OpenAI-Compatible Image API Credit Deduction

**Files:**
- Modify: `api/ai.py`
- Modify: `services/protocol/openai_v1_image_generations.py`
- Modify: `services/protocol/openai_v1_image_edit.py`
- Test: `test/test_user_key_limits.py`

- [ ] **Step 1: Write failing generation quota test**

Update `test_image_generation_entry_consumes_persisted_user_image_quota` or add a sibling test that posts:

```python
json={"model": "gpt-image-2", "prompt": "cat", "n": 2, "resolution": "2k"}
```

Assert:

```python
self.assertEqual(reloaded["limits"]["images_used"], 4)
self.assertEqual(reloaded["limits"]["images_remaining"], 1)
```

Use `images_total: 5`.

- [ ] **Step 2: Write failing default-resolution test**

Keep or add a no-resolution request with `n: 2`, `images_total: 3`, and assert used `2`, remaining `1`.

- [ ] **Step 3: Run OpenAI API tests to verify RED**

Run: `python -m unittest test.test_user_key_limits.UserKeyLimitApiTests.test_image_generation_entry_consumes_persisted_user_image_quota`

Expected: FAIL for the new 2K expectation before implementation.

- [ ] **Step 4: Implement OpenAI API resolution handling**

In `ImageGenerationRequest`, add:

```python
resolution: str | None = None
```

In `/v1/images/generations`, calculate:

```python
resolution = normalize_image_resolution(body.resolution, strict=False)
credit_amount = image_credit_cost(resolution) * body.n
payload["resolution"] = resolution
```

Use `amount=credit_amount` in `usage_limited_call`.

For `/v1/images/edits`, add form field:

```python
resolution: str | None = Form(default=None)
```

Normalize with `strict=False`, include in payload, and use `image_credit_cost(resolution) * n`.

In protocol handlers, read `resolution` and include it in `ConversationRequest` payload if supported by current constructor, or at minimum pass it through task payloads without changing upstream behavior.

- [ ] **Step 5: Run OpenAI API tests to verify GREEN**

Run: `python -m unittest test.test_user_key_limits.UserKeyLimitApiTests`

Expected: PASS for focused API quota tests.

## Task 3: Image Task API Credit Deduction And Persistence

**Files:**
- Modify: `api/image_tasks.py`
- Modify: `services/image_task_service.py`
- Test: `test/test_image_tasks_api.py`
- Test: `test/test_image_task_service.py`

- [ ] **Step 1: Write failing task API tests**

Add tests in `test/test_image_tasks_api.py`:

```python
def test_create_generation_task_passes_resolution_and_uses_credit_cost(self):
    captured_amounts = []
    def consume(identity, release, *, amount=1):
        captured_amounts.append(amount)
    with mock.patch.object(image_tasks_module, "consume_persistent_image_quota", consume):
        response = self.client.post(
            "/api/image-tasks/generations",
            headers=AUTH_HEADERS,
            json={"client_task_id": "task-2k", "prompt": "cat", "model": "gpt-image-2", "resolution": "2K"},
        )
    self.assertEqual(response.status_code, 200, response.text)
    self.assertEqual(captured_amounts, [2])
    self.assertEqual(self.fake_service.generation_calls[0][1]["resolution"], "2k")

def test_create_generation_task_rejects_unknown_resolution(self):
    response = self.client.post(
        "/api/image-tasks/generations",
        headers=AUTH_HEADERS,
        json={"client_task_id": "task-8k", "prompt": "cat", "model": "gpt-image-2", "resolution": "8k"},
    )
    self.assertEqual(response.status_code, 400, response.text)
```

- [ ] **Step 2: Run task API tests to verify RED**

Run: `python -m unittest test.test_image_tasks_api.ImageTasksApiTests.test_create_generation_task_passes_resolution_and_uses_credit_cost test.test_image_tasks_api.ImageTasksApiTests.test_create_generation_task_rejects_unknown_resolution`

Expected: FAIL before `resolution` support exists.

- [ ] **Step 3: Implement task API resolution handling**

In `ImageGenerationTaskRequest`, add `resolution: str | None = None`.

Change `_acquire_image_usage_limit` to accept `amount`:

```python
def _acquire_image_usage_limit(identity: dict[str, object], model: str, *, amount: int = 1):
    release = usage_limit_service.acquire(identity, model=model, kind="image")
    consume_persistent_image_quota(identity, release, amount=amount)
    return release
```

Normalize task API resolution with `strict=True`, pass `resolution=resolution`, and call acquire with `amount=image_credit_cost(resolution)`.

For edit tasks, add `resolution: str | None = Form(default=None)` and the same strict handling.

- [ ] **Step 4: Persist resolution in task service**

Add `resolution` parameter to `submit_generation` and `submit_edit`, store it in task records, include it in `_task_to_public`, and include it in handler payloads.

- [ ] **Step 5: Run task tests to verify GREEN**

Run: `python -m unittest test.test_image_tasks_api test.test_image_task_service`

Expected: PASS or only unrelated pre-existing failures documented.

## Task 4: Access-Code/User Management Credit Copy

**Files:**
- Modify: `services/auth_service.py`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/app/settings/components/user-keys-card.tsx`
- Test: `test/test_user_key_limits.py`
- Test: `web/src/app/settings/components/user-keys-card.test.tsx`

- [ ] **Step 1: Write failing check-in compatibility test**

In `test_checkin_adds_total_quota_once_per_day`, add:

```python
self.assertEqual(first["bonus_credits"], 20)
self.assertEqual(second["bonus_credits"], 0)
```

- [ ] **Step 2: Write failing access-code copy test**

Update `user-keys-card.test.tsx` expectations:

```typescript
expect(source).toContain("总积分");
expect(source).toContain("已用积分");
expect(source).toContain("剩余积分");
expect(source).not.toContain("总图片额度");
expect(source).not.toContain("已用图片");
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
python -m unittest test.test_user_key_limits.UserKeyAuthServiceLimitTests.test_checkin_adds_total_quota_once_per_day
npx bun test web/src/app/settings/components/user-keys-card.test.tsx
```

Expected: FAIL before copy/response updates.

- [ ] **Step 4: Implement check-in and access-code copy**

In `check_in`, return:

```python
return {"awarded": awarded, "bonus_images": bonus_images, "bonus_credits": bonus_images, "user": self._public_item(next_item)}
```

In `UserCheckInResponse`, add `bonus_credits: number`.

In `user-keys-card.tsx`, rename form state and visible copy from image quota labels to credit labels while keeping payload fields as `images_total` and `images_used`.

- [ ] **Step 5: Run tests to verify GREEN**

Run the same backend/frontend focused tests.

Expected: PASS.

## Task 5: Frontend API And Submission Resolution

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/app/ColaAI/components/generate-task-submission.ts`
- Test: `web/src/app/ColaAI/components/generate-task-submission.test.ts`

- [ ] **Step 1: Write failing submission tests**

Add/adjust tests:

```typescript
test("passes resolution to generation tasks and preserves it for retry", async () => {
  const calls: Array<{ resolution?: string }> = [];
  const tasks = await createGenerateSubmissionTasks(
    { prompt: "生成海报", count: 1, model: "gpt-image-2", size: "1:1", resolution: "4k" },
    {
      createTaskId: () => "task-4k",
      createGenerationTask: async (_id, _prompt, _model, _size, _public, resolution) => {
        calls.push({ resolution });
        return { id: "task-4k", status: "queued", mode: "generate", model: "gpt-image-2", size: "1:1", resolution, created_at: "now", updated_at: "now" };
      },
    },
  );
  expect(calls).toEqual([{ resolution: "4k" }]);
  expect(buildGenerateRetrySubmissionInput(tasks[0])).toMatchObject({ resolution: "4k" });
});
```

- [ ] **Step 2: Run submission tests to verify RED**

Run: `npx bun test web/src/app/ColaAI/components/generate-task-submission.test.ts`

Expected: FAIL before resolution is in types/signatures.

- [ ] **Step 3: Implement API and submission types**

Add:

```typescript
export type ImageResolution = "1k" | "2k" | "4k";
```

Add optional `resolution?: ImageResolution | string` to `ImageTask`, `GenerateSubmissionInput`, `GenerateSubmissionContext`, and task creation helpers. Update `createImageGenerationTask` and `createImageEditTask` to include/send `resolution`.

- [ ] **Step 4: Run submission tests to verify GREEN**

Run the same Bun test.

Expected: PASS.

## Task 6: ColaAI Resolution Selector And Local Credit Decrement

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Test: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Write failing workbench tests**

Update quota decrement test:

```typescript
test("decrements ordinary user credits after successful task submission", () => {
  expect(decrementSessionImageQuota(sessionWithLimits, 6).limits).toEqual({
    imagesTotal: 10,
    imagesUsed: 9,
    imagesRemaining: 1,
  });
});
```

Add source assertions:

```typescript
expect(workbenchSource).toContain("resolution");
expect(workbenchSource).toContain("1K");
expect(workbenchSource).toContain("2K");
expect(workbenchSource).toContain("4K");
expect(workbenchSource).toContain("剩余");
expect(workbenchSource).toContain("积分");
expect(workbenchSource).not.toContain("预计可生成 {formatImageRemaining(session.limits)} 张");
```

- [ ] **Step 2: Run workbench tests to verify RED**

Run: `npx bun test web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

Expected: FAIL before resolution selector/copy changes.

- [ ] **Step 3: Implement workbench resolution state and selector**

Add resolution state defaulting to `1k`, present selector labels `1K`, `2K`, `4K`, and pass `resolution` into `submitGenerateTasks`.

Add frontend helper:

```typescript
export function imageResolutionCreditCost(resolution?: string) {
  return resolution === "4k" ? 3 : resolution === "2k" ? 2 : 1;
}
```

Compute accepted credits:

```typescript
const acceptedCredits = tasks
  .filter((task) => task.status !== "error")
  .reduce((sum, task) => sum + imageResolutionCreditCost(task.submissionContext?.resolution ?? input.resolution), 0);
```

Use accepted credits for local decrement in both generation paths.

- [ ] **Step 4: Update quota/check-in copy**

Use credit-oriented text:

```tsx
{session.name || "ColaAI"} · 剩余 {formatImageRemaining(session.limits)} 积分
```

For check-in, prefer `result.bonus_credits ?? result.bonus_images` and display `积分`.

- [ ] **Step 5: Run workbench tests to verify GREEN**

Run: `npx bun test web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

Expected: PASS or only unrelated pre-existing failures documented.

## Task 7: Focused Verification And Completion Audit

**Files:**
- Inspect all modified files from Tasks 1-6.

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
python -m unittest test.test_user_key_limits test.test_image_tasks_api test.test_image_task_service
```

Expected: PASS or document unrelated pre-existing failures with exact failing test names.

- [ ] **Step 2: Run frontend focused tests**

Run:

```bash
npx bun test web/src/app/ColaAI/components/generate-task-submission.test.ts web/src/app/ColaAI/components/cola-ai-workbench.test.tsx web/src/app/settings/components/user-keys-card.test.tsx web/src/lib/api.test.ts web/src/store/auth.test.ts
```

Expected: PASS or document unrelated pre-existing failures with exact failing test names.

- [ ] **Step 3: Search for stale user-facing image quota copy**

Run:

```bash
rg -n "总图片额度|已用图片|预计可生成|图片总数|剩余额度：" web/src/app/ColaAI web/src/app/settings web/src/lib web/src/store
```

Expected: no stale quota-as-image copy in access-code or ColaAI quota surfaces. Non-quota image references may remain.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git diff -- api/support.py api/ai.py api/image_tasks.py services/image_task_service.py services/protocol/openai_v1_image_generations.py services/protocol/openai_v1_image_edit.py services/auth_service.py test/test_user_key_limits.py test/test_image_tasks_api.py web/src/lib/api.ts web/src/app/settings/components/user-keys-card.tsx web/src/app/settings/components/user-keys-card.test.tsx web/src/app/ColaAI/components/generate-task-submission.ts web/src/app/ColaAI/components/generate-task-submission.test.ts web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/ColaAI/components/cola-ai-workbench.test.tsx
```

Expected: changes align with resolution credits and no unrelated refactor.

- [ ] **Step 5: Report completion**

Summarize changed behavior, verification commands, and any unrelated pre-existing test/typecheck failures.
