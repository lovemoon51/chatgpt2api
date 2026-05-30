# ColaAI Generation Stage Polish Design

## Design Read

This is the second stage of ColaAI's image-generation interface polish. The bottom composer now reads as a restrained creative instrument panel, so the top session rail and result stage should use the same quiet studio language.

Dial values:

- Design variance: 6
- Motion intensity: 4
- Visual density: 4

## Direction

Use a "developing studio stage" treatment. The top rail stays compact, but active conversation state should use the same teal accent as the composer. The result stage should feel like a calm work surface for generated images and prompt records.

Generation animation should be visible but not theatrical. Use a film-development metaphor: soft placeholders, slow scanning light, grid texture, and progress dots. Avoid purple AI glow, big loaders, bouncing mascots, or full-screen blocking overlays.

## Scope

In scope:

- `GenerateSessionRail` visual treatment.
- `GenerateConversationStage` container and prompt/result card treatment.
- `GenerationStage` active-generation animation.
- CSS needed for the developing placeholders.

Out of scope:

- Image task submission logic.
- Task polling.
- Conversation persistence.
- Canvas workflow.
- Bottom composer behavior, except for preserving visual alignment.

## UX Requirements

- Empty stage remains quiet and does not look broken.
- Active generation shows 1 to 4 developing placeholders based on requested count.
- The active status is inline with the current turn, not a blocking modal.
- Motion respects `prefers-reduced-motion` through the existing global reduced-motion block.
- Existing accessible text and live region behavior remains.
