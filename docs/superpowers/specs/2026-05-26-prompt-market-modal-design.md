# Prompt Market Modal Design

## Goal

Add a first usable prompt-template market to Studio. The market opens as a large modal from the existing Studio composer instead of navigating to a separate page. Users can browse public image prompt templates, maintain private templates, favorite templates, submit templates for review, and apply a template back into the current composer without losing the current Studio context.

## Confirmed Product Decisions

- Scope is the station-local market MVP, not an external GitHub/resource import system.
- Public submissions require review. User submissions start as `pending`; admins can approve or reject them.
- A template stores prompt text and basic image parameters only: title, description, prompt, model, size, count, tags, and one preview image.
- The preview image is selected from an existing generated result. First version does not upload arbitrary covers.
- The market appears as a Studio modal. It does not include a logout area or a full standalone sidebar.

## Non-Goals

- No external template harvesting, GitHub import, or bundled public resource collection in this phase.
- No ratings, comments, download counts, view counts, or recommendation ranking.
- No reference-image/template-with-source-image support.
- No automatic generation when applying a template.
- No marketplace page outside Studio for the first version.

## User Experience

The existing Studio `市场` button opens a centered modal over the current Studio screen. The background remains visible with a light blur/dim so the user understands they are still in the same creation flow.

The modal header contains:

- Title: `提示词库`
- A short description explaining that applying a template fills the current composer.
- `刷新`
- `新建私有模板`
- Close button

The modal body contains:

- Statistic cards: public templates, my private templates, my favorites, my submissions.
- Tabs: public templates, my private templates, my favorites, my submissions.
- Admin-only review tab: visible only for admin users and hidden from normal users.
- Display controls: grid/list segmented control and a masonry-density selector.
- Template cards with preview image, title, author, model, size, count, tags, short description, apply action, and favorite action.

Applying a template closes the modal and fills the current Studio composer:

- `prompt`
- `selectedImageModel`
- `imageSize`
- `imageCount`

Applying does not submit the task. The user can still edit the prompt or parameters before sending.

## Template Creation Flow

Users create a template from an existing generated result in a Studio image turn.

Entry points:

- Template modal `新建私有模板`
- Generated result card action `保存为模板`

The creation form asks for:

- Preview image: selected generated result
- Title
- Description
- Prompt, prefilled from the source turn
- Model, size, and count, prefilled from the source turn
- Tags
- Visibility: private or submit to public review

If the user chooses private, the template is stored as private and visible under `我的私有`.

If the user chooses submit, the template is stored as public-candidate with status `pending` and visible under `我的投稿`.

## Review Flow

Admins can open the review queue inside the same modal.

Admin actions:

- Approve: changes status to `approved`, making the template visible in public templates.
- Reject: changes status to `rejected` and requires a short rejection reason.

Normal users can view their own submitted templates in `我的投稿` with status:

- `pending`
- `approved`
- `rejected`

Rejected templates show the rejection reason.

## Data Model

Use a backend-owned model so the market works across browsers and users.

`PromptTemplate`:

- `id`: string
- `title`: string
- `description`: string
- `prompt`: string
- `model`: image model string
- `size`: string
- `count`: number
- `tags`: string[]
- `preview_image`: object
- `preview_image.url`: protected image URL or managed image path
- `preview_image.thumbnail_url`: optional thumbnail URL
- `preview_image.source_image_id`: optional managed/generated image id
- `owner_id`: string
- `owner_name`: string
- `visibility`: `private` or `public`
- `review_status`: `draft`, `pending`, `approved`, or `rejected`
- `review_reason`: optional string
- `reviewed_by`: optional string
- `reviewed_at`: optional ISO timestamp
- `created_at`: ISO timestamp
- `updated_at`: ISO timestamp

`PromptTemplateFavorite`:

- `template_id`: string
- `user_id`: string
- `created_at`: ISO timestamp

Derived counts are computed from templates and favorites rather than stored as mutable counters.

## Backend API

Add a focused router, for example `api/prompt_market.py`, mounted from `api/app.py`.

Endpoints:

- `GET /api/prompt-templates`
  - Query: `scope=public|private|favorites|submissions|review`, `q`, `tag`, `layout`, `status`
  - Public scope returns `approved` public templates.
  - Private scope returns templates owned by the current user.
  - Favorites scope returns favorited templates for the current user.
  - Submissions scope returns current user's submitted templates.
  - Review scope requires admin and returns pending/rejected/approved candidates.

- `GET /api/prompt-templates/stats`
  - Returns counts for public, private, favorites, submissions, and admin pending review count when applicable.

- `POST /api/prompt-templates`
  - Creates a private template or a pending submission.
  - Requires authenticated identity.

- `PATCH /api/prompt-templates/{id}`
  - Owner can edit private templates and pending/rejected submissions.
  - Admin can edit reviewed public templates if needed.

- `DELETE /api/prompt-templates/{id}`
  - Owner can delete private templates and own submissions that are not approved public templates.
  - Admin can delete any template.

- `POST /api/prompt-templates/{id}/favorite`
  - Adds favorite for current user.

- `DELETE /api/prompt-templates/{id}/favorite`
  - Removes favorite for current user.

- `POST /api/prompt-templates/{id}/review`
  - Admin-only. Body contains `action=approve|reject` and optional `reason`; rejection requires `reason`.

## Storage

For the MVP, use a dedicated prompt-template service that persists to `data/prompt_templates.json` and `data/prompt_template_favorites.json`.

This avoids overloading the account/auth-key storage abstraction, which currently only covers accounts and auth keys. The service should use a small file-lock or queued-write pattern so concurrent requests do not corrupt JSON files.

If the project later needs database/git-backed prompt templates, the service can be lifted into the shared storage abstraction after the data shape stabilizes.

## Frontend Components

Add market-specific components under Studio or image app component folders:

- `PromptMarketModal`
- `PromptTemplateCard`
- `PromptTemplateFormDialog`
- `PromptTemplateReviewPanel`
- `PromptTemplateDisplayControls`

Studio owns modal open state and the apply-template handler. The modal receives callbacks to apply selected template values to the existing Studio composer state.

The modal should not own or reset the current conversation, current prompt draft, or uploaded reference images except when the user explicitly applies a template. Applying a template replaces prompt/model/size/count only and leaves reference images unchanged for the first version.

## Error Handling

- Template list failure: show a compact error state with retry.
- Create/update failure: keep form values and show the backend error message.
- Review failure: keep the item in queue and show an error toast.
- Apply failure should be rare because it is local state update; if template data is incomplete, disable apply and show why.
- Missing preview image: render a neutral placeholder card rather than blocking template listing.

## Permissions

Use existing auth identity helpers:

- Any authenticated identity can list approved public templates.
- Authenticated users can manage their own private templates, favorites, and submissions.
- Admin-only actions use `require_admin`.
- Server responses should never expose non-owner private templates to other users.

## Testing

Backend tests:

- Public list returns approved public templates only.
- Private list returns only current user's private templates.
- Favorite add/remove affects only current user.
- Submission starts as pending.
- Admin can approve and reject.
- Non-admin cannot access review queue or review endpoint.
- Rejection requires a reason.

Frontend tests or focused component checks:

- Market button opens modal and does not navigate away from Studio.
- Applying a template fills prompt, model, size, and count without submitting.
- Normal users do not see review controls.
- Admin users can see review queue.
- Cards render preview image, title, metadata, tags, apply, and favorite controls.

Manual verification:

- Open Studio, click `市场`, verify modal appears over current Studio view.
- Create a private template from a generated result.
- Submit a template for review and see it under `我的投稿`.
- Approve as admin and verify it appears under public templates.
- Apply an approved template and verify the composer is updated.
