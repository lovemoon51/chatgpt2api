# ColaAI Canvas Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ColaAI 画布补齐第一批高频交互，包括框选、多选、组拖拽、对齐参考线和基础快捷键。

**Architecture:** 在现有自研画布上增量扩展。`use-canvas-store` 负责多选状态和批量操作，`InfiniteCanvasSurface` 负责交互编排，纯 helper 负责框选命中和吸附计算，临时参考线与框选框不进入持久化状态。

**Tech Stack:** React 19、Next.js、TypeScript、Tailwind、`bun:test`、现有 ColaAI 画布组件。

---

### Task 1: 扩展状态模型与纯 helper

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-types.ts`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.ts`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.test.ts`
- Create: `web/src/app/ColaAI/components/canvas-selection.ts`
- Create: `web/src/app/ColaAI/components/canvas-selection.test.ts`
- Create: `web/src/app/ColaAI/components/canvas-snapping.ts`
- Create: `web/src/app/ColaAI/components/canvas-snapping.test.ts`

- [ ] 先补失败测试，覆盖多选、批量移动、复制内部连线、框选命中、吸附命中。
- [ ] 运行单测确认因缺少实现而失败。
- [ ] 实现 `selectedNodeIds`、批量删除、全选、复制、微调、多节点移动。
- [ ] 实现 `canvas-selection.ts` 与 `canvas-snapping.ts`。
- [ ] 重新运行 helper/store 测试确认通过。

### Task 2: 更新节点与连接渲染契约

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-connections.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-render-guards.ts`
- Modify: `web/src/app/ColaAI/components/canvas-render-guards.test.ts`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`

- [ ] 更新失败测试，覆盖多选选中态与连接层比较器。
- [ ] 运行测试确认失败。
- [ ] 让节点支持多选选中态、保留文本编辑、兼容继续生成入口。
- [ ] 调整 render guard，避免多选数组变化带来无意义重绘。
- [ ] 重新运行渲染相关测试确认通过。

### Task 3: 实现框选、组拖拽、参考线与快捷键

**Files:**
- Modify: `web/src/app/ColaAI/components/infinite-canvas-surface.tsx`
- Create: `web/src/app/ColaAI/components/canvas-guides.tsx`

- [ ] 先补或扩展失败测试/静态断言，覆盖框选层与交互标记。
- [ ] 在 surface 中加入 `Shift + 拖拽空白` 框选。
- [ ] 让拖任意已选节点时整组选区一起移动。
- [ ] 接入吸附计算与参考线 overlay。
- [ ] 加入 `Esc`、`Delete`、`Ctrl+A`、`Ctrl+D`、方向键快捷键。
- [ ] 运行组件与 helper 测试确认通过。

### Task 4: 接回工作区并完成验证

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx`
- Modify: touched test files only if needed

- [ ] 让工作区基于多选状态计算 `canGenerate` 与删除行为。
- [ ] 运行 `bun test` 覆盖 ColaAI 画布相关测试。
- [ ] 运行 `bun run typecheck`。
- [ ] 运行 `bun run lint`。
- [ ] 在浏览器验证框选、多选拖动、吸附参考线、复制、删除和刷新恢复。
