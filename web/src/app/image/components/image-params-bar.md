# ImageParamsBar 组件使用指南

## 概述

`ImageParamsBar` 是一个横向布局的图片生成参数控制栏，整合了创作台的核心功能，适用于将左侧面板移到上方后的新布局。

## 功能特性

### 1. 状态信息显示
- 剩余额度
- 今日限制（请求数/图片数）
- 并发数（当前/最大）
- 活跃任务数量（带动画加载图标）

### 2. 参数控制
- **张数控制**：数字输入框，支持 1-100 张
- **比例选择**：下拉菜单，支持未指定、1:1、16:9、4:3、3:4、9:16
- **高级参数面板**：
  - 构图模式切换（Auto / 按比例）
  - 比例快速选择
  - 格式显示（PNG）
  - 官方工具说明

### 3. 快捷操作
- 提示词市场按钮
- 提示词优化按钮（支持加载状态和禁用状态）

## 使用方法

### 基础用法

```tsx
import { ImageParamsBar } from "@/app/image/components/image-params-bar";

function MyImagePage() {
  const [imageCount, setImageCount] = useState("1");
  const [imageSize, setImageSize] = useState("1:1");

  return (
    <ImageParamsBar
      imageCount={imageCount}
      imageSize={imageSize}
      availableQuota="100"
      activeTaskCount={0}
      onImageCountChange={setImageCount}
      onImageSizeChange={setImageSize}
    />
  );
}
```

### 完整用法（带所有功能）

```tsx
import { ImageParamsBar } from "@/app/image/components/image-params-bar";

function MyImagePage() {
  const [imageCount, setImageCount] = useState("1");
  const [imageSize, setImageSize] = useState("1:1");
  const [isOptimizing, setIsOptimizing] = useState(false);

  const handleOptimizePrompt = async () => {
    setIsOptimizing(true);
    try {
      // 调用优化 API
      await optimizePrompt();
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <ImageParamsBar
      imageCount={imageCount}
      imageSize={imageSize}
      availableQuota="100"
      activeTaskCount={2}
      dailyLimit={{ requests: 100, images: 200 }}
      concurrency={5}
      onImageCountChange={setImageCount}
      onImageSizeChange={setImageSize}
      onOpenPromptMarket={() => setPromptMarketOpen(true)}
      onOptimizePrompt={handleOptimizePrompt}
      isOptimizingPrompt={isOptimizing}
      canOptimizePrompt={Boolean(prompt.trim())}
    />
  );
}
```

## Props 说明

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `imageCount` | `string` | ✅ | 图片张数 |
| `imageSize` | `string` | ✅ | 图片比例（空字符串表示未指定） |
| `availableQuota` | `string` | ✅ | 可用额度显示文本 |
| `activeTaskCount` | `number` | ✅ | 活跃任务数量 |
| `dailyLimit` | `{ requests?: number \| null; images?: number \| null }` | ❌ | 每日限制 |
| `concurrency` | `number \| null` | ❌ | 最大并发数 |
| `onImageCountChange` | `(value: string) => void` | ✅ | 张数变化回调 |
| `onImageSizeChange` | `(value: string) => void` | ✅ | 比例变化回调 |
| `onOpenPromptMarket` | `() => void` | ❌ | 打开提示词市场回调 |
| `onOptimizePrompt` | `() => void` | ❌ | 优化提示词回调 |
| `isOptimizingPrompt` | `boolean` | ❌ | 是否正在优化（默认 false） |
| `canOptimizePrompt` | `boolean` | ❌ | 是否可以优化（默认 false） |

## 布局位置

根据你的截图，这个组件应该放置在：

```tsx
<div className="flex min-h-0 flex-col">
  {/* 顶部导航栏 */}
  <header>...</header>
  
  {/* 参数控制栏（红框位置） */}
  <ImageParamsBar {...props} />
  
  {/* 主内容区域 */}
  <div className="flex-1 overflow-y-auto">
    {/* 图片结果展示 */}
  </div>
  
  {/* 底部输入框 */}
  <div className="shrink-0">
    <ImageComposer {...props} />
  </div>
</div>
```

## 样式特点

1. **响应式设计**：
   - 移动端：紧凑布局，隐藏部分文字标签
   - 桌面端：完整显示所有信息

2. **视觉层次**：
   - 状态信息：灰色背景，低调展示
   - 参数控制：白色背景，边框突出
   - 活跃状态：蓝色高亮，吸引注意

3. **交互反馈**：
   - 悬停效果：背景色变化
   - 激活状态：蓝色边框和背景
   - 加载状态：旋转动画

## 与创作台的差异

| 特性 | 创作台 | 新组件 |
|------|--------|--------|
| 布局方向 | 垂直（左侧面板） | 横向（顶部栏） |
| 模式切换 | 对话/作画切换 | 仅图片模式 |
| 模型选择 | 下拉菜单 | 未包含（可扩展） |
| 参数面板 | 底部弹出 | 顶部弹出 |
| 状态显示 | 分散在多处 | 集中在一行 |

## 扩展建议

如果需要添加模型选择功能，可以在"参数控制"区域添加：

```tsx
{/* 模型选择 */}
<div className="relative">
  <button
    type="button"
    className="inline-flex h-9 items-center gap-2 rounded-full border border-stone-200 bg-white px-3 text-xs font-medium"
    onClick={() => setIsModelMenuOpen(true)}
  >
    <ImageIcon className="size-4" />
    <span>模型 {selectedModel}</span>
    <ChevronDown className="size-4" />
  </button>
  {/* 模型选择菜单 */}
</div>
```

## 注意事项

1. **数值验证**：`imageCount` 应该在外部进行 1-100 的范围限制
2. **状态同步**：确保 `availableQuota` 和 `activeTaskCount` 实时更新
3. **权限控制**：根据用户角色显示/隐藏提示词市场和优化功能
4. **性能优化**：使用 `useCallback` 包装回调函数，避免不必要的重渲染

## 测试

运行测试：

```bash
npm test image-params-bar.test.tsx
```

测试覆盖：
- ✅ 基本渲染
- ✅ 状态信息显示
- ✅ 参数控制交互
- ✅ 菜单打开/关闭
- ✅ 回调函数调用
- ✅ 禁用状态
