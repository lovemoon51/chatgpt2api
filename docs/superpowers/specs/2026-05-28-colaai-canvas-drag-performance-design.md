# ColaAI 画布拖拽性能优化设计

- 日期：2026-05-28
- 范围：`web/src/app/ColaAI/components/` 下的画布拖拽与平移链路
- 入口：`http://localhost:3000/ColaAI/`

## 背景与问题

用户反馈画布在拖拽节点和平移视图时手感卡顿，四种场景全部命中：拖单节点、平移整个画布、节点 ≥20 个、画布中包含图片节点。当前已有的优化手段包括 `frame-batcher` RAF 合并、`canvas-visibility` 视口裁剪、`React.memo` 节点比较，但仍不足以支撑顺滑交互。

代码审计后定位的核心瓶颈：

1. **viewport 走 React state**。`updateViewport` 每帧 setState，触发整个 `CanvasWorkspace` 子树（Inspector、Toolbar、ZoomControls、生成面板）重渲染，与拖拽无关的组件被无谓刷新。
2. **节点位置每帧写 React state，连接线 memo 失效**。`moveNodes` 每帧重建 `state.nodes`；`CanvasConnections` 的 `areShallowItemsEqual` 检查到引用变化即整层 SVG 重画，节点越多累计成本越高。
3. **合成层缺失**。节点 `<article>` 仅声明 `contain: layout style`，未包含 `paint`，浏览器没有把节点独立成合成层；图片节点由 `AuthenticatedImage` 渲染，与节点 transform 共享同一绘制层，触发频繁 paint。
4. **history 全量复制开销**。即便有 `coalesceKey` 合并，`moveNodes` 内部仍 `state.nodes.map(...)` 整表复制并刷新 `updatedAt`，每帧一次。

## 目标

- 拖拽单节点、多选节点稳定 60fps（≤50 个节点规模）
- 平移整个画布稳定 60fps
- 含图片节点不再额外掉帧
- 不破坏现有 undo/redo、吸附辅助线、连接预览、键盘 nudge、本地持久化等行为
- 不引入新的画布库或大型依赖

## 非目标

- 不重写画布架构（不迁移到 react-flow / @xyflow/react）
- 不优化超大规模场景（500+ 节点级别），现阶段不需要
- 不改变 viewport 是否进 history 的现状（仍走 transient mutation）

## 设计

整体方案分三层落地：状态分片、拖拽期 DOM 直接驱动、合成层与图片隔离。

### 1. 状态分片：viewport 退出 history 树

**改造点：`web/src/app/ColaAI/components/use-canvas-store.ts`**

- 在 store 内部维护 `viewportRef: React.MutableRefObject<CanvasViewport>` + 订阅器 `viewportListeners: Set<() => void>`，新增 `subscribeViewport(listener)` 与 `getViewport()`
- 暴露 `useCanvasViewport()` hook，内部基于 `useSyncExternalStore` 订阅；只在视觉上需要 viewport 数值的组件（如缩放百分比指示）订阅
- `updateViewport` 改为：写入 `viewportRef.current` 后通知订阅者，而不是 setState
- 持久化：原本 viewport 也要写进 localStorage，改为持久化时从 ref 读取最新值后再合并（持久化已 deferred 180ms，频率可控）
- 原 `state.viewport` 字段保留（避免 store 接口大改），但其值由 ref 驱动；history 快照里 viewport 始终用 ref 当前值快照

**对外影响：**

- `CanvasWorkspace`：移除 `state.viewport` 在子组件 props 中的传递，改为各组件自取
- `InfiniteCanvasSurface`：内部已有 `viewportRef`，改为直接订阅 store ref，省去 useEffect 同步
- `CanvasZoomControls`：用 `useCanvasViewport()` 拿缩放值显示
- 历史撤销 viewport 行为保持现状（transient，不进 past）

**预期收益：** 平移画布与缩放时 Workspace 子树零重渲染，仅 surface 层做 transform 写入。

### 2. 拖拽期 DOM 直接驱动

**改造点：`web/src/app/ColaAI/components/infinite-canvas-surface.tsx` + `canvas-node.tsx` + `canvas-connections.tsx`**

#### 2.1 节点拖拽

- pointerdown 收集被拖节点的 DOM 引用：`document.querySelector('[data-node-id="..."]')` 拿到 `HTMLElement`，连同初始位置存入 `dragRef`
- pointermove 在 RAF 帧内**直接写 DOM**：`el.style.transform = translate(x, y)`，**不调用 `moveNodes`**
- pointerup 时调用一次 `moveNodes(positions)` 把最终位置提交到 React state，由 history coalesce 合并为单条 undo 记录
- pointercancel / Escape 时把 DOM transform 恢复到 React state 当前值，避免视觉错位

#### 2.2 连接线即时更新

- 拖拽中维护 `dragAffectedConnectionsRef`：以 nodeId 为 key 的连接元素引用 Map（fromNodeId 或 toNodeId 命中被拖节点）
- 每帧根据被拖节点的最新位置，重新计算 `getConnectionPath(from, to)` 并直接 `path.setAttribute('d', ...)`
- 双层 path（透明 hit-area + 可见 path）同步更新
- pointerup 时 React 重新渲染连接线层，DOM 上的最后一帧 d 属性与 React 写入的 d 一致，无跳变

#### 2.3 viewport 平移

- 已经在第 1 节解耦；pointermove 中直接更新 `viewportRef`，并直接写最外层变换容器（`transform: translate(...) scale(...)`）的 DOM transform
- ZoomControls 的缩放百分比通过订阅器只更新自身

#### 2.4 吸附与辅助线

- `getSnappedDelta` 仍每帧执行（O(n) 在 ≤50 节点可接受），但其结果中的 `guides` 走 React state，限频为每 2-3 帧更新一次（用计数器节流）
- 拖拽结束 setGuides([]) 不变

**预期收益：** 拖拽过程中 React 完全不参与，60fps 主要由浏览器合成器驱动。

### 3. 合成层与图片节点隔离

**改造点：`canvas-node.tsx` + `canvas-connections.tsx` + 相关 CSS**

- 节点 `<article>` 的 `contain` 升级为 `layout style paint`
- 拖拽期临时给被拖节点加 `data-cola-dragging="true"`，CSS 选择器 `[data-cola-dragging="true"] { will-change: transform; transform: translateZ(0) translate(...) }`，强制独立合成层；松手后通过 DOM 操作摘除属性，避免 will-change 常驻
- 图片节点容器（`{imageUrl ? <div>...AuthenticatedImage...</div>}`）外层加 `contain: strict`，把图片解码/重绘隔离
- SVG 连接线层加 `transform: translateZ(0)`（对 SVG 顶层 `<svg>` 元素），让连线层独立于节点层
- 显存预算：20-50 节点 × 每层数 MB 合成层，整体可控；不在常态下给所有节点加 will-change，仅拖拽期临时加

**预期收益：** transform 变化只触发 compositor，不触发 layout/paint；图片节点因 contain: strict 不再连带触发周边节点重绘。

### 4. history 复制开销优化

**改造点：`use-canvas-store.ts` 的 `moveNodes`**

- 拖拽期不再每帧调用 `moveNodes`（已被第 2 节消除），所以 history 复制频率从每帧降到每次拖拽 1 次
- 此节不再额外改 reducer，等第 2 节落地后实测再判断是否需要进一步精简

## 实施顺序

按此顺序合入，每步可独立验证：

1. **第 1 步：viewport 状态分片**
   - 改造 `use-canvas-store.ts` 暴露 ref + subscribe
   - 改造 `CanvasWorkspace`、`InfiniteCanvasSurface`、`CanvasZoomControls` 接入新 API
   - 验证：平移与缩放手感顺滑；Inspector / Toolbar 不再重渲染（React DevTools profiler）

2. **第 2 步：节点拖拽 DOM 直驱**
   - `InfiniteCanvasSurface` 收集被拖节点 DOM 引用，pointermove 写 transform
   - 同步连接线 `<path>.setAttribute('d', ...)`
   - pointerup 提交一次 React state
   - 验证：单节点 / 多选拖拽 60fps；undo/redo 行为不变；Esc 取消恢复正确

3. **第 3 步：合成层与图片隔离**
   - 节点 contain + 拖拽期 will-change CSS
   - 图片容器 contain: strict
   - 连接线 SVG translateZ(0)
   - 验证：含图片节点拖拽不再卡；Performance 面板看到 compositor-only 帧

## 风险与回滚

- **DOM 直驱与 React 状态不一致风险**：拖拽中 React 仍能因为外部事件（轮询任务回写、其他用户输入）触发 re-render，导致节点 transform 被 React 回写覆盖。缓解：拖拽中给节点加 `data-cola-dragging` 标记，`CanvasNode` 的 memo 比较函数在标记存在时返回 true（跳过重渲染），松手后取消标记并由 React 接管。
- **合成层显存占用**：节点数远超 50 时显存吃紧。缓解：will-change 不常驻，仅拖拽期临时加；contain: paint 是免费的不会预留资源。
- **回滚策略**：三步分别对应独立 commit，任一阶段出问题可单独回滚不影响其他。

## 验证标准

落地后用以下方式验证：

- Chrome DevTools Performance 面板：拖拽节点录制 5 秒，主线程脚本时间 < 30%，60fps 稳定
- React DevTools Profiler：平移画布期间，Inspector / Toolbar / GenerationPanel 渲染次数为 0
- 人工：在 30 节点画布、含 5 个图片节点的场景下连续拖拽 10 秒，无明显掉帧或抖动
- 回归：undo/redo、Ctrl+A 全选、键盘 nudge、Esc 取消、连接预览、吸附辅助线行为不变

## 未来工作（不在本次范围）

- 节点数 100+ 场景的虚拟化策略（目前 visibility 已经 cull，足够当前规模）
- 连接线层从 React 完全移出（用 OffscreenCanvas 或 WebGL 渲染）
- 节点位置改为 CSS 自定义属性驱动，让 React 只负责结构、CSS 负责变换
