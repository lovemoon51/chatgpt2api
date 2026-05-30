# ColaAI Canvas Home Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ColaAI's `canvas` mode land on a new homepage first, then let users continue the current canvas, start a blank canvas, or start from a local template before entering the existing editor.

**Architecture:** Add a small `home | editor` subview inside the existing `canvas` mode rather than creating a new route. Keep the current editor mostly intact, add a pure helper module for homepage summary and draft creation, add a dedicated `CanvasHome` component for the new landing UI, and wire both into `ColaAIWorkbench` with localStorage-backed transitions.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, Bun test, render-to-static-markup SSR tests, existing ColaAI canvas localStorage helpers.

---

### Task 1: Add Pure Canvas Home State Helpers

**Files:**
- Create: `web/src/app/ColaAI/components/canvas-home-state.ts`
- Create: `web/src/app/ColaAI/components/canvas-home-state.test.ts`
- Reuse: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Reuse: `web/src/app/ColaAI/components/canvas-types.ts`

- [ ] **Step 1: Write the failing helper tests**

Add `web/src/app/ColaAI/components/canvas-home-state.test.ts` with:

```ts
import { describe, expect, test } from "bun:test";

import type { CanvasStorageLike } from "./canvas-types";
import {
  buildCanvasHomeSummary,
  createBlankCanvasState,
  createTemplateCanvasState,
  getCanvasHomeSummary,
  getCanvasTemplateCards,
} from "./canvas-home-state";
import { COLA_CANVAS_STORAGE_KEY, createInitialCanvasState, saveCanvasState } from "./use-canvas-store";

function createMemoryStorage(seed: Record<string, string> = {}): CanvasStorageLike {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

describe("canvas-home-state", () => {
  test("builds a filled summary from an existing canvas state", () => {
    const state = createInitialCanvasState();

    expect(buildCanvasHomeSummary(state)).toEqual({
      hasCanvas: true,
      title: "未命名画布",
      updatedAt: state.updatedAt,
      nodeCount: 4,
      hasGenerativeContent: true,
    });
  });

  test("returns an empty fallback summary when storage has no canvas", () => {
    const storage = createMemoryStorage();
    const summary = getCanvasHomeSummary(storage);

    expect(summary.hasCanvas).toBe(false);
    expect(summary.title).toBe("还没有画布");
    expect(summary.nodeCount).toBe(0);
    expect(summary.hasGenerativeContent).toBe(false);
  });

  test("loads the persisted canvas summary from storage", () => {
    const storage = createMemoryStorage();
    const state = createInitialCanvasState();
    saveCanvasState(storage, state);

    const summary = getCanvasHomeSummary(storage);

    expect(summary.hasCanvas).toBe(true);
    expect(summary.title).toBe("未命名画布");
    expect(storage.getItem(COLA_CANVAS_STORAGE_KEY)).not.toBeNull();
  });

  test("creates a blank canvas state with a fresh timestamp and default title", () => {
    const blank = createBlankCanvasState();

    expect(blank.title).toBe("未命名画布");
    expect(blank.nodes).toHaveLength(4);
    expect(blank.connections).toHaveLength(3);
    expect(blank.updatedAt).toBeTruthy();
  });

  test("creates a template canvas state with a template title and matching seed nodes", () => {
    const template = createTemplateCanvasState("brand-board");

    expect(template.title).toBe("品牌情绪板");
    expect(template.nodes.length).toBeGreaterThanOrEqual(4);
    expect(template.nodes.some((node) => node.title.includes("品牌"))).toBe(true);
    expect(template.connections.length).toBeGreaterThan(0);
  });

  test("returns four local template cards for the canvas homepage", () => {
    const cards = getCanvasTemplateCards();

    expect(cards.map((card) => card.id)).toEqual([
      "brand-board",
      "poster-concept",
      "product-collage",
      "storyboard",
    ]);
  });
});
```

- [ ] **Step 2: Run the helper test to verify RED**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-home-state.test.ts
```

Expected: FAIL with missing module or missing exports from `./canvas-home-state`.

- [ ] **Step 3: Implement the helper module**

Create `web/src/app/ColaAI/components/canvas-home-state.ts` with:

```ts
import type { CanvasNodeData, CanvasState, CanvasStorageLike } from "./canvas-types";
import { createInitialCanvasState, loadCanvasState } from "./use-canvas-store";

export type CanvasHomeSummary = {
  hasCanvas: boolean;
  title: string;
  updatedAt: string | null;
  nodeCount: number;
  hasGenerativeContent: boolean;
};

export type CanvasTemplateCard = {
  id: "brand-board" | "poster-concept" | "product-collage" | "storyboard";
  title: string;
  description: string;
  badge: string;
  accentClassName: string;
};

const EMPTY_SUMMARY: CanvasHomeSummary = {
  hasCanvas: false,
  title: "还没有画布",
  updatedAt: null,
  nodeCount: 0,
  hasGenerativeContent: false,
};

const TEMPLATE_CARDS: CanvasTemplateCard[] = [
  {
    id: "brand-board",
    title: "品牌情绪板",
    description: "从品牌关键词、材质参考和输出目标开始搭建风格系统。",
    badge: "Brand",
    accentClassName: "from-sky-100 via-cyan-50 to-emerald-100",
  },
  {
    id: "poster-concept",
    title: "海报概念板",
    description: "组织标题文案、主视觉参考和生图目标，快速进入创意海报探索。",
    badge: "Poster",
    accentClassName: "from-amber-100 via-rose-50 to-fuchsia-100",
  },
  {
    id: "product-collage",
    title: "产品视觉拼贴",
    description: "用产品图、材质描述和配置节点搭建商品视觉实验台。",
    badge: "Product",
    accentClassName: "from-emerald-100 via-lime-50 to-sky-100",
  },
  {
    id: "storyboard",
    title: "分镜草图",
    description: "将场景说明、镜头参考和结果节点放进同一条视觉叙事链路里。",
    badge: "Storyboard",
    accentClassName: "from-violet-100 via-indigo-50 to-sky-100",
  },
];

function cloneCanvasState(state: CanvasState): CanvasState {
  return JSON.parse(JSON.stringify(state)) as CanvasState;
}

function touchState(state: CanvasState, title = state.title): CanvasState {
  return {
    ...state,
    title,
    updatedAt: new Date().toISOString(),
    selectedConnectionId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
  };
}

export function buildCanvasHomeSummary(state: CanvasState | null | undefined): CanvasHomeSummary {
  if (!state) {
    return EMPTY_SUMMARY;
  }

  const title = state.title?.trim() || "未命名画布";
  const nodeCount = Array.isArray(state.nodes) ? state.nodes.length : 0;
  const hasCanvas = nodeCount > 0 || (Array.isArray(state.connections) && state.connections.length > 0) || title !== "未命名画布";
  const hasGenerativeContent = state.nodes.some((node) => node.type === "generation" || node.type === "image" || Boolean(node.metadata?.imageUrl));

  return {
    hasCanvas,
    title,
    updatedAt: state.updatedAt || null,
    nodeCount,
    hasGenerativeContent,
  };
}

export function getCanvasHomeSummary(storage: CanvasStorageLike): CanvasHomeSummary {
  return buildCanvasHomeSummary(loadCanvasState(storage));
}

export function createBlankCanvasState(): CanvasState {
  return touchState(createInitialCanvasState(), "未命名画布");
}

function replaceSeedNode(node: CanvasNodeData, patch: Partial<CanvasNodeData>): CanvasNodeData {
  return {
    ...node,
    ...patch,
    metadata: {
      ...node.metadata,
      ...patch.metadata,
    },
  };
}

export function createTemplateCanvasState(templateId: CanvasTemplateCard["id"]): CanvasState {
  const base = cloneCanvasState(createInitialCanvasState());

  if (templateId === "brand-board") {
    return touchState({
      ...base,
      title: "品牌情绪板",
      nodes: [
        replaceSeedNode(base.nodes[0], { title: "品牌关键词", metadata: { content: "高级、清透、可信、科技感。" } }),
        replaceSeedNode(base.nodes[1], { title: "材质参考", metadata: { content: "拖入包装、材质或竞品图片作为风格样本。" } }),
        replaceSeedNode(base.nodes[2], { title: "品牌输出配置", metadata: { prompt: "生成一组品牌情绪板和主视觉方向。", size: "4:3" } }),
        replaceSeedNode(base.nodes[3], { title: "品牌视觉输出", metadata: { content: "生成的情绪板会回到这里。" } }),
      ],
    });
  }

  if (templateId === "poster-concept") {
    return touchState({
      ...base,
      title: "海报概念板",
      nodes: [
        replaceSeedNode(base.nodes[0], { title: "海报文案", metadata: { content: "输入主题标题、副标题和关键信息层级。" } }),
        replaceSeedNode(base.nodes[1], { title: "主视觉参考", metadata: { content: "拖入构图、光影或角色参考。" } }),
        replaceSeedNode(base.nodes[2], { title: "海报生成配置", metadata: { prompt: "生成一张有冲击力的概念海报。", size: "2:3" } }),
        replaceSeedNode(base.nodes[3], { title: "海报结果", metadata: { content: "生成的主视觉海报会出现在这里。" } }),
      ],
    });
  }

  if (templateId === "product-collage") {
    return touchState({
      ...base,
      title: "产品视觉拼贴",
      nodes: [
        replaceSeedNode(base.nodes[0], { title: "产品卖点", metadata: { content: "整理核心卖点、使用场景和质感关键词。" } }),
        replaceSeedNode(base.nodes[1], { title: "商品参考图", metadata: { content: "拖入产品主图、包装图或材质特写。" } }),
        replaceSeedNode(base.nodes[2], { title: "商品视觉配置", metadata: { prompt: "生成一组产品拼贴和陈列视觉。", size: "1:1" } }),
        replaceSeedNode(base.nodes[3], { title: "商品视觉结果", metadata: { content: "拼贴结果会保留在这条链路里。" } }),
      ],
    });
  }

  return touchState({
    ...base,
    title: "分镜草图",
    nodes: [
      replaceSeedNode(base.nodes[0], { title: "镜头说明", metadata: { content: "写下场景、视角、节奏和角色动作。" } }),
      replaceSeedNode(base.nodes[1], { title: "分镜参考", metadata: { content: "拖入镜头、布光或构图参考图。" } }),
      replaceSeedNode(base.nodes[2], { title: "分镜配置", metadata: { prompt: "生成一张电影感分镜草图。", size: "16:9" } }),
      replaceSeedNode(base.nodes[3], { title: "分镜结果", metadata: { content: "分镜草图结果会回到这里。" } }),
    ],
  });
}

export function getCanvasTemplateCards() {
  return TEMPLATE_CARDS;
}
```

- [ ] **Step 4: Run the helper test to verify GREEN**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-home-state.test.ts
```

Expected: PASS.

### Task 2: Add the Canvas Home UI Shell

**Files:**
- Create: `web/src/app/ColaAI/components/canvas-home.tsx`
- Create: `web/src/app/ColaAI/components/canvas-home.test.tsx`
- Reuse: `web/src/app/ColaAI/components/canvas-home-state.ts`

- [ ] **Step 1: Write the failing CanvasHome render tests**

Add `web/src/app/ColaAI/components/canvas-home.test.tsx` with:

```ts
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasHome } from "./canvas-home";
import type { CanvasHomeSummary } from "./canvas-home-state";
import { getCanvasTemplateCards } from "./canvas-home-state";

const filledSummary: CanvasHomeSummary = {
  hasCanvas: true,
  title: "品牌探索画布",
  updatedAt: "2026-05-29T08:00:00.000Z",
  nodeCount: 7,
  hasGenerativeContent: true,
};

describe("CanvasHome", () => {
  test("renders the ColaAI canvas landing view with continue and template actions", () => {
    const markup = renderToStaticMarkup(
      <CanvasHome
        summary={filledSummary}
        templates={getCanvasTemplateCards()}
        onContinue={() => undefined}
        onCreateBlank={() => undefined}
        onSelectTemplate={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="canvas-home"');
    expect(markup).toContain("从一张画布开始组织你的创意");
    expect(markup).toContain("继续当前画布");
    expect(markup).toContain("新建空白画布");
    expect(markup).toContain("品牌情绪板");
    expect(markup).toContain("最近编辑");
    expect(markup).toContain("品牌探索画布");
  });

  test("renders the first-time empty-state copy when no canvas exists", () => {
    const markup = renderToStaticMarkup(
      <CanvasHome
        summary={{
          hasCanvas: false,
          title: "还没有画布",
          updatedAt: null,
          nodeCount: 0,
          hasGenerativeContent: false,
        }}
        templates={getCanvasTemplateCards()}
        onContinue={() => undefined}
        onCreateBlank={() => undefined}
        onSelectTemplate={() => undefined}
      />,
    );

    expect(markup).toContain("创建第一张画布");
    expect(markup).toContain("还没有画布");
    expect(markup).toContain("从空白画布开始");
  });
});
```

- [ ] **Step 2: Run the CanvasHome test to verify RED**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-home.test.tsx
```

Expected: FAIL because `./canvas-home` does not exist.

- [ ] **Step 3: Implement the CanvasHome component**

Create `web/src/app/ColaAI/components/canvas-home.tsx` with:

```tsx
"use client";

import { ArrowRight, LayoutTemplate, Layers3, Plus, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CanvasHomeSummary, CanvasTemplateCard } from "./canvas-home-state";

type CanvasHomeProps = {
  summary: CanvasHomeSummary;
  templates: CanvasTemplateCard[];
  onContinue: () => void;
  onCreateBlank: () => void;
  onSelectTemplate: (templateId: CanvasTemplateCard["id"]) => void;
};

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return "刚刚准备好";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "最近编辑";
  }
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function CanvasHome({ summary, templates, onContinue, onCreateBlank, onSelectTemplate }: CanvasHomeProps) {
  const continueLabel = summary.hasCanvas ? "继续当前画布" : "创建第一张画布";

  return (
    <main
      data-cola-panel="canvas-home"
      className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1240px] flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-24 md:pb-14 md:pl-[104px] md:pr-10 md:pt-24"
    >
      <section className="rounded-[32px] border border-white/70 bg-white/74 px-6 py-8 shadow-[0_30px_90px_-54px_rgba(15,23,42,0.32)] ring-1 ring-black/[0.04] backdrop-blur-2xl md:px-9 md:py-10">
        <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
          <Sparkles className="size-3.5" />
          Canvas for ColaAI
        </div>
        <h1 className="mt-4 max-w-[760px] text-[clamp(36px,6vw,64px)] font-medium leading-[0.98] tracking-[-0.03em] text-slate-950">
          从一张画布开始组织你的创意
        </h1>
        <p className="mt-4 max-w-[680px] text-sm leading-7 text-slate-600 md:text-base">
          把提示词、参考图、生成配置和 AI 结果留在同一条创作链路里，随时回到上一步继续扩展。
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <button
            type="button"
            data-cola-action="continue-canvas-home"
            className="group rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(240,249,255,0.92),rgba(255,255,255,0.92),rgba(236,253,245,0.9))] p-5 text-left shadow-[0_18px_48px_-42px_rgba(14,116,144,0.46)] transition hover:-translate-y-0.5"
            onClick={onContinue}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700/80">Continue</div>
                <h2 className="mt-3 text-2xl font-semibold text-slate-950">{continueLabel}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {summary.hasCanvas ? "回到最近编辑的工作流，继续推进已有创作链路。" : "从空白画布开始，把第一组灵感和参考都放进去。"}
                </p>
              </div>
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white">
                <ArrowRight className="size-5 transition group-hover:translate-x-0.5" />
              </span>
            </div>
            <div className="mt-5 grid gap-3 rounded-[22px] border border-white/90 bg-white/78 p-4 text-sm text-slate-600 sm:grid-cols-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">标题</div>
                <div className="mt-2 font-medium text-slate-950">{summary.title}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">最近编辑</div>
                <div className="mt-2 font-medium text-slate-950">{formatUpdatedAt(summary.updatedAt)}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">节点数量</div>
                <div className="mt-2 font-medium text-slate-950">{summary.nodeCount} 个节点</div>
              </div>
            </div>
          </button>

          <button
            type="button"
            data-cola-action="create-blank-canvas"
            className="rounded-[28px] border border-slate-200/80 bg-white/82 p-5 text-left shadow-[0_24px_70px_-54px_rgba(15,23,42,0.34)] transition hover:-translate-y-0.5"
            onClick={onCreateBlank}
          >
            <div className="grid size-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Plus className="size-5" />
            </div>
            <h2 className="mt-5 text-xl font-semibold text-slate-950">新建空白画布</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">从空白画布开始，按你的方式组织文本、参考图和生成结果。</p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
              立即开始
              <ArrowRight className="size-4" />
            </div>
          </button>
        </div>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[30px] border border-white/70 bg-white/72 p-5 shadow-[0_26px_80px_-58px_rgba(15,23,42,0.28)] ring-1 ring-black/[0.04] backdrop-blur-2xl md:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <LayoutTemplate className="size-4 text-amber-500" />
            创作起步模板
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                data-cola-template={template.id}
                className="rounded-[24px] border border-slate-200/80 bg-white/82 p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300"
                onClick={() => onSelectTemplate(template.id)}
              >
                <div className={cn("rounded-[18px] bg-gradient-to-br p-4", template.accentClassName)}>
                  <div className="inline-flex rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                    {template.badge}
                  </div>
                  <div className="mt-8 text-lg font-semibold text-slate-950">{template.title}</div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">{template.description}</p>
              </button>
            ))}
          </div>
        </div>

        <aside className="rounded-[30px] border border-white/70 bg-white/72 p-5 shadow-[0_26px_80px_-58px_rgba(15,23,42,0.28)] ring-1 ring-black/[0.04] backdrop-blur-2xl md:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Layers3 className="size-4 text-sky-500" />
            最近编辑
          </div>
          <div className="mt-5 rounded-[24px] border border-slate-200/80 bg-white/82 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">当前摘要</div>
            <div className="mt-3 text-lg font-semibold text-slate-950">{summary.title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-600">
              {summary.hasCanvas ? "继续上一次的节点链路，或者从下面的模板再开一条新支线。" : "还没有画布。你可以从空白开始，也可以用模板快速搭一个创作起点。"}
            </div>
            <div className="mt-5 grid gap-3 rounded-[20px] bg-slate-50 p-4 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-3">
                <span>节点数量</span>
                <span className="font-semibold text-slate-950">{summary.nodeCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>生成链路</span>
                <span className="font-semibold text-slate-950">{summary.hasGenerativeContent ? "已包含" : "尚未开始"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>更新时间</span>
                <span className="font-semibold text-slate-950">{formatUpdatedAt(summary.updatedAt)}</span>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run the CanvasHome test to verify GREEN**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-home.test.tsx
```

Expected: PASS.

### Task 3: Wire CanvasHome into the Workbench and Editor Entry Flow

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`
- Reuse: `web/src/app/ColaAI/components/canvas-workspace.tsx`
- Reuse: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Reuse: `web/src/app/ColaAI/components/canvas-home-state.ts`
- Reuse: `web/src/app/ColaAI/components/canvas-home.tsx`

- [ ] **Step 1: Write the failing workbench routing tests**

Update `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx` by replacing the current `initialMode="canvas"` expectation block with:

```ts
  test("renders the canvas homepage instead of dropping directly into the editor", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="canvas" />);

    expect(markup).toContain('data-cola-mode="canvas"');
    expect(markup).toContain('data-cola-panel="canvas-home"');
    expect(markup).toContain("从一张画布开始组织你的创意");
    expect(markup).toContain("继续当前画布");
    expect(markup).toContain("新建空白画布");
    expect(markup).toContain("品牌情绪板");
    expect(markup).not.toContain('data-cola-panel="canvas-workspace"');
  });
```

Also add this focused editor shell test nearby so the editor markup still has direct coverage:

```ts
  test("renders the canvas editor shell when directly mounting CanvasWorkspace", () => {
    const markup = renderToStaticMarkup(<CanvasWorkspace onBack={() => undefined} />);

    expect(markup).toContain('data-cola-panel="canvas-workspace"');
    expect(markup).toContain('data-cola-canvas="immersive-light"');
    expect(markup).toContain("继续生成");
  });
```

Add the import:

```ts
import { CanvasWorkspace } from "./canvas-workspace";
```

- [ ] **Step 2: Run the workbench test to verify RED**

Run:

```bash
cd web && bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx
```

Expected: FAIL because `initialMode="canvas"` still renders `CanvasWorkspace`.

- [ ] **Step 3: Implement the new canvas subview flow**

Update `web/src/app/ColaAI/components/cola-ai-workbench.tsx` with:

```tsx
import { CanvasHome } from "./canvas-home";
import {
  createBlankCanvasState,
  createTemplateCanvasState,
  getCanvasHomeSummary,
  getCanvasTemplateCards,
  type CanvasTemplateCard,
} from "./canvas-home-state";
import { CanvasWorkspace, type CanvasSourceTaskFocus } from "./canvas-workspace";
import { COLA_CANVAS_STORAGE_KEY, saveCanvasState } from "./use-canvas-store";
```

Add the subview type near the existing workbench types:

```ts
type CanvasSubview = "home" | "editor";
```

Add state and template memo inside `ColaAIWorkbench`:

```tsx
  const [canvasSubview, setCanvasSubview] = useState<CanvasSubview>("home");
  const canvasTemplates = useMemo(() => getCanvasTemplateCards(), []);
```

Reset the subview whenever the main mode changes away from canvas:

```tsx
  useEffect(() => {
    if (mode !== "canvas" && canvasSubview !== "home") {
      setCanvasSubview("home");
    }
  }, [canvasSubview, mode]);
```

Add these callbacks inside `ColaAIWorkbench`:

```tsx
  const handleOpenCanvasHome = useCallback(() => {
    setMode("canvas");
    setCanvasSubview("home");
  }, []);

  const handleOpenCanvasEditor = useCallback(() => {
    setMode("canvas");
    setCanvasSubview("editor");
  }, []);

  const handleContinueCanvas = useCallback(() => {
    handleOpenCanvasEditor();
  }, [handleOpenCanvasEditor]);

  const handleCreateBlankCanvas = useCallback(() => {
    if (typeof window !== "undefined") {
      saveCanvasState(window.localStorage, createBlankCanvasState());
    }
    handleOpenCanvasEditor();
  }, [handleOpenCanvasEditor]);

  const handleCreateTemplateCanvas = useCallback((templateId: CanvasTemplateCard["id"]) => {
    if (typeof window !== "undefined") {
      saveCanvasState(window.localStorage, createTemplateCanvasState(templateId));
    }
    handleOpenCanvasEditor();
  }, [handleOpenCanvasEditor]);
```

Change the side rail and mobile primary navigation button handlers to route canvas through the homepage:

```tsx
                  onClick={() => {
                    if (item.key === "canvas") {
                      handleOpenCanvasHome();
                      return;
                    }
                    setMode(item.key);
                  }}
```

Apply the same condition to the mobile nav buttons and the `MobileMoreSheet` `onNavigate` handler.

Replace the current canvas render block:

```tsx
      {mode === "canvas" && canvasSubview === "home" && (
        <CanvasHome
          summary={typeof window === "undefined" ? getCanvasHomeSummary({
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          }) : getCanvasHomeSummary(window.localStorage)}
          templates={canvasTemplates}
          onContinue={handleContinueCanvas}
          onCreateBlank={handleCreateBlankCanvas}
          onSelectTemplate={handleCreateTemplateCanvas}
        />
      )}

      {mode === "canvas" && canvasSubview === "editor" && (
        <CanvasWorkspace
          onBack={handleOpenCanvasHome}
          onOpenSourceTask={handleOpenCanvasSourceTask}
        />
      )}
```

Then refactor that inline storage access into a memoized summary computed above:

```tsx
  const canvasHomeSummary = useMemo(() => {
    if (typeof window === "undefined") {
      return getCanvasHomeSummary({
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      });
    }
    return getCanvasHomeSummary(window.localStorage);
  }, [canvasSubview, mode]);
```

and pass `summary={canvasHomeSummary}` to `CanvasHome`.

- [ ] **Step 4: Run the workbench and canvas tests to verify GREEN**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-home-state.test.ts src/app/ColaAI/components/canvas-home.test.tsx src/app/ColaAI/components/cola-ai-workbench.test.tsx src/app/ColaAI/components/canvas-workspace.test.tsx
```

Expected: PASS.

### Task 4: Verify End-to-End Canvas Entry Behavior

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx` if browser verification reveals UI issues
- Modify: `web/src/app/ColaAI/components/canvas-home.tsx` if browser verification reveals layout or copy issues

- [ ] **Step 1: Run type-aware and feature-focused verification**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-home-state.test.ts src/app/ColaAI/components/canvas-home.test.tsx src/app/ColaAI/components/cola-ai-workbench.test.tsx src/app/ColaAI/components/canvas-workspace.test.tsx
```

Expected: PASS with zero failures.

- [ ] **Step 2: Verify in the browser**

Manual checks:

```text
1. Open http://localhost:3000/ColaAI/
2. Click the "画布" rail item
3. Confirm the first screen is the new canvas homepage
4. Click "继续当前画布" and confirm the editor opens
5. Click the editor back button and confirm it returns to the homepage
6. Click "新建空白画布" and confirm the editor opens with a fresh draft
7. Return home and click a template card, then confirm the editor opens with a template title
```

Expected: Every navigation step matches the design spec.
