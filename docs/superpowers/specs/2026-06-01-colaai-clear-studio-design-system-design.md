# ColaAI Clear Studio Design System Design

## Goal

Upgrade ColaAI into a unified clear studio workbench, so discovery, image generation, canvas, prompt library, assets, API, notices, and settings all feel like one product system instead of separate polished pages.

## Design Read

ColaAI is a creative AI product for frequent image generation users. The redesign should feel like a professional studio workbench: calm, clear, fast to scan, and visually refined without becoming decorative or marketing-heavy.

Chosen direction: **Clear Professional Workbench**.

## Scope

This design covers global visual system alignment across the current ColaAI workbench. It keeps the existing information architecture, route, primary navigation labels, and core workflows intact.

In scope:

- Global color, surface, shadow, shape, focus, and motion rules.
- Shared visual treatment for side navigation, mobile navigation, panels, cards, inputs, buttons, segmented controls, tags, empty states, loading states, and error states.
- Focused visual hierarchy improvements for Discover, Generate, Canvas Home, Prompt Library, Assets, Developer, Notice, and Settings modes.
- Accessibility and reduced-motion requirements.

Out of scope:

- Changing route structure or primary navigation labels.
- Rewriting product copy beyond short labels required for clarity.
- Replacing the existing React state architecture.
- Introducing a new component library.
- Implementing a dark Creator OS mode in this pass.

## Design Principles

### 1. One Workbench, Many Modes

Every mode should share the same material language. The user should feel they are moving between rooms in the same studio, not between unrelated templates.

### 2. Clear Before Decorative

The design should make the main task obvious:

- Discover: start from prompt and inspiration.
- Generate: continue a visual conversation and inspect task output.
- Canvas: create, open, or template a node workflow.
- Prompt Library: search, filter, inspect, copy, and apply.
- Assets: browse, copy, download, and reuse images.

### 3. Restrained ColaAI Accent

ColaAI can keep its cyan, emerald, and blue creative feel, but accent color should be used for focus, status, and selected states. It should not flood every surface.

### 4. Stable Density

The UI should be dense enough for repeated work, but not cramped. Cards and panels should use consistent spacing and predictable scan paths.

## Visual System

### Color

Use a light, cool, clear workbench palette.

- Page background: cold slate white to very pale mint or cyan.
- Main text: slate 950.
- Secondary text: slate 500 to slate 600.
- Muted surfaces: slate 50, slate 100.
- Primary action: slate 950 with white text.
- Secondary action: white or slate 50 with slate text and a light border.
- Accent: emerald or cyan for focus rings, selected states, live status, and generation progress.
- Warning and destructive states: keep semantic amber and red, but desaturate enough to fit the system.

Avoid:

- Warm beige page backgrounds as the default.
- Purple or blue glow as a blanket AI style.
- Multiple competing accent colors in the same panel.
- Strong gradient buttons for ordinary actions.

### Surfaces

Use one shared surface family:

- Primary panels: translucent white with a subtle slate border.
- Secondary panels: solid slate 50 or white with light border.
- Floating overlays: white with stronger border, shadow, and backdrop blur.
- Image cards: minimal chrome, clear hover controls, no excessive nested card frames.

Surface shadows should be soft and tinted with slate, not pure black. Shadows communicate hierarchy, not decoration.

### Shape

Use a consistent radius system:

- Small controls: 10 to 12px.
- Standard panels and cards: 16 to 20px.
- Large composer or workspace shells: 22 to 24px.
- Pills only for segmented controls, compact filters, and icon buttons where the shape has a functional purpose.

Avoid arbitrary mixed radius values in the same area.

### Typography

Keep the existing Next font foundation and use tighter hierarchy:

- Page titles: compact and confident, not oversized marketing hero type inside work surfaces.
- Panel titles: small but high contrast.
- Body copy: slate 500 to slate 600 with readable line height.
- Metadata: compact, stable, and aligned.

No serif font is needed for this product UI.

### Motion

Motion intensity should be moderate and functional.

Use motion for:

- Button active feedback.
- Card hover lift or media reveal.
- Panel and menu entrance.
- Generation loading phases.
- Task status transitions.
- Canvas template and empty-state affordances.

Requirements:

- All decorative or repeated motion must respect `prefers-reduced-motion`.
- Loading states should use skeletons that match final layout shapes.
- Avoid continuous attention-grabbing motion in dense work areas.

## Component Rules

### Navigation

Side navigation remains stable in label and order. It should use:

- A clean vertical rail with consistent icon button sizes.
- One active state style across all modes.
- Compact utility actions separated from primary product modes.
- Clear hover and keyboard focus states.

Mobile navigation should use the same active state and visual material, with no separate styling language.

### Buttons

Use three button roles:

- Primary: slate 950 background, white text.
- Secondary: white or slate 50 background, slate text, subtle border.
- Ghost: transparent, used only where surrounding hierarchy is already clear.

All buttons need readable contrast, icon alignment, active feedback, and no wrapping labels in desktop layouts.

### Inputs And Composer

Prompt input and search fields should share the same input shell language:

- Clear border and focus ring.
- Consistent placeholder tone.
- Attached action controls should visually belong to the same composer.
- The Generate action should be visually dominant, but not visually noisy.

### Cards

Cards should be used for repeated items and framed tools only.

Repeated item cards:

- Image cards show the image first, then title and metadata.
- Prompt cards show title, author or source, tags, prompt preview, and actions in predictable positions.
- Asset cards should keep filename and actions legible without covering important image content.

Avoid card-inside-card structures unless the inner surface is an actual control group.

### Segmented Controls And Tags

Use segmented controls for mutually exclusive mode choices such as ratio, count, model group, and asset filters.

Use tags for metadata only. Tags should not dominate a card or become the main visual texture.

### Empty States

Empty states should be useful and composed:

- Canvas Home: emphasize create blank canvas and templates.
- Prompt Library: show current filters and an obvious reset path.
- Assets: explain when no assets match filters and keep task queue status visible.

Empty states should use the same surface and action system as the rest of the UI.

## Mode-Level Design

### Discover

Goal: make the creative entry point feel premium but still task-first.

Changes:

- Reduce hero decoration and clarify composer hierarchy.
- Make the prompt composer the strongest element.
- Keep recent creations visible with consistent image card rhythm.
- Unify sticky composer with the main composer rather than making it feel like a second component.

### Generate

Goal: make repeated generation work easier to scan.

Changes:

- Clarify the current session rail and selected conversation.
- Make the generation timeline read like a work log, with compact task status, timing, prompt, result, and retry controls.
- Make the creator console feel attached to the current session.
- Keep parameters grouped and scannable.

### Canvas Home

Goal: make starting a canvas feel like entering a structured creative workspace.

Changes:

- Upgrade empty state and template cards with the global surface style.
- Make blank canvas and template starts visually distinct but harmonious.
- Keep canvas records, when present, easy to scan by title, updated time, and node summary.

### Prompt Library

Goal: make discovery and reuse feel precise, not noisy.

Changes:

- Use a clearer search and filter rhythm.
- Reduce tag visual weight.
- Make prompt cards more consistent in title, source, tags, preview, and actions.
- Keep result summary compact and useful.

### Assets

Goal: make the image library feel like a professional asset browser.

Changes:

- Strengthen filter tabs and task queue status.
- Improve image grid spacing and hover action clarity.
- Keep filenames readable without letting them dominate the visual.
- Use consistent empty and loading states.

### Developer, Notice, Settings

Goal: make utility pages belong to ColaAI without over-designing them.

Changes:

- Reuse the same page header, panel, table/list, and button styles.
- Keep content dense and functional.
- Avoid marketing-style hero sections in these work pages.

## Accessibility

Requirements:

- Maintain keyboard access for navigation, dialogs, menus, buttons, inputs, and cards.
- Visible focus rings must be consistent and high contrast.
- Button text contrast must pass WCAG AA.
- Placeholder text must remain readable.
- Icon-only buttons need accessible labels.
- Images keep existing alt behavior.
- Motion respects reduced-motion settings.

## Implementation Notes

The codebase already uses Next.js, Tailwind v4, lucide-react, and existing local UI primitives. This redesign should reuse those choices instead of adding a new design system package.

The implementation should prefer:

- Shared constants for visual tokens where practical.
- Small helper functions for repeated class groups only when they reduce duplication.
- Focused changes in existing ColaAI components.
- No broad state refactor.
- No route or navigation label changes.

Potential file areas:

- `web/src/app/globals.css`
- `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- `web/src/app/ColaAI/components/canvas-home.tsx`
- `web/src/app/ColaAI/components/canvas-home-state.ts`
- `web/src/app/ColaAI/components/canvas-workspace.tsx`
- `web/src/app/ColaAI/components/canvas-node.tsx`
- `web/src/app/ColaAI/components/canvas-generation-panel.tsx`
- `web/src/app/ColaAI/components/canvas-asset-library-panel.tsx`
- `web/src/app/ColaAI/components/canvas-image-history-panel.tsx`

## Testing And Verification

Minimum verification:

- Run relevant ColaAI component tests.
- Run TypeScript typecheck.
- Open `/ColaAI/` in the browser.
- Verify Discover, Generate, Canvas Home, Prompt Library, Assets, Developer, Notice, and Settings modes.
- Check desktop and mobile widths.
- Check focus states with keyboard navigation.
- Check reduced-motion mode where feasible.

Visual acceptance:

- One coherent light theme across all modes.
- Primary action style is consistent.
- Card and panel radius system is consistent.
- Accent color is restrained and purposeful.
- Main task in each mode is immediately visible.
- No text overlaps or clipped controls at common widths.

## Approved Direction

The user selected and approved direction A: Clear Professional Workbench.
