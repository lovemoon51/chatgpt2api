# ColaAI Canvas Workflow Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add visible node linking and upstream input collection so ColaAI canvas generation behaves like a connected workflow.

**Architecture:** Keep persistent workflow state in the existing canvas store. Add a pure helper for upstream generation settings, extend nodes with lightweight input/output handles, and let `InfiniteCanvasSurface` coordinate drag-to-connect without persisting preview state.

**Tech Stack:** React, TypeScript, Next.js, Tailwind, `bun:test`.

---

### Task 1: Upstream Generation Settings

**Files:**
- Create: `web/src/app/ColaAI/components/canvas-workflow.ts`
- Create: `web/src/app/ColaAI/components/canvas-workflow.test.ts`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx`

- [ ] Write failing tests for collecting direct and transitive upstream text, image references, and config values.
- [ ] Implement `collectCanvasGenerationSettings`.
- [ ] Use the helper when opening or submitting generation from a selected node.

### Task 2: Visible Connector Handles

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-render-guards.ts`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [ ] Add failing render assertions for input/output handles.
- [ ] Render small left/right connector handles that do not start node dragging.
- [ ] Keep node memoization focused on node identity and selected state.

### Task 3: Drag-To-Connect

**Files:**
- Modify: `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-guides.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [ ] Add failing render assertion for connection preview layer.
- [ ] Add output-handle pointer drag state and preview line.
- [ ] On pointer up over another node input handle, call `addConnection`.

### Task 4: Verification

**Files:**
- Relevant ColaAI tests only.

- [ ] Run ColaAI component tests.
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run lint`.
- [ ] Browser-check connector handles and generation panel prefill.
