# ColaAI Workbench Design

## Goal

Add an independent `/ColaAI` route that presents a Rova-like creative image workbench named ColaAI. The first screen should feel like a focused creation entrance: a soft media background, glass side navigation, a large imagination-focused headline, a prominent prompt composer, and a recent creations stream.

## Scope

- Keep existing `/studio` behavior intact.
- Add a standalone ColaAI route with its own components.
- Support image creation intent from the main composer.
- Surface prompt market, task queue, image library, model selection, image ratio, image count, upload/reference image entry, and public/private toggle.
- Reuse existing API helpers and shared UI components where possible.

## Layout

ColaAI uses a full-screen app surface. Desktop mirrors the Rova first-screen structure:

- Glass left rail: ColaAI brand, Discover/Create/Prompts/Assets, and compact utility entries.
- Center hero: soft media-wall background, large `用想象力 创造世界` headline, short GPT-IMAGE-2 description, and white rounded prompt composer.
- Below hero: `今日已生成 4,200+ 张图片` social proof and a recent creations grid.

Mobile hides the desktop side rail and uses a fixed bottom navigation for Discover/Create/Prompts/Assets. The composer wraps controls without overlapping content.

## Behavior

- Empty generation fills a sample ColaAI prompt so the user has a useful starting point.
- Prompt market apply fills prompt/model/ratio/count.
- Image library opens in a dialog and can preview/download/copy images using existing helpers.
- Task queue opens as a lightweight dialog from the API/queue entry or generation action.

## Implementation Notes

- Do not import or mutate `StudioPageContent`; it is too coupled.
- Reuse `PromptMarketModal`, `AuthenticatedImage`, and image API helpers.
- Keep ColaAI-specific types and helpers in `web/src/app/ColaAI/components/`.
- Update `AppShell` so `/ColaAI` receives the same full-screen shell treatment as `/studio`.
- Add top navigation entry for ColaAI without removing the existing studio entry.

## Verification

- Component test confirms the workbench renders the brand, Rova-like layout markers, side nav, hero, composer, soft media wall, prompt controls, prompt market entry, task queue entry, image library entry, and recent creations.
- Frontend typecheck, lint, and build should pass.
- Browser verification should open `/ColaAI` and confirm the page is not blank, responsive, and has no obvious overlap.
