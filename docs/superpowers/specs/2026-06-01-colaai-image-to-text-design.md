# ColaAI 图生文设计

## 背景

现有图片任务接口已经区分：

- `POST /api/image-tasks/generations`：文生图
- `POST /api/image-tasks/edits`：图生图

ColaAI 画布中已经存在图片反推提示词的概念：文本节点支持 `promptMode: "imageReverse"`，并能通过图片节点与文本节点的连接表达“图片作为文本生成输入”。本设计在此基础上新增“图生文”能力，不新增独立节点类型，先复用文本节点承载图片分析结果。

## 目标

在 ColaAI 画布中实现“图片节点 → 文本节点”的图生文工作流，输出完整图片分析结果，包括图片描述、标签、结构化分析和可复用于文生图的提示词。

## 非目标

- 不在 Studio 页面新增图生文模式。
- 不新增专门的 `analysis` 或 `image-to-text` 节点类型。
- 不改变现有文生图和图生图接口的调用方式。

## 推荐方案

采用方案 A：复用现有文本节点，扩展 `promptMode`。

文本节点继续作为画布上的文本承载单元，但新增一种语义：当 `metadata.promptMode` 为 `"imageToText"` 时，文本节点表示图片理解/图片分析结果。

## 后端接口约定

新增任务接口：

```text
POST /api/image-tasks/descriptions
```

请求格式使用 `FormData`，与现有图生图接口保持一致：

```text
image: File
client_task_id: string
prompt?: string
model?: string
```

任务创建接口返回现有 `ImageTask` 结构。前端继续通过现有接口轮询任务：

```text
GET /api/image-tasks?ids=<task_id>
```

图生文任务成功后，任务结果中应包含结构化文本结果，建议形态：

```json
{
  "description": "图片整体描述",
  "tags": ["人物", "夜景", "霓虹", "电影感"],
  "prompt": "可用于再次生成图片的完整提示词",
  "analysis": {
    "subject": "主体",
    "scene": "场景",
    "lighting": "光影",
    "style": "风格",
    "composition": "构图"
  }
}
```

前端负责将结构化结果拼成可读中文内容，写入文本节点，同时保留原始结构化结果。

## 前端数据模型

扩展 `CanvasNodeMetadata.promptMode`：

```ts
promptMode?: "optimize" | "imageReverse" | "imageToText";
```

为文本节点 metadata 增加可选字段，用于保留图生文原始结果：

```ts
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
```

节点更新规则：

- `metadata.content`：展示给用户的完整中文分析文本，可编辑。
- `metadata.prompt`：可复用于文生图的提示词。
- `metadata.status`：`loading`、`success` 或 `error`。
- `metadata.sourceTaskId`：关联后端图生文任务 ID。
- `metadata.errorDetails`：失败原因。
- `metadata.promptMode`：图生文任务使用 `"imageToText"`。

## 画布交互流程

推荐工作流是：图片节点连接到文本节点。

1. 用户在画布中选择文本节点并触发“图生文”。
2. 如果该文本节点已有上游图片节点，前端使用这些图片作为输入。
3. 如果没有上游图片节点，前端自动在文本节点左侧创建一个图片节点，并连接到该文本节点。
4. 用户补充或上传图片后，再触发图生文任务。
5. 前端调用 `POST /api/image-tasks/descriptions` 创建任务。
6. 文本节点进入 `loading` 状态，显示“正在分析图片...”。
7. 前端通过 `fetchImageTasks` 轮询任务结果。
8. 成功后将描述、标签、分析字段和可复用提示词写回文本节点。
9. 失败后将文本节点标记为 `error`，并保留错误信息。

## 前端改动范围

- `web/src/lib/api.ts`
  - 新增 `ImageDescriptionResult` 类型。
  - 新增 `createImageDescriptionTask(...)`。
- `web/src/app/ColaAI/components/canvas-types.ts`
  - 扩展 `promptMode`。
  - 增加 `imageTextResult` metadata 字段。
- `web/src/app/ColaAI/components/use-canvas-store.ts`
  - 新增或扩展 `startImageToText(...)`。
  - 复用自动创建/连接参考图片节点的逻辑。
  - 支持图生文任务状态更新。
- `web/src/app/ColaAI/components/canvas-workspace.tsx`
  - 触发图生文任务。
  - 将任务成功/失败结果写回文本节点。
  - 继续复用现有轮询方式。
- 相关测试文件
  - 覆盖自动创建图片节点、连接节点、设置 `promptMode: "imageToText"`。
  - 覆盖任务成功后文本节点内容更新。
  - 覆盖任务失败后错误状态更新。

## 验收标准

- 文本节点可以从上游图片节点生成完整图片分析文本。
- 没有上游图片时，可以自动创建参考图片节点并连到文本节点。
- 图生文任务具有可见的 `loading`、`success`、`error` 状态。
- 成功结果包含描述、标签、结构化分析和可复用 prompt。
- 生成出的文本可以继续作为下游生图 prompt 使用。
- 现有文生图和图生图流程不受影响。

## 测试策略

- 使用 `bun test` 运行相关单元测试。
- 优先测试 `use-canvas-store.ts` 的状态变化和连接创建。
- 对 `canvas-workspace.tsx` 的任务成功/失败写回行为增加测试。
- 回归运行现有 ColaAI 相关测试，确认文生图和图生图路径没有被破坏。

## 风险与约束

- 后端需要提供 `/api/image-tasks/descriptions`，并让任务结果能被现有 `fetchImageTasks` 查询到。
- 如果后端结果字段命名不同，前端需要一层归一化函数，不应把后端细节散落在组件里。
- 复用文本节点会让文本节点语义更丰富，因此 UI 上需要清晰标识当前是普通文本、提示词优化还是图生文结果。
