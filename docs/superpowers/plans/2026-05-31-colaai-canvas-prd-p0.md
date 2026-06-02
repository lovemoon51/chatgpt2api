# ColaAI Canvas PRD P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the P0 parts of the ColaAI图文画布优化 PRD: text prompt editing, image result derivative toolbar, upscale derivative nodes, and observable transition markers.

**Architecture:** Keep the existing canvas store and node renderer. Add a small derivative-node workflow to the store, pass the action through the surface/workspace, and render toolbar/prompt states in `CanvasNode` using data attributes that tests can lock.

**Tech Stack:** React/Next client components, Bun tests, existing canvas store helpers, Tailwind classes.

---

### Task 1: Lock P0 Behaviors With Tests

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.test.ts`

- [ ] Add tests for text prompt panel markers.
- [ ] Add tests for image derivative toolbar markers.
- [ ] Add tests for adding an upscale derivative node with an automatic connection.

### Task 2: Store Derivative Nodes

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-types.ts`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.ts`

- [ ] Add derivative metadata fields.
- [ ] Add `addImageDerivativeNode(state, sourceNodeId, derivativeType)`.
- [ ] Expose the action from `useCanvasStore`.

### Task 3: Node Rendering

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`

- [ ] Render selected/editing text nodes with a Liblib-like prompt panel.
- [ ] Render image result derivative toolbar on selected image/generation result nodes.
- [ ] Wire the upscale action button to the new callback.
- [ ] Add data attributes for creation/expand/toolbar/edge animation hooks.

### Task 4: Surface And Workspace Wiring

**Files:**
- Modify: `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-connections.tsx`

- [ ] Pass the derivative action through the canvas surface.
- [ ] Use the store action from the workspace.
- [ ] Add connection draw animation markers for derived edges.

### Task 5: Verify

**Files:**
- Test: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`
- Test: `web/src/app/ColaAI/components/use-canvas-store.test.ts`

- [ ] Run focused Bun tests.
- [ ] If tests pass, optionally verify the local browser UI.
