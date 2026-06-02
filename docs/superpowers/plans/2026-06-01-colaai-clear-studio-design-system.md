# ColaAI Clear Studio Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Clear Professional Workbench design system across the existing ColaAI UI without changing routes, navigation labels, or core state flows.

**Architecture:** Add a small shared style-token module for ColaAI surface/button/input classes, then migrate high-impact workbench areas to those tokens in focused passes. Keep the large existing `cola-ai-workbench.tsx` structure intact for this pass, but remove obvious visual drift such as warm page background, serif logo styling, animated prompt-library decoration, gradient primary buttons, and inconsistent panel surfaces.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, Bun tests, existing `lucide-react` icons, existing `cn()` utility.

---

## File Structure

- Create: `web/src/app/ColaAI/components/cola-ai-style.ts`
  - Shared ColaAI design-system class constants and helpers.
- Create: `web/src/app/ColaAI/components/cola-ai-style.test.ts`
  - Unit tests for class helpers and palette constraints.
- Modify: `web/src/app/globals.css`
  - Replace the warm global page background with the approved cool clear workbench background.
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
  - Use shared tokens for shell, navigation, brand, composer, popovers, creation cards, prompt library, assets, developer, notice, settings, dialogs, and mobile sheet.
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`
  - Add static-render assertions that important modes expose clear-studio markers and no longer use the retired visual treatments.
- Modify: `web/src/app/ColaAI/components/canvas-home.tsx`
  - Align canvas home with the same panel, button, card, and empty-state system.
- Modify: `web/src/app/ColaAI/components/canvas-home.test.tsx`
  - Add assertions for clear-studio markers and consistent action styling.

Do not stage unrelated dirty files. Existing uncommitted files in this workspace should be preserved.

---

### Task 1: Add Shared Clear Studio Style Tokens

**Files:**
- Create: `web/src/app/ColaAI/components/cola-ai-style.ts`
- Create: `web/src/app/ColaAI/components/cola-ai-style.test.ts`

- [ ] **Step 1: Write the style-token tests**

Create `web/src/app/ColaAI/components/cola-ai-style.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  colaButtonClass,
  colaCardClass,
  colaFocusClass,
  colaInputShellClass,
  colaPanelClass,
  colaShellClass,
  colaSurfaceClass,
} from "./cola-ai-style";

describe("cola-ai-style", () => {
  test("defines the clear studio shell without warm beige defaults", () => {
    expect(colaShellClass).toContain("from-slate-50");
    expect(colaShellClass).toContain("via-cyan-50/35");
    expect(colaShellClass).toContain("to-emerald-50/25");
    expect(colaShellClass).not.toContain("245, 239, 231");
    expect(colaShellClass).not.toContain("beige");
  });

  test("uses a consistent panel and card surface language", () => {
    expect(colaPanelClass).toContain("border-slate-200/80");
    expect(colaPanelClass).toContain("bg-white/84");
    expect(colaPanelClass).toContain("backdrop-blur-xl");
    expect(colaCardClass).toContain("rounded-[20px]");
    expect(colaCardClass).toContain("ring-1");
  });

  test("keeps primary buttons high contrast and non-gradient", () => {
    const primary = colaButtonClass("primary");
    expect(primary).toContain("bg-slate-950");
    expect(primary).toContain("text-white");
    expect(primary).not.toContain("gradient");
  });

  test("defines secondary, ghost, and danger button roles", () => {
    expect(colaButtonClass("secondary")).toContain("bg-white/82");
    expect(colaButtonClass("ghost")).toContain("bg-transparent");
    expect(colaButtonClass("danger")).toContain("text-rose-700");
  });

  test("shares focus and input shell rules", () => {
    expect(colaFocusClass).toContain("focus-visible:ring-2");
    expect(colaFocusClass).toContain("focus-visible:ring-cyan-400/70");
    expect(colaInputShellClass).toContain("border-slate-200/80");
    expect(colaInputShellClass).toContain("bg-white/86");
  });

  test("surface helper returns known variants", () => {
    expect(colaSurfaceClass("raised")).toContain("shadow-[0_24px_70px_-54px_rgba(15,23,42,0.48)]");
    expect(colaSurfaceClass("flat")).toContain("bg-slate-50/80");
    expect(colaSurfaceClass("overlay")).toContain("bg-white/96");
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-style.test.ts
```

Expected: FAIL because `cola-ai-style.ts` does not exist.

- [ ] **Step 3: Implement the shared style-token module**

Create `web/src/app/ColaAI/components/cola-ai-style.ts`:

```ts
import { cn } from "@/lib/utils";

export const colaFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

export const colaShellClass =
  "min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.96),rgba(240,249,255,0.92)_36%,rgba(236,253,245,0.9)_72%,rgba(248,250,252,0.98)_100%)] from-slate-50 via-cyan-50/35 to-emerald-50/25 text-slate-950";

export const colaPanelClass =
  "rounded-[24px] border border-slate-200/80 bg-white/84 shadow-[0_24px_70px_-54px_rgba(15,23,42,0.48)] ring-1 ring-white/80 backdrop-blur-xl";

export const colaCardClass =
  "rounded-[20px] border border-slate-200/80 bg-white/82 shadow-[0_18px_54px_-44px_rgba(15,23,42,0.42)] ring-1 ring-white/70 transition duration-200 hover:-translate-y-0.5 hover:bg-white/92 hover:shadow-[0_24px_70px_-52px_rgba(15,23,42,0.54)] active:translate-y-0";

export const colaInputShellClass =
  "rounded-[20px] border border-slate-200/80 bg-white/86 shadow-[0_18px_54px_-46px_rgba(15,23,42,0.38)] ring-1 ring-white/80 backdrop-blur-xl";

export const colaMutedPanelClass =
  "rounded-[18px] border border-slate-200/70 bg-slate-50/80 ring-1 ring-white/70";

type ColaButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function colaButtonClass(variant: ColaButtonVariant = "secondary", className?: string) {
  const base =
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold transition duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0";

  const variants: Record<ColaButtonVariant, string> = {
    primary:
      "rounded-full bg-slate-950 px-4 py-2.5 text-sm text-white shadow-[0_18px_42px_-30px_rgba(15,23,42,0.9)] hover:-translate-y-0.5 hover:bg-slate-800",
    secondary:
      "rounded-full border border-slate-200/80 bg-white/82 px-4 py-2.5 text-sm text-slate-700 shadow-[0_12px_32px_-28px_rgba(15,23,42,0.48)] hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-white hover:text-slate-950",
    ghost:
      "rounded-full bg-transparent px-3 py-2 text-sm text-slate-500 hover:bg-slate-100/80 hover:text-slate-950",
    danger:
      "rounded-full border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 hover:-translate-y-0.5 hover:bg-rose-100",
  };

  return cn(base, colaFocusClass, variants[variant], className);
}

export function colaSurfaceClass(variant: "raised" | "flat" | "overlay" = "raised", className?: string) {
  const variants = {
    raised: colaPanelClass,
    flat: colaMutedPanelClass,
    overlay:
      "rounded-[22px] border border-slate-200/80 bg-white/96 shadow-[0_24px_64px_-42px_rgba(15,23,42,0.54)] ring-1 ring-white/80 backdrop-blur-xl",
  };

  return cn(variants[variant], className);
}
```

- [ ] **Step 4: Run the style-token test and verify it passes**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-style.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/ColaAI/components/cola-ai-style.ts web/src/app/ColaAI/components/cola-ai-style.test.ts
git commit -m "feat(colaai): add clear studio style tokens"
```

---

### Task 2: Apply Global Shell, Brand, And Navigation Language

**Files:**
- Modify: `web/src/app/globals.css`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Add failing tests for shell and brand updates**

Append to the `describe("ColaAIWorkbench", () => { ... })` block in `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`:

```tsx
  test("renders the clear studio shell marker and keeps the brand sans-serif", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={publicSession} />);

    expect(markup).toContain('data-cola-design="clear-studio"');
    expect(markup).toContain('data-cola-panel="side-nav"');
    expect(markup).toContain('data-cola-brand="clear-studio"');
    expect(markup).not.toContain("font-serif");
    expect(markup).not.toContain("italic tracking-normal");
  });
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "clear studio shell marker"
```

Expected: FAIL because `data-cola-design="clear-studio"` and `data-cola-brand="clear-studio"` are not present yet, and the brand still contains `font-serif`.

- [ ] **Step 3: Import shared tokens in the workbench**

In `web/src/app/ColaAI/components/cola-ai-workbench.tsx`, add:

```ts
import {
  colaButtonClass,
  colaCardClass,
  colaFocusClass,
  colaInputShellClass,
  colaMutedPanelClass,
  colaPanelClass,
  colaShellClass,
  colaSurfaceClass,
} from "./cola-ai-style";
```

- [ ] **Step 4: Replace the global body background**

In `web/src/app/globals.css`, replace the `html, body` background rule:

```css
  html,
  body {
    background:
      radial-gradient(circle at top left, rgba(255, 255, 255, 0.96), rgba(240, 249, 255, 0.92) 36%, rgba(236, 253, 245, 0.9) 72%, rgba(248, 250, 252, 0.98) 100%);
    overscroll-behavior: none;
  }
```

- [ ] **Step 5: Update `BrandLogo`**

Replace the root `className` in `BrandLogo` with:

```tsx
className={cn("relative text-center font-sans font-semibold tracking-[-0.04em] text-slate-950", className)}
data-cola-brand="clear-studio"
```

Replace the visible inner brand text with:

```tsx
Cola<span className="text-[0.78em] text-cyan-600">AI</span>
```

Replace the stroked duplicate span class with:

```tsx
className="absolute inset-x-0 top-1 text-transparent [-webkit-text-stroke:1px_rgba(15,23,42,0.14)]"
```

- [ ] **Step 6: Update the ColaAI root wrapper**

In `ColaAIWorkbench`, update the outermost returned wrapper so it includes:

```tsx
data-cola-design="clear-studio"
className={cn("relative isolate overflow-hidden", colaShellClass)}
```

Keep existing data attributes such as `data-cola-layout`, `data-cola-drop-scope`, `data-cola-performance`, and `data-cola-mode`.

- [ ] **Step 7: Update side and mobile navigation surfaces**

For `data-cola-panel="side-nav"`, replace the main nav shell class with:

```tsx
className="fixed left-4 top-1/2 z-40 hidden w-[72px] -translate-y-1/2 rounded-[24px] border border-slate-200/80 bg-white/78 p-2 shadow-[0_24px_70px_-54px_rgba(15,23,42,0.54)] ring-1 ring-white/80 backdrop-blur-xl md:block"
```

For active nav buttons, use:

```tsx
"bg-slate-950 text-white shadow-[0_14px_34px_-24px_rgba(15,23,42,0.88)]"
```

For inactive nav buttons, use:

```tsx
"text-slate-500 hover:bg-slate-100/80 hover:text-slate-950"
```

For `data-cola-panel="mobile-nav"`, replace the surface class with:

```tsx
className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-40 rounded-[22px] border border-slate-200/80 bg-white/86 p-2 shadow-[0_22px_64px_-42px_rgba(15,23,42,0.56)] ring-1 ring-white/80 backdrop-blur-xl md:hidden"
```

- [ ] **Step 8: Run the targeted test**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "clear studio shell marker"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/app/globals.css web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/ColaAI/components/cola-ai-workbench.test.tsx
git commit -m "feat(colaai): apply clear studio shell and navigation"
```

---

### Task 3: Unify Composer, Popover, And Primary Button Styling

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Add failing composer assertions**

Append to `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`:

```tsx
  test("renders the generate composer with clear studio input and primary button styling", () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <GenerateComposer
        prompt=""
        count={1}
        quality="智能"
        ratio="1:1"
        imageModel="auto"
        publicMode={false}
        referenceImage={null}
        onPromptChange={noop}
        onCountChange={noop}
        onQualityChange={noop}
        onRatioChange={noop}
        onImageModelChange={noop}
        onPublicChange={noop}
        onReferenceFileChange={noop}
        onReferenceRemove={noop}
        onOpenPrompts={noop}
        onGenerate={noop}
      />,
    );

    expect(markup).toContain('data-cola-design="clear-studio-composer"');
    expect(markup).toContain("bg-white/86");
    expect(markup).toContain("bg-slate-950");
    expect(markup).not.toContain("bg-[linear-gradient(135deg,#111418_0%,#0f766e_100%)]");
  });
```

- [ ] **Step 2: Run the composer test and verify it fails**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "clear studio input and primary button"
```

Expected: FAIL because the composer does not have the clear-studio marker and still uses gradient primary styling.

- [ ] **Step 3: Update `RovaComposer` surface and controls**

In `RovaComposer`, add `data-cola-design="clear-studio-composer"` to the root `section`.

Replace the root composer class with:

```tsx
className={cn(
  "relative mx-auto w-full max-w-[820px] overflow-visible text-left",
  colaInputShellClass,
  sticky ? "shadow-[0_18px_54px_-42px_rgba(15,23,42,0.52)]" : "shadow-[0_28px_82px_-58px_rgba(15,23,42,0.54)]",
  className,
)}
```

Replace the reference upload button class with:

```tsx
className={cn(
  "mt-0.5 grid size-11 shrink-0 place-items-center rounded-[14px] border border-dashed border-slate-300 bg-slate-50 text-slate-400 transition hover:border-cyan-300 hover:bg-white hover:text-cyan-700",
  colaFocusClass,
)}
```

Replace the Prompt Market button class with:

```tsx
className={colaButtonClass("secondary", "h-8 px-3 text-xs")}
```

Replace the Generate submit button class with:

```tsx
className={colaButtonClass("primary", "h-[38px] px-5 text-[13px]")}
```

Remove the decorative sweep span inside the Generate submit button.

- [ ] **Step 4: Update `GenerateComposer` surface and controls**

In `GenerateComposer`, add `data-cola-design="clear-studio-composer"` to the root `section`.

Replace the root composer class with:

```tsx
className={cn("relative mx-auto w-full max-w-[1164px] overflow-visible text-left", colaInputShellClass)}
```

Replace the prompt textarea wrapper with:

```tsx
className="relative min-w-0 flex-1 rounded-[20px] bg-white/40"
```

Replace the textarea class with:

```tsx
className="min-h-[92px] w-full resize-none border-0 bg-transparent text-[17px] leading-7 text-slate-950 outline-none placeholder:text-slate-400 max-[560px]:min-h-[104px] max-[560px]:text-base max-[560px]:leading-7"
```

Replace the upload/material button class with the same reference upload class from Step 3.

Replace the prompt-market action button with:

```tsx
className={colaButtonClass("secondary", "h-10 px-3.5 text-xs")}
```

Replace the Generate button class with:

```tsx
className={colaButtonClass("primary", "h-[46px] px-7 text-sm")}
```

Remove the decorative sweep span inside the Generate button.

- [ ] **Step 5: Update model and ratio/count popovers**

For every `data-cola-panel="image-model-settings"` and `data-cola-panel="studio-generation-settings"` popover, replace its root class with:

```tsx
className={colaSurfaceClass("overlay", "absolute bottom-[84px] z-50 max-h-[min(440px,70dvh)] w-[min(392px,calc(100vw-32px))] overflow-y-auto p-4 text-left max-[560px]:left-1/2 max-[560px]:-translate-x-1/2")}
```

Keep each existing `left-*` position by adding it after the shared class:

```tsx
className={colaSurfaceClass("overlay", "absolute bottom-[84px] left-6 z-50 max-h-[min(440px,70dvh)] w-[min(392px,calc(100vw-32px))] overflow-y-auto p-4 text-left max-[560px]:left-1/2 max-[560px]:-translate-x-1/2")}
```

For selected segmented options use:

```tsx
"bg-slate-950 text-white shadow-sm"
```

For unselected segmented options use:

```tsx
"text-slate-500 hover:bg-white hover:text-slate-950"
```

- [ ] **Step 6: Run composer tests**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "composer"
```

Expected: PASS for existing composer tests and the new clear-studio composer test.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/ColaAI/components/cola-ai-workbench.test.tsx
git commit -m "feat(colaai): unify composer controls"
```

---

### Task 4: Align Discover Feed, Prompt Library, And Assets

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Add failing mode-level visual assertions**

Append to `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`:

```tsx
  test("renders prompt library in clear studio style without meteor decoration", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="prompts" />);

    expect(markup).toContain('data-cola-design="clear-studio-prompt-library"');
    expect(markup).toContain('data-cola-panel="prompt-library"');
    expect(markup).not.toContain("prompt-meteor-field");
    expect(markup).not.toContain("animated-gradient-border");
  });

  test("renders assets workspace in clear studio style", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="assets" />);

    expect(markup).toContain('data-cola-design="clear-studio-assets"');
    expect(markup).toContain('data-cola-panel="assets-workspace"');
    expect(markup).toContain("bg-white/84");
  });
```

- [ ] **Step 2: Run the mode tests and verify they fail**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "clear studio style"
```

Expected: FAIL because the markers do not exist and prompt library still renders meteor and animated gradient decoration.

- [ ] **Step 3: Update `ImageTile` and creation skeleton cards**

In `ImageTile`, replace the article class with:

```tsx
className={cn("creation-scroll-card group mb-3 min-w-0 break-inside-avoid overflow-hidden text-left", colaCardClass)}
```

Replace the primary action button class with:

```tsx
className={colaButtonClass("primary", "px-2.5 py-1 text-[11px]")}
```

Replace the secondary action button class with:

```tsx
className={colaButtonClass("ghost", "px-2.5 py-1 text-[11px]")}
```

In `CreationFeedSkeletonCard`, replace the root class with:

```tsx
className={cn("mb-3 min-w-0 break-inside-avoid overflow-hidden p-1.5", colaCardClass)}
```

- [ ] **Step 4: Update `CreationFeed` header**

Replace the centered header block with a left-aligned section header:

```tsx
<div className={cn(flushTop ? "mb-[28px]" : "mb-5", "mx-auto flex max-w-[1400px] items-end justify-between gap-4")}>
  <div>
    <h2 className="text-[26px] font-semibold leading-8 tracking-[-0.03em] text-slate-950">最近创作</h2>
    <p className="mt-1 text-sm leading-5 text-slate-500">来自你的灵感</p>
  </div>
  {feedState !== "idle" ? (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-cyan-100 bg-cyan-50 px-2.5 text-[11px] font-semibold text-cyan-700">
      <span className="size-1.5 rounded-full bg-cyan-500 motion-safe:animate-[pulse_900ms_ease-in-out_infinite]" />
      {feedState === "loading" ? "正在加载" : "正在刷新"}
    </span>
  ) : null}
</div>
```

- [ ] **Step 5: Update `PromptLibrary` shell**

In `PromptLibrary`, set:

```tsx
data-cola-design="clear-studio-prompt-library"
```

Remove the entire `data-cola-effect="prompt-meteor-field"` block.

Replace the top badge with:

```tsx
<div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-100 bg-cyan-50 px-4 py-1.5 text-xs font-semibold text-cyan-700">
  <Sparkles className="size-3.5" />
  精选提示词库 · 来自 GitHub 开源社区
</div>
```

Replace the search shell class with:

```tsx
className={cn("mx-auto mt-8 flex max-w-[820px] items-center gap-3 px-4 py-3", colaInputShellClass)}
```

Replace prompt card root class with:

```tsx
className={cn("group flex min-h-[430px] flex-col p-3", colaCardClass)}
```

Replace prompt card action classes with `colaButtonClass("secondary", "flex-1 px-3 py-2 text-xs")` and `colaButtonClass("primary", "flex-1 px-3 py-2 text-xs")`.

Replace the empty-state container class with:

```tsx
className={cn(
  "mt-8 place-items-center border-dashed p-10 text-center",
  colaSurfaceClass("raised"),
  filteredPromptCards.length === 0 ? "grid" : "hidden",
)}
```

- [ ] **Step 6: Update `AssetsWorkspace` shell and cards**

In `AssetsWorkspace`, set:

```tsx
data-cola-design="clear-studio-assets"
```

Wrap the header and queue status in a panel:

```tsx
<div className={cn("mb-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between", colaPanelClass)}>
```

Replace the task queue status class with:

```tsx
className={cn("px-4 py-3 text-sm text-slate-500", colaSurfaceClass("flat"))}
```

Replace image article class with:

```tsx
className={cn("overflow-hidden", colaCardClass)}
```

Replace icon buttons with:

```tsx
className={cn("grid size-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-950", colaFocusClass)}
```

- [ ] **Step 7: Run mode tests**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "clear studio style"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/ColaAI/components/cola-ai-workbench.test.tsx
git commit -m "feat(colaai): align discovery prompt and asset surfaces"
```

---

### Task 5: Align Canvas Home With Clear Studio System

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-home.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-home.test.tsx`

- [ ] **Step 1: Add failing canvas home style assertions**

Append to `web/src/app/ColaAI/components/canvas-home.test.tsx`:

```tsx
  test("uses clear studio markers and high contrast canvas actions", () => {
    const markup = renderToStaticMarkup(
      <CanvasHome
        canvases={[filledEntry]}
        templates={getCanvasTemplateCards()}
        onOpenCanvas={() => undefined}
        onCreateBlank={() => undefined}
        onSelectTemplate={() => undefined}
        onDeleteCanvas={() => undefined}
        selectedCanvasIds={[]}
        onToggleCanvasSelection={() => undefined}
        onToggleAllCanvasSelection={() => undefined}
        onDeleteSelectedCanvases={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-design="clear-studio-canvas-home"');
    expect(markup).toContain("bg-white/84");
    expect(markup).toContain("bg-slate-950");
    expect(markup).not.toContain("rounded-[34px]");
  });
```

- [ ] **Step 2: Run the canvas home style test and verify it fails**

Run:

```bash
cd web
bun test src/app/ColaAI/components/canvas-home.test.tsx -t "clear studio markers"
```

Expected: FAIL because the design marker is missing and `rounded-[34px]` still exists.

- [ ] **Step 3: Import shared tokens**

In `web/src/app/ColaAI/components/canvas-home.tsx`, add:

```ts
import {
  colaButtonClass,
  colaCardClass,
  colaFocusClass,
  colaMutedPanelClass,
  colaPanelClass,
  colaSurfaceClass,
} from "./cola-ai-style";
```

- [ ] **Step 4: Update the canvas home root and library panel**

Add to the `main` element:

```tsx
data-cola-design="clear-studio-canvas-home"
```

Replace the `data-cola-section="canvas-library"` class with:

```tsx
className={cn("p-5 md:p-8", colaPanelClass)}
```

- [ ] **Step 5: Update canvas home actions**

Replace "新建空白画布" button class with:

```tsx
className={colaButtonClass("primary", "h-11 px-4")}
```

Replace "删除选中" button class with:

```tsx
className={colaButtonClass("danger", "h-8 px-3 text-xs")}
```

Replace "全选" button class with:

```tsx
className={cn(
  colaButtonClass("secondary", "h-8 px-3 text-xs"),
  allCanvasesSelected && "border-cyan-200 bg-cyan-50 text-cyan-700",
)}
```

- [ ] **Step 6: Update canvas cards and empty state**

Replace canvas record article class with:

```tsx
className={cn("group min-h-[212px] p-5 text-left", colaCardClass)}
```

Replace empty-state button class with:

```tsx
className={cn("group min-h-[212px] border-dashed border-cyan-200 bg-cyan-50/62 p-5 text-left", colaCardClass)}
```

Replace small metadata chips with:

```tsx
className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
```

Replace selected count chip with:

```tsx
className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700"
```

- [ ] **Step 7: Update template section surfaces**

Find the `data-cola-section="canvas-templates"` section and replace template card root classes with:

```tsx
className={cn("group p-5 text-left", colaCardClass)}
```

Replace icon wells with:

```tsx
className="grid size-11 place-items-center rounded-[16px] bg-cyan-50 text-cyan-700 shadow-[0_16px_36px_-28px_rgba(8,145,178,0.65)]"
```

- [ ] **Step 8: Run canvas home tests**

Run:

```bash
cd web
bun test src/app/ColaAI/components/canvas-home.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/app/ColaAI/components/canvas-home.tsx web/src/app/ColaAI/components/canvas-home.test.tsx
git commit -m "feat(colaai): align canvas home with clear studio"
```

---

### Task 6: Align Utility Pages, Dialogs, And Mobile Sheet

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Add failing utility-page assertions**

Append to `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`:

```tsx
  test("renders utility modes with clear studio markers", () => {
    expect(renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="developer" />)).toContain(
      'data-cola-design="clear-studio-utility"',
    );
    expect(renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="notice" />)).toContain(
      'data-cola-design="clear-studio-utility"',
    );
    expect(renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="settings" />)).toContain(
      'data-cola-design="clear-studio-utility"',
    );
  });
```

- [ ] **Step 2: Run the utility test and verify it fails**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "utility modes"
```

Expected: FAIL because the utility markers are missing.

- [ ] **Step 3: Update utility page roots**

Add `data-cola-design="clear-studio-utility"` to these `main` elements:

- `DeveloperConsole`
- `AnnouncementCenter`
- `SettingsWorkspace`
- `AuthRequiredPanel`

Replace their main content card classes with `colaPanelClass`, `colaCardClass`, `colaSurfaceClass("flat")`, and `colaButtonClass()` equivalents.

For the Developer "创建密钥" button use:

```tsx
className={colaButtonClass("primary")}
```

For tab buttons use:

```tsx
className={cn(
  "px-5 py-3 text-sm font-semibold transition",
  index === 0 ? "border-b-2 border-slate-950 text-slate-950" : "text-slate-500 hover:text-slate-950",
)}
```

- [ ] **Step 4: Update `MobileMoreSheet`**

Replace sheet panel class with:

```tsx
className={cn(
  "absolute inset-x-0 bottom-0 rounded-t-[24px] border border-slate-200/80 bg-white/94 p-5 shadow-[0_-24px_72px_-44px_rgba(15,23,42,0.62)] ring-1 ring-white/80 backdrop-blur-xl transition duration-300",
  open ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
)}
```

Replace login button with:

```tsx
className={colaButtonClass("primary", "mb-4 w-full px-4 py-3")}
```

Replace action buttons with:

```tsx
className={cn("flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left text-sm text-slate-700 hover:bg-slate-100/80", colaFocusClass)}
```

- [ ] **Step 5: Update `DialogShell` and `LightweightDialog`**

Replace `DialogShell` dialog class with:

```tsx
className={cn("w-full max-w-[520px] overflow-hidden", colaSurfaceClass("overlay"))}
```

Replace close button class with:

```tsx
className={cn("grid size-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-950", colaFocusClass)}
```

Replace announcement cards in `LightweightDialog` with:

```tsx
className={cn("p-4", colaSurfaceClass("flat"))}
```

- [ ] **Step 6: Run utility tests**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "utility modes"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/ColaAI/components/cola-ai-workbench.test.tsx
git commit -m "feat(colaai): align utility panels and dialogs"
```

---

### Task 7: Full Verification And Browser Polish

**Files:**
- Modify only files required to fix issues found during verification.

- [ ] **Step 1: Run relevant component tests**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-style.test.ts src/app/ColaAI/components/cola-ai-workbench.test.tsx src/app/ColaAI/components/canvas-home.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
cd web
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
cd web
bun run lint
```

Expected: PASS, or only pre-existing warnings unrelated to the changed files. If lint fails in changed files, fix it before continuing.

- [ ] **Step 4: Open ColaAI in browser**

Use the existing dev server at `http://127.0.0.1:3000/ColaAI/`.

Verify these modes:

- Discover
- Generate
- Canvas Home
- Prompt Library
- Assets
- Developer
- Notice
- Settings

Expected:

- `data-cola-design="clear-studio"` is present on the root.
- No obvious warm beige page wash.
- Primary buttons use slate background and white text.
- Composer, popovers, cards, and panels share one surface language.
- No visible text overlap at desktop width.

- [ ] **Step 5: Check mobile width**

Set browser viewport to approximately `390x844` and reload `/ColaAI/`.

Expected:

- Mobile nav stays visible and readable.
- Composer toolbar wraps without clipped labels.
- Prompt filters scroll horizontally.
- Asset filenames truncate rather than overflow.
- Canvas Home actions remain reachable.

- [ ] **Step 6: Fix visual defects found in browser**

For any changed file defect, patch only the relevant class. Examples:

```tsx
// If a desktop CTA wraps, increase available width or reduce padding:
className={colaButtonClass("primary", "h-[46px] min-w-[104px] px-6 text-sm")}

// If a filename overflows, force truncation:
className="min-w-0 truncate text-xs font-medium text-slate-600"

// If a mobile toolbar clips, allow wrapping:
className="flex min-h-[70px] flex-wrap items-center gap-3 ..."
```

- [ ] **Step 7: Re-run tests after visual fixes**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-style.test.ts src/app/ColaAI/components/cola-ai-workbench.test.tsx src/app/ColaAI/components/canvas-home.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Capture verification screenshots**

Save screenshots in the repository root or `.tmp`:

- `colaai-clear-studio-discover.png`
- `colaai-clear-studio-generate.png`
- `colaai-clear-studio-canvas.png`
- `colaai-clear-studio-mobile.png`

Do not commit screenshots unless the user asks for visual artifacts to be tracked.

- [ ] **Step 9: Final commit**

If Task 7 required additional fixes:

```bash
git add web/src/app/ColaAI/components web/src/app/globals.css
git commit -m "fix(colaai): polish clear studio responsive states"
```

If no additional fixes were required, do not create an empty commit.

---

## Plan Self-Review

Spec coverage:

- Global visual system alignment: Tasks 1, 2, 3, 4, 5, 6.
- Shared treatment for navigation, panels, cards, inputs, buttons, segmented controls, empty states, loading states: Tasks 1 through 6.
- Discover, Generate, Canvas Home, Prompt Library, Assets, Developer, Notice, Settings: Tasks 2 through 7.
- Accessibility and reduced motion: Tasks 1, 3, 6, 7.
- No new component library: all tasks use existing Tailwind, lucide, and `cn()`.
- Preserve routes and labels: explicitly stated in file structure and no route changes are planned.

Placeholder scan:

- No explicit unfinished work markers are present.
Unfinished-marker scan:

- No incomplete marker entries are present.
- Visual-fix examples in Task 7 are concrete patches, not open-ended gaps.

Type consistency:

- `colaButtonClass`, `colaSurfaceClass`, and exported class constants are defined in Task 1 before use.
- Tests import the exact exported names from Task 1.
- `data-cola-design` marker names are consistent across tests and implementation steps.
