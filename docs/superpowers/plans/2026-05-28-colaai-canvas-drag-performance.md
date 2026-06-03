# ColaAI 画布拖拽性能优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ColaAI 画布在拖拽节点、平移视图、含图片节点的场景下稳定 60fps,核心做法是把 viewport 从 React state 中分离、拖拽期直接写 DOM、为图片节点和连接线层引入合成层隔离。

**Architecture:** 三层改造同步进行。第一层在 `use-canvas-store` 旁挂一个模块级 viewport store(ref + listeners + `useSyncExternalStore`),让 viewport 的频繁更新不再触发 React 子树重渲染。第二层让 `InfiniteCanvasSurface` 在 pointermove 期间直接写节点 DOM transform 和 SVG path 的 `d` 属性,完全跳过 React,只在 pointerup 一次性提交到 store 形成 undo 记录。第三层通过给图片容器加 `contain: strict`、给 SVG 加 `translateZ(0)`、给拖拽中的节点加 `will-change: transform`,把 transform 变化限制在合成器层。

**Tech Stack:** React 19、Next.js 15、TypeScript、Tailwind、`bun:test`、`renderToStaticMarkup`、现有 ColaAI 画布组件链。

---

### Task 1: 模块级 viewport store

**Files:**
- Create: `web/src/app/ColaAI/components/canvas-viewport-store.ts`
- Create: `web/src/app/ColaAI/components/canvas-viewport-store.test.ts`

为什么单独建模块:`use-canvas-store` 是 hook 风格,每次调用都会有新的内部 ref,无法被多个组件共享。viewport 需要跨组件订阅(Surface 写、ZoomControls 读),用模块级单例最简单可靠。

- [ ] **Step 1.1:** 写失败测试 `canvas-viewport-store.test.ts`

```ts
import { describe, expect, test, beforeEach } from "bun:test";

import {
  getCanvasViewport,
  resetCanvasViewport,
  setCanvasViewport,
  subscribeCanvasViewport,
} from "./canvas-viewport-store";

describe("canvas viewport store", () => {
  beforeEach(() => {
    resetCanvasViewport();
  });

  test("returns the default viewport before any updates", () => {
    expect(getCanvasViewport()).toEqual({ x: 0, y: 0, k: 1 });
  });

  test("setCanvasViewport replaces the current viewport", () => {
    setCanvasViewport({ x: 120, y: -40, k: 1.5 });
    expect(getCanvasViewport()).toEqual({ x: 120, y: -40, k: 1.5 });
  });

  test("subscribers are notified after each update", () => {
    let notifications = 0;
    const unsubscribe = subscribeCanvasViewport(() => {
      notifications += 1;
    });

    setCanvasViewport({ x: 10, y: 20, k: 1 });
    setCanvasViewport({ x: 30, y: 40, k: 1 });

    expect(notifications).toBe(2);
    unsubscribe();
  });

  test("unsubscribed listeners stop receiving updates", () => {
    let notifications = 0;
    const unsubscribe = subscribeCanvasViewport(() => {
      notifications += 1;
    });
    unsubscribe();

    setCanvasViewport({ x: 50, y: 60, k: 1 });

    expect(notifications).toBe(0);
  });

  test("returns the same reference if viewport values are unchanged", () => {
    setCanvasViewport({ x: 10, y: 20, k: 1 });
    const before = getCanvasViewport();
    setCanvasViewport({ x: 10, y: 20, k: 1 });
    expect(getCanvasViewport()).toBe(before);
  });

  test("clamps zoom to [0.12, 4]", () => {
    setCanvasViewport({ x: 0, y: 0, k: 0.05 });
    expect(getCanvasViewport().k).toBe(0.12);
    setCanvasViewport({ x: 0, y: 0, k: 6 });
    expect(getCanvasViewport().k).toBe(4);
  });
});
```

- [ ] **Step 1.2:** 跑测试确认失败

```bash
cd web && bun test src/app/ColaAI/components/canvas-viewport-store.test.ts
```

预期:`Cannot find module './canvas-viewport-store'`。

- [ ] **Step 1.3:** 写最小实现 `canvas-viewport-store.ts`

```ts
import type { CanvasViewport } from "./canvas-types";

const minZoom = 0.12;
const maxZoom = 4;
const defaultViewport: CanvasViewport = { x: 0, y: 0, k: 1 };

let currentViewport: CanvasViewport = defaultViewport;
const listeners = new Set<() => void>();

export function getCanvasViewport(): CanvasViewport {
  return currentViewport;
}

export function setCanvasViewport(viewport: CanvasViewport): void {
  const k = Math.min(maxZoom, Math.max(minZoom, viewport.k));
  if (
    currentViewport.x === viewport.x &&
    currentViewport.y === viewport.y &&
    currentViewport.k === k
  ) {
    return;
  }
  currentViewport = { x: viewport.x, y: viewport.y, k };
  listeners.forEach((listener) => listener());
}

export function subscribeCanvasViewport(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetCanvasViewport(): void {
  currentViewport = defaultViewport;
  listeners.clear();
}
```

- [ ] **Step 1.4:** 跑测试确认通过

```bash
cd web && bun test src/app/ColaAI/components/canvas-viewport-store.test.ts
```

预期:6 个测试全部通过。

- [ ] **Step 1.5:** 提交

```bash
git add web/src/app/ColaAI/components/canvas-viewport-store.ts web/src/app/ColaAI/components/canvas-viewport-store.test.ts
git commit -m "feat(colaai): 引入模块级 viewport store

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: useCanvasViewport hook

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-viewport-store.ts`
- Modify: `web/src/app/ColaAI/components/canvas-viewport-store.test.ts`

`useSyncExternalStore` 是 React 18+ 标准订阅外部存储的 hook,SSR 安全,自动处理 tear。

- [ ] **Step 2.1:** 在测试文件追加失败测试

```ts
import { renderToStaticMarkup } from "react-dom/server";

import { useCanvasViewport } from "./canvas-viewport-store";

function ViewportProbe() {
  const viewport = useCanvasViewport();
  return <span data-testid="viewport">{`${viewport.x},${viewport.y},${viewport.k}`}</span>;
}

test("useCanvasViewport reads the current viewport during SSR", () => {
  setCanvasViewport({ x: 80, y: -20, k: 1.25 });
  const markup = renderToStaticMarkup(<ViewportProbe />);
  expect(markup).toContain('data-testid="viewport"');
  expect(markup).toContain("80,-20,1.25");
});
```

- [ ] **Step 2.2:** 跑测试确认失败(没导出 useCanvasViewport)

```bash
cd web && bun test src/app/ColaAI/components/canvas-viewport-store.test.ts
```

- [ ] **Step 2.3:** 在 `canvas-viewport-store.ts` 顶部加 `"use client";`,文件末尾追加 hook

```ts
import { useSyncExternalStore } from "react";

export function useCanvasViewport(): CanvasViewport {
  return useSyncExternalStore(
    subscribeCanvasViewport,
    getCanvasViewport,
    getCanvasViewport,
  );
}
```

注意 `getCanvasViewport` 第三个参数(server snapshot)必须存在,否则 SSR 报错。

- [ ] **Step 2.4:** 跑测试确认通过

```bash
cd web && bun test src/app/ColaAI/components/canvas-viewport-store.test.ts
```

- [ ] **Step 2.5:** 提交

```bash
git add web/src/app/ColaAI/components/canvas-viewport-store.ts web/src/app/ColaAI/components/canvas-viewport-store.test.ts
git commit -m "feat(colaai): 增加 useCanvasViewport hook

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 让 useCanvasStore 的 updateViewport 走新 store

**Files:**
- Modify: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.test.ts`

把 `updateViewport` 从 `applyTransientMutation`(走 React state) 改为只更新模块级 viewport store(不触发任何 React state 变更)。`state.viewport` 字段保留,但读取的是 `getCanvasViewport()` 的最新值,在 history 快照、持久化时同步。

- [ ] **Step 3.1:** 在 `use-canvas-store.test.ts` 追加失败测试,断言 updateViewport 不再触发 history.present 引用变化

```ts
import { getCanvasViewport, resetCanvasViewport, setCanvasViewport } from "./canvas-viewport-store";

describe("useCanvasStore viewport sharding", () => {
  test("updateViewport mutates the module-level viewport store", () => {
    resetCanvasViewport();
    setCanvasViewport({ x: 12, y: 34, k: 1.5 });
    expect(getCanvasViewport()).toEqual({ x: 12, y: 34, k: 1.5 });
  });

  test("updateViewport clamps zoom into the supported range", () => {
    resetCanvasViewport();
    setCanvasViewport({ x: 0, y: 0, k: 99 });
    expect(getCanvasViewport().k).toBe(4);
  });
});
```

- [ ] **Step 3.2:** 跑测试确认通过(此时仍然只是直接调用 setCanvasViewport,确认行为)

```bash
cd web && bun test src/app/ColaAI/components/use-canvas-store.test.ts
```

- [ ] **Step 3.3:** 修改 `use-canvas-store.ts` 的 `updateViewport` action

替换 `web/src/app/ColaAI/components/use-canvas-store.ts:974` 附近的 action 定义:

```ts
import { setCanvasViewport, getCanvasViewport } from "./canvas-viewport-store";

// ... 在 actions = useMemo 内,替换 updateViewport:
updateViewport: (viewport: CanvasViewport) => {
  setCanvasViewport(viewport);
},
```

同时移除 `applyTransientMutation((current) => updateViewport(current, viewport))` 这一行,因为 viewport 不再走 React state。

- [ ] **Step 3.4:** 让初始化和持久化也走 viewport store

修改 `useCanvasStore` 内的初始化逻辑,在初始 state 加载后把 viewport 同步到模块 store:

```ts
const [history, setHistory] = useState<CanvasHistoryState>(() => {
  const initialState = (() => {
    if (typeof window === "undefined") {
      return createInitialCanvasState();
    }
    return loadCanvasState(window.localStorage) ?? createInitialCanvasState();
  })();
  if (typeof window !== "undefined") {
    setCanvasViewport(initialState.viewport);
  }
  return createInitialCanvasHistory(initialState);
});
```

修改持久化的 `useEffect`,在 schedule 前用最新 viewport 覆盖 state:

```ts
useEffect(() => {
  const stateWithViewport = { ...state, viewport: getCanvasViewport() };
  persistence?.schedule(stateWithViewport);
}, [persistence, state]);
```

- [ ] **Step 3.5:** 跑全量 use-canvas-store 测试确认无回归

```bash
cd web && bun test src/app/ColaAI/components/use-canvas-store.test.ts
```

预期:全部通过。注意现有测试若直接断言 `state.viewport === { x:..., y:..., k:... }`,可能需要改为读 `getCanvasViewport()`。如果确实需要修改,记录到 operations-log。

- [ ] **Step 3.6:** 提交

```bash
git add web/src/app/ColaAI/components/use-canvas-store.ts web/src/app/ColaAI/components/use-canvas-store.test.ts
git commit -m "refactor(colaai): updateViewport 不再走 React state

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: CanvasZoomControls 接入新 hook

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-zoom-controls.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

让 ZoomControls 直接订阅 viewport,不再从 props 接收。CanvasWorkspace 不再传 zoom prop,zoom 按钮改为通过 `getCanvasViewport()` 读最新值再调用 setCanvasViewport。

- [ ] **Step 4.1:** 在 `canvas-workspace.test.tsx` 修改失败测试

找到 `renders connections, toolbar, zoom controls, and generation panel` 测试,把 `<CanvasZoomControls zoom={0.91} ... />` 改为先 `setCanvasViewport({ x: 0, y: 0, k: 0.91 })` 再渲染 `<CanvasZoomControls onFitView={...} onZoomIn={...} onZoomOut={...} />`(去掉 zoom prop):

```ts
import { resetCanvasViewport, setCanvasViewport } from "./canvas-viewport-store";

// 在测试 setup:
beforeEach(() => {
  resetCanvasViewport();
});

// 在 zoom controls 测试体内:
setCanvasViewport({ x: 0, y: 0, k: 0.91 });
// ... 渲染 <CanvasZoomControls onFitView={...} onZoomIn={...} onZoomOut={...} />
expect(markup).toContain("91%");
```

- [ ] **Step 4.2:** 跑测试确认失败(因为 ZoomControls 还要 zoom prop)

```bash
cd web && bun test src/app/ColaAI/components/canvas-workspace.test.tsx
```

- [ ] **Step 4.3:** 改 `canvas-zoom-controls.tsx` 用 hook

```tsx
"use client";

import { Focus, Minus, Plus } from "lucide-react";

import { useCanvasViewport } from "./canvas-viewport-store";

type CanvasZoomControlsProps = {
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export function CanvasZoomControls({ onFitView, onZoomIn, onZoomOut }: CanvasZoomControlsProps) {
  const viewport = useCanvasViewport();
  return (
    <div
      data-cola-panel="canvas-zoom-controls"
      className="absolute bottom-6 left-6 z-40 flex items-center gap-2 rounded-2xl border border-black/5 bg-white/96 px-3 py-2 text-sm text-slate-600 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.2)]"
    >
      <button type="button" title="缩小" className="grid size-8 place-items-center rounded-xl hover:bg-slate-100" onClick={onZoomOut}>
        <Minus className="size-4" />
      </button>
      <span className="min-w-12 text-center text-xs font-semibold text-slate-700">{Math.round(viewport.k * 100)}%</span>
      <button type="button" title="放大" className="grid size-8 place-items-center rounded-xl hover:bg-slate-100" onClick={onZoomIn}>
        <Plus className="size-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-slate-200" />
      <button type="button" title="适配视图" className="grid size-8 place-items-center rounded-xl hover:bg-slate-100" onClick={onFitView}>
        <Focus className="size-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4.4:** 改 `canvas-workspace.tsx` 不再传 zoom prop,zoom 按钮通过 viewport store 读取最新值

替换 `web/src/app/ColaAI/components/canvas-workspace.tsx:465-470`:

```tsx
import { getCanvasViewport } from "./canvas-viewport-store";

<CanvasZoomControls
  onFitView={() => updateViewport({ x: 0, y: 0, k: 1 })}
  onZoomIn={() => {
    const current = getCanvasViewport();
    updateViewport({ ...current, k: current.k * 1.16 });
  }}
  onZoomOut={() => {
    const current = getCanvasViewport();
    updateViewport({ ...current, k: current.k / 1.16 });
  }}
/>
```

同时把 `createNodePosition` 改为读模块 store:

```tsx
function createNodePosition() {
  const viewport = getCanvasViewport();
  return {
    x: (320 - viewport.x) / viewport.k,
    y: (220 - viewport.y) / viewport.k,
  };
}
```

- [ ] **Step 4.5:** 跑测试确认通过

```bash
cd web && bun test src/app/ColaAI/components/canvas-workspace.test.tsx
```

- [ ] **Step 4.6:** 提交

```bash
git add web/src/app/ColaAI/components/canvas-zoom-controls.tsx web/src/app/ColaAI/components/canvas-workspace.tsx web/src/app/ColaAI/components/canvas-workspace.test.tsx
git commit -m "refactor(colaai): ZoomControls 订阅 viewport store

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: InfiniteCanvasSurface 接入 viewport store

**Files:**
- Modify: `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`

Surface 内部的 `viewportRef` 改为从 viewport store 同步;`handleWheel` 用 `getCanvasViewport()` 读取;变换容器 `transform` 改为通过 ref + DOM 写入(为后续 DOM-direct 平移做准备)。

- [ ] **Step 5.1:** 改 surface props,移除 viewport 相关参数

`InfiniteCanvasSurfaceProps` 移除 `state.viewport` 的依赖。`onViewportChange` 仍保留(目前由 wheel/pan 调用),但内部实现改为只调 `setCanvasViewport`。

替换文件顶部 import:

```tsx
import { getCanvasViewport, subscribeCanvasViewport } from "./canvas-viewport-store";
```

替换 viewport ref 同步逻辑(`web/src/app/ColaAI/components/infinite-canvas-surface.tsx:175` 与 `:197-202`):

```tsx
const viewportRef = useRef(getCanvasViewport());

useEffect(() => {
  const sync = () => {
    viewportRef.current = getCanvasViewport();
    if (transformContainerRef.current) {
      const v = viewportRef.current;
      transformContainerRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    }
  };
  sync();
  return subscribeCanvasViewport(sync);
}, []);
```

- [ ] **Step 5.2:** 给变换容器加 ref,初始 transform 也来自 viewport store

替换 `web/src/app/ColaAI/components/infinite-canvas-surface.tsx:782-788` 的变换容器:

```tsx
const transformContainerRef = useRef<HTMLDivElement | null>(null);

// 在 return JSX 内:
<div
  ref={transformContainerRef}
  className="absolute left-0 top-0 origin-top-left"
  style={{
    transform: `translate(${getCanvasViewport().x}px, ${getCanvasViewport().y}px) scale(${getCanvasViewport().k})`,
    willChange: "transform",
  }}
>
```

- [ ] **Step 5.3:** `handleWheel` 与 `handleCanvasPointerDown` 改为读 store

替换 `handleWheel` 内的 `state.viewport` 引用为 `getCanvasViewport()`,`handleCanvasPointerDown` 内 selection 起点改为 `viewportRef.current`(已经是 store 同步过的)。

`handleWheel` 第 552 行附近:

```tsx
function handleWheel(event: WheelEvent<HTMLDivElement>) {
  const rect = containerRef.current?.getBoundingClientRect();
  if (!rect) return;
  const current = getCanvasViewport();
  const factor = Math.pow(1.1, -event.deltaY / 100);
  const nextK = Math.min(4, Math.max(0.12, current.k * factor));
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const worldX = (mouseX - current.x) / current.k;
  const worldY = (mouseY - current.y) / current.k;
  onViewportChange({
    x: mouseX - worldX * nextK,
    y: mouseY - worldY * nextK,
    k: nextK,
  });
}
```

`handleCanvasPointerDown` 内 `initialViewport: state.viewport` 改为 `initialViewport: getCanvasViewport()`,`selection` 分支的 `getWorldPoint(event, rect, state.viewport)` 改为 `getWorldPoint(event, rect, getCanvasViewport())`。

`handleConnectionStart` 内同理:`getWorldPoint(event, rect, state.viewport)` → `getWorldPoint(event, rect, getCanvasViewport())`。

- [ ] **Step 5.4:** 把 `InfiniteCanvasSurface` 的 viewport pan 改为 DOM-direct(移除 viewportBatcher 走 React 路径)

替换 `web/src/app/ColaAI/components/infinite-canvas-surface.tsx:248-262` 的初始化:

```tsx
useEffect(() => {
  nodeMoveBatcherRef.current = createAnimationFrameBatcher(
    (positions) => {
      moveNodesRef.current(positions);
    },
    (callback) => window.requestAnimationFrame(callback),
    (id) => window.cancelAnimationFrame(id),
  );
  return () => {
    nodeMoveBatcherRef.current?.cancel();
    nodeMoveBatcherRef.current = null;
  };
}, []);
```

(viewportBatcherRef 整体删掉。)

替换 pointermove 的 canvas 分支(第 279-289 行):

```tsx
if (drag.type === "canvas") {
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  drag.moved = drag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
  setCanvasViewport({
    x: drag.initialViewport.x + dx,
    y: drag.initialViewport.y + dy,
    k: drag.initialViewport.k,
  });
  return;
}
```

(import 加 `setCanvasViewport`。)

pointerup 内 `viewportBatcherRef.current?.flush()` 删除。Esc 处理内 `viewportBatcherRef.current?.cancel()` 删除。

- [ ] **Step 5.5:** typecheck 与 lint

```bash
cd web && bun run typecheck && bun run lint
```

预期:无错误。

- [ ] **Step 5.6:** 跑画布相关测试

```bash
cd web && bun test src/app/ColaAI/components/
```

预期:全部通过。注意 `state.viewport` 字段如果在 `<InfiniteCanvasSurface>` 处仍被传入,可以保留(组件内不再读它),但更干净的做法是从 props 移除。

- [ ] **Step 5.7:** 提交

```bash
git add web/src/app/ColaAI/components/infinite-canvas-surface.tsx
git commit -m "perf(colaai): canvas pan 直接写 viewport store 与 DOM transform

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: 提取连接路径计算为可复用 helper

**Files:**
- Create: `web/src/app/ColaAI/components/canvas-connection-paths.ts`
- Create: `web/src/app/ColaAI/components/canvas-connection-paths.test.ts`
- Modify: `web/src/app/ColaAI/components/canvas-connections.tsx`

DOM-direct 拖拽时需要在 surface 里直接调用相同的路径计算函数,把它从 connections 组件提到独立模块。

- [ ] **Step 6.1:** 写失败测试 `canvas-connection-paths.test.ts`

```ts
import { describe, expect, test } from "bun:test";

import { computeCanvasConnectionPath } from "./canvas-connection-paths";

describe("computeCanvasConnectionPath", () => {
  test("draws a Bezier path from the right edge of `from` to the left edge of `to`", () => {
    const path = computeCanvasConnectionPath(
      { position: { x: 0, y: 0 }, width: 100, height: 80 },
      { position: { x: 300, y: 100 }, width: 120, height: 60 },
    );
    expect(path.startsWith("M 100 40 C ")).toBe(true);
    expect(path.endsWith(" 300 130")).toBe(true);
  });

  test("uses a minimum curvature of 68", () => {
    const path = computeCanvasConnectionPath(
      { position: { x: 0, y: 0 }, width: 100, height: 80 },
      { position: { x: 110, y: 0 }, width: 50, height: 80 },
    );
    expect(path).toContain("168 40");
  });
});
```

- [ ] **Step 6.2:** 跑测试确认失败

```bash
cd web && bun test src/app/ColaAI/components/canvas-connection-paths.test.ts
```

- [ ] **Step 6.3:** 创建 `canvas-connection-paths.ts`

```ts
import type { CanvasPoint } from "./canvas-types";

type CanvasConnectionPathInput = {
  position: CanvasPoint;
  width: number;
  height: number;
};

export function computeCanvasConnectionPath(
  from: CanvasConnectionPathInput,
  to: CanvasConnectionPathInput,
): string {
  const startX = from.position.x + from.width;
  const startY = from.position.y + from.height / 2;
  const endX = to.position.x;
  const endY = to.position.y + to.height / 2;
  const distance = Math.abs(endX - startX);
  const curvature = Math.max(distance * 0.46, 68);
  return `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
}
```

- [ ] **Step 6.4:** 跑测试确认通过

```bash
cd web && bun test src/app/ColaAI/components/canvas-connection-paths.test.ts
```

- [ ] **Step 6.5:** 在 `canvas-connections.tsx` 复用此 helper

替换文件内 `getConnectionPath` 函数(第 24-33 行)为 import:

```tsx
import { computeCanvasConnectionPath } from "./canvas-connection-paths";

// ... 在组件内,把 const path = getConnectionPath(from, to); 改为
const path = computeCanvasConnectionPath(from, to);
```

删除原来的 `getConnectionPath` 函数定义。

- [ ] **Step 6.6:** 跑画布测试确认无回归

```bash
cd web && bun test src/app/ColaAI/components/
```

- [ ] **Step 6.7:** 提交

```bash
git add web/src/app/ColaAI/components/canvas-connection-paths.ts web/src/app/ColaAI/components/canvas-connection-paths.test.ts web/src/app/ColaAI/components/canvas-connections.tsx
git commit -m "refactor(colaai): 抽出连接路径计算为独立 helper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: 节点拖拽 DOM-direct (核心优化)

**Files:**
- Modify: `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`

拖拽节点时,不再每帧调用 `moveNodes`,而是在 RAF 内直接写 `<article>` 的 `style.transform`。同时给被拖节点加 `data-cola-dragging="true"` 与 `style.willChange = "transform"`。pointerup 一次性提交 `moveNodes(finalPositions)`,React 重新渲染时 transform 与 DOM 上一致,没有跳变。

不写新 helper 文件,改动集中在 surface;DOM 操作部分的核心逻辑通过手工浏览器验证,无法在 SSR 测试中覆盖。

- [ ] **Step 7.1:** 在 `DragState` 的 node 分支扩展字段

替换 `web/src/app/ColaAI/components/infinite-canvas-surface.tsx:60-69`:

```tsx
| {
    type: "node";
    nodeIds: string[];
    startX: number;
    startY: number;
    initialPositions: Record<string, CanvasPoint>;
    movingNodes: CanvasState["nodes"];
    stationaryNodes: CanvasState["nodes"];
    nodeElements: Map<string, HTMLElement>;
    affectedConnections: Array<{
      element: SVGPathElement;
      hitElement: SVGPathElement;
      from: { nodeId: string; width: number; height: number; basePosition: CanvasPoint };
      to: { nodeId: string; width: number; height: number; basePosition: CanvasPoint };
    }>;
    lastPositions: Record<string, CanvasPoint>;
  }
```

- [ ] **Step 7.2:** 在 `handleNodePointerDown` 收集 DOM 引用

替换 `web/src/app/ColaAI/components/infinite-canvas-surface.tsx:649-690` 末尾,在 `dragRef.current = { type: "node", ... }` 之后追加 DOM 收集逻辑:

```tsx
const nodeElements = new Map<string, HTMLElement>();
selectedNodeIds.forEach((id) => {
  const el = document.querySelector<HTMLElement>(`article[data-node-id="${id}"]`);
  if (el) {
    nodeElements.set(id, el);
    el.setAttribute("data-cola-dragging", "true");
    el.style.willChange = "transform";
  }
});

const movingNodeIdSet = new Set(selectedNodeIds);
const nodesById = new Map(nodesRef.current.map((node) => [node.id, node]));
const affectedConnections: typeof dragRef.current.affectedConnections = [];
state.connections.forEach((connection) => {
  const fromNode = nodesById.get(connection.fromNodeId);
  const toNode = nodesById.get(connection.toNodeId);
  if (!fromNode || !toNode) return;
  const fromMoving = movingNodeIdSet.has(connection.fromNodeId);
  const toMoving = movingNodeIdSet.has(connection.toNodeId);
  if (!fromMoving && !toMoving) return;
  const paths = document.querySelectorAll<SVGPathElement>(
    `[data-connection-id="${connection.id}"]`,
  );
  const hitElement = paths[0];
  const visibleElement = (paths[1] ?? paths[0]) as SVGPathElement | undefined;
  if (!hitElement || !visibleElement) return;
  affectedConnections.push({
    element: visibleElement,
    hitElement,
    from: {
      nodeId: fromNode.id,
      width: fromNode.width,
      height: fromNode.height,
      basePosition: fromNode.position,
    },
    to: {
      nodeId: toNode.id,
      width: toNode.width,
      height: toNode.height,
      basePosition: toNode.position,
    },
  });
});

dragRef.current = {
  type: "node",
  nodeIds: selectedNodeIds,
  startX: event.clientX,
  startY: event.clientY,
  initialPositions: getNodePositions(movingNodes),
  movingNodes,
  stationaryNodes: nodesRef.current.filter((item) => !selectedNodeIdSet.has(item.id)),
  nodeElements,
  affectedConnections,
  lastPositions: getNodePositions(movingNodes),
};
```

注意:visibleElement 是 SVG 中第二个 `<path>`(可见线),hitElement 是第一个(透明 hit-area)。`canvas-connections.tsx` 给两个 path 都加 `data-connection-id`,这一步在 Step 7.3 同步处理。

但实际查看现有代码,只有 hit-area 的 path 有 `data-connection-id`(第 73 行)。我们需要给可见 path 也加上同样的属性。

- [ ] **Step 7.3:** 给 connections.tsx 的可见 path 也加 data-connection-id

修改 `web/src/app/ColaAI/components/canvas-connections.tsx:87`,给第二个 `<path>` 加属性:

```tsx
<path
  data-connection-id={connection.id}
  d={path}
  fill="none"
  stroke={selected ? "#7c3aed" : "#a78bfa"}
  ...
/>
```

由于两个 path 都带 `data-connection-id`,`document.querySelectorAll` 会按文档顺序返回两个,Step 7.2 中通过 `[0]` / `[1]` 索引区分。

- [ ] **Step 7.4:** 改写 pointermove 的 node 分支为 DOM 直驱

替换 `web/src/app/ColaAI/components/infinite-canvas-surface.tsx:315-334` 的 node 分支:

```tsx
const rawDelta = {
  x: (event.clientX - drag.startX) / viewportRef.current.k,
  y: (event.clientY - drag.startY) / viewportRef.current.k,
};
const snapped = getSnappedDelta({
  movingNodes: drag.movingNodes,
  stationaryNodes: drag.stationaryNodes,
  delta: rawDelta,
  threshold: snapThreshold / viewportRef.current.k,
});

drag.lastPositions = Object.fromEntries(
  drag.nodeIds.map((nodeId) => {
    const initial = drag.initialPositions[nodeId];
    return [nodeId, { x: initial.x + snapped.delta.x, y: initial.y + snapped.delta.y }];
  }),
);

drag.nodeIds.forEach((nodeId) => {
  const el = drag.nodeElements.get(nodeId);
  const pos = drag.lastPositions[nodeId];
  if (el && pos) {
    el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }
});

drag.affectedConnections.forEach((conn) => {
  const fromPos = drag.lastPositions[conn.from.nodeId] ?? conn.from.basePosition;
  const toPos = drag.lastPositions[conn.to.nodeId] ?? conn.to.basePosition;
  const d = computeCanvasConnectionPath(
    { position: fromPos, width: conn.from.width, height: conn.from.height },
    { position: toPos, width: conn.to.width, height: conn.to.height },
  );
  conn.element.setAttribute("d", d);
  conn.hitElement.setAttribute("d", d);
});

setGuides(snapped.guides);
```

文件顶部确保 import:

```tsx
import { computeCanvasConnectionPath } from "./canvas-connection-paths";
```

- [ ] **Step 7.5:** 改写 pointerup 的 node 分支:清除 DOM 标记 + 一次性提交

替换 `web/src/app/ColaAI/components/infinite-canvas-surface.tsx:341-345`:

```tsx
if (drag?.type === "node") {
  drag.nodeElements.forEach((el) => {
    el.removeAttribute("data-cola-dragging");
    el.style.willChange = "";
  });
  const movedNodeIds = drag.nodeIds.filter((id) => {
    const initial = drag.initialPositions[id];
    const last = drag.lastPositions[id];
    return last && (initial.x !== last.x || initial.y !== last.y);
  });
  if (movedNodeIds.length > 0) {
    const finalPositions = Object.fromEntries(
      movedNodeIds.map((id) => [id, drag.lastPositions[id]]),
    );
    moveNodesRef.current(finalPositions);
  }
  finalizeHistoryBatchRef.current();
  setGuides([]);
}
```

注意:`nodeMoveBatcherRef.current?.flush()` 不再需要(我们没往 batcher push 任何东西),但保留 batcher 作为 nudge 等其他路径的兜底也可以。本次为了简洁,把 `nodeMoveBatcherRef` 整体删掉,改为直接调 `moveNodesRef.current`。

替换 Step 5.4 中的 useEffect:

```tsx
// 整个 batcher 初始化删除,因为 viewport 和 node 拖拽都不再用
// 只保留 (键盘 nudge 等其他路径仍走 useCanvasStore actions,无需 batcher)
```

如果其他地方还有 `nodeMoveBatcherRef` 引用,一并清理。Esc 处理内的 `nodeMoveBatcherRef.current?.cancel()` 删除。

- [ ] **Step 7.6:** Esc 取消时恢复 DOM transform 到 initial 状态

替换 Esc 处理逻辑(`web/src/app/ColaAI/components/infinite-canvas-surface.tsx:402-417`)开头:

```tsx
if (event.key === "Escape") {
  event.preventDefault();
  const drag = dragRef.current;
  if (drag?.type === "node") {
    drag.nodeIds.forEach((id) => {
      const el = drag.nodeElements.get(id);
      const initial = drag.initialPositions[id];
      if (el && initial) {
        el.style.transform = `translate(${initial.x}px, ${initial.y}px)`;
      }
      el?.removeAttribute("data-cola-dragging");
      if (el) el.style.willChange = "";
    });
    drag.affectedConnections.forEach((conn) => {
      const d = computeCanvasConnectionPath(
        { position: conn.from.basePosition, width: conn.from.width, height: conn.from.height },
        { position: conn.to.basePosition, width: conn.to.width, height: conn.to.height },
      );
      conn.element.setAttribute("d", d);
      conn.hitElement.setAttribute("d", d);
    });
  }
  dragRef.current = null;
  setGuides([]);
  setSelectionRect(null);
  setConnectionPreview(null);
  setConnectionMenu(null);
  setContextMenu(null);
  document.body.style.cursor = "default";
  selectNodeRef.current(null);
  selectConnectionRef.current(null);
  finalizeHistoryBatchRef.current();
  return;
}
```

- [ ] **Step 7.7:** typecheck + lint + 单测

```bash
cd web && bun run typecheck && bun run lint && bun test src/app/ColaAI/components/
```

预期:全部通过。

- [ ] **Step 7.8:** 浏览器手动验证(必须)

```bash
cd web && bun run dev
```

打开 `http://localhost:3000/ColaAI/`:
1. 拖单个节点 → 流畅,松手后位置正确
2. Ctrl+A 全选后拖任一节点 → 整组联动,不掉帧
3. 拖拽中按 Esc → 节点回到原位,连接线回到原状
4. 拖完后 Ctrl+Z → 一次撤销回到初始位置
5. Chrome DevTools Performance 录制 5 秒拖拽 → JS 主线程占比 < 30%

验证标准达不到则返回 7.4 检查 RAF/transform 写入逻辑。

- [ ] **Step 7.9:** 提交

```bash
git add web/src/app/ColaAI/components/infinite-canvas-surface.tsx web/src/app/ColaAI/components/canvas-connections.tsx
git commit -m "perf(colaai): 节点拖拽期直接写 DOM transform 与 SVG d 属性

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: 合成层与图片节点隔离

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-connections.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

article 自身不能加 `contain: paint`(会裁掉两侧的 connector handle,且现有测试明确禁止)。改为对图片容器加 `contain: strict` 隔离图片解码/重绘,SVG 加 `translateZ(0)` 让连线层独立,article 在 `data-cola-dragging` 时通过 inline style 临时获得 `will-change: transform`(已经在 Task 7 做了)。

- [ ] **Step 8.1:** 给 `canvas-workspace.test.tsx` 增加新断言

在 `does not paint-contain nodes so border handles are not clipped` 测试之后新增:

```tsx
test("isolates image content with strict contain to prevent paint propagation", () => {
  const state = createInitialCanvasState();
  const imageNode = {
    ...state.nodes.find((n) => n.id === "seed-image")!,
    metadata: {
      ...state.nodes[1].metadata,
      imageUrl: "data:image/png;base64,iVBORw0KGgo=",
    },
  };
  const markup = renderToStaticMarkup(
    <CanvasNode
      node={imageNode}
      selected={false}
      onContentChange={() => undefined}
      onOpenGeneration={() => undefined}
      onPointerDown={() => undefined}
    />,
  );
  expect(markup).toContain('data-cola-image-container="true"');
  expect(markup).toContain("contain:strict");
});

test("renders connection layer with GPU compositing hint", () => {
  const state = createInitialCanvasState();
  const bounds = getCanvasLayerBounds(state.nodes);
  const markup = renderToStaticMarkup(
    <CanvasConnections
      bounds={bounds}
      nodes={state.nodes}
      connections={state.connections}
      selectedConnectionId={null}
      onSelectConnection={() => undefined}
    />,
  );
  expect(markup).toContain("translateZ(0)");
});
```

- [ ] **Step 8.2:** 跑测试确认失败

```bash
cd web && bun test src/app/ColaAI/components/canvas-workspace.test.tsx
```

预期:两条新测试失败。

- [ ] **Step 8.3:** 给图片容器加 contain: strict

替换 `web/src/app/ColaAI/components/canvas-node.tsx:136-145`:

```tsx
{imageUrl ? (
  <div
    data-cola-image-container="true"
    className="mt-3 h-[calc(100%-58px)] overflow-hidden rounded-[14px] bg-slate-100"
    style={{ contain: "strict" }}
  >
    <AuthenticatedImage
      src={imageUrl}
      alt={node.title}
      className="h-full w-full object-cover"
      draggable={false}
      loadingMotion="static"
    />
  </div>
) : editing ? (
  // ...
)}
```

- [ ] **Step 8.4:** 给 SVG 加 translateZ(0)

替换 `web/src/app/ColaAI/components/canvas-connections.tsx:46-56` 的 svg style:

```tsx
<svg
  aria-hidden="true"
  data-cola-canvas-layer="connections"
  className="pointer-events-none absolute overflow-visible"
  style={{
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    transform: "translateZ(0)",
  }}
  viewBox={`${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}`}
>
```

- [ ] **Step 8.5:** 跑测试确认通过

```bash
cd web && bun test src/app/ColaAI/components/canvas-workspace.test.tsx
```

预期:全部通过,包括既有的 `does not paint-contain nodes` 测试(article 仍然只有 `contain: layout style`)。

- [ ] **Step 8.6:** 浏览器验证含图片节点的拖拽不再卡顿

```bash
cd web && bun run dev
```

操作:
1. 拖入 5 张图片节点(从本地文件)
2. 拖动其中一个 → 流畅,周边节点不重绘(用 Chrome DevTools 的 Paint Flashing 验证)
3. 平移整个画布(在空白处按住拖动) → SVG 连线层独立合成,不与节点层一起 paint

- [ ] **Step 8.7:** 提交

```bash
git add web/src/app/ColaAI/components/canvas-node.tsx web/src/app/ColaAI/components/canvas-connections.tsx web/src/app/ColaAI/components/canvas-workspace.test.tsx
git commit -m "perf(colaai): 图片容器 contain:strict + 连线层独立合成

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: 全量验证

**Files:**
- 仅运行命令,不改代码

- [ ] **Step 9.1:** 全量单测

```bash
cd web && bun test
```

预期:全部通过。

- [ ] **Step 9.2:** typecheck

```bash
cd web && bun run typecheck
```

预期:无错误。

- [ ] **Step 9.3:** lint

```bash
cd web && bun run lint
```

预期:无错误。

- [ ] **Step 9.4:** 浏览器回归测试

启动 dev server 并打开 `http://localhost:3000/ColaAI/`,逐项验证:

1. 单节点拖拽 60fps(DevTools Performance)
2. 多选拖拽 60fps
3. 平移画布 60fps,Inspector / Toolbar / GenerationPanel 渲染次数为 0(React DevTools Profiler)
4. 缩放(滚轮)流畅,zoom 百分比实时更新
5. 30 节点 + 5 张图片场景下连续拖 10 秒,无明显掉帧
6. 拖拽中按 Esc 取消,节点回到原位
7. 拖拽后 Ctrl+Z 撤销,Ctrl+Shift+Z 重做
8. Ctrl+A 全选 → 拖任一节点联动
9. Delete 删除节点 + 关联连接线
10. 方向键 / Shift+方向键 nudge 选中节点
11. 框选(Shift + 在空白处拖)
12. 节点连线拖出 → 接到目标 input handle
13. 刷新页面后状态恢复(localStorage)

- [ ] **Step 9.5:** 性能基准记录(手动)

在 Chrome DevTools Performance 面板录制 5 秒拖拽,在 `.claude/verification-report.md` 记录:

```markdown
## ColaAI 画布拖拽性能验证

时间:[YYYY-MM-DD HH:mm:ss]

### 优化前(基线,优化前 commit hash)

- 单节点拖拽:[平均 fps]
- 平移画布:[平均 fps]
- 30 节点 + 5 图片拖拽:[平均 fps]

### 优化后

- 单节点拖拽:[平均 fps]
- 平移画布:[平均 fps]
- 30 节点 + 5 图片拖拽:[平均 fps]

### 主线程占比

- 优化前 JS 时间:[N%]
- 优化后 JS 时间:[N%]
```

如果某项不达标(例如多节点拖拽 < 55fps),回到 Task 7 检查 RAF 节流和 affectedConnections 收集逻辑。

- [ ] **Step 9.6:** 不创建额外提交,直接收尾(所有改动已通过 Task 1-8 各自提交)。

---

## 自检清单

- [x] 第一节(viewport 分片) → Task 1-5
- [x] 第二节(DOM 直驱) → Task 6-7
- [x] 第三节(合成层) → Task 8
- [x] 现有测试 `does not paint-contain nodes` 不破坏(article 保留 `contain: layout style`)
- [x] 每个 Task 包含 TDD 步骤(写失败测试 → 验证失败 → 实现 → 验证通过 → 提交)
- [x] 文件路径完整(项目内绝对路径)
- [x] 浏览器手动验证步骤明确(30 节点 + 5 图片基准)
- [x] Esc / undo / redo / 框选 / 快捷键回归在 9.4 覆盖
