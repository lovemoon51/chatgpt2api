# Prompt Market Interface Polish Design

## Goal

Improve the existing Studio prompt market modal without changing the prompt-template product model or backend API. The optimized interface should keep the current modal-based flow, make browsing templates feel polished, and reduce vertical and visual clutter so users can manage larger template collections comfortably.

## Confirmed Direction

The chosen direction is `A. 顶部工具栏收紧`.

This iteration keeps the current modal, tabbed scopes, grid/list display, density control, inline create/edit form, and card-based content area. It does not add a left navigation rail, persistent detail preview panel, or standalone market page.

## Non-Goals

- No backend schema, permission, storage, or API changes.
- No new template ranking, rating, comment, or recommendation behavior.
- No left sidebar navigation.
- No right-side detail preview panel.
- No automatic generation after applying a template.
- No changes to the apply-template payload; applying still fills prompt, model, size, and count only.

## Layout

The modal remains a large centered Studio dialog. Its desktop width and height can stay close to the current implementation, but the visual rhythm should be tighter and more tool-like.

The top of the modal should become two compact layers:

- Header layer: title, short description, refresh action, and create action.
- Control layer: scope tabs, lightweight stats, search, grid/list segmented control, and density selector.

The current large statistic cards should be replaced with compact stat chips such as `公共 12`, `私有 3`, `收藏 8`, `投稿 1`, and admin-only `待审核 2`. These chips should use restrained borders and backgrounds instead of card shadows.

On desktop, the scope tabs and controls should fit into one tidy toolbar when space allows. On smaller widths, the search field can take a full row and controls can wrap naturally without squeezing the title or actions.

## Template Cards

Grid cards should keep the preview image prominent but use a more disciplined structure:

- Border radius should be reduced from the current large rounded style to a moderate tool-surface style.
- Preview image remains at the top with a stable aspect ratio.
- Status is shown as a lightweight badge over the preview or near metadata.
- Title uses a compact two-line clamp.
- Metadata groups author, model, size, and count in one readable line.
- Description or prompt fallback uses a two-line clamp.
- Tags remain visible but should not dominate the card.
- Primary action `套用` stays visually strongest and sits in the action row.
- Favorite is an icon button.
- Edit, delete, approve, and reject are secondary actions with lower visual weight.

List mode should feel like a management list rather than stretched grid cards:

- Thumbnail on the left with a fixed width on desktop.
- Text and metadata in the center.
- Actions aligned consistently on the right or bottom depending on available width.
- Mobile list mode can collapse back into a single-column card layout.

## Create And Edit Form

The inline form remains inside the modal, but should be lighter and better grouped.

Form sections:

- Basic information: title, tags, description.
- Prompt: prompt textarea.
- Parameters: model, size, count, visibility.

Desktop layout keeps preview image on the left and fields on the right. Mobile layout stacks preview above fields. Buttons stay at the form bottom, with copy that matches intent:

- `保存私有`
- `提交审核`
- `保存修改`

Validation remains local for title and prompt. Backend errors should keep the form open and preserve field values.

## Empty, Loading, And Error States

Loading state should stay centered but use short copy and avoid visually taking over the whole modal.

Error state should remain retryable but read like an inline content error, not a large alert wall. It should include the backend message and a retry button.

Empty states should be scope-aware:

- Public empty: `暂无公共模板`.
- Private empty: `暂无私有模板`, with a create action.
- Favorites empty: `还没有收藏模板`.
- Submissions empty: `还没有投稿模板`.
- Review empty: `暂无待审核模板`.

Missing preview images should continue to render a neutral placeholder and should not block browsing or actions.

## Review And Risk Actions

Review status labels remain:

- `待审核`
- `已公开`
- `已驳回`
- `私有草稿`

Rejected templates should continue to show the rejection reason. Rejecting a submission still requires a reason. Deleting a template still requires confirmation.

Admin-only review controls remain hidden for normal users.

## Dark Mode And Responsive Behavior

Dark mode should use the same structure and hierarchy as light mode, with dark backgrounds, borders, and form controls tuned together. Avoid light native controls standing out inside the dark modal.

Responsive requirements:

- Header actions must not collide with title text.
- Search should become full-width when needed.
- Grid cards become single-column on narrow screens.
- Card action rows must wrap cleanly without overlapping text.
- Dialog content should remain scrollable with fixed header/control areas.

## Testing

Focused frontend tests should cover:

- Compact stats render the expected scope counts.
- Non-admin users do not see the review tab or review actions.
- Admin users can see the review tab.
- Template cards render preview, status, title, metadata, tags, apply, favorite, and management actions.
- Empty states are scope-aware and show the correct action for private templates.
- Applying a template still builds the same payload: prompt, model, size, and count.

Manual browser verification should cover:

- Desktop Studio modal opened from `市场`.
- Mobile viewport modal layout.
- Grid and list mode.
- Comfortable and compact density.
- Empty state.
- Dark theme.
- Create/edit form expansion.
- Admin review controls when using an admin session.
