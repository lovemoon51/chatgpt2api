# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

这是一个基于 Next.js App Router 的前端仓库，主应用位于 `web/`。应用以静态导出为目标，页面和工作台都以客户端交互为主，核心能力集中在账号管理、图片生成/编辑工作台、注册/设置/日志/仪表盘，以及 ColaAI 无限画布子系统。

ColaAI 是仓库里最复杂的模块：它不是单一页面，而是一组页面、状态层、持久化层和交互组件共同组成的画布工作流。修改 ColaAI 时要同时看页面入口、工作台编排、画布 store、历史记录、模板/主页摘要和相关测试。

## 常用命令

在 `web/` 目录下执行：

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm start
```

单测通常使用 Bun：

```bash
bun test
bun test web/src/app/ColaAI/layout.test.ts
bun test web/src/app/ColaAI/components/canvas-home.test.tsx
bun test web/src/app/ColaAI/components/canvas-workspace.test.tsx
```

如果需要只跑某个测试文件，直接把文件路径传给 `bun test`。项目当前没有单独的 test script，测试以 `bun test` 为准。

## 技术栈与约定

- Next.js 16 + React 19 + TypeScript 严格模式
- App Router 页面都在 `web/src/app/**`
- 通用组件在 `web/src/components`
- 网络与后端协议封装在 `web/src/lib/api.ts` 和 `web/src/lib/request.ts`
- 本地持久化会话在 `web/src/store/auth.ts`，图片会话在 `web/src/store/image-conversations.ts`
- ColaAI 画布逻辑集中在 `web/src/app/ColaAI/components/`
- 路径别名 `@/*` 指向 `web/src/*`

代码风格上，仓库偏向函数组件、hooks 和纯函数拆分；ColaAI 的状态与数据转换尽量保持可测试的纯函数形式。

## 应优先查看的入口

- `web/src/app/layout.tsx`：全局壳、Toast、字体和页面容器
- `web/src/components/app-shell.tsx`：区分普通页面与全屏工作台布局
- `web/src/lib/request.ts`：Axios 实例、鉴权头、401 处理
- `web/src/lib/api.ts`：所有后端接口和类型定义的主入口
- `web/src/store/auth.ts`：本地会话与访问密钥
- `web/src/store/image-conversations.ts`：Studio 会话持久化
- `web/src/app/ColaAI/page.tsx`：ColaAI 页面入口
- `web/src/app/ColaAI/components/cola-ai-workbench.tsx`：ColaAI 的高层编排
- `web/src/app/ColaAI/components/use-canvas-store.ts`：画布状态、历史、持久化核心
- `web/src/app/ColaAI/components/canvas-home-state.ts`：画布库摘要、模板与旧数据迁移

## ColaAI 架构

ColaAI 由三层组成：

1. **页面入口层**：`web/src/app/ColaAI/page.tsx` 负责读取会话并把 session 传给工作台。
2. **工作台编排层**：`cola-ai-workbench.tsx` 负责模式切换、素材/生成/提示词/画布等子视图组合，以及和图片任务、会话状态的联动。
3. **画布核心层**：`use-canvas-store.ts`、`canvas-workflow.ts`、`canvas-home-state.ts`、`canvas-auto-layout.ts` 等负责节点、连接、历史、布局、存储和模板。

画布主页和编辑器是分离的：主页更偏库管理和摘要，编辑器负责真正的节点编辑与生图流程。改动其中一层时，要检查是否影响另一层的存储格式或选中状态。

## 认证与请求流程

- 登录态通过 `localforage` 持久化在 `web/src/store/auth.ts`
- `web/src/lib/request.ts` 会自动附加 Bearer token
- 401 时会清理会话并跳转到 `/login`
- `web/src/lib/auth-session.ts` 会在读取会话时做有效性校验

修改 API 调用或认证流程时，优先确认这条链路是否还完整。

## 测试关注点

- 测试框架是 Bun 的 `bun:test`
- 现有测试大量覆盖 ColaAI 的纯函数、状态机和关键页面
- 新增或修改 ColaAI 逻辑时，优先补对应的单元测试
- 运行单个测试文件时，直接用 `bun test <file>`

## 配置要点

- `web/next.config.ts` 使用静态导出，`images.unoptimized` 已启用
- `tsconfig.json` 开启 `strict`，并配置了 `@/* -> ./src/*`
- `eslint.config.mjs` 继承 Next 的 core-web-vitals 和 TypeScript 规则，并关闭了 `no-unused-vars` 与 `no-explicit-any`

## 工作建议

- 优先复用现有模块，不要在 ColaAI 里重复实现已有的状态/存储/任务合并逻辑
- 改动画布或图片任务流程时，先看相关测试，再改实现
- 如果只改单个页面或纯函数，先找同目录现有测试作为模板
