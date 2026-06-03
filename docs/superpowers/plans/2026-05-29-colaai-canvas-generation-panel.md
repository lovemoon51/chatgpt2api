# ColaAI Canvas Generation Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the ColaAI canvas generation panel to match the approved compact creation layout while preserving the existing ColaAI theme and generation behavior.

**Architecture:** Keep the existing `CanvasGenerationPanel` API and submission flow, but rebuild the panel markup into a compact three-zone layout. Update render tests first so the structural change is protected before implementation.

**Tech Stack:** React, Next.js, Tailwind CSS, Jest static render tests

---

### Task 1: Lock the new panel contract in tests

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [ ] **Step 1: Write the failing test**

Add assertions for the new panel strings and remove the old header/button expectations.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test web/src/app/ColaAI/components/canvas-workspace.test.tsx`
Expected: FAIL because the old panel still renders `继续生成` and lacks the new structure.

- [ ] **Step 3: Write minimal implementation**

Rebuild the panel in `canvas-generation-panel.tsx` with mode tabs, stat chips, compact controls, and `开始生成`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test web/src/app/ColaAI/components/canvas-workspace.test.tsx`
Expected: PASS

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3000/ColaAI/`, inspect the canvas generation panel, and confirm the new layout matches the approved structure while retaining ColaAI’s theme.
