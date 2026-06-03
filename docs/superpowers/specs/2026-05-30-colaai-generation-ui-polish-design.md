# ColaAI Generation UI Polish Design

## Design Read

ColaAI's image generation surface is a practical creative tool for users who repeatedly prompt, tune, compare, and reuse generated images. The redesign should feel more memorable and intentional than a plain chat input, while preserving the existing quiet white-glass visual language.

Dial values:

- Design variance: 6
- Motion intensity: 4
- Visual density: 4

## Direction

Use the "creative instrument panel" direction. The composer remains minimal, but the controls should read as a compact creation console instead of a generic text box with chips.

The accent color is a single restrained teal family. It is used only for active creative states, reference-image affordances, and subtle focus cues. Avoid purple AI gradients and avoid adding decorative content unrelated to generation.

## Scope

In scope:

- The bottom generation composer in `GenerateWorkspace`.
- The large composer control popovers for model, ratio, and count.
- Reference-image upload, preview, and remove affordances.
- Empty and active prompt states in the composer.
- The generate button, public toggle, and parameter chips.

Out of scope:

- Backend image generation behavior.
- Conversation persistence.
- Canvas editor behavior.
- The left navigation rail.
- The generated result card layout, unless a small spacing adjustment is required to keep the composer visually balanced.

## User Experience

The composer should communicate three zones:

1. Reference slot: a visible material slot for uploading or showing a reference image.
2. Prompt field: the primary writing surface with a calm placeholder and strong focus treatment.
3. Control strip: compact model, ratio/count, privacy, and submit controls with clear active states.

When no prompt exists, the input should feel inviting without becoming a landing-page hero. When a reference image exists, the upload slot should become a thumbnail with a precise remove control.

The popovers should feel like small studio panels. They keep the current option sets, but use clearer selected states, fewer competing colors, and consistent radii.

## Accessibility And Responsiveness

All existing button labels and keyboard behavior remain intact. The textarea keeps Enter-to-generate and Shift+Enter line break behavior. Controls must stay one-line on desktop and wrap cleanly on narrow mobile widths without text overlap.

Use a single corner-radius rule:

- Composer shell: 24px.
- Inner slots and popovers: 18px to 20px.
- Chips and submit button: full pill.

## Verification

Run the ColaAI component tests that cover the composer and page. Run the frontend typecheck if available. Verify the page in the in-app browser at `http://localhost:3000/ColaAI/`, including desktop and a narrow mobile viewport.
