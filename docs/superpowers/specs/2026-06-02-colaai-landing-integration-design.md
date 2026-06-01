# ColaAI Landing Integration Design

## Goal

Integrate the existing external landing-page concept into ColaAI as the new `/ColaAI` opening experience, replace the old video-centered hero with the project's five most recent generated images, keep ColaAI's existing ambient background style, and transition downward into the current ColaAI discover page as the persistent main experience.

## Design Read

This work is not a full marketing-site migration. It is a focused integration that turns ColaAI discover mode into a two-stage experience:

1. A branded landing hero that borrows the old homepage's stage composition.
2. The existing ColaAI discover page, which remains the long-lived workspace after the hero handoff.

Chosen direction: **hero-first ColaAI discover integration**.

## Scope

In scope:

- Change `/ColaAI` discover mode so the user first sees a new landing hero.
- Rebuild the old homepage's hero composition in ColaAI-native React and Tailwind code.
- Replace all hero videos with the five most recent managed images already available to ColaAI.
- Reuse the existing ColaAI ambient background treatment instead of the old homepage's standalone visual system.
- Transition from the landing hero into the existing `DiscoverHome` content when the user scrolls down.
- Keep the discover page as the persistent post-hero browsing surface.
- Preserve desktop and mobile usability.

Out of scope:

- Migrating the old homepage's later long-form sections, testimonials, pricing, FAQ, footer, or menu system.
- Embedding the old static HTML or Webflow runtime.
- Replacing ColaAI discover mode state architecture.
- Changing ColaAI route structure beyond the visual behavior of `/ColaAI`.
- Reworking generate, canvas, prompt library, assets, developer, notice, or settings modes beyond whatever is needed to keep the discover integration coherent.

## Design Principles

### 1. ColaAI First, Old Hero Second

The old homepage contributes layout language, not a separate product identity. The result should read as ColaAI with a stronger opening, not as a foreign landing page dropped into the app.

### 2. One Scroll, One Handoff

The user should experience a single clear transition:

- enter ColaAI
- see the new landing hero
- scroll down
- land in the ColaAI discover workspace

After the handoff, the user remains in discover mode rather than continuing through a long marketing narrative.

### 3. Real Project Output Over Placeholder Media

The landing hero should showcase real recent project images, not static design assets or recreated sample content. The first screen should feel alive and connected to the user's current product usage.

### 4. Reuse Existing ColaAI Systems

Existing discover-mode background, image loading, composer, sticky composer, creation feed, refresh behavior, and public-preview fallbacks remain intact except for the minimal integration hooks required to place the landing hero above discover content.

## Experience Overview

`/ColaAI` discover mode becomes a stacked composition:

1. `RovaMediaBackground`
2. `LandingHero`
3. existing `DiscoverHome` content

The hero occupies the first viewport and introduces ColaAI with a stage similar to the old homepage:

- one prominent central image card
- four orbiting supporting image cards on desktop
- strong title and supporting copy
- primary call to action that points the user toward creating or exploring

The moment the user scrolls past the hero handoff threshold, the discover page takes over as the working surface. The discover content is not recreated. It is the same existing ColaAI discover implementation the project already uses today.

## Information Architecture

### Route Behavior

`/ColaAI` remains the same route and remains the main ColaAI entry point.

Inside `ColaAIWorkbench`, discover mode becomes:

- `LandingHero` first
- `DiscoverHome` second

Other modes remain unchanged.

### Discover Structure

The discover stack should become:

1. shared ColaAI background
2. fixed or pinned landing hero stage
3. handoff anchor
4. current discover hero/composer/feed section

The existing discover mode still owns:

- prompt composer
- reference image drop target
- recent creations feed
- pull-to-refresh
- sticky composer behavior

## Components And Responsibilities

### `ColaAIWorkbench`

Responsibility changes:

- continue owning mode switching, image loading, and discover data flow
- derive the five-image landing dataset from the already-loaded managed images
- render the new landing hero before `DiscoverHome` when `mode === "discover"`
- keep the existing `RovaMediaBackground` at the workbench shell level

Hero-specific rendering logic must live in a dedicated component rather than being expanded inline inside `ColaAIWorkbench`.

### `LandingHero`

New component responsibility:

- render the first-screen ColaAI landing stage
- consume five recent images plus public-preview fallback data
- expose the handoff anchor or scroll target
- animate only the hero layer
- stay visually compatible with the shared ColaAI background

This component remains presentation-focused and does not own network state.

### `DiscoverHome`

Responsibility stays mostly unchanged:

- render the existing discover hero composer
- render the recent creations feed
- handle pull-to-refresh
- show sticky composer based on the current discover hero visibility rules

Only minimal changes are allowed to support the landing handoff cleanly. The main discover implementation remains the same component and is not duplicated.

## Data Flow

### Primary Image Source

The landing hero should use the same managed image source already loaded for ColaAI discover mode:

- `fetchManagedImages({ page_size: 12 })`
- take the first five images after the existing sort order returned by the backend

This is the authoritative source for "the current project's latest generated images" in this feature.

### Preview Selection Rules

Use the same preview preference policy ColaAI already uses for managed images:

- prefer the original image URL when available
- fall back to thumbnail URL when needed

This keeps the landing hero visually consistent with the rest of ColaAI image presentation.

### Empty Or Public Preview State

If the user is in public preview or if no managed images exist:

- render a curated fallback landing dataset
- keep the same five-slot stage layout
- do not show broken cards or empty placeholders

The fallback should still look like ColaAI and should not resurrect the old external homepage media.

## Hero Layout

### Desktop

Desktop uses the old homepage's composition language, adapted to image cards:

- one large central card
- four smaller orbit cards around it
- title and supporting copy layered over or above the stage
- restrained action row

The cards should feel like floating generated works rather than video players:

- no play controls
- no video chrome
- desktop cards show lightweight filename-style metadata labels; mobile hides secondary metadata so the image stage stays readable

### Mobile

Mobile uses the same stage concept with reduced density:

- one main featured image card
- two or three supporting stacked cards
- headline and CTA remain clear above the fold

The feature still uses five images as its dataset, but mobile does not need to show all five at once if that harms readability.

## Background And Styling

The hero should continue using ColaAI's ambient background language:

- existing `RovaMediaBackground`
- ColaAI white haze and gradient fades
- existing panel glass treatment where appropriate

Do not import the old homepage's global styles, Webflow classes, jQuery, GSAP runtime, or video helpers.

Visual translation from the old homepage:

- keep the stage composition
- keep the sense of orbit and spotlight
- replace dark cinematic video language with light ColaAI image-studio language
- keep motion subtle and product-like

## Scroll And Handoff Behavior

### Default Behavior

The page starts at the landing hero.

As the user scrolls downward:

- the landing hero performs a light exit transition
- the stage content shifts or scales slightly
- the discover section approaches the viewport

At the handoff threshold, the page snaps to the discover section top so the user lands cleanly on the existing ColaAI discover hero.

### "Fixed At Discover" Interpretation

The approved interpretation of "拖到文字页即展示的是 ColaAI 的发现页面 然后固定在此" is:

- the landing hero is an opening act, not a long document
- once the user transitions into discover mode content, the discover page becomes the main browsing surface
- the old homepage's later sections are not part of the downward journey

The user can scroll upward to revisit the landing hero. Discover remains the stable post-handoff context because no additional landing sections continue below the handoff.

### Discover Sticky Behavior

The existing discover sticky composer should continue to be driven by the visibility of the discover hero itself, not by the new landing hero. This keeps current discover logic coherent after the handoff.

## Interaction Details

### Call To Action

The landing hero CTA scrolls directly to the discover composer. It does not switch route or mode.

### Image Interaction

Landing hero cards support lightweight hover motion only. They do not include discover-feed behaviors such as prompt reuse, copy prompt, or open detail modal.

Keep the hero focused on mood, proof, and transition rather than duplicating the feed.

## Accessibility

Requirements:

- the landing hero must remain readable over the shared background
- image cards need meaningful alt text or decorative treatment when appropriate
- any snap or handoff motion must respect reduced-motion preferences
- CTA controls require visible focus and keyboard access
- mobile layout must avoid clipped cards and obscured text behind fixed navigation

## Error Handling And Resilience

If managed image loading fails:

- keep current discover error tolerance
- render fallback landing images instead of blocking discover mode
- allow the existing discover content below to continue rendering

If fewer than five images exist:

- use as many recent real images as are available
- fill remaining slots with ColaAI-native fallback assets or repeated safe fallback cards if needed
- preserve the stage layout without broken gaps

## File Targets

Likely implementation areas:

- `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- new hero component under `web/src/app/ColaAI/components/`
- possibly `web/src/app/ColaAI/components/rova-media-background.tsx` only if minor background tuning is needed
- `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`
- `web/src/app/globals.css` if any shared motion or landing-only utility styles are needed

The implementation should avoid broad edits to unrelated ColaAI modes.

## Testing And Verification

Minimum verification:

- run relevant ColaAI workbench tests
- add or update tests that prove discover mode now includes the landing hero before `DiscoverHome`
- verify recent managed images are mapped into a five-item landing dataset
- verify fallback behavior for public preview or empty image state
- verify desktop and mobile layout in the browser
- verify reduced-motion compatibility where feasible

Visual acceptance:

- `/ColaAI` opens on a ColaAI-branded landing hero
- the hero shows image cards, not videos
- the hero uses ColaAI's ambient background style
- downward scroll cleanly enters the current ColaAI discover page
- discover mode remains the stable browsing context after the handoff

## Approved Direction

The user approved the hero-first ColaAI discover integration with these explicit decisions:

- integrate the old homepage concept into `/ColaAI`
- replace hero videos with the project's five most recent generated images
- keep ColaAI's background style to avoid visual mismatch
- transition downward into the existing ColaAI discover page and treat that as the persistent main surface
