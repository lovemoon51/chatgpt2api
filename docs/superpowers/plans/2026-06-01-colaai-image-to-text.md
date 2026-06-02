# ColaAI 图生文实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ColaAI 画布中新增“图生文”工作流，让图片节点可以生成完整的中文分析文本，并回写到文本节点中。

**Architecture:** 复用现有 ColaAI 的文本节点与任务轮询链路，不新增节点类型。前端新增一个图生文任务创建接口，`use-canvas-store.ts` 负责画布级状态与节点联动，`canvas-workspace.tsx` 负责触发任务和轮询回写，`canvas-node.tsx` 负责展示与提交入口。这样可以最小化改动面，同时保持图生文、提示词优化和现有生图流程的边界清晰。

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Bun test, localforage, existing ColaAI canvas store and API wrapper.

---

### Task 1: 扩展图片任务 API

**Files:**
- Modify: `web/src/lib/api.ts:947-985`
- Test: `web/src/lib/api.test.ts`（如果仓库没有这个文件，则新建同目录测试）

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { createImageDescriptionTask } from "./api";

describe("createImageDescriptionTask", () => {
  test("posts a FormData payload to the descriptions endpoint", async () => {
    const file = new File(["demo"], "demo.png", { type: "image/png" });
    const task = await createImageDescriptionTask("client-1", file, "分析这张图", "gpt-image-2");
    expect(task).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test web/src/lib/api.test.ts -v`
Expected: FAIL because `createImageDescriptionTask` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export type ImageDescriptionResult = {
  description?: string;
  tags?: string[];
  prompt?: string;
  analysis?: {
    subject?: string;
    scene?: string;
    lighting?: string;
    style?: string;
    composition?: string;
    [key: string]: string | undefined;
  };
};

export async function createImageDescriptionTask(
  clientTaskId: string,
  file: File,
  prompt?: string,
  model?: ImageModel,
) {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("client_task_id", clientTaskId);
  if (prompt) formData.append("prompt", prompt);
  if (model) formData.append("model", model);

  return httpRequest<ImageTask>("/api/image-tasks/descriptions", {
    method: "POST",
    body: formData,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test web/src/lib/api.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/api.test.ts
git commit -m "feat: add image description task api"
```

---

### Task 2: 扩展画布节点数据模型与状态机

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-types.ts:16-33`
- Modify: `web/src/app/ColaAI/components/use-canvas-store.ts:25-360`
- Test: `web/src/app/ColaAI/components/use-canvas-store.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that starts an image-to-text flow and asserts the selected text node gets `promptMode: "imageToText"`, a left-side image node is created when needed, and the text node stores image analysis metadata.

```ts
import { describe, expect, test } from "bun:test";
import { addTextNode, startImageToText } from "./use-canvas-store";
import { createInitialCanvasState } from "./use-canvas-store";

describe("startImageToText", () => {
  test("creates a reference image node and marks the text node as imageToText", () => {
    const state = addTextNode(createInitialCanvasState(), { x: 520, y: 260 });
    const textNode = state.nodes.at(-1)!;
    const updated = startImageToText(state, textNode.id);
    const updatedTextNode = updated.nodes.find((node) => node.id === textNode.id)!;

    expect(updatedTextNode.metadata?.promptMode).toBe("imageToText");
    expect(updatedTextNode.metadata?.content).toContain("正在分析图片");
    expect(updatedTextNode.metadata?.referenceImageNodeIds?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test web/src/app/ColaAI/components/use-canvas-store.test.ts -v`
Expected: FAIL because `startImageToText` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export type CanvasNodeMetadata = {
  content?: string;
  imageUrl?: string;
  prompt?: string;
  promptMode?: "optimize" | "imageReverse" | "imageToText";
  referenceImageNodeIds?: string[];
  imageTextResult?: {
    description?: string;
    tags?: string[];
    prompt?: string;
    analysis?: {
      subject?: string;
      scene?: string;
      lighting?: string;
      style?: string;
      composition?: string;
      [key: string]: string | undefined;
    };
  };
  // keep the existing fields unchanged
};

export function startImageToText(state: CanvasState, textNodeId: string): CanvasState {
  // reuse the same left-reference-node creation pattern as startImageReversePrompt
  // mark the text node with promptMode: "imageToText"
  // set loading text and clear old error/result fields
  return state;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test web/src/app/ColaAI/components/use-canvas-store.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/ColaAI/components/canvas-types.ts web/src/app/ColaAI/components/use-canvas-store.ts web/src/app/ColaAI/components/use-canvas-store.test.ts
git commit -m "feat: support image to text canvas state"
```

---

### Task 3: 接入图生文任务触发与轮询回写

**Files:**
- Modify: `web/src/app/ColaAI/components/canvas-workspace.tsx:163-400`
- Modify: `web/src/app/ColaAI/components/canvas-workspace.test.tsx`
- Modify: `web/src/app/ColaAI/components/canvas-node.tsx:144-197`

- [ ] **Step 1: Write the failing test**

Add a workspace test that simulates a text node entering image-to-text mode and verifies the workspace calls the new API and writes the returned result back into the node.

```ts
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasWorkspace } from "./canvas-workspace";
import { createInitialCanvasState } from "./use-canvas-store";

describe("CanvasWorkspace image-to-text flow", () => {
  test("renders the selected text node in imageToText mode", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(<CanvasWorkspace onBack={() => undefined} initialState={state} />);
    expect(markup).toContain("创意提示词");
  });
});
```

Then extend it to cover the specific behavior you implement: task creation, polling, and node update.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test web/src/app/ColaAI/components/canvas-workspace.test.tsx -v`
Expected: FAIL because the image-to-text path is not wired yet.

- [ ] **Step 3: Write minimal implementation**

```ts
const handleImageToText = useCallback(async (nodeId: string) => {
  // 1. find upstream image node(s) or create a reference image node
  // 2. createImageDescriptionTask(...)
  // 3. set text node loading state
  // 4. poll fetchImageTasks(ids)
  // 5. normalize task payload into metadata.content / metadata.prompt / metadata.imageTextResult
}, [/* existing workspace deps */]);
```

In `canvas-node.tsx`, add a clear entry point for text nodes so users can trigger the new mode without confusing it with prompt optimization.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test web/src/app/ColaAI/components/canvas-workspace.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/ColaAI/components/canvas-workspace.tsx web/src/app/ColaAI/components/canvas-workspace.test.tsx web/src/app/ColaAI/components/canvas-node.tsx
git commit -m "feat: wire colaai image to text flow"
```

---

### Task 4: 回归 ColaAI 相关测试与静态检查

**Files:**
- No code changes expected unless tests reveal a mismatch

- [ ] **Step 1: Run targeted ColaAI tests**

```bash
bun test web/src/app/ColaAI/layout.test.ts
bun test web/src/app/ColaAI/components/use-canvas-store.test.ts
bun test web/src/app/ColaAI/components/canvas-workspace.test.tsx
bun test web/src/app/ColaAI/components/canvas-home.test.tsx
```

Expected: all pass.

- [ ] **Step 2: Run lint and typecheck**

```bash
pnpm lint
pnpm typecheck
```

Expected: no new lint or type errors.

- [ ] **Step 3: Verify against the spec**

Check the plan against `docs/superpowers/specs/2026-06-01-colaai-image-to-text-design.md` and confirm:

- 图生文仍然复用文本节点
- 没有新增独立节点类型
- 新接口只影响图片任务链路
- 成功结果包含描述、标签、分析和 prompt

- [ ] **Step 4: Commit verification-only fixes if needed**

If tests or lint expose a gap, fix it in the smallest file set and create a new commit.

```bash
git add <fixed-files>
git commit -m "fix: polish colaai image to text flow"
```

---

### 任务覆盖检查

- Task 1 覆盖新的后端任务入口和 API 类型。
- Task 2 覆盖画布数据模型、promptMode 扩展和参考图片节点联动。
- Task 3 覆盖 workspace 触发、轮询和节点回写。
- Task 4 覆盖回归验证与最终质量门。

### 执行顺序建议

按顺序执行 Task 1 → Task 2 → Task 3 → Task 4，每个任务完成后立即跑对应测试并提交一次小 commit。