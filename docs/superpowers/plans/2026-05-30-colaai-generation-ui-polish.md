# ColaAI Generation UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ColaAI image-generation composer feel like a restrained creative instrument panel while preserving the existing minimal white-glass product language.

**Architecture:** Keep behavior inside the existing `GenerateComposer` component and avoid changing data flow. Update visual markup and Tailwind classes for the composer shell, reference slot, control chips, popovers, and submit controls, preserving all current props and handlers.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4 utilities, lucide-react icons already present in the project.

---

### Task 1: Update Composer Shell And Reference Slot

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Test: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Preserve current tests before editing**

Run: `cd web; npm run typecheck`

Expected: TypeScript reports the current baseline. If unrelated pre-existing errors appear, record them and continue only if they do not point at ColaAI generation composer edits.

- [ ] **Step 2: Rework `GenerateComposer` outer shell**

In `GenerateComposer`, keep the same props and state. Change only JSX classes and small static helper text. The shell should use `rounded-[24px]`, a white translucent background, a subtle teal-tinted top highlight, and no new dependencies.

- [ ] **Step 3: Rework the reference slot**

Keep the hidden file input and `onReferenceFileChange` behavior. Change the upload button into a 60px material slot with dashed border when empty, teal focus/hover cue, image thumbnail when populated, and a small remove button with unchanged `aria-label`.

- [ ] **Step 4: Keep textarea behavior**

Keep the `value`, `onChange`, `onKeyDown`, `placeholder`, and `aria-label`. Update visual classes only: larger breathing room, strong focus ring through parent shell, no text overlap on mobile.

### Task 2: Update Control Strip And Popovers

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`

- [ ] **Step 1: Update model chip**

Keep `data-cola-control="image-model"` and existing click behavior. Use a dark pill with teal icon glow and selected model label. Button text must stay one line.

- [ ] **Step 2: Update ratio/count chip**

Keep `data-cola-control="ratio-count"` and existing click behavior. Use a light studio chip, teal selected/open state, and the existing `Auto | 1张` summary.

- [ ] **Step 3: Update public toggle**

Keep `aria-pressed`, click behavior, and label. Use neutral off state and teal on state with a readable knob.

- [ ] **Step 4: Update submit button**

Keep disabled behavior and `onGenerate`. Use a dark-to-teal gradient with a restrained shimmer layer. Maintain white text contrast.

- [ ] **Step 5: Update model popover**

Keep option values and click behavior. Restyle as a compact studio panel with selected option using dark text/teal ring rather than multiple accent colors.

- [ ] **Step 6: Update ratio/count popover**

Keep current ratio and count options. Use a quieter segmented control, teal selected states, and consistent 18px inner radius.

### Task 3: Verify UI And Types

**Files:**
- Read: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`

- [ ] **Step 1: Run typecheck**

Run: `cd web; npm run typecheck`

Expected: PASS, or only unrelated pre-existing failures outside touched ColaAI files.

- [ ] **Step 2: Open and inspect desktop**

Open `http://localhost:3000/ColaAI/` in the in-app browser. Confirm the composer is visible, prompt input works visually, model/settings popovers open, and no desktop overlap appears.

- [ ] **Step 3: Inspect narrow mobile viewport**

Use a narrow viewport around 390px wide. Confirm the composer wraps without clipped text, the submit button remains readable, and controls do not overlap.

- [ ] **Step 4: Capture final screenshot**

Take a browser screenshot for the final response.
