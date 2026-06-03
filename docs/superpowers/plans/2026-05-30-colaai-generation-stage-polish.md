# ColaAI Generation Stage Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the top session rail and result stage with the new creative composer, including a restrained generation-in-progress animation.

**Architecture:** Keep all behavior inside `cola-ai-workbench.tsx`; add small presentational helpers and CSS classes in `globals.css`. Do not alter task submission, polling, storage, or image rendering logic.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4 utilities, existing CSS keyframes.

---

### Task 1: Add Stage Polish Tests

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [x] Add a focused test that renders `GenerationStage` active and expects:
  - `data-cola-effect="image-developing-stage"`
  - `data-cola-panel="generation-developing-frame"`
  - phase labels remain present.

- [x] Add a focused test that renders `GenerateSessionRail` and expects:
  - `data-cola-design="creative-session-strip"`
  - `data-cola-state="active"` on the active rail.

### Task 2: Implement Visual Stage

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/globals.css`

- [x] Restyle `GenerateSessionRail` to match the teal-accent studio language.
- [x] Replace `GenerationStage`'s simple text status with a compact developing-stage component.
- [x] Restyle `GenerateConversationStage` record shell with subtle teal borders and quieter card hierarchy.
- [x] Add CSS classes and keyframes for image developing placeholders.

### Task 3: Verify

**Files:**
- Read: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Read: `web/src/app/globals.css`

- [x] Run the focused Bun tests.
- [x] Run `npm run typecheck` and record existing baseline failures if still present.
- [x] Verify in the in-app browser that `http://localhost:3000/ColaAI/` has the new rail/stage data markers.

Typecheck note: `npm run typecheck` is still blocked by pre-existing baseline issues in canvas tests, `infinite-canvas-surface.tsx`, and `image-params-bar.test.tsx`.
