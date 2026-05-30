# ColaAI Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent `/ColaAI` creative workbench route with a Rova-like image creation entrance.

**Architecture:** Add route-local ColaAI components, reuse shared UI/API modules, and keep `/studio` untouched. The first implementation focuses on a full-screen creative landing/workbench surface: glass side navigation, soft media background, central prompt composer, prompt market, image library, task queue, and recent creations.

**Tech Stack:** Next.js app router, React 19, Tailwind CSS, lucide-react, bun:test, existing chatgpt2api frontend APIs.

---

## File Structure

- Create `web/src/app/ColaAI/page.tsx`: auth-guarded route entry.
- Create `web/src/app/ColaAI/components/cola-ai-workbench.tsx`: main Rova-like workbench state, layout, composer, recent creations, queue, dialogs.
- Create `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`: server-rendered structure test.
- Modify `web/src/components/app-shell.tsx`: make `/ColaAI` full-screen like `/studio`.
- Modify `web/src/components/top-nav.tsx`: add ColaAI entry.

## Tasks

### Task 1: Red Test

- [ ] Create `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`.
- [ ] Assert static markup contains `ColaAI`, `data-cola-layout="rova-like"`, `data-cola-panel="side-nav"`, `data-cola-panel="hero"`, `data-cola-panel="composer"`, `data-cola-visual="soft-media-wall"`, `提示词市场`, `任务队列`, `图片库`, and `最近创作`.
- [ ] Run `bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx` from `web`.
- [ ] Expected: fail because `cola-ai-workbench.tsx` does not exist.

### Task 2: Green Implementation

- [ ] Create `web/src/app/ColaAI/components/cola-ai-workbench.tsx`.
- [ ] Implement exported `ColaAIWorkbench` and pure helper pieces needed by the test.
- [ ] Create `web/src/app/ColaAI/page.tsx` using `useAuthGuard`.
- [ ] Run the component test until it passes.

### Task 3: Shell And Navigation

- [ ] Update `web/src/components/app-shell.tsx` to treat `/ColaAI` and nested routes as full-screen workbench routes.
- [ ] Update `web/src/components/top-nav.tsx` to include `ColaAI` for admin and user nav items.
- [ ] Run `bun run typecheck` and `bun run lint` from `web`.

### Task 4: Browser Verification

- [ ] Start or reuse the local Next dev server.
- [ ] Open `/ColaAI` in the browser.
- [ ] Verify the page renders, desktop side navigation does not overlap the composer, mobile bottom navigation remains usable, and controls do not collide.
- [ ] Run `bun run build` from `web`.
