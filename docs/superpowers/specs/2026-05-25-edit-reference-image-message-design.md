# Edit Reference Image Message Design

## Goal

When a user sends an image-to-image or image edit request, the edited/reference image should appear as part of that sent user message. The image is shown above the prompt bubble, aligned to the right, so the conversation history clearly shows which image the prompt edited.

## Scope

- Show submitted `referenceImages` in the historical conversation turn, above the user's prompt text.
- Keep ordinary text-to-image turns visually unchanged.
- Keep current composer reference-image preview and removal behavior unchanged.
- Keep image generation, edit submission, and continue-edit data flow unchanged.
- Support one or more reference images.

## UI Behavior

For turns with reference images, the user-message area renders a right-aligned attachment strip above the prompt bubble. A single image appears as a thumbnail above the prompt. Multiple images appear in a compact row aligned to the right and wrap when needed on narrow screens.

The prompt bubble remains the primary user message content. The reference thumbnails should feel attached to that same message, not like a separate result section. No reference image UI is shown for turns without reference images.

## Data Flow

The existing image conversation model already stores submitted reference images on each turn as `referenceImages`. The page-level submission, image edit task creation, and continue-edit handlers do not need new state. Rendering should use the `referenceImages` already present on each `ImageTurn`.

Legacy single-source-image data remains covered by the existing normalization into `referenceImages`.

## Components

`ImageResults` is the main rendering target because it owns the conversation turn display. It should render reference thumbnails near the right-aligned user prompt area instead of presenting them as a separate “本轮参考图” block in the result details.

The composer remains responsible for unsent reference-image previews. It should not display unsent images in the historical conversation area.

## Edge Cases

- No reference images: keep current layout.
- Multiple reference images: render compact thumbnails, right-aligned, wrapping on small screens.
- Mobile width: use smaller thumbnails or existing responsive styles so prompt text remains readable.
- Image load failure: keep behavior simple with the browser image fallback or a minimal thumbnail placeholder if the current component pattern already supports it.

## Verification

- Run the relevant frontend typecheck or test command available in the project.
- Manually verify ordinary text-to-image turns still look unchanged.
- Manually verify an image edit turn shows the submitted reference image above the right-aligned prompt.
- Manually verify multiple reference images align to the right and wrap cleanly.
- Confirm “加入编辑” still only populates the composer until the next prompt is sent.
