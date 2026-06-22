# ColaAI Canvas Generation Panel Design

## Goal

在不改变 ColaAI 现有主题语言的前提下，把画布里的“生成配置”面板改成更紧凑、更偏创作工作台的结构，贴近参考图的信息架构和操作顺序。

## Requirements

- 保留 ColaAI 当前浅色主题、圆角体系、边框和交互动效，不切换成参考图里的深色外观。
- 面板标题使用“生成配置”，弱化当前“继续生成 / 参考节点”的旧表单语义。
- 顶部增加模式切换：`生图 / 文本 / 视频`。
- 当前只支持 `生图`，`文本` 与 `视频` 先展示为禁用态，不接入新功能。
- 面板主体改成三段式：
  - 状态胶囊：提示词数量、参考图数量、预览入口
  - 主配置行：模型选择 + 参数摘要
  - 主操作按钮：开始生成
- 参数摘要文案采用 `自动 · 比例 · 张数` 的合并表达，不再把比例、张数拆成多个大块。
- 保留现有生成逻辑、禁用逻辑和提交回调，不改接口协议。

## Component Scope

- 主要修改 [web/src/app/ColaAI/components/canvas-generation-panel.tsx](/D:/IdeaProject/register/chatgpt2api/web/src/app/ColaAI/components/canvas-generation-panel.tsx)
- 同步更新 [web/src/app/ColaAI/components/canvas-workspace.test.tsx](/D:/IdeaProject/register/chatgpt2api/web/src/app/ColaAI/components/canvas-workspace.test.tsx) 的静态渲染断言

## Interaction Notes

- `预览` 先作为非破坏性按钮展示，不强行接入复杂预览逻辑。
- 模型仍用原生 `select`，但视觉上压缩成胶囊输入。
- 张数仍沿用既有 `count` 状态，只是通过更紧凑的步进按钮呈现。
- “开始生成”继续受 `selectedNode`、`submitting` 和 `prompt.trim()` 控制。

## Testing

- 更新组件静态渲染测试，覆盖新标题、新模式切换、新胶囊文案和新按钮文案。
- 运行目标测试文件确认通过。
