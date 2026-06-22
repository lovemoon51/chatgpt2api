# ColaAI 创作工作流画布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ColaAI 的静态画布壳层升级为浅色沉浸式创作工作流画布，支持节点、连线、本地持久化和基于图片节点继续生成。

**Architecture:** 画布从 `cola-ai-workbench.tsx` 拆成独立组件与纯状态模块。纯函数负责节点、连接、视口和本地持久化，React 客户端组件负责平移、缩放、拖拽、抽屉和生成入口，最终由 ColaAI 的 `canvas` 模式装配。

**Tech Stack:** Next.js 16、React 19 客户端组件、TypeScript 严格模式、Tailwind CSS、lucide-react、`bun:test`、`renderToStaticMarkup`。

---

## 文件结构

- Create: `web/src/app/ColaAI/components/canvas-types.ts`  
  定义画布节点、连接、视口、状态和生成提交类型。
- Create: `web/src/app/ColaAI/components/use-canvas-store.ts`  
  提供纯状态函数、本地存储读写函数和 React hook。
- Create: `web/src/app/ColaAI/components/use-canvas-store.test.ts`  
  覆盖默认状态、节点新增、删除、移动、视口更新、生成结果追加和本地持久化。
- Create: `web/src/app/ColaAI/components/canvas-node.tsx`  
  渲染文本、图片、生成结果节点。
- Create: `web/src/app/ColaAI/components/canvas-connections.tsx`  
  渲染紫色虚线连接。
- Create: `web/src/app/ColaAI/components/canvas-toolbar.tsx`  
  渲染底部悬浮工具条。
- Create: `web/src/app/ColaAI/components/canvas-zoom-controls.tsx`  
  渲染左下缩放控件。
- Create: `web/src/app/ColaAI/components/canvas-generation-drawer.tsx`  
  渲染继续生成抽屉。
- Create: `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`  
  负责画布视口、平移、缩放、节点拖拽、节点层与连线层。
- Create: `web/src/app/ColaAI/components/canvas-workspace.tsx`  
  装配顶栏、画布、工具条、缩放控件、AI 入口和生成抽屉。
- Create: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`  
  覆盖画布 SSR 结构、工具条、节点类型、生成入口和浅色视觉标记。
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`  
  删除内联 `CanvasWorkspace`，改为导入新组件。
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`  
  更新画布测试断言，确保工作台仍能渲染新画布入口。

## 外部依据

- React 官方文档确认：交互组件需要客户端组件、状态更新使用 `useState`，窗口级 pointer 监听应放在 `useEffect` 并清理监听器。
- 当前项目已使用 `bun:test` + `renderToStaticMarkup`，计划沿用同一测试方式。
- 当前画布壳层位于 `web/src/app/ColaAI/components/cola-ai-workbench.tsx:1439`，视觉基调为 `#fafafa`、淡紫光晕、24px 网格、白色玻璃节点和紫色虚线连接。

### Task 1: 画布状态模型与纯函数

**Files:**
- Create: `web/src/app/ColaAI/components/canvas-types.ts`
- Create: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Create: `web/src/app/ColaAI/components/use-canvas-store.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/app/ColaAI/components/use-canvas-store.test.ts` 写入：

```ts
import { describe, expect, test } from "bun:test";

import {
  addImageNode,
  addTextNode,
  appendGenerationNode,
  createInitialCanvasState,
  deleteSelectedNode,
  loadCanvasState,
  moveNode,
  saveCanvasState,
  selectNode,
  updateViewport,
} from "./use-canvas-store";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("use-canvas-store helpers", () => {
  test("creates a default ColaAI canvas state", () => {
    const state = createInitialCanvasState();

    expect(state.title).toBe("未命名画布");
    expect(state.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(state.nodes.map((node) => node.type)).toEqual(["text", "image", "generation"]);
    expect(state.connections).toHaveLength(2);
    expect(state.selectedNodeId).toBeNull();
  });

  test("adds, selects, moves, and deletes nodes", () => {
    const withText = addTextNode(createInitialCanvasState(), { x: 120, y: 160 });
    const textNode = withText.nodes.at(-1)!;
    const selected = selectNode(withText, textNode.id);
    const moved = moveNode(selected, textNode.id, { x: 240, y: 260 });
    const deleted = deleteSelectedNode(moved);

    expect(textNode.title).toBe("文本节点");
    expect(moved.nodes.find((node) => node.id === textNode.id)?.position).toEqual({ x: 240, y: 260 });
    expect(deleted.nodes.some((node) => node.id === textNode.id)).toBe(false);
    expect(deleted.selectedNodeId).toBeNull();
  });

  test("adds image nodes and appends generation nodes with a connection", () => {
    const withImage = addImageNode(createInitialCanvasState(), {
      position: { x: 320, y: 220 },
      imageUrl: "/api/images/reference.png",
      title: "参考图片",
    });
    const imageNode = withImage.nodes.at(-1)!;
    const generated = appendGenerationNode(withImage, imageNode.id, {
      imageUrl: "/api/images/result.png",
      prompt: "霓虹城市猫咪",
      sourceTaskId: "task-1",
    });
    const resultNode = generated.nodes.at(-1)!;

    expect(resultNode.type).toBe("generation");
    expect(resultNode.imageUrl).toBe("/api/images/result.png");
    expect(resultNode.sourceTaskId).toBe("task-1");
    expect(generated.connections.some((connection) => connection.fromNodeId === imageNode.id && connection.toNodeId === resultNode.id)).toBe(true);
    expect(generated.selectedNodeId).toBe(resultNode.id);
  });

  test("updates viewport and persists state", () => {
    const storage = createMemoryStorage();
    const state = updateViewport(createInitialCanvasState(), { x: -40, y: 18, zoom: 1.25 });

    saveCanvasState(storage, state);
    const loaded = loadCanvasState(storage);

    expect(loaded?.viewport).toEqual({ x: -40, y: 18, zoom: 1.25 });
    expect(loaded?.title).toBe("未命名画布");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web && bun test src/app/ColaAI/components/use-canvas-store.test.ts
```

Expected: FAIL，提示找不到 `./use-canvas-store` 或导出的函数不存在。

- [ ] **Step 3: 新增类型文件**

创建 `web/src/app/ColaAI/components/canvas-types.ts`：

```ts
export type CanvasNodeType = "text" | "image" | "generation";

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasSize = {
  width: number;
  height: number;
};

export type CanvasViewport = CanvasPoint & {
  zoom: number;
};

export type CanvasNodeData = {
  id: string;
  type: CanvasNodeType;
  position: CanvasPoint;
  size: CanvasSize;
  title: string;
  content: string;
  imageUrl?: string;
  sourceTaskId?: string;
};

export type CanvasConnectionData = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type CanvasState = {
  title: string;
  nodes: CanvasNodeData[];
  connections: CanvasConnectionData[];
  viewport: CanvasViewport;
  selectedNodeId: string | null;
  updatedAt: string;
};

export type CanvasGenerationPayload = {
  prompt: string;
  imageUrl: string;
  sourceTaskId?: string;
};

export type CanvasStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
```

- [ ] **Step 4: 新增纯函数与 hook**

创建 `web/src/app/ColaAI/components/use-canvas-store.ts`：

```ts
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CanvasGenerationPayload, CanvasNodeData, CanvasPoint, CanvasState, CanvasStorageLike, CanvasViewport } from "./canvas-types";

export const COLA_CANVAS_STORAGE_KEY = "chatgpt2api:cola_canvas_state";

const now = () => new Date().toISOString();

const createId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function touch(state: CanvasState): CanvasState {
  return { ...state, updatedAt: now() };
}

export function createInitialCanvasState(): CanvasState {
  const textNode: CanvasNodeData = {
    id: "seed-text",
    type: "text",
    position: { x: 180, y: 180 },
    size: { width: 260, height: 154 },
    title: "创意提示词",
    content: "一只可爱的猫咪坐在窗台上，窗外是城市夜景，霓虹灯光映照，赛博朋克风格，高质量渲染。",
  };
  const imageNode: CanvasNodeData = {
    id: "seed-image",
    type: "image",
    position: { x: 560, y: 140 },
    size: { width: 220, height: 220 },
    title: "参考图片",
    content: "拖入参考图，保留构图、角色或产品材质。",
    imageUrl: "",
  };
  const generationNode: CanvasNodeData = {
    id: "seed-generation",
    type: "generation",
    position: { x: 920, y: 260 },
    size: { width: 280, height: 174 },
    title: "AI 生图结果",
    content: "生成节点会把提示词、参考图与比例参数串成可复用流程。",
    imageUrl: "",
  };

  return {
    title: "未命名画布",
    nodes: [textNode, imageNode, generationNode],
    connections: [
      { id: "seed-text-to-image", fromNodeId: textNode.id, toNodeId: imageNode.id },
      { id: "seed-image-to-generation", fromNodeId: imageNode.id, toNodeId: generationNode.id },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedNodeId: null,
    updatedAt: now(),
  };
}

export function addTextNode(state: CanvasState, position: CanvasPoint): CanvasState {
  const node: CanvasNodeData = {
    id: createId("text"),
    type: "text",
    position,
    size: { width: 260, height: 150 },
    title: "文本节点",
    content: "双击编辑创意提示词。",
  };
  return touch({ ...state, nodes: [...state.nodes, node], selectedNodeId: node.id });
}

export function addImageNode(state: CanvasState, input: { position: CanvasPoint; imageUrl: string; title?: string }): CanvasState {
  const node: CanvasNodeData = {
    id: createId("image"),
    type: "image",
    position: input.position,
    size: { width: 220, height: 220 },
    title: input.title ?? "图片节点",
    content: "可作为继续生成的参考图。",
    imageUrl: input.imageUrl,
  };
  return touch({ ...state, nodes: [...state.nodes, node], selectedNodeId: node.id });
}

export function selectNode(state: CanvasState, nodeId: string | null): CanvasState {
  return { ...state, selectedNodeId: nodeId };
}

export function moveNode(state: CanvasState, nodeId: string, position: CanvasPoint): CanvasState {
  return touch({
    ...state,
    nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
  });
}

export function deleteSelectedNode(state: CanvasState): CanvasState {
  if (!state.selectedNodeId) {
    return state;
  }
  const selectedNodeId = state.selectedNodeId;
  return touch({
    ...state,
    nodes: state.nodes.filter((node) => node.id !== selectedNodeId),
    connections: state.connections.filter((connection) => connection.fromNodeId !== selectedNodeId && connection.toNodeId !== selectedNodeId),
    selectedNodeId: null,
  });
}

export function updateViewport(state: CanvasState, viewport: CanvasViewport): CanvasState {
  const zoom = Math.min(2.5, Math.max(0.25, viewport.zoom));
  return touch({ ...state, viewport: { x: viewport.x, y: viewport.y, zoom } });
}

export function appendGenerationNode(state: CanvasState, sourceNodeId: string, payload: CanvasGenerationPayload): CanvasState {
  const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
  const fallbackPosition = { x: 320, y: 220 };
  const position = sourceNode ? { x: sourceNode.position.x + sourceNode.size.width + 140, y: sourceNode.position.y + 48 } : fallbackPosition;
  const node: CanvasNodeData = {
    id: createId("generation"),
    type: "generation",
    position,
    size: { width: 280, height: 220 },
    title: "AI 生图结果",
    content: payload.prompt,
    imageUrl: payload.imageUrl,
    sourceTaskId: payload.sourceTaskId,
  };
  return touch({
    ...state,
    nodes: [...state.nodes, node],
    connections: [...state.connections, { id: createId("connection"), fromNodeId: sourceNodeId, toNodeId: node.id }],
    selectedNodeId: node.id,
  });
}

export function loadCanvasState(storage: CanvasStorageLike): CanvasState | null {
  const raw = storage.getItem(COLA_CANVAS_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as CanvasState;
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.connections) || !parsed.viewport) {
    return null;
  }
  return parsed;
}

export function saveCanvasState(storage: CanvasStorageLike, state: CanvasState) {
  storage.setItem(COLA_CANVAS_STORAGE_KEY, JSON.stringify(state));
}

export function useCanvasStore() {
  const [state, setState] = useState<CanvasState>(() => createInitialCanvasState());

  useEffect(() => {
    const loaded = loadCanvasState(window.localStorage);
    if (loaded) {
      setState(loaded);
    }
  }, []);

  useEffect(() => {
    saveCanvasState(window.localStorage, state);
  }, [state]);

  const actions = useMemo(
    () => ({
      addTextNode: (position: CanvasPoint) => setState((current) => addTextNode(current, position)),
      addImageNode: (input: { position: CanvasPoint; imageUrl: string; title?: string }) => setState((current) => addImageNode(current, input)),
      appendGenerationNode: (sourceNodeId: string, payload: CanvasGenerationPayload) => setState((current) => appendGenerationNode(current, sourceNodeId, payload)),
      deleteSelectedNode: () => setState((current) => deleteSelectedNode(current)),
      moveNode: (nodeId: string, position: CanvasPoint) => setState((current) => moveNode(current, nodeId, position)),
      selectNode: (nodeId: string | null) => setState((current) => selectNode(current, nodeId)),
      updateViewport: (viewport: CanvasViewport) => setState((current) => updateViewport(current, viewport)),
    }),
    [],
  );

  const selectedNode = useMemo(() => state.nodes.find((node) => node.id === state.selectedNodeId) ?? null, [state.nodes, state.selectedNodeId]);

  return { state, selectedNode, ...actions };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
cd web && bun test src/app/ColaAI/components/use-canvas-store.test.ts
```

Expected: PASS，4 个测试通过。

### Task 2: 静态画布组件 SSR 结构

**Files:**
- Create: `web/src/app/ColaAI/components/canvas-node.tsx`
- Create: `web/src/app/ColaAI/components/canvas-connections.tsx`
- Create: `web/src/app/ColaAI/components/canvas-toolbar.tsx`
- Create: `web/src/app/ColaAI/components/canvas-zoom-controls.tsx`
- Create: `web/src/app/ColaAI/components/canvas-generation-drawer.tsx`
- Create: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `web/src/app/ColaAI/components/canvas-workspace.test.tsx`：

```tsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasConnections } from "./canvas-connections";
import { CanvasGenerationDrawer } from "./canvas-generation-drawer";
import { CanvasNode } from "./canvas-node";
import { CanvasToolbar } from "./canvas-toolbar";
import { CanvasZoomControls } from "./canvas-zoom-controls";
import { createInitialCanvasState } from "./use-canvas-store";

describe("ColaAI canvas components", () => {
  test("renders the three node types with ColaAI light visual markers", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <div>
        {state.nodes.map((node) => (
          <CanvasNode key={node.id} node={node} selected={node.id === "seed-image"} onSelect={() => undefined} onMove={() => undefined} onOpenGeneration={() => undefined} />
        ))}
      </div>,
    );

    expect(markup).toContain('data-cola-canvas-node="text"');
    expect(markup).toContain('data-cola-canvas-node="image"');
    expect(markup).toContain('data-cola-canvas-node="generation"');
    expect(markup).toContain('data-cola-state="selected"');
    expect(markup).toContain("创意提示词");
    expect(markup).toContain("参考图片");
    expect(markup).toContain("AI 生图结果");
  });

  test("renders connections, toolbar, zoom controls, and generation drawer", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <div>
        <CanvasConnections nodes={state.nodes} connections={state.connections} />
        <CanvasToolbar canGenerate canDelete onAddText={() => undefined} onAddImage={() => undefined} onDelete={() => undefined} onOpenGeneration={() => undefined} />
        <CanvasZoomControls zoom={0.91} onFitView={() => undefined} />
        <CanvasGenerationDrawer open selectedNode={state.nodes[1]} prompt="霓虹猫咪" onPromptChange={() => undefined} onClose={() => undefined} onSubmit={() => undefined} submitting={false} />
      </div>,
    );

    expect(markup).toContain('data-cola-canvas-layer="connections"');
    expect(markup).toContain('data-cola-panel="canvas-toolbar"');
    expect(markup).toContain('data-cola-panel="canvas-zoom-controls"');
    expect(markup).toContain('data-cola-panel="canvas-generation-drawer"');
    expect(markup).toContain("继续生成");
    expect(markup).toContain("91%");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-workspace.test.tsx
```

Expected: FAIL，提示组件文件不存在。

- [ ] **Step 3: 实现 CanvasNode**

创建 `web/src/app/ColaAI/components/canvas-node.tsx`：

```tsx
import { ImagePlus, Sparkles, Type } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { CanvasNodeData, CanvasPoint } from "./canvas-types";
import { cn } from "@/lib/utils";

const iconByType = {
  text: Type,
  image: ImagePlus,
  generation: Sparkles,
};

type CanvasNodeProps = {
  node: CanvasNodeData;
  selected: boolean;
  onSelect: (nodeId: string) => void;
  onMove: (nodeId: string, position: CanvasPoint) => void;
  onOpenGeneration: (nodeId: string) => void;
};

export function CanvasNode({ node, selected, onSelect, onMove, onOpenGeneration }: CanvasNodeProps) {
  const Icon = iconByType[node.type];

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    event.stopPropagation();
    onSelect(node.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (event.buttons !== 1) {
      return;
    }
    onMove(node.id, {
      x: node.position.x + event.movementX,
      y: node.position.y + event.movementY,
    });
  }

  return (
    <article
      data-cola-canvas-node={node.type}
      data-cola-state={selected ? "selected" : "idle"}
      className={cn(
        "absolute rounded-[18px] border bg-white/92 p-4 text-left shadow-[0_22px_70px_-52px_rgba(15,23,42,0.85)] backdrop-blur-xl transition",
        selected ? "border-violet-400 ring-4 ring-violet-200/60" : "border-black/5",
      )}
      style={{ width: node.size.width, minHeight: node.size.height, transform: `translate(${node.position.x}px, ${node.position.y}px)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-slate-950 text-white">
          <Icon className="size-4" />
        </span>
        <h2 className="text-sm font-semibold text-slate-950">{node.title}</h2>
      </div>
      {node.imageUrl ? <img src={node.imageUrl} alt={node.title} className="mt-3 aspect-square w-full rounded-2xl object-cover" /> : null}
      <p className="mt-3 text-xs leading-5 text-slate-500">{node.content}</p>
      {(node.type === "image" || node.type === "generation") && selected ? (
        <button type="button" className="mt-3 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => onOpenGeneration(node.id)}>
          继续生成
        </button>
      ) : null}
    </article>
  );
}
```

- [ ] **Step 4: 实现连接和控件组件**

创建 `web/src/app/ColaAI/components/canvas-connections.tsx`：

```tsx
import type { CanvasConnectionData, CanvasNodeData } from "./canvas-types";

function centerOf(node: CanvasNodeData) {
  return {
    x: node.position.x + node.size.width / 2,
    y: node.position.y + node.size.height / 2,
  };
}

type CanvasConnectionsProps = {
  nodes: CanvasNodeData[];
  connections: CanvasConnectionData[];
};

export function CanvasConnections({ nodes, connections }: CanvasConnectionsProps) {
  return (
    <svg data-cola-canvas-layer="connections" aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
      {connections.map((connection) => {
        const from = nodes.find((node) => node.id === connection.fromNodeId);
        const to = nodes.find((node) => node.id === connection.toNodeId);
        if (!from || !to) {
          return null;
        }
        const start = centerOf(from);
        const end = centerOf(to);
        const midX = (start.x + end.x) / 2;
        return <path key={connection.id} d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="6 8" />;
      })}
    </svg>
  );
}
```

创建 `web/src/app/ColaAI/components/canvas-toolbar.tsx`：

```tsx
import { Eraser, Hand, ImagePlus, Sparkles, Trash2, Type, Upload } from "lucide-react";

import { cn } from "@/lib/utils";

type CanvasToolbarProps = {
  canGenerate: boolean;
  canDelete: boolean;
  onAddText: () => void;
  onAddImage: () => void;
  onDelete: () => void;
  onOpenGeneration: () => void;
};

export function CanvasToolbar({ canGenerate, canDelete, onAddText, onAddImage, onDelete, onOpenGeneration }: CanvasToolbarProps) {
  return (
    <div data-cola-panel="canvas-toolbar" className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-[17px] border border-black/5 bg-white/94 px-4 py-3 text-slate-600 shadow-[0_18px_54px_-36px_rgba(15,23,42,0.75)] backdrop-blur-xl">
      <button type="button" title="手型工具" className="grid size-9 place-items-center rounded-xl bg-slate-950 text-white">
        <Hand className="size-4" />
      </button>
      <button type="button" title="文本节点" className="grid size-9 place-items-center rounded-xl hover:bg-slate-100" onClick={onAddText}>
        <Type className="size-4" />
      </button>
      <button type="button" title="图片节点" className="grid size-9 place-items-center rounded-xl hover:bg-slate-100" onClick={onAddImage}>
        <ImagePlus className="size-4" />
      </button>
      <button type="button" title="继续生成" className={cn("grid size-9 place-items-center rounded-xl hover:bg-slate-100", !canGenerate && "opacity-40")} onClick={onOpenGeneration} disabled={!canGenerate}>
        <Sparkles className="size-4" />
      </button>
      <button type="button" title="上传" className="grid size-9 place-items-center rounded-xl hover:bg-slate-100" onClick={onAddImage}>
        <Upload className="size-4" />
      </button>
      <span className="mx-1 h-6 w-px bg-slate-200" />
      <button type="button" title="清除选择" className="grid size-9 place-items-center rounded-xl hover:bg-slate-100">
        <Eraser className="size-4" />
      </button>
      <button type="button" title="删除节点" className={cn("grid size-9 place-items-center rounded-xl text-rose-500 hover:bg-rose-50", !canDelete && "opacity-40")} onClick={onDelete} disabled={!canDelete}>
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
```

创建 `web/src/app/ColaAI/components/canvas-zoom-controls.tsx`：

```tsx
import { CircleHelp, Focus, LocateFixed } from "lucide-react";

type CanvasZoomControlsProps = {
  zoom: number;
  onFitView: () => void;
};

export function CanvasZoomControls({ zoom, onFitView }: CanvasZoomControlsProps) {
  return (
    <div data-cola-panel="canvas-zoom-controls" className="absolute bottom-6 left-6 z-20 flex items-center gap-3 rounded-2xl border border-black/5 bg-white/92 px-4 py-3 text-sm text-slate-600 shadow-[0_14px_45px_-34px_rgba(15,23,42,0.7)] backdrop-blur-xl">
      <LocateFixed className="size-4" />
      <button type="button" title="适配视图" onClick={onFitView}>
        <Focus className="size-4" />
      </button>
      <div className="h-1 w-24 rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-slate-950" style={{ width: `${Math.round(Math.min(1, zoom / 1.5) * 100)}%` }} />
      </div>
      <span>{Math.round(zoom * 100)}%</span>
      <CircleHelp className="size-4" />
    </div>
  );
}
```

- [ ] **Step 5: 实现生成抽屉**

创建 `web/src/app/ColaAI/components/canvas-generation-drawer.tsx`：

```tsx
import { Sparkles, X } from "lucide-react";

import type { CanvasNodeData } from "./canvas-types";
import { cn } from "@/lib/utils";

type CanvasGenerationDrawerProps = {
  open: boolean;
  selectedNode: CanvasNodeData | null;
  prompt: string;
  submitting: boolean;
  onPromptChange: (prompt: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function CanvasGenerationDrawer({ open, selectedNode, prompt, submitting, onPromptChange, onClose, onSubmit }: CanvasGenerationDrawerProps) {
  return (
    <aside data-cola-panel="canvas-generation-drawer" className={cn("absolute inset-y-4 right-4 z-30 w-[360px] rounded-[24px] border border-black/5 bg-white/95 p-5 text-slate-950 shadow-[0_24px_80px_-42px_rgba(15,23,42,0.85)] backdrop-blur-2xl transition", open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-8 opacity-0")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-slate-950 text-white">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">继续生成</h2>
            <p className="text-xs text-slate-500">参考节点：{selectedNode?.title ?? "未选择"}</p>
          </div>
        </div>
        <button type="button" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <label className="mt-5 block text-xs font-medium text-slate-500" htmlFor="canvas-generation-prompt">
        提示词
      </label>
      <textarea id="canvas-generation-prompt" className="mt-2 min-h-[132px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100" value={prompt} onChange={(event) => onPromptChange(event.target.value)} />
      <button type="button" className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60" disabled={!selectedNode || submitting} onClick={onSubmit}>
        {submitting ? "生成中" : "基于节点继续生成"}
      </button>
    </aside>
  );
}
```

- [ ] **Step 6: 运行组件测试确认通过**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-workspace.test.tsx
```

Expected: PASS，2 个测试通过。

### Task 3: 交互画布视口与工作区装配

**Files:**
- Create: `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`
- Create: `web/src/app/ColaAI/components/canvas-workspace.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [ ] **Step 1: 扩展失败测试**

在 `canvas-workspace.test.tsx` 追加：

```tsx
import { CanvasWorkspace } from "./canvas-workspace";

test("renders the immersive ColaAI canvas workspace shell", () => {
  const markup = renderToStaticMarkup(<CanvasWorkspace onBack={() => undefined} />);

  expect(markup).toContain('data-cola-panel="canvas-workspace"');
  expect(markup).toContain('data-cola-canvas="immersive-light"');
  expect(markup).toContain('data-cola-canvas-layer="surface"');
  expect(markup).toContain('data-cola-panel="canvas-toolbar"');
  expect(markup).toContain('data-cola-panel="canvas-zoom-controls"');
  expect(markup).toContain('data-cola-action="canvas-ai-entry"');
  expect(markup).toContain("未命名画布");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-workspace.test.tsx
```

Expected: FAIL，提示 `CanvasWorkspace` 或 `InfiniteCanvasSurface` 不存在。

- [ ] **Step 3: 实现 InfiniteCanvasSurface**

创建 `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`：

```tsx
import type { WheelEvent } from "react";

import { CanvasConnections } from "./canvas-connections";
import { CanvasNode } from "./canvas-node";
import type { CanvasNodeData, CanvasPoint, CanvasState, CanvasViewport } from "./canvas-types";

type InfiniteCanvasSurfaceProps = {
  state: CanvasState;
  onSelectNode: (nodeId: string | null) => void;
  onMoveNode: (nodeId: string, position: CanvasPoint) => void;
  onOpenGeneration: (nodeId: string) => void;
  onViewportChange: (viewport: CanvasViewport) => void;
};

export function InfiniteCanvasSurface({ state, onSelectNode, onMoveNode, onOpenGeneration, onViewportChange }: InfiniteCanvasSurfaceProps) {
  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const nextZoom = state.viewport.zoom - event.deltaY * 0.001;
    onViewportChange({ ...state.viewport, zoom: nextZoom });
  }

  function handleBackgroundPointerDown() {
    onSelectNode(null);
  }

  function handleMoveNode(nodeId: string, position: CanvasPoint) {
    const node = state.nodes.find((item): item is CanvasNodeData => item.id === nodeId);
    if (!node) {
      return;
    }
    onMoveNode(nodeId, position);
  }

  return (
    <div data-cola-canvas-layer="surface" className="absolute inset-0 overflow-hidden" onWheel={handleWheel} onPointerDown={handleBackgroundPointerDown}>
      <div
        className="absolute left-0 top-0 h-full w-full origin-top-left"
        style={{ transform: `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.zoom})` }}
      >
        <CanvasConnections nodes={state.nodes} connections={state.connections} />
        {state.nodes.map((node) => (
          <CanvasNode key={node.id} node={node} selected={node.id === state.selectedNodeId} onSelect={onSelectNode} onMove={handleMoveNode} onOpenGeneration={onOpenGeneration} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 实现 CanvasWorkspace**

创建 `web/src/app/ColaAI/components/canvas-workspace.tsx`：

```tsx
import { ArrowLeft, Bot, Sparkles } from "lucide-react";
import { useState } from "react";

import { CanvasGenerationDrawer } from "./canvas-generation-drawer";
import { CanvasToolbar } from "./canvas-toolbar";
import { CanvasZoomControls } from "./canvas-zoom-controls";
import { InfiniteCanvasSurface } from "./infinite-canvas-surface";
import { useCanvasStore } from "./use-canvas-store";

type CanvasWorkspaceProps = {
  onBack: () => void;
};

export function CanvasWorkspace({ onBack }: CanvasWorkspaceProps) {
  const { state, selectedNode, addTextNode, addImageNode, appendGenerationNode, deleteSelectedNode, moveNode, selectNode, updateViewport } = useCanvasStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [prompt, setPrompt] = useState("霓虹城市夜景，电影感光影，高质量细节。\n");
  const [submitting, setSubmitting] = useState(false);
  const canGenerate = selectedNode?.type === "image" || selectedNode?.type === "generation";

  function createNodePosition() {
    return { x: -state.viewport.x + 320, y: -state.viewport.y + 220 };
  }

  function openGeneration() {
    if (!canGenerate) {
      return;
    }
    setDrawerOpen(true);
  }

  function openGenerationForNode(nodeId: string) {
    selectNode(nodeId);
    setDrawerOpen(true);
  }

  function handleSubmitGeneration() {
    if (!selectedNode) {
      return;
    }
    setSubmitting(true);
    appendGenerationNode(selectedNode.id, {
      prompt,
      imageUrl: selectedNode.imageUrl || "",
      sourceTaskId: selectedNode.sourceTaskId,
    });
    setSubmitting(false);
    setDrawerOpen(false);
  }

  return (
    <main data-cola-panel="canvas-workspace" data-cola-canvas="immersive-light" className="fixed inset-0 z-50 overflow-hidden bg-[#fafafa] text-slate-950">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(167,139,250,0.16),transparent_34%),linear-gradient(#e5e7eb_1px,transparent_1px),linear-gradient(90deg,#e5e7eb_1px,transparent_1px)] bg-[length:auto,24px_24px,24px_24px]" />
      <div className="absolute left-5 top-4 z-20 flex items-center gap-3 rounded-[14px] border border-black/5 bg-white/92 px-3 py-2 shadow-[0_8px_30px_-22px_rgba(15,23,42,0.68)] backdrop-blur-xl">
        <button type="button" aria-label="返回" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </button>
        <span className="h-5 w-px bg-slate-200" />
        <span className="rounded-md px-2 py-1 text-sm font-medium text-slate-900">{state.title}</span>
      </div>
      <div className="absolute right-5 top-4 z-20 flex items-center gap-2">
        <button type="button" className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white" onClick={openGeneration} disabled={!canGenerate}>
          <Sparkles className="size-4" />
          继续生成
        </button>
      </div>
      <InfiniteCanvasSurface state={state} onSelectNode={selectNode} onMoveNode={moveNode} onOpenGeneration={openGenerationForNode} onViewportChange={updateViewport} />
      <CanvasToolbar canGenerate={canGenerate} canDelete={Boolean(state.selectedNodeId)} onAddText={() => addTextNode(createNodePosition())} onAddImage={() => addImageNode({ position: createNodePosition(), imageUrl: "", title: "图片节点" })} onDelete={deleteSelectedNode} onOpenGeneration={openGeneration} />
      <CanvasZoomControls zoom={state.viewport.zoom} onFitView={() => updateViewport({ x: 0, y: 0, zoom: 1 })} />
      <button type="button" data-cola-action="canvas-ai-entry" className="absolute bottom-[72px] right-6 z-20 grid size-11 place-items-center rounded-full bg-gradient-to-br from-violet-400 via-fuchsia-400 to-sky-400 text-white shadow-[0_14px_32px_-18px_rgba(124,58,237,0.8)]" onClick={openGeneration} disabled={!canGenerate}>
        <Bot className="size-5" />
      </button>
      <CanvasGenerationDrawer open={drawerOpen} selectedNode={selectedNode} prompt={prompt} submitting={submitting} onPromptChange={setPrompt} onClose={() => setDrawerOpen(false)} onSubmit={handleSubmitGeneration} />
    </main>
  );
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-workspace.test.tsx
```

Expected: PASS，新增工作区测试通过。

### Task 4: 接入 ColaAI 工作台并删除内联画布壳层

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: 更新测试断言**

修改 `cola-ai-workbench.test.tsx` 中 `renders the canvas workspace shell` 测试为：

```tsx
test("renders the interactive canvas workspace shell", () => {
  const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="canvas" />);

  expect(markup).toContain('data-cola-mode="canvas"');
  expect(markup).toContain('data-cola-panel="canvas-workspace"');
  expect(markup).toContain('data-cola-canvas="immersive-light"');
  expect(markup).toContain('data-cola-panel="canvas-toolbar"');
  expect(markup).toContain('data-cola-panel="canvas-zoom-controls"');
  expect(markup).toContain('data-cola-action="canvas-ai-entry"');
  expect(markup).toContain("未命名画布");
  expect(markup).toContain("创意提示词");
  expect(markup).toContain("参考图片");
  expect(markup).toContain("AI 生图结果");
  expect(markup).toContain("继续生成");
});
```

- [ ] **Step 2: 运行测试确认失败或仍引用旧壳层**

Run:

```bash
cd web && bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx
```

Expected: FAIL，缺少新的 `data-cola-canvas="immersive-light"` 或工具条标记。

- [ ] **Step 3: 修改工作台导入并删除内联函数**

在 `web/src/app/ColaAI/components/cola-ai-workbench.tsx` 顶部 imports 中加入：

```ts
import { CanvasWorkspace } from "./canvas-workspace";
```

删除旧的内联 `function CanvasWorkspace({ onBack }: { onBack: () => void }) { ... }` 整段。保留底部原有调用：

```tsx
{mode === "canvas" && <CanvasWorkspace onBack={() => setMode("discover")} />}
```

如果删除后 lucide 图标 import 出现未使用，移除仅旧画布使用的 `ArrowLeft`、`ImagePlus`、`Type`、`Video` 中不再被本文件使用的项；不要删除其他工作台仍在使用的图标。

- [ ] **Step 4: 运行工作台测试确认通过**

Run:

```bash
cd web && bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx
```

Expected: PASS，所有 ColaAI 工作台测试通过。

### Task 5: 继续生成接入现有生图 API

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [ ] **Step 1: 扩展生成抽屉测试**

在 `canvas-workspace.test.tsx` 增加：

```tsx
test("generation drawer exposes prompt and reference node flow", () => {
  const state = createInitialCanvasState();
  const markup = renderToStaticMarkup(
    <CanvasGenerationDrawer open selectedNode={state.nodes[1]} prompt="基于参考图继续生成" onPromptChange={() => undefined} onClose={() => undefined} onSubmit={() => undefined} submitting={false} />,
  );

  expect(markup).toContain("参考节点：参考图片");
  expect(markup).toContain("基于参考图继续生成");
  expect(markup).toContain("基于节点继续生成");
});
```

- [ ] **Step 2: 修改 `CanvasWorkspace` 生成提交**

在 `canvas-workspace.tsx` 中导入：

```ts
import { createImageGenerationTask } from "@/lib/api";
```

将 `handleSubmitGeneration` 替换为：

```ts
async function handleSubmitGeneration() {
  if (!selectedNode) {
    return;
  }
  setSubmitting(true);
  try {
    const clientTaskId = `canvas-${Date.now().toString(36)}`;
    const task = await createImageGenerationTask(clientTaskId, prompt);
    const imageUrl = task.data?.find((item) => item.url)?.url ?? selectedNode.imageUrl ?? "";
    appendGenerationNode(selectedNode.id, {
      prompt,
      imageUrl,
      sourceTaskId: task.id,
    });
    setDrawerOpen(false);
  } finally {
    setSubmitting(false);
  }
}
```

并把抽屉传参保持为：

```tsx
<CanvasGenerationDrawer open={drawerOpen} selectedNode={selectedNode} prompt={prompt} submitting={submitting} onPromptChange={setPrompt} onClose={() => setDrawerOpen(false)} onSubmit={handleSubmitGeneration} />
```

- [ ] **Step 3: 运行相关测试**

Run:

```bash
cd web && bun test src/app/ColaAI/components/canvas-workspace.test.tsx src/app/ColaAI/components/cola-ai-workbench.test.tsx
```

Expected: PASS，画布与工作台测试通过。

### Task 6: 类型检查、构建和浏览器验证

**Files:**
- Modify if needed: files touched by earlier tasks only.

- [ ] **Step 1: 运行前端类型检查**

Run:

```bash
cd web && bun run typecheck
```

Expected: PASS，无 TypeScript 错误。

- [ ] **Step 2: 运行前端 lint**

Run:

```bash
cd web && bun run lint
```

Expected: PASS，无 ESLint 错误。

- [ ] **Step 3: 运行画布相关测试**

Run:

```bash
cd web && bun test src/app/ColaAI/components/use-canvas-store.test.ts src/app/ColaAI/components/canvas-workspace.test.tsx src/app/ColaAI/components/cola-ai-workbench.test.tsx
```

Expected: PASS，所有画布与 ColaAI 工作台测试通过。

- [ ] **Step 4: 启动本地前端**

Run:

```bash
cd web && bun run dev
```

Expected: Next.js dev server 启动并显示本地访问地址。

- [ ] **Step 5: 浏览器验证主流程**

在浏览器打开 `/ColaAI`，进入画布模式后验证：

1. 页面显示浅色网格、淡紫光晕、顶部标题、底部工具条、左下缩放控件和右下 AI 入口。
2. 点击文本节点工具，画布新增文本节点。
3. 点击图片节点工具，画布新增图片节点。
4. 拖拽节点，节点位置变化。
5. 滚轮缩放，左下角百分比变化。
6. 选中图片节点，点击继续生成入口，右侧抽屉打开。
7. 输入提示词并提交，生成成功后画布追加结果节点并自动连线。
8. 刷新页面，节点、连线和视口状态恢复。

Expected: 8 项均通过；如 API 无可用生成结果，记录为环境限制，但状态追加逻辑的自动测试必须通过。

## 自审结果

- 规格覆盖：任务 1 覆盖状态模型和本地持久化；任务 2 覆盖节点、连线、工具条、缩放控件和抽屉；任务 3 覆盖全屏沉浸式画布、平移缩放和工作区装配；任务 4 覆盖 ColaAI 集成；任务 5 覆盖继续生成；任务 6 覆盖验证。
- 占位扫描：计划不包含 TBD、TODO 或未定义占位实现；所有新增文件和函数均在任务中定义。
- 类型一致性：`CanvasNodeData`、`CanvasConnectionData`、`CanvasState`、`CanvasViewport`、`CanvasGenerationPayload` 在后续任务中沿用同一命名。
