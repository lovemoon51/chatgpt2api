# ColaAI 作品预览优先原图设计

## 背景

当前 ColaAI 在多个作品预览场景里优先使用 `thumbnail_url`，例如发现页的“最近创作”和资产区的图片卡片。这在快速滚动时能减少首屏体积，但会带来一个明显问题：用户点击查看或直接在卡片上观察作品时，画面容易发糊，尤其是人像、海报、插画这类细节密集的内容。

从现有代码看，ColaAI 内部对“作品预览”和“模板封面”这两类图片没有完全区分：

- 作品预览：更接近用户自己的最终输出，应优先清晰度。
- 模板封面：更接近浏览型封面卡，可以继续优先更轻的预览资源。

## 目标

在 ColaAI 中统一调整“作品预览类图片”的资源优先级，让用户默认看到原图级预览，而不是先看到模糊缩略图。

## 非目标

- 不移除后端缩略图生成能力。
- 不要求所有图片入口都完全禁用缩略图。
- 不改变大图查看器、下载、复制链接等能力。
- 不在这次改动中引入复杂的按网速自适应策略。

## 推荐方案

采用“全站作品预览优先原图，少数纯封面场景保留缩略图”的方案。

核心原则：

1. 用户自己生成或上传出来的“作品”类图片，在列表卡片里默认优先原图。
2. 明确属于“模板封面 / 灵感封面 / 市场卡面”的图片，可以继续优先缩略图。
3. 所有预览入口都保留回退链路：原图失败时，仍可以回退到可用缩略图或备选地址。

## 资源优先级规则

新增一套统一的 ColaAI 预览取图规则，区分两种策略。

### 1. 作品预览策略 `preferOriginal`

适用于用户自己的生成结果、最近创作、资产区作品、作品复用入口。

优先级顺序：

```text
signed_url -> url -> b64_json -> thumbnail_url
```

设计原因：

- `signed_url` 是最佳公开原图地址，优先使用。
- `url` 是受保护原图地址，次优。
- `b64_json` 可直接展示完整图片。
- `thumbnail_url` 只作为失败兜底，不再作为默认首选。

### 2. 封面预览策略 `preferThumbnail`

适用于提示词模板、灵感模板、市场卡片等“以浏览密度优先”的封面场景。

优先级顺序：

```text
thumbnail_url -> url -> signed_url
```

设计原因：

- 这类图片是浏览封面，不是用户最终作品主预览。
- 高密度卡片墙保留缩略图优先，有利于滚动与首屏体积控制。

## 适用范围

### 改为优先原图的场景

- ColaAI 发现页“最近创作”瀑布流。
- ColaAI 资产区图片卡片。
- 任何“点击后查看的是这张用户作品本身”的预览卡片。
- 任何“复用这张作品继续创作”的作品预览入口。

### 保持缩略图优先的场景

- 提示词模板卡片封面。
- 提示词市场/模板市场中的浏览封面。
- 其他明确以“内容发现密度”为主、而非“作品清晰预览”为主的卡片。

## 前端实现设计

### 1. 新增统一预览解析 helper

在图片工具层新增统一 helper，建议形态：

```ts
type PreviewImageSource = {
  signed_url?: string;
  url?: string;
  b64_json?: string;
  thumbnail_url?: string;
};

type PreviewPriority = "preferOriginal" | "preferThumbnail";

function getPreferredPreviewUrl(image: PreviewImageSource, priority: PreviewPriority): string;
function getPreviewFallbackUrl(image: PreviewImageSource, priority: PreviewPriority): string | undefined;
```

这层负责：

- 统一主图 URL 选择。
- 统一 fallback URL 选择。
- 避免各组件继续内联写 `thumbnail_url || url` 之类的分散逻辑。

### 2. 替换发现页最近创作取图

当前 `buildCreations(images)` 里直接使用：

```ts
image.thumbnail_url || image.url
```

需要改成作品预览策略：

```ts
getPreferredPreviewUrl(image, "preferOriginal")
```

并在卡片组件里保留 fallback：

```ts
fallbackSrc={getPreviewFallbackUrl(image, "preferOriginal")}
```

### 3. 替换资产区作品卡片取图

当前资产区作品卡片也直接优先 `thumbnail_url`。这一块同样改为 `preferOriginal`。

### 4. 保留模板封面现状，但迁移到统一 helper

提示词模板卡片虽然继续优先缩略图，但不再手写：

```ts
thumbnail_url || url
```

而是显式走：

```ts
getPreferredPreviewUrl(previewImage, "preferThumbnail")
```

这样后续如果策略要微调，只需要改 helper，不需要逐个改组件。

## 回退与稳定性

- 如果原图地址可访问，则直接展示原图。
- 如果原图失败，再回退到缩略图或其他备选地址。
- `AuthenticatedImage` 继续承担加载失败兜底职责。
- 现有鉴权下载逻辑不需要重写，只需要让新的主图 URL 选择规则复用现有能力。

## 影响与权衡

### 收益

- 发现页最近创作不再默认糊图。
- 资产区作品预览质量明显提升。
- “用户作品”和“模板封面”语义分离更清晰。
- 以后任何新作品预览入口都能复用统一策略。

### 成本

- 作品列表首屏请求体积会增加。
- 高分辨率原图在慢网下的卡片加载时间可能更长。
- 需要仔细确认不会误伤纯模板浏览场景。

## 验收标准

- 发现页最近创作卡片默认优先展示原图。
- 资产区作品卡片默认优先展示原图。
- 原图失败时，仍能正常回退到可用备选地址。
- 提示词模板等封面卡片继续可控地使用缩略图优先策略。
- 代码中不再散落 `thumbnail_url || url` 这类作品预览判断。

## 测试策略

- 为统一 helper 增加单测：
  - `preferOriginal` 时优先原图。
  - `preferOriginal` 时原图缺失回退缩略图。
  - `preferThumbnail` 时优先缩略图。
- 为发现页最近创作增加组件测试：
  - 当同时存在 `url` 和 `thumbnail_url` 时，卡片主图使用原图。
- 为资产区作品卡片增加组件测试：
  - 主图使用原图，fallback 仍保留。
- 回归运行 ColaAI 相关测试，确认提示词模板封面逻辑未被破坏。

## 风险与约束

- 如果部分原图地址本身过慢，用户会感知到列表加载变重；因此 fallback 和现有鉴权加载链必须保留。
- 如果后端某些列表只返回缩略图而没有原图，前端仍要正常显示，不可出现空卡。
- 这次不做按设备、带宽、分辨率动态切换，先确保“作品预览清晰优先”的策略成立。
