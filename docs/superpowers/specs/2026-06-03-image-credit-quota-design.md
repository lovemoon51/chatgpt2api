# Image Credit Quota Design

## Summary

Change ordinary-user image quota from "number of images" to "credit points" consumed by requested image resolution:

- 1K image: 1 credit
- 2K image: 2 credits
- 4K image: 3 credits

The access-code/user-management flow uses the same credit quota semantics, so administrators create and edit access codes by total credits, used credits, and remaining credits rather than total images, used images, and remaining images.

## Current State

The backend currently stores ordinary-user image quota in `limits.images_total`, `limits.images_used`, and computed `limits.images_remaining`. These names are image-oriented, but the service already supports integer quota totals and multi-unit consumption through `auth_service.consume_image_quota(user_id, amount=...)`.

Image generation paths currently deduct by count:

- `/v1/images/generations` uses `amount=body.n`.
- `/v1/images/edits` uses `amount=n`.
- `/api/image-tasks/generations` and `/api/image-tasks/edits` deduct `amount=1` per queued task.

The frontend currently sends `size` as a composition ratio such as `1:1`, `9:16`, or leaves it unset for auto composition. It does not have a dedicated 1K/2K/4K resolution field.

## Requirements

1. Users consume credits based on requested resolution, not generated image count alone.
2. 1K costs 1 credit, 2K costs 2 credits, and 4K costs 3 credits.
3. Multiple requested images/tasks multiply the per-image credit cost.
4. Access-code creation, editing, listing, and filters display and edit credit quota, not image quota.
5. Existing users and existing stored data continue to work without a required migration step.
6. Existing API callers that do not pass resolution default to 1K behavior.
7. The ratio/composition `size` field remains separate from resolution.

## Recommended Approach

Introduce a dedicated `resolution` request field with canonical values `1k`, `2k`, and `4k`.

Keep `images_total`, `images_used`, and `images_remaining` as storage and wire-compatibility fields for this change, but treat their semantic meaning as credit totals. UI copy and frontend session names should move toward "credits" while continuing to accept the existing backend payload shape.

This avoids a broad storage migration while still fixing the behavior and user-facing semantics.

## Backend Design

Add a small shared credit-cost helper near the quota enforcement path, for example:

- `normalize_image_resolution(value) -> "1k" | "2k" | "4k"`
- `image_credit_cost(value) -> 1 | 2 | 3`

Rules:

- Missing or empty resolution defaults to `1k`.
- Frontend task APIs reject explicit unknown resolution values with a 400 response.
- OpenAI-compatible endpoints normalize explicit unknown resolution values to `1k` for third-party compatibility.
- Canonical values are lowercase: `1k`, `2k`, `4k`.
- Friendly aliases such as `1K`, `2K`, and `4K` normalize to lowercase.

Apply the helper in all image quota consumers:

- `/v1/images/generations`: `amount = cost(resolution) * n`
- `/v1/images/edits`: `amount = cost(resolution) * n`
- `/api/image-tasks/generations`: `amount = cost(resolution)`
- `/api/image-tasks/edits`: `amount = cost(resolution)`

The task service should persist `resolution` on tasks alongside `size` so retries, history, and UI state can preserve the selected resolution. The protocol layer can pass `resolution` through the payload even if the current upstream image implementation only uses it for quota accounting initially.

Quota errors keep the existing `image total limit exceeded` behavior internally, but user-facing UI should translate this as insufficient credits.

## Access-Code And User Management Design

Keep accepting existing request fields:

- `images_total`
- `images_used`
- `images_remaining` as computed output

Change admin UI labels and form semantics:

- "总图片额度" -> "总积分"
- "已用图片" -> "已用积分"
- "当前余额" -> "剩余积分"
- Balance filters refer to credits.

Do not add `credits_total`, `credits_used`, or `credits_remaining` response fields in this implementation. The existing `images_*` fields remain the wire format and are interpreted as credit fields by the frontend.

Daily check-in currently returns `bonus_images = 20`. Keep that compatibility response field and add `bonus_credits` with the same numeric value. Frontend copy should display the award as credits.

## ColaAI Frontend Design

Add a resolution selector to the generation composer:

- 1K
- 2K
- 4K

Default is 1K to preserve current cost behavior for existing users.

The generation submit path includes `resolution` in:

- `createImageGenerationTask`
- `createImageEditTask`
- retry submission context
- persisted generation conversation/task context where relevant

Local quota decrement changes from accepted task count to accepted credit amount:

- accepted 1K task: decrement 1
- accepted 2K task: decrement 2
- accepted 4K task: decrement 3

For multiple submitted tasks, sum each accepted task's resolution cost. Failed or rejected submissions do not decrement local credits.

Update user-facing quota text:

- "预计可生成 N 张" becomes credit-oriented text such as "剩余 N 积分".
- "剩余额度" labels specify credits where shown.

## OpenAI-Compatible Image API Design

Extend request models to accept `resolution`:

- JSON body for `/v1/images/generations`
- multipart form for `/v1/images/edits`

Existing callers without `resolution` default to `1k`.

The existing `size` parameter remains available and unchanged.

## Error Handling

If an authenticated ordinary user lacks enough remaining credits, the backend rejects before queueing/submitting with the existing usage-limit response shape.

Admins remain unlimited unless existing admin-specific restrictions are introduced elsewhere.

Invalid `resolution` handling is endpoint-specific:

- Missing or empty values always default to `1k`.
- `/api/image-tasks/*` rejects explicit unknown values with status 400.
- `/v1/images/*` normalizes explicit unknown values to `1k` to preserve third-party compatibility.

## Testing

Backend tests:

- `auth_service.consume_image_quota(..., amount=...)` still deducts multi-credit usage and rejects overuse.
- Resolution cost helper maps 1K/2K/4K to 1/2/3.
- `/v1/images/generations` deducts `cost * n`.
- `/v1/images/edits` deducts `cost * n`.
- `/api/image-tasks/generations` and `/api/image-tasks/edits` deduct `cost` per queued task.
- Existing no-resolution requests default to 1 credit.

Frontend tests:

- Access-code card renders credit labels.
- Access-code create/edit still sends compatible limit fields.
- ColaAI generation task creation sends `resolution`.
- Local session decrement uses accepted credit amount instead of accepted image count.
- Retry preserves the original resolution.

## Out Of Scope

- Renaming persisted storage fields from `images_*` to `credits_*`.
- A historical data migration.
- Guaranteeing upstream image providers actually render different pixel dimensions immediately.
- Changing account-pool upstream quota reporting.
