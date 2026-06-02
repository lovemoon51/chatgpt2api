# ColaAI Canvas PRD Full TODO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `docs/colaai-canvas-image-text-optimization-prd.md` into an executable development sequence for ColaAI canvas text/image nodes, derivative workflows, animation, assets, and history.

**Architecture:** Keep the existing ColaAI canvas store, node renderer, infinite surface, and workspace shell. Add behavior incrementally behind tests, with P0 stabilizing text/image node editing and image derivative workflows, P1 adding menus/assets/history, and P2 connecting deeper derivative capabilities. All UI must match the current ColaAI canvas theme, not directly copy Liblib visuals.

**Tech Stack:** Next.js client components, React 19, TypeScript, Zustand-like canvas store helpers, Tailwind v4 utilities, CSS keyframes, Bun tests.

---

## Non-Negotiable Development Rules

- [ ] Before editing UI, open `http://localhost:3000/ColaAI/` and observe the current canvas theme: light canvas, soft grid/texture, white or translucent cards, slate text, violet/cyan accents, rounded controls, subtle shadows.
- [x] Treat Liblib as interaction reference only. Do not copy its brand styling directly.
- [x] Keep video functionality out of scope. Existing video placeholders must stay disabled or visually de-emphasized.
- [x] Use TDD for store and render behavior: write or update focused tests before implementation.
- [x] Keep default canvas clean. High-density controls should appear only in selected/editing states.
- [x] Prefer small, reversible changes. Do not refactor unrelated ColaAI workbench code.
- [x] Do not change unrelated dirty files. Stage/commit only files touched for the task if committing.

## Current File Map

- `docs/colaai-canvas-image-text-optimization-prd.md`: source product requirements and visual constraints.
- `web/src/app/ColaAI/components/canvas-types.ts`: node metadata and derivative type definitions.
- `web/src/app/ColaAI/components/use-canvas-store.ts`: pure canvas state helpers and hook actions.
- `web/src/app/ColaAI/components/use-canvas-store.test.ts`: store behavior tests.
- `web/src/app/ColaAI/components/canvas-node.tsx`: visual rendering for text, image, config, generation, derivative nodes.
- `web/src/app/ColaAI/components/canvas-workspace.tsx`: top-level canvas workspace wiring and store action handoff.
- `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`: pointer interactions, node rendering loop, connection interactions.
- `web/src/app/ColaAI/components/canvas-connections.tsx`: edge rendering and draw animation hooks.
- `web/src/app/ColaAI/components/canvas-workspace.test.tsx`: static render coverage for components.
- `web/src/app/globals.css`: canvas animation keyframes and global motion/reduced-motion styles.

## Verification Commands

- Focused canvas tests:

```powershell
cd web
bun test src/app/ColaAI/components/canvas-workspace.test.tsx src/app/ColaAI/components/use-canvas-store.test.ts
```

- Typecheck, expected current caveat:

```powershell
cd web
bun run typecheck
```

Expected current caveat: this may fail on pre-existing test environment type issues around `bun:test beforeEach`, missing `@testing-library/react`, and Jest globals. Do not treat those as task failures unless the current task changes them.

- Browser smoke check:

```text
Open http://localhost:3000/ColaAI/
Enter canvas
Select text node
Select image result node
Click image derivative action if a result image exists
Confirm UI matches ColaAI theme
```

---

## Phase P0: Core Text/Image Canvas Workflow

Backfill verification note: P0 was partially implemented before this full TODO plan was created. The P0 items below were re-checked with `bun test src/app/ColaAI/components/canvas-workspace.test.tsx src/app/ColaAI/components/use-canvas-store.test.ts` on 2026-05-31, with `73 pass / 0 fail`.

### Task 1: Lock Current Theme Constraint In Tests

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`

- [x] Add static render assertions that text/image editing UI exposes ColaAI-specific markers:

```tsx
expect(markup).toContain('data-cola-node-surface="studio-card"');
expect(markup).toContain('data-cola-text-layout="liblib-inspired"');
expect(markup).toContain('data-cola-motion="prompt-panel-expand"');
```

- [x] Add a render assertion that image prompt UI has ColaAI-themed controls, not generic copied labels only:

```tsx
expect(markup).toContain('data-cola-image-layout="liblib-inspired"');
expect(markup).toContain('data-cola-image-parameter-bar="true"');
expect(markup).toContain('data-cola-image-control="style"');
expect(markup).toContain('data-cola-image-control="settings"');
```

- [x] Run focused tests and confirm expected failures before implementing missing markers.

```powershell
cd web
bun test src/app/ColaAI/components/canvas-workspace.test.tsx
```

- [x] Implement or adjust markers in `canvas-node.tsx`.
- [x] Re-run focused tests and confirm pass.

### Task 2: Text Node Browsing And Editing States

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`
- Optional Modify: `web/src/app/globals.css`

- [x] Add or confirm a test for selected text nodes rendering:

```tsx
expect(markup).toContain('data-cola-text-preview-card="true"');
expect(markup).toContain('data-cola-text-prompt-panel="true"');
expect(markup).toContain("自己编写内容");
expect(markup).toContain("文生图片");
expect(markup).toContain("图片反推提示词");
expect(markup).toContain("GVLM 3.1");
expect(markup).toContain('data-cola-action="inline-text-start-generation"');
```

- [x] Ensure selected text nodes expand into a preview card plus prompt panel.
- [x] Ensure empty prompt disables the generation action.
- [x] Ensure non-selected text nodes stay compact and do not render high-density controls.
- [x] Keep colors, radius, and shadows compatible with current ColaAI canvas.
- [x] Run focused tests.

### Task 3: Image Node Editing State

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Add or confirm a test that promptable image nodes render:

```tsx
expect(markup).toContain('data-cola-node-layout="text-to-image-card"');
expect(markup).toContain('data-cola-image-preview="true"');
expect(markup).toContain('data-cola-image-prompt-panel="true"');
expect(markup).toContain("图生图");
expect(markup).toContain("图片高清");
expect(markup).toContain("描述你想要生成的画面内容");
expect(markup).toContain("16:9 · 2K");
expect(markup).toContain("摄像机");
```

- [x] Render image preview/upload area above prompt panel.
- [x] Render style, marker, and focus chips.
- [x] Render bottom parameter bar with model, size/quality, camera preset, count, cost, translate/settings buttons, and generate button.
- [x] Do not show full prompt panel for normal uploaded image result nodes unless they are in an explicit editing mode.
- [x] Run focused component tests.

### Task 4: Image Result Derivative Toolbar

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Add or confirm a render test for selected image result nodes:

```tsx
expect(markup).toContain('data-cola-image-derivative-toolbar="true"');
expect(markup).toContain('data-cola-action="image-derivative-panorama"');
expect(markup).toContain('data-cola-action="image-derivative-multi-angle"');
expect(markup).toContain('data-cola-action="image-derivative-lighting"');
expect(markup).toContain('data-cola-action="image-derivative-grid"');
expect(markup).toContain('data-cola-action="image-derivative-upscale"');
expect(markup).toContain('data-cola-action="image-derivative-split-grid"');
```

- [x] Render toolbar only when selected node is an image/generation result with `metadata.imageUrl`.
- [x] Hide toolbar for promptable image editing nodes and derivative nodes.
- [x] Keep toolbar aligned above the node and avoid covering the image center.
- [x] Wire each toolbar button to `onAddImageDerivative(node.id, derivativeType)`.
- [x] Run component tests.

### Task 5: Store Support For Derivative Nodes

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-types.ts`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.test.ts`

- [x] Define derivative types:

```ts
export type CanvasImageDerivativeType =
  | "upscale"
  | "grid"
  | "multiAngle"
  | "lighting"
  | "panorama"
  | "splitGrid";
```

- [x] Extend node metadata with:

```ts
imageMode?: "reference" | "generation" | "derivative";
sourceNodeId?: string;
derivativeType?: CanvasImageDerivativeType;
derivativeModel?: string;
upscaleFactor?: number;
```

- [x] Add store test:

```ts
const derived = addImageDerivativeNode(state, "seed-image", "upscale");
const derivativeNode = derived.nodes.at(-1)!;
expect(derivativeNode.title).toBe("高清");
expect(derivativeNode.metadata?.imageMode).toBe("derivative");
expect(derivativeNode.metadata?.sourceNodeId).toBe("seed-image");
expect(derivativeNode.metadata?.derivativeType).toBe("upscale");
expect(derivativeNode.metadata?.derivativeModel).toBe("Topazlabs");
expect(derivativeNode.metadata?.upscaleFactor).toBe(2);
expect(derived.connections.some((connection) => connection.fromNodeId === "seed-image" && connection.toNodeId === derivativeNode.id)).toBe(true);
```

- [x] Implement `addImageDerivativeNode(state, sourceNodeId, derivativeType)`.
- [x] Ensure missing source node returns the original state object.
- [x] Ensure the new derivative node is selected after creation.
- [x] Run store tests.

### Task 6: Workspace And Surface Wiring

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx`
- Modify: `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`

- [x] Add `onAddImageDerivative` prop to `InfiniteCanvasSurface`.
- [x] Pass store action from `CanvasWorkspace` into `InfiniteCanvasSurface`.
- [x] Pass `onAddImageDerivative` from `InfiniteCanvasSurface` into each `CanvasNode`.
- [x] Confirm no callback is required for nodes that cannot show derivative toolbar.
- [x] Run focused tests.

### Task 7: P0 Motion Layer

**Files:**
- Modify: `web/src/app/globals.css`
- Modify: `web/src/app/ColaAI/components/canvas-connections.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Add data motion hooks:

```tsx
data-cola-motion="prompt-panel-expand"
data-cola-motion="derivative-toolbar-enter"
data-cola-motion="derived-node-enter"
data-cola-motion="edge-draw"
```

- [x] Implement CSS animations:

```css
[data-cola-image-derivative-toolbar="true"] {
  animation: cola-canvas-toolbar-reveal 260ms cubic-bezier(0.18, 0.82, 0.24, 1) both;
}

path[data-cola-motion="edge-draw"] {
  animation: cola-canvas-edge-draw 460ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
```

- [x] Add `@media (prefers-reduced-motion: reduce)` fallback disabling these animations.
- [x] Avoid animating outer node `transform` because canvas positioning uses inline `translate(...)`.
- [x] Run tests and browser smoke check.

---

## Phase P1: Menus, Parameters, Assets, And History

### Task 8: Text Model Selector Menu

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Add test for text model menu closed state:

```tsx
expect(markup).toContain("GVLM 3.1");
expect(markup).not.toContain('data-cola-panel="text-model-options"');
```

- [x] Add client state for opening model selector inside text editing panel.
- [x] Render options: GVLM 3.1, CVLM 5.5, GVLM 3.1 Flash, Qwen 3 VL Flash.
- [x] Each option must show name, estimated time, and short description.
- [x] Selecting an option updates node metadata through `onContentChange` only if no metadata patch action exists; otherwise add a focused metadata patch action in store.
- [x] Keep popup visual language aligned with ColaAI config menus.

### Task 9: Image Parameter Menus

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-types.ts`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.test.ts`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Add metadata patch support for image promptable nodes:

```ts
export type CanvasImageConfigPatch = Partial<Pick<
  NonNullable<CanvasNodeData["metadata"]>,
  "model" | "size" | "quality" | "cameraPreset" | "count" | "cost" | "webSearch"
>>;
```

- [x] Add store helper `updateImageConfigNode(state, nodeId, patch)`.
- [x] Add tests that changing count updates count and cost.
- [x] Render model, size/quality, camera, and count popovers.
- [x] Add outside-click or selection-change close behavior if existing config popover pattern supports it.
- [x] Run focused tests.

### Task 10: Prompt Helper Chips

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Add tests for style, marker, and focus chip selected state.
- [x] Render chip popovers with concrete options:

```text
风格: 写实摄影, 产品海报, 电影感, 3D 渲染
标记: 人物, 场景, 物品, 品牌视觉
聚焦: 主体居中, 近景, 广角, 俯视
```

- [x] Selecting a chip updates visible chip label.
- [x] Do not implement complex prompt concatenation yet; store selected metadata only.
- [x] Keep menus small and aligned to the selected chip.

### Task 11: Image History Panel

**Files:**
- Create: `web/src/app/ColaAI/components/canvas-image-history-panel.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Create panel component with data marker:

```tsx
<aside data-cola-panel="image-history" />
```

- [x] Render tabs for 图片历史 only in P1; video/audio labels may be hidden or disabled.
- [x] Render empty state:

```text
暂无图片历史
生成或上传图片后，可以在这里快速引用到画布。
```

- [x] Add action buttons for each image item: 创建图片节点, 作为参考图, 高清.
- [x] Wire opening from left toolbar or workspace action.
- [x] If real history data is unavailable, use existing generated nodes with image URLs as panel source.

### Task 12: Asset Library Panel

**Files:**
- Create: `web/src/app/ColaAI/components/canvas-asset-library-panel.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Create panel component with data marker:

```tsx
<aside data-cola-panel="asset-library" />
```

- [x] Render categories: 全部, 人物, 场景, 物品, 风格, 项目空间.
- [x] Render empty state:

```text
还没有素材
上传参考图或保存生成结果后，可以在 prompt 中用 @ 引用。
```

- [x] Render disabled 音效/video-related entries only if needed for consistency, but do not promote them.
- [x] Keep panel aligned to current ColaAI side-panel visual style.

### Task 13: @ Asset Reference UI

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Add test for prompt placeholder containing `@引用素材`.
- [x] On typing `@`, show a compact asset suggestion menu if assets exist.
- [x] If no assets exist, show:

```text
暂无可引用素材
先上传或保存一张图片到素材库。
```

- [x] Insert selected asset as a visible token in prompt metadata or append `@素材名` text if token rendering is not available.
- [x] Do not block normal typing when the menu is closed.

---

## Phase P2: Expanded Derivatives And Real Capability Hooks

### Task 14: Grid And Multi-Angle Derivative Nodes

**Files:**
- Modify: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.test.ts`
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Add tests for `grid` and `multiAngle` derivative creation.
- [x] Ensure titles are `九宫格` and `多角度`.
- [x] Render derivative-specific configuration text.
- [x] Keep output nodes connected to source image.
- [x] Do not call real backend until API contract exists.

### Task 15: Lighting, Panorama, Split Grid Derivatives

**Files:**
- Modify: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.test.ts`
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`

- [x] Add store tests for `lighting`, `panorama`, and `splitGrid`.
- [x] Use titles `打光`, `全景`, `宫格切分`.
- [x] Render clear coming-soon state if real backend is unavailable:

```text
该能力即将支持，当前先保留工作流节点。
```

- [x] Keep the toolbar button active only if the node can be created.
- [x] Add disabled or beta state only if product wants to prevent creation.

### Task 16: Smooth Pan To Derived Node

**Files:**
- Modify: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Modify: `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx`

- [x] Add a selected-node follow behavior after derivative creation.
- [x] Compute viewport target so new node is visible without hiding source node.
- [x] Use existing viewport update mechanism.
- [x] Respect user zoom level unless new node is outside visible bounds.
- [x] Do not animate viewport if user has reduced motion enabled.

### Task 17: Generation And Derivative Loading States

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/globals.css`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [x] Add tests for generating image node showing loader markers:

```tsx
expect(markup).toContain('data-cola-generation-state="loading"');
```

- [x] Reuse existing loader classes where possible.
- [x] Add derivative loading state for mock backend:

```text
正在准备高清参数
```

- [x] Ensure error state has retry action if a backend task fails.

---

## Final QA Checklist For Codex

- [ ] Re-read `docs/colaai-canvas-image-text-optimization-prd.md` section 3.1 before each UI task.
- [x] Run focused Bun tests after each task.
- [x] Run `git diff --check` for touched files.
- [ ] Browser-check `http://localhost:3000/ColaAI/` after visual tasks.
- [ ] Verify text node: compact -> selected editor -> compact.
- [ ] Verify image node: upload/reference -> selected result toolbar.
- [ ] Verify image derivative: click 高清 -> derived node appears -> edge appears.
- [x] Verify no video feature is promoted.
- [x] Verify reduced-motion fallback for new animations.
- [ ] If committing, commit by phase or task:

```powershell
git add web/src/app/ColaAI/components docs/colaai-canvas-image-text-optimization-prd.md docs/superpowers/plans/2026-05-31-colaai-canvas-prd-full-todo.md
git commit -m "feat: implement colaai canvas image text workflow"
```

Do not stage unrelated screenshots, `.tmp`, `.claude`, `.playwright-mcp`, or unrelated modified files.

## Suggested Execution Order

1. Finish or verify P0 tasks 1-7.
2. Ship P1 task 8 and task 9 together only if they share metadata patching; otherwise split them.
3. Ship P1 task 10 after image parameter patching is stable.
4. Ship P1 task 11 and task 12 as separate panel PRs.
5. Ship P1 task 13 only after asset panel data shape is stable.
6. Ship P2 derivative tasks one capability at a time.

## Plan Self-Review

- Spec coverage: P0 covers text/image node editing, derivative toolbar, upscale node, auto edge, and core animation. P1 covers model menus, parameter menus, chips, image history, asset library, and @ references. P2 covers expanded derivatives, smooth pan, and loading/error states.
- Theme constraint coverage: section 3.1 is reflected in non-negotiable rules, Task 1, and final QA.
- Known gap: real backend calls for derivative models are intentionally deferred because PRD allows UI/state/workflow skeleton before full model integration.
