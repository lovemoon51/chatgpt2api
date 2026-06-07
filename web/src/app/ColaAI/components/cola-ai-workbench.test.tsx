import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AssetsWorkspace,
  ColaAIWorkbench,
  CreationFeed,
  GenerateComposer,
  GenerateConversationStage,
  GenerateResultGrid,
  GenerateSessionRail,
  TaskQueuePopover,
  GenerateTaskDiagnosticsPanel,
  GenerateWorkspace,
  GenerationStage,
  PromptCardArtwork,
  ReferenceDropOverlay,
  buildCreations,
  buildImageReversePromptMessages,
  buildPromptArchitectMessages,
  getPromptLibraryTotalCount,
  promptTemplateToPromptCard,
  resolvePromptSourceCards,
  getPromptLibraryStatusText,
  shouldUseRemotePromptTemplates,
  clearReferencePreviewUrl,
  decrementSessionImageQuota,
  getDroppedImageFile,
  handlePromptComposerKeyDown,
  imageResolutionCreditCost,
  prependGenerateSession,
} from "./cola-ai-workbench";
import { timestampFromIso } from "./cola-ai-time";
import { buildLandingHeroItems, landingHeroFallbackItems } from "./cola-ai-landing-hero-state";
import type { ImageTask, PromptTemplate } from "@/lib/api";
import type { GenerateTask } from "./generate-task-submission";
import { CanvasWorkspace } from "./canvas-workspace";

const testDir = dirname(fileURLToPath(import.meta.url));
const workbenchSource = readFileSync(join(testDir, "cola-ai-workbench.tsx"), "utf-8");
const globalsSource = readFileSync(join(testDir, "../../globals.css"), "utf-8");

test("parses backend plain datetime values as UTC timestamps", () => {
  expect(timestampFromIso("2026-05-27 00:00:00")).toBe(Date.parse("2026-05-27T00:00:00Z"));
  expect(timestampFromIso("2026-05-27T00:00:00")).toBe(Date.parse("2026-05-27T00:00:00Z"));
  expect(timestampFromIso("2026-05-27T08:00:00+08:00")).toBe(Date.parse("2026-05-27T08:00:00+08:00"));
});

test("decrements ordinary user image quota after successful task submission", () => {
  expect(
    decrementSessionImageQuota(
      {
        key: "sess-user",
        role: "creator",
        subjectId: "user-1",
        name: "Creator",
        limits: {
          creditsTotal: 10,
          creditsUsed: 3,
          creditsRemaining: 7,
          imagesTotal: 10,
          imagesUsed: 3,
          imagesRemaining: 7,
        },
      },
      2,
    ).limits,
  ).toEqual({
    creditsTotal: 10,
    creditsUsed: 5,
    creditsRemaining: 5,
    imagesTotal: 10,
    imagesUsed: 5,
    imagesRemaining: 5,
  });
});

test("calculates ordinary user image credit costs by resolution", () => {
  expect(imageResolutionCreditCost()).toBe(1);
  expect(imageResolutionCreditCost("1k")).toBe(1);
  expect(imageResolutionCreditCost("2k")).toBe(2);
  expect(imageResolutionCreditCost("4k")).toBe(3);
  expect(imageResolutionCreditCost("8k")).toBe(1);
});

const session = {
  key: "test-key",
  role: "creator",
  subjectId: "cola-user",
  name: "Cola Tester",
  limits: {
    imagesRemaining: 27,
  },
} as const;

const publicSession = {
  key: "",
  role: "guest",
  subjectId: "public-preview",
  name: "ColaAI",
} as const;

function extractSideNavMarkup(markup: string) {
  const panelMarker = 'data-cola-panel="side-nav"';
  const markerIndex = markup.indexOf(panelMarker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const asideStart = markup.lastIndexOf("<aside", markerIndex);
  const asideEnd = markup.indexOf("</aside>", markerIndex);
  expect(asideStart).toBeGreaterThanOrEqual(0);
  expect(asideEnd).toBeGreaterThan(asideStart);

  return markup.slice(asideStart, asideEnd + "</aside>".length);
}

const successTask: ImageTask = {
  id: "task-success-1",
  status: "success",
  mode: "generate",
  created_at: "2026-05-27T00:00:00Z",
  updated_at: "2026-05-27T00:00:01Z",
  data: [{ url: "/api/images/generated-1.png", revised_prompt: "成片提示词" }],
};

const secondSuccessTask: ImageTask = {
  id: "task-success-2",
  status: "success",
  mode: "generate",
  created_at: "2026-05-27T00:02:00Z",
  updated_at: "2026-05-27T00:02:01Z",
  data: [{ url: "/api/images/generated-2.png", revised_prompt: "第二组结果" }],
};

const creationFeedItem = {
  id: "recent-image-1",
  title: "最近创作 1",
  subtitle: "1024 x 1024",
  prompt: "复用这张作品的视觉风格继续创作。",
  imageUrl: "/api/images/recent-image-1.png",
  imageFallbackUrl: "/image-thumbnails/recent-image-1.png",
};

const promptTemplate: PromptTemplate = {
  id: "template-product",
  title: "真实产品海报",
  description: "用于商品首图",
  prompt: "生成一张真实产品海报",
  model: "gpt-image-2",
  size: "4:5",
  count: 2,
  tags: ["product", "poster"],
  preview_image: { url: "/api/images/template-product.png" },
  owner_id: "owner-1",
  owner_name: "模板作者",
  visibility: "public",
  review_status: "approved",
  created_at: "2026-05-30T00:00:00Z",
  updated_at: "2026-05-30T00:00:00Z",
};

const failedTask: ImageTask = {
  id: "task-failed-1",
  status: "error",
  mode: "generate",
  model: "gpt-image-2",
  size: "1:1",
  created_at: "2026-05-27T00:03:00Z",
  updated_at: "2026-05-27T00:03:01Z",
  error: "账号额度不足，请稍后重试。",
};

const failedTaskWithContext: GenerateTask = {
  ...failedTask,
  submissionContext: {
    prompt: "失败时的完整原始提示词",
    count: 3,
    model: "gpt-image-2",
    size: "1:1",
    attempt: 2,
    retryOfTaskId: "task-original-failed",
  },
};

describe("ColaAIWorkbench", () => {
  test("builds prompt architect chat messages for canvas text optimization", () => {
    const messages = buildPromptArchitectMessages("生成一张芙莉莲");

    expect(messages).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("专业提示词架构师 Prompt Architect"),
      }),
      {
        role: "user",
        content: "生成一张芙莉莲",
      },
    ]);
  });

  test("builds image reverse messages with multimodal reference images", () => {
    const messages = buildImageReversePromptMessages("请反推这张海报", [
      {
        title: "海报参考图",
        imageUrl: "data:image/png;base64,AAA",
      },
      {
        title: "待补图参考",
        imageUrl: "",
      },
    ]);

    expect(messages).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("图片提示词反推专家"),
      }),
      {
        role: "user",
        content: [
          {
            type: "text",
            text: expect.stringContaining("请反推这张海报"),
          },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAA" },
          },
          {
            type: "text",
            text: expect.stringContaining("待补图参考"),
          },
        ],
      },
    ]);
  });

  test("maps prompt templates into prompt library cards", () => {
    expect(promptTemplateToPromptCard(promptTemplate)).toEqual({
      id: "template-product",
      title: "真实产品海报",
      prompt: "生成一张真实产品海报",
      author: "模板作者",
      tags: ["product", "poster"],
      tone: "from-cyan-100 via-lime-100 to-amber-100",
      ratio: "4:5",
      category: "产品广告",
      useCase: "适合商品首图",
      previewUrl: "/api/images/template-product.png",
      previewFallbackUrl: undefined,
      model: "gpt-image-2",
      count: 2,
    });
  });

  test("uses remote prompt templates once the public library is available", () => {
    expect(shouldUseRemotePromptTemplates("ready", { public: 4, private: 0, favorites: 0, submissions: 0 }, 0)).toBe(false);
    expect(shouldUseRemotePromptTemplates("ready", { public: 0, private: 0, favorites: 0, submissions: 0 }, 1)).toBe(true);
    expect(shouldUseRemotePromptTemplates("ready", { public: 0, private: 0, favorites: 0, submissions: 0 }, 0)).toBe(false);
    expect(shouldUseRemotePromptTemplates("error", { public: 4, private: 0, favorites: 0, submissions: 0 }, 2)).toBe(false);
  });

  test("uses local prompt seeds only when remote prompt templates are unavailable", () => {
    const remoteCard = promptTemplateToPromptCard(promptTemplate);

    expect(resolvePromptSourceCards(true, [remoteCard])).toEqual([remoteCard]);
    expect(resolvePromptSourceCards(false, [remoteCard]).map((card) => card.id)).toContain("banana-apple-poster");
    expect(resolvePromptSourceCards(false, [remoteCard]).map((card) => card.id)).not.toContain("template-product");
  });

  test("shows the remote public template count as the prompt library total", () => {
    expect(getPromptLibraryTotalCount(true, { public: 300, private: 0, favorites: 0, submissions: 0 }, 25)).toBe(300);
    expect(getPromptLibraryTotalCount(true, { public: 0, private: 0, favorites: 0, submissions: 0 }, 25)).toBe(25);
    expect(getPromptLibraryTotalCount(false, { public: 300, private: 0, favorites: 0, submissions: 0 }, 13)).toBe(13);
  });

  test("labels the GitHub community prompts as the fallback source", () => {
    expect(getPromptLibraryStatusText("loading", "", "")).toBe("正在同步公开模板库");
    expect(getPromptLibraryStatusText("error", "", "")).toBe("公开模板库暂不可用，正在使用 GitHub 社区源");
    expect(getPromptLibraryStatusText("ready", "城市", "城市")).toBe("搜索：城市");
    expect(getPromptLibraryStatusText("ready", "", "")).toBe("按标题、作者、标签和提示词内容匹配");
  });

  test("renders prompt template preview images when template data provides one", () => {
    const markup = renderToStaticMarkup(<PromptCardArtwork card={promptTemplateToPromptCard(promptTemplate)} />);

    expect(markup).toContain('data-cola-panel="prompt-template-preview"');
    expect(markup).toContain('data-cola-media="prompt-template-preview-image"');
    expect(markup).toContain('src="/api/images/template-product.png"');
    expect(markup).toContain('alt="真实产品海报 预览图"');
  });

  test("falls back to the original prompt template preview when a thumbnail is present", () => {
    const markup = renderToStaticMarkup(
      <PromptCardArtwork
        card={{
          ...promptTemplateToPromptCard({
            ...promptTemplate,
            preview_image: {
              url: "/images/original-template.png",
              thumbnail_url: "/image-thumbnails/original-template.png",
            },
          }),
          previewFallbackUrl: "/images/original-template.png",
        }}
      />,
    );

    expect(markup).toContain('src="/image-thumbnails/original-template.png"');
    expect(markup).toContain("original-template.png");
  });

  test("builds recent creations with original images first and thumbnail fallback", () => {
    expect(buildCreations([
      {
        rel: "managed-1",
        name: "recent-image.png",
        date: "2026-06-01",
        size: 1024,
        url: "/images/recent-image.png",
        thumbnail_url: "/image-thumbnails/recent-image.png",
        created_at: "2026-06-01T00:00:00Z",
        width: 1536,
        height: 1024,
      },
    ])).toEqual([
      {
        id: "managed-1",
        title: "最近创作 1",
        subtitle: "1536 x 1024",
        prompt: "复用 recent-image 的视觉风格继续创作。",
        imageUrl: "/images/recent-image.png",
        imageFallbackUrl: "/image-thumbnails/recent-image.png",
      },
    ]);
  });

  test("falls back to thumbnails for recent creations when the original image is unavailable", () => {
    expect(buildCreations([
      {
        rel: "managed-2",
        name: "recent-image.png",
        date: "2026-06-01",
        size: 1024,
        url: "",
        thumbnail_url: "/image-thumbnails/recent-image.png",
        created_at: "2026-06-01T00:00:00Z",
      },
    ])).toEqual([
      expect.objectContaining({
        imageUrl: "/image-thumbnails/recent-image.png",
        imageFallbackUrl: undefined,
      }),
    ]);
  });

  test("keeps the fixed five landing items instead of using recent managed images", () => {
    const items = buildLandingHeroItems([
      {
        rel: "managed-1",
        name: "hero-1.png",
        date: "2026-06-02",
        size: 1024,
        url: "/images/hero-1.png",
        thumbnail_url: "/image-thumbnails/hero-1.png",
        created_at: "2026-06-02T00:00:00Z",
      },
      {
        rel: "managed-2",
        name: "hero-2.png",
        date: "2026-06-02",
        size: 1024,
        url: "/images/hero-2.png",
        created_at: "2026-06-02T00:01:00Z",
      },
    ]);

    expect(items).toEqual(landingHeroFallbackItems);
    expect(items).toHaveLength(5);
    expect(items.some((item) => item.id.startsWith("managed-"))).toBe(false);
  });

  test("selects the first image file from dragged data", () => {
    const textFile = new File(["not an image"], "notes.txt", { type: "text/plain" });
    const pngFile = new File(["png"], "reference.png", { type: "image/png" });
    const jpegFile = new File(["jpeg"], "portrait.jpg", { type: "image/jpeg" });

    expect(getDroppedImageFile({ files: [textFile, pngFile] })).toBe(pngFile);
    expect(
      getDroppedImageFile({
        items: [
          { kind: "file", type: "text/plain", getAsFile: () => textFile },
          { kind: "file", type: "image/jpeg", getAsFile: () => jpegFile },
        ],
      }),
    ).toBe(jpegFile);
    expect(getDroppedImageFile({ files: [textFile] })).toBeNull();
  });

  test("clears reference preview urls when removing a reference image", () => {
    const revokedUrls: string[] = [];
    const referencePreviewUrlRef = { current: "blob:cola-reference" };

    clearReferencePreviewUrl(referencePreviewUrlRef, (url) => revokedUrls.push(url));

    expect(revokedUrls).toEqual(["blob:cola-reference"]);
    expect(referencePreviewUrlRef.current).toBe("");

    clearReferencePreviewUrl(referencePreviewUrlRef, (url) => revokedUrls.push(url));

    expect(revokedUrls).toEqual(["blob:cola-reference"]);
  });

  test("renders a delete control for an attached reference image", () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <GenerateComposer
        prompt=""
        count={1}
        quality="智能"
        ratio="1:1"
        resolution="1k"
        imageModel="auto"
        publicMode={false}
        referenceImage={{ name: "reference.png", previewUrl: "blob:cola-reference" }}
        onPromptChange={noop}
        onCountChange={noop}
        onQualityChange={noop}
        onRatioChange={noop}
        onResolutionChange={noop}
        onImageModelChange={noop}
        onPublicChange={noop}
        onReferenceFileChange={noop}
        onReferenceRemove={noop}
        onOpenPrompts={noop}
        onGenerate={noop}
      />,
    );

    expect(markup).toContain('data-cola-action="remove-reference"');
    expect(markup).toContain('aria-label="删除参考图 reference.png"');
    expect(markup).toContain('data-cola-panel="reference-image-preview"');
    expect(markup).toContain('data-cola-panel="reference-image-name"');
  });

  test("renders the generation composer as a clear studio composer", () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <GenerateComposer
        prompt=""
        count={1}
        quality="智能"
        ratio="1:1"
        resolution="2k"
        imageModel="auto"
        publicMode={false}
        referenceImage={null}
        onPromptChange={noop}
        onCountChange={noop}
        onQualityChange={noop}
        onRatioChange={noop}
        onResolutionChange={noop}
        onImageModelChange={noop}
        onPublicChange={noop}
        onReferenceFileChange={noop}
        onReferenceRemove={noop}
        onOpenPrompts={noop}
        onGenerate={noop}
      />,
    );

    expect(markup).toContain('data-cola-design="clear-studio-composer"');
    expect(markup).toContain('data-cola-panel="reference-material-slot"');
    expect(markup).toContain('data-cola-panel="ratio-count-popover"');
    expect(markup).toContain('data-cola-group="resolution-options"');
    expect(markup).toContain('data-cola-resolution-option="1k"');
    expect(markup).toContain('data-cola-resolution-option="2k"');
    expect(markup).toContain('data-cola-resolution-option="4k"');
    expect(markup).toContain("2K");
    expect(markup).toContain("创作控制台");
    expect(markup).toContain("size-[60px]");
    expect(markup).toContain("bg-slate-950");
    expect(markup).not.toContain('data-cola-design="creative-instrument-panel"');
    expect(markup).not.toContain('data-cola-effect="shimmer-button"');
    expect(markup).not.toContain("before:bg-gradient-to-r");
  });

  test("renders active generation as a developing studio stage", () => {
    const markup = renderToStaticMarkup(<GenerationStage isActive taskCount={3} />);

    expect(markup).toContain('data-cola-effect="image-developing-stage"');
    expect(markup).toContain('data-cola-panel="generation-developing-frame"');
    expect(markup).toContain('data-cola-panel="generation-rhythm-notes"');
    expect(markup).toContain('data-cola-effect="colorful-music-notes"');
    expect(markup).toContain('data-cola-tone="rainbow"');
    expect(markup).toContain('data-cola-motion="syncopated-jump"');
    expect(markup.match(/data-cola-note-tone="rainbow"/g)).toHaveLength(3);
    expect(markup).toContain('data-cola-note-index="0"');
    expect(markup).toContain('data-cola-note-index="1"');
    expect(markup).toContain('data-cola-note-index="2"');
    expect(markup).toContain("🎶");
    expect(markup).toContain("正在生成图片");
    expect(markup).not.toContain('data-cola-panel="generation-phase-list"');
    expect(markup).not.toContain("理解提示词与构图偏好");
    expect(markup).not.toContain("保存作品并准备展示");
  });

  test("renders the generate session rail as a creative session strip", () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <GenerateSessionRail
        sessions={[
          { id: "session-1", title: "产品主视觉", createdAt: "2026-05-30T10:00:00+08:00", updatedAt: "2026-05-30T10:02:00+08:00", taskIds: [] },
          { id: "session-2", title: "角色设定", createdAt: "2026-05-30T10:03:00+08:00", updatedAt: "2026-05-30T10:04:00+08:00", taskIds: [] },
        ]}
        activeSessionId="session-1"
        tasks={[]}
        onCreateSession={noop}
        onSelectSession={noop}
        onDeleteSession={noop}
        onOpenQueue={noop}
      />,
    );

    expect(markup).toContain('data-cola-design="creative-session-strip"');
    expect(markup).toContain('data-cola-state="active"');
    expect(markup).toContain('data-cola-panel="generate-session-active-dot"');
  });

  test("renders the dragged image hint overlay from the studio workflow", () => {
    const markup = renderToStaticMarkup(<ReferenceDropOverlay active />);

    expect(markup).toContain('data-cola-panel="reference-drop-overlay"');
    expect(markup).toContain('data-cola-state="active"');
    expect(markup).toContain("松开添加为作画参考图");
    expect(markup).toContain("会放入下方生图对话框");
  });

  test("submits prompt composers with Enter while keeping Shift+Enter for new lines", () => {
    let submitCount = 0;
    let preventDefaultCount = 0;

    handlePromptComposerKeyDown(
      {
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: false },
        preventDefault: () => {
          preventDefaultCount += 1;
        },
      },
      () => {
        submitCount += 1;
      },
    );

    expect(submitCount).toBe(1);
    expect(preventDefaultCount).toBe(1);

    handlePromptComposerKeyDown(
      {
        key: "Enter",
        shiftKey: true,
        nativeEvent: { isComposing: false },
        preventDefault: () => {
          preventDefaultCount += 1;
        },
      },
      () => {
        submitCount += 1;
      },
    );

    handlePromptComposerKeyDown(
      {
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
        preventDefault: () => {
          preventDefaultCount += 1;
        },
      },
      () => {
        submitCount += 1;
      },
    );

    expect(submitCount).toBe(1);
    expect(preventDefaultCount).toBe(1);
  });

  test("renders active generation status as a full developing placeholder", () => {
    const markup = renderToStaticMarkup(<GenerationStage isActive taskCount={1} />);

    expect(markup).toContain('data-cola-panel="generation-text-status"');
    expect(markup).toContain('data-cola-effect="image-developing-stage"');
    expect(markup).toContain('data-cola-panel="generation-developing-frame"');
    expect(markup).toContain('data-cola-panel="generation-rhythm-notes"');
    expect(markup).toContain('data-cola-effect="colorful-music-notes"');
    expect(markup).toContain('data-cola-tone="rainbow"');
    expect(markup).toContain('data-cola-motion="syncopated-jump"');
    expect(markup.match(/data-cola-note-tone="rainbow"/g)).toHaveLength(3);
    expect(markup).toContain("生成中");
    expect(markup).toContain("正在生成图片");
    expect(markup).toContain("🎶");
    expect(markup).toContain("队列 1");
    expect(markup).toContain("absolute inset-0");
    expect(markup).not.toContain('data-cola-panel="generation-phase-list"');
    expect(markup).not.toContain('data-cola-panel="generation-stage"');
    expect(markup).not.toContain('data-cola-effect="rova-generation-loader"');
    expect(markup).not.toContain('data-cola-effect="paint-drip-loader"');
    expect(markup).not.toContain('data-cola-effect="generation-shimmer"');
    expect(markup).not.toContain("AI 画笔正在起舞");
    expect(markup).not.toContain("生成画面并细化视觉细节");
    expect(markup).not.toContain("撒上一些像素魔法");
  });

  test("renders successful generation task images in the generate stage", () => {
    const markup = renderToStaticMarkup(<GenerateResultGrid tasks={[successTask]} />);

    expect(markup).toContain('data-cola-panel="generate-result-grid"');
    expect(markup).toContain('data-cola-task-id="task-success-1"');
    expect(markup).toContain("/api/images/generated-1.png");
    expect(markup).toContain("成片提示词");
    expect(markup).not.toContain('data-cola-panel="generation-text-status"');
  });

  test("keeps active generation placeholders free of result actions", () => {
    const activeTask: GenerateTask = {
      id: "task-running-1",
      status: "running",
      phase_label: "生成中",
      mode: "generate",
      model: "gpt-image-2",
      size: "1:1",
      created_at: "2026-05-27T15:34:00+08:00",
      updated_at: "2026-05-27T15:34:01+08:00",
      submissionContext: {
        prompt: "正在生成的提示词",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
        attempt: 1,
        turnId: "turn-running",
      },
    };

    const markup = renderToStaticMarkup(
      <GenerateConversationStage
        session={{
          id: "session-running",
          title: "正在生成的提示词",
          createdAt: "2026-05-27T15:34:00+08:00",
          updatedAt: "2026-05-27T15:34:01+08:00",
          taskIds: ["task-running-1"],
        }}
        tasks={[activeTask]}
        generationError=""
        isStageActive
        stageTaskCount={1}
        activeTask={activeTask}
        hasGeneratedResults={false}
        requestedCount={1}
      />,
    );

    expect(markup).toContain('data-cola-panel="generate-result-placeholder"');
    expect(markup).toContain('data-cola-panel="generation-text-status"');
    expect(markup).toContain('data-cola-panel="generation-rhythm-notes"');
    expect(markup).toContain("生成图片占位");
    expect(markup).not.toContain("结果 1");
    expect(markup).not.toContain('data-cola-panel="generate-result-actions"');
    expect(markup).not.toContain('aria-label="复制结果 1"');
    expect(markup).not.toContain('aria-label="编辑结果 1"');
    expect(markup).not.toContain('aria-label="下载结果 1"');
  });

  test("keeps queue waiting time out of active generation elapsed time", () => {
    const activeTask: GenerateTask = {
      id: "task-running-after-queue",
      status: "running",
      phase_label: "生成中",
      mode: "generate",
      model: "gpt-image-2",
      size: "1:1",
      created_at: "2026-05-27T00:00:00Z",
      queued_at: "2026-05-27T00:00:00Z",
      started_at: "2026-05-27T00:02:10Z",
      updated_at: "2026-05-27T00:02:11Z",
      submissionContext: {
        prompt: "排队后开始生成的提示词",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
        attempt: 1,
        turnId: "turn-running-after-queue",
      },
    };

    const markup = renderToStaticMarkup(
      <GenerateConversationStage
        session={{
          id: "session-running-after-queue",
          title: "排队后开始生成的提示词",
          createdAt: "2026-05-27T00:00:00Z",
          updatedAt: "2026-05-27T00:02:11Z",
          taskIds: ["task-running-after-queue"],
        }}
        tasks={[activeTask]}
        generationError=""
        isStageActive
        stageTaskCount={1}
        activeTask={activeTask}
        hasGeneratedResults={false}
        requestedCount={1}
      />,
    );

    expect(markup).toContain("耗时 1.0 s");
    expect(markup).toContain("等待 130 s");
    expect(markup).not.toContain("耗时 130 s");
    expect(markup).not.toContain("耗时 131 s");
  });

  test("renders generated conversation records only when the stage has content", () => {
    const markup = renderToStaticMarkup(
      <GenerateConversationStage
        session={{
          id: "session-1",
          title: "生成一张芙莉莲",
          createdAt: "2026-05-27T15:20:00+08:00",
          updatedAt: "2026-05-27T15:30:00+08:00",
          taskIds: ["task-success-1"],
        }}
        tasks={[successTask]}
        generationError=""
        isStageActive={false}
        stageTaskCount={0}
        hasGeneratedResults
        requestedCount={1}
      />,
    );

    expect(markup).toContain('data-cola-panel="generate-conversation-stage"');
    expect(markup).toContain('data-cola-design="developing-studio-stage"');
    expect(markup).toContain('data-cola-state="content"');
    expect(markup).toContain('data-cola-behavior="middle-conversation-scroll"');
    expect(markup).toContain('data-cola-panel="generate-conversation-thread"');
    expect(markup).toContain('data-cola-panel="generate-conversation-thread" class="hide-scrollbar flex min-h-0 flex-1 flex-col gap-7 overflow-hidden');
    expect(markup).toContain('data-cola-panel="generate-record-card"');
    expect(markup).toContain('data-cola-behavior="record-scroll-box"');
    expect(markup).toContain('data-cola-panel="generate-record-scroll"');
    expect(markup).toContain('data-cola-behavior="internal-record-scroll"');
    expect(markup).toContain("max-h-full");
    expect(markup).toContain("mx-auto");
    expect(markup).toContain("flex-1 overflow-hidden rounded-[32px] bg-white/70");
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("overscroll-contain");
    expect(markup).toContain("pb-12");
    expect(markup).toContain("max-w-[1040px]");
    expect(markup).toContain('data-cola-layout="studio-creation-record-flow"');
    expect(markup).not.toContain('data-cola-layout="image-left-prompt-right"');
    expect(markup).not.toContain('data-cola-layout="prompt-top-result-row"');
    expect(markup).toContain('data-cola-panel="generate-prompt-card"');
    expect(markup).toContain('data-cola-panel="generate-prompt-meta"');
    expect(markup).toContain('data-cola-panel="generate-status-strip"');
    expect(markup).toContain('data-cola-panel="generate-result-cards"');
    expect(markup).toContain('data-cola-panel="generate-result-card"');
    expect(markup).toContain('data-cola-panel="generate-result-card-footer"');
    expect(markup).toContain('data-cola-panel="generate-result-actions"');
    expect(markup).toContain('data-cola-panel="generate-run-card"');
    expect(markup).toContain('data-cola-panel="generate-result-summary"');
    expect(markup).toContain('data-cola-panel="generate-result-gallery"');
    expect(markup).toContain('data-cola-task-id="task-success-1"');
    expect(markup).toContain("ml-auto w-full max-w-[560px]");
    expect(markup).toContain("rounded-[22px] bg-white/92 px-3.5 py-2.5");
    expect(markup).toContain("overflow-hidden whitespace-nowrap pr-16 text-[11px]");
    expect(markup).toContain("absolute right-3 top-2");
    expect(markup).toContain("mt-1.5 text-sm font-semibold leading-6");
    expect(markup).toContain('data-cola-panel="generate-status-strip" class="inline-flex w-fit max-w-full self-start flex-wrap items-center gap-1.5 text-xs');
    expect(markup).toContain('data-cola-panel="generate-result-summary" class="flex max-w-full flex-wrap items-center gap-1.5');
    expect(markup).toContain("rounded-full bg-slate-100/70 px-2 py-1 leading-none");
    expect(markup).not.toContain('data-cola-panel="generate-status-strip" class="flex w-full flex-wrap items-center gap-3 text-base');
    expect(markup).toContain("w-[min(320px,72vw)]");
    expect(markup).toContain("object-cover");
    expect(markup).not.toContain("object-contain");
    expect(markup).toContain("结果 1");
    expect(markup).toContain('aria-label="复制结果 1"');
    expect(markup).toContain('aria-label="编辑结果 1"');
    expect(markup).toContain('aria-label="下载结果 1"');
    expect(markup.indexOf('data-cola-panel="generate-prompt-card"')).toBeLessThan(markup.indexOf('data-cola-panel="generate-status-strip"'));
    expect(markup.indexOf('data-cola-panel="generate-status-strip"')).toBeLessThan(markup.indexOf('data-cola-panel="generate-result-cards"'));
    expect(markup.indexOf('data-cola-panel="generate-result-summary"')).toBeLessThan(markup.indexOf('data-cola-panel="generate-result-gallery"'));
    expect(markup.indexOf('data-cola-panel="generate-prompt-card"')).toBeGreaterThan(markup.indexOf('data-cola-panel="generate-record-scroll"'));
    expect(markup).not.toContain("w-[min(320px,74vw)]");
    expect(markup).not.toContain("w-[min(390px,82vw)]");
    expect(markup).not.toContain("bg-slate-950");
    expect(markup).toContain("生成一张芙莉莲");
    expect(markup).toContain("成功1/失败0");
    expect(markup).toContain("耗时 1.0 s");
    expect(markup).toContain("等待 1.0 s");
    expect(markup).not.toContain("本次耗时 1.0 s");
    expect(markup).not.toContain("已等待 1.0 s");
    expect(markup).not.toContain('data-cola-panel="generate-task-details"');
    expect(markup).not.toContain("任务详情");
    expect(markup).not.toContain("用于排查提交参数");
    expect(markup).not.toContain('data-cola-panel="generate-empty-conversation-space"');
  });

  test("stacks multiple generate turns inside the same session", () => {
    const firstTurnTask: GenerateTask = {
      ...successTask,
      submissionContext: {
        prompt: "生成一张芙莉莲",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
        attempt: 1,
        turnId: "turn-1",
      },
    };
    const secondTurnTask: GenerateTask = {
      ...secondSuccessTask,
      submissionContext: {
        prompt: "生成一张泳装芙莉莲",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
        attempt: 1,
        turnId: "turn-2",
      },
    };
    const markup = renderToStaticMarkup(
      <GenerateConversationStage
        session={{
          id: "session-1",
          title: "芙莉莲连续生成",
          createdAt: "2026-05-27T15:20:00+08:00",
          updatedAt: "2026-05-27T15:32:00+08:00",
          taskIds: ["task-success-1", "task-success-2"],
        }}
        tasks={[firstTurnTask, secondTurnTask]}
        generationError=""
        isStageActive={false}
        stageTaskCount={0}
        hasGeneratedResults
        requestedCount={1}
      />,
    );

    expect(markup.match(/data-cola-panel="generate-prompt-card"/g)).toHaveLength(2);
    expect(markup.match(/data-cola-panel="generate-status-strip"/g)).toHaveLength(2);
    expect(markup).toContain("第 1 轮");
    expect(markup).toContain("第 2 轮");
    expect(markup).toContain("生成一张芙莉莲");
    expect(markup).toContain("生成一张泳装芙莉莲");
    expect(markup.indexOf("生成一张芙莉莲")).toBeLessThan(markup.indexOf("生成一张泳装芙莉莲"));
  });

  test("renders failed generation tasks as visible conversation records", () => {
    const markup = renderToStaticMarkup(
      <GenerateConversationStage
        session={{
          id: "session-1",
          title: "生成一张芙莉莲",
          createdAt: "2026-05-27T15:20:00+08:00",
          updatedAt: "2026-05-27T15:30:00+08:00",
          taskIds: ["task-failed-1"],
        }}
        tasks={[failedTask]}
        generationError=""
        isStageActive={false}
        stageTaskCount={0}
        hasGeneratedResults={false}
        requestedCount={1}
        onRetryGeneration={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="generate-task-errors"');
    expect(markup).toContain('data-cola-task-id="task-failed-1"');
    expect(markup).toContain("成功0/失败1");
    expect(markup).toContain("账号额度不足，请稍后重试。");
    expect(markup).toContain('data-cola-action="retry-failed-generation"');
    expect(markup).toContain("重试");
  });

  test("renders retrying failed generation tasks with a disabled retry action", () => {
    const retryingFailedTask = {
      ...failedTask,
      submissionContext: {
        prompt: "生成一张芙莉莲",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
        attempt: 1,
        retrying: true,
      },
    } as ImageTask;

    const markup = renderToStaticMarkup(
      <GenerateConversationStage
        session={{
          id: "session-1",
          title: "生成一张芙莉莲",
          createdAt: "2026-05-27T15:20:00+08:00",
          updatedAt: "2026-05-27T15:30:00+08:00",
          taskIds: ["task-failed-1"],
        }}
        tasks={[retryingFailedTask]}
        generationError=""
        isStageActive={false}
        stageTaskCount={0}
        hasGeneratedResults={false}
        requestedCount={1}
        onRetryGeneration={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-action="retry-failed-generation"');
    expect(markup).toContain('data-cola-retry-state="retrying"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("重试中");
  });

  test("keeps diagnostic task details out of the middle creation record", () => {
    const markup = renderToStaticMarkup(
      <GenerateConversationStage
        session={{
          id: "session-1",
          title: "生成一张芙莉莲",
          createdAt: "2026-05-27T15:20:00+08:00",
          updatedAt: "2026-05-27T15:30:00+08:00",
          taskIds: ["task-failed-1"],
        }}
        tasks={[failedTaskWithContext]}
        generationError=""
        isStageActive={false}
        stageTaskCount={0}
        hasGeneratedResults={false}
        requestedCount={3}
        onRetryGeneration={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="generate-record-card"');
    expect(markup).toContain('data-cola-layout="studio-creation-record-flow"');
    expect(markup).toContain("账号额度不足，请稍后重试。");
    expect(markup).toContain('data-cola-action="retry-failed-generation"');
    expect(markup).not.toContain('data-cola-panel="generate-task-details"');
    expect(markup).not.toContain('data-cola-task-detail-id="task-failed-1"');
    expect(markup).not.toContain("任务详情");
    expect(markup).not.toContain("用于排查提交参数");
    expect(markup).not.toContain("失败时的完整原始提示词");
    expect(markup).not.toContain("task-original-failed");
    expect(markup).not.toContain('data-cola-action="copy-generate-task-id"');
    expect(markup).not.toContain('data-cola-action="copy-generate-task-error"');
    expect(markup).not.toContain('data-cola-action="retry-failed-generation-detail"');
  });

  test("renders a focused task diagnostics panel from a canvas failure", () => {
    const markup = renderToStaticMarkup(
      <GenerateTaskDiagnosticsPanel
        task={failedTaskWithContext}
        canvasTask={{
          id: "task-failed-1",
          prompt: "画布节点原始提示词",
          error: "账号额度不足，请稍后重试。",
          status: "error",
          model: "gpt-image-2",
          size: "1:1",
          attempt: 2,
        }}
        focusSource="canvas"
        onRetryGeneration={() => undefined}
        onClearFocus={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="generate-task-diagnostics"');
    expect(markup).toContain('data-cola-task-detail-id="task-failed-1"');
    expect(markup).toContain('data-cola-task-detail-state="focused"');
    expect(markup).toContain('data-cola-focus-source="canvas"');
    expect(markup).toContain("画布定位");
    expect(markup).toContain("失败时的完整原始提示词");
    expect(markup).toContain("task-original-failed");
    expect(markup).toContain('data-cola-action="copy-generate-task-id"');
    expect(markup).toContain('data-cola-action="copy-generate-task-error"');
    expect(markup).toContain('data-cola-action="retry-failed-generation-detail"');
  });

  test("renders canvas-focused task diagnostics in the generate workspace outside the creation record", () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <GenerateWorkspace
        prompt=""
        count={1}
        quality="智能"
        ratio="1:1"
        resolution="1k"
        imageModel="auto"
        publicMode={false}
        referenceImage={null}
        isGenerating={false}
        submittedTasks={[failedTaskWithContext]}
        generateSessions={[
          {
            id: "session-1",
            title: "生成一张芙莉莲",
            createdAt: "2026-05-27T15:20:00+08:00",
            updatedAt: "2026-05-27T15:30:00+08:00",
            taskIds: ["task-failed-1"],
          },
        ]}
        activeGenerateSessionId="session-1"
        generationError=""
        focusedTaskId="task-failed-1"
        focusedCanvasTask={{
          id: "task-failed-1",
          nodeId: "canvas-node-1",
          prompt: "画布节点原始提示词",
          error: "账号额度不足，请稍后重试。",
          status: "error",
          model: "gpt-image-2",
          size: "1:1",
          attempt: 2,
        }}
        onPromptChange={noop}
        onCountChange={noop}
        onQualityChange={noop}
        onRatioChange={noop}
        onResolutionChange={noop}
        onImageModelChange={noop}
        onPublicChange={noop}
        onReferenceFileChange={noop}
        onReferenceRemove={noop}
        onOpenPrompts={noop}
        onCreateSession={noop}
        onSelectSession={noop}
        onDeleteSession={noop}
        onOpenQueue={noop}
        onGenerate={noop}
        onRetryGeneration={noop}
        onClearFocusedTask={noop}
      />,
    );

    expect(markup).toContain('data-cola-panel="generate-task-diagnostics"');
    expect(markup).toContain('data-cola-task-detail-id="task-failed-1"');
    expect(markup).toContain('data-cola-focus-source="canvas"');
    expect(markup.indexOf('data-cola-panel="generate-conversation-stage"')).toBeLessThan(
      markup.indexOf('data-cola-panel="generate-task-diagnostics"'),
    );
  });

  test("renders a lightweight generate session rail", () => {
    const markup = renderToStaticMarkup(
      <GenerateSessionRail
        sessions={[
          { id: "session-1", title: "赛博城市海报与未来城市夜景长标题测试", createdAt: "2026-05-27T15:20:00+08:00", updatedAt: "2026-05-27T15:30:00+08:00", tasks: [successTask] },
          { id: "session-2", title: "空对话", createdAt: "2026-05-27T15:32:00+08:00", updatedAt: "2026-05-27T15:32:00+08:00", tasks: [] },
        ]}
        activeSessionId="session-1"
        onCreateSession={() => {}}
        onSelectSession={() => {}}
        onDeleteSession={() => {}}
        onOpenQueue={() => {}}
      />,
    );

    expect(markup).toContain('data-cola-panel="generate-session-rail"');
    expect(markup).toContain('data-cola-design="creative-session-strip"');
    expect(markup).toContain('data-cola-state="active"');
    expect(markup).toContain('data-cola-visual="glass-session-strip"');
    expect(markup).toContain("bg-white/54");
    expect(markup).toContain("border-emerald-100/55");
    expect(markup).toContain("backdrop-blur-2xl");
    expect(markup).toContain("min-h-[62px]");
    expect(markup).toContain("flex-nowrap");
    expect(markup).not.toContain("区分每一组当前生成");
    expect(markup).not.toContain(">生成会话</p>");
    expect(markup).toContain('data-cola-action="create-generate-session"');
    expect(markup).toContain("新建对话");
    expect(markup).toContain('data-cola-action="delete-generate-session"');
    expect(markup).toContain('aria-label="删除当前对话"');
    expect(markup).toContain('data-cola-action="open-task-queue"');
    expect(markup).toContain('aria-label="打开任务队列"');
    expect(markup).toContain('data-cola-panel="generate-session-actions"');
    expect(markup.indexOf('data-cola-action="delete-generate-session"')).toBeLessThan(markup.indexOf('data-cola-action="open-task-queue"'));
    expect(markup.indexOf('data-cola-action="open-task-queue"')).toBeLessThan(markup.indexOf('data-cola-action="create-generate-session"'));
    expect(markup).toContain('data-cola-session-id="session-1"');
    expect(markup).toContain('data-cola-session-state="active"');
    expect(markup).toContain('data-cola-panel="generate-session-active-dot"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain('data-cola-panel="generate-session-active-indicator"');
    expect(markup).toContain("当前");
    expect(markup).toContain('data-cola-panel="generate-session-list"');
    expect(markup).toContain('data-cola-behavior="drag-scroll-sessions"');
    expect(markup).toContain('data-cola-session-click-target="true"');
    expect(markup).toContain("cursor-grab");
    expect(markup).toContain("overscroll-x-contain");
    expect(markup).toContain('data-cola-panel="generate-session-title"');
    expect(markup).toContain('data-cola-panel="generate-session-meta"');
    expect(markup).toContain("truncate");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).toContain("赛博城市海报与未来城市夜景长标题测试");
    expect(markup).toContain("05/27 15:30 · 已生成 1 张图片");
    expect(markup).toContain("05/27 15:32 · 已生成 0 张图片");
    expect(markup).not.toContain("1 张结果");
    expect(markup).not.toContain("空会话");
  });

  test("renders task queue as a compact popover with blank-area close target", () => {
    const queuedTask: GenerateTask = {
      id: "task-queued-1",
      status: "queued",
      phase_label: "等待生成",
      mode: "generate",
      model: "gpt-image-2",
      size: "1:1",
      created_at: "2026-05-27T15:34:00+08:00",
      updated_at: "2026-05-27T15:34:00+08:00",
      submissionContext: {
        prompt: "排队中的创意提示词",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
        attempt: 1,
      },
    };

    const markup = renderToStaticMarkup(
      <TaskQueuePopover open role="creator" tasks={[queuedTask]} onClose={() => {}} />,
    );

    expect(markup).toContain('data-cola-panel="task-queue-popover"');
    expect(markup).toContain('data-cola-backdrop="task-queue-popover"');
    expect(markup).toContain('aria-label="关闭任务队列"');
    expect(markup).toContain("absolute right-0 top-[calc(100%+10px)]");
    expect(markup).toContain("w-[min(360px,calc(100vw-32px))]");
    expect(markup).toContain("任务队列");
    expect(markup).toContain("1 个任务处理中");
    expect(markup).toContain("创作者");
    expect(markup).toContain("排队中的创意提示词");
    expect(markup).toContain("等待生成");
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain("fixed inset-0 z-50 grid place-items-center");
  });

  test("does not render the task queue popover while closed", () => {
    const markup = renderToStaticMarkup(<TaskQueuePopover open={false} tasks={[]} onClose={() => {}} />);

    expect(markup).not.toContain('data-cola-panel="task-queue-popover"');
    expect(markup).not.toContain('data-cola-backdrop="task-queue-popover"');
  });

  test("new generate sessions are inserted even when an empty session already exists", () => {
    const previousSessions = [
      { id: "empty-old", title: "空对话", createdAt: "2026-05-27T15:32:00+08:00", updatedAt: "2026-05-27T15:32:00+08:00", taskIds: [] },
      { id: "filled", title: "赛博城市", createdAt: "2026-05-27T15:20:00+08:00", updatedAt: "2026-05-27T15:30:00+08:00", taskIds: ["task-success-1"] },
    ];
    const nextSession = { id: "empty-newest", title: "空对话", createdAt: "2026-05-27T15:33:00+08:00", updatedAt: "2026-05-27T15:33:00+08:00", taskIds: [] };

    expect(prependGenerateSession(previousSessions, nextSession).map((sessionItem) => sessionItem.id)).toEqual([
      "empty-newest",
      "empty-old",
      "filled",
    ]);
  });

  test("filters generated images to the active generate session", () => {
    const markup = renderToStaticMarkup(
      <GenerateResultGrid
        tasks={[successTask, secondSuccessTask]}
        sessions={[
          { id: "session-1", title: "第一组", createdAt: "2026-05-27T00:00:00Z", updatedAt: "2026-05-27T00:01:00Z", taskIds: ["task-success-1"] },
          { id: "session-2", title: "第二组", createdAt: "2026-05-27T00:02:00Z", updatedAt: "2026-05-27T00:02:00Z", taskIds: ["task-success-2"] },
        ]}
        activeSessionId="session-1"
      />,
    );

    expect(markup).toContain("/api/images/generated-1.png");
    expect(markup).toContain("成片提示词");
    expect(markup).not.toContain("/api/images/generated-2.png");
    expect(markup).not.toContain("第二组结果");
  });

  test("renders the clear studio discover home by default", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} />);

    expect(markup).toContain("ColaAI");
    expect(markup).toContain('data-cola-layout="rova-like"');
    expect(markup).toContain('data-cola-drop-scope="global-reference-image"');
    expect(markup).toContain('data-cola-performance="paint-optimized"');
    expect(markup).toContain('data-cola-mode="discover"');
    expect(markup).toContain('data-cola-panel="side-nav"');
    expect(markup).toContain('data-cola-behavior="rova-glass-rail"');
    expect(markup).toContain('data-cola-panel="discover-home"');
    expect(markup).toContain('data-cola-behavior="drop-reference-image"');
    expect(markup).toContain('data-cola-drop-target="image-reference"');
    expect(markup).toContain('data-cola-panel="discover-hero"');
    expect(markup).toContain('data-cola-design="clear-studio"');
    expect(markup).toContain('data-cola-design="clear-studio-composer"');
    expect(markup).toContain('data-cola-brand="clear-studio"');
    expect(markup).toContain('data-cola-layout="rova-export-hero"');
    expect(markup).toContain('data-cola-panel="composer"');
    expect(markup).toContain('data-cola-variant="rova-compact-hero"');
    expect(markup).toContain('data-cola-density="rova-compact"');
    expect(markup).toContain('data-cola-control="ratio-count"');
    expect(markup).toContain('data-cola-toolbar="prompt-controls"');
    expect(markup).toContain('data-cola-fit="nowrap-chip"');
    expect(markup).toContain('data-cola-panel="creation-feed"');
    expect(markup).toContain('data-cola-layout="masonry-feed"');
    expect(markup).toContain('data-cola-panel="pull-refresh-indicator"');
    expect(markup).toContain('data-cola-behavior="pull-to-refresh"');
    expect(markup).toContain('data-cola-effect="rova-pull-loader"');
    expect(markup).toContain('data-cola-panel="sticky-composer"');
    expect(markup).toContain('data-cola-behavior="appears-after-hero"');
    expect(markup).toContain('data-cola-visual="rova-media-background"');
    expect(markup).toContain('data-cola-motion="mux-video-background"');
    expect(markup).toContain('data-cola-background="rova-export-media"');
    expect(markup).toContain('data-cola-background="mux-hr-saas-video"');
    expect(markup).toContain("https://player.mux.com/i5P900Vm00u3LKTiYNMB5hSQ33j9jCsYCPslVCm2Cghec");
    expect(markup).toContain("autoplay=muted");
    expect(markup).toContain("muted=true");
    expect(markup).toContain("loop=true");
    expect(markup).toContain("preload=auto");
    expect(markup).toContain("controls=false");
    expect(markup).toContain("rotate-180");
    expect(markup).toContain("scale-x-[-1]");
    expect(markup).toContain("w-[max(1687px,calc(100vw+320px))]");
    expect(markup).toContain("h-[max(938px,calc((100vw+320px)*134/241))]");
    expect(markup).toContain("min-w-[1687px]");
    expect(markup).toContain("left-1/2");
    expect(markup).toContain("-translate-x-1/2");
    expect(markup).toContain("-top-[96px]");
    expect(markup).toContain("will-change-transform");
    expect(markup).not.toContain('data-cola-effect="mux-load-cover"');
    expect(markup).not.toContain("top-[118px]");
    expect(markup).toContain("metadata-video-title=hf_20260302_085640_276ea93b-d7da-4418-a09b-2aa5b490e838");
    expect(markup).toContain("allowFullScreen");
    expect(markup).not.toContain("/colaai/hr-saas-landing-page-replicated.png");
    expect(markup).not.toContain('data-cola-effect="rounded-media-grid"');
    expect(markup).toContain('data-cola-effect="svg-export-fade"');
    expect(markup).not.toContain('data-cola-effect="svg-export-radial"');
    expect(markup).not.toContain('data-cola-background-tile="media-thumb"');
    expect(markup).not.toContain("mix-blend-soft-light");
    expect(markup).toContain('data-cola-effect="sparkle-text"');
    expect(markup).not.toContain('data-cola-effect="shimmer-button"');
    expect(markup).not.toContain("font-serif");
    expect(markup).not.toContain("italic tracking-normal");
    expect(markup).toContain('data-cola-action="submit-generation"');
    expect(markup).toContain('data-cola-action="open-prompt-market"');
    expect(markup).toContain('data-cola-panel="mobile-utility-nav"');
    expect(markup).toContain('data-cola-panel="mobile-more-sheet"');
    expect(markup).toContain('data-cola-rail-label="ColaAI"');
    expect(markup).toContain('data-cola-brand="clear-studio"');
    expect(markup).not.toContain('data-cola-effect="line-shadow-logo"');
    expect(markup).toContain('data-cola-action="toggle-language"');
    expect(markup).not.toContain('data-cola-action="open-announcement"');
    expect(markup).not.toContain('data-cola-action="open-contact"');
    expect(markup).not.toContain('data-cola-action="open-credits"');
    expect(markup).not.toContain('data-cola-action="open-credit-history"');
    expect(markup).toContain('data-cola-action="open-more-menu"');
    expect(markup).toContain("用想象力 创造世界");
    expect(markup).toContain("请输入你的创意");
    expect(markup).toContain("描述你想创作的图片");
    expect(markup).toContain("参考图");
    expect(markup).toContain("GPT-IMAGE-2");
    expect(markup).toContain("9:16");
    expect(markup).toContain("1:1");
    expect(markup).toContain("图片比例");
    expect(markup).toContain("生成数量");
    expect(markup).toContain("Auto | 1K | 1张");
    expect(markup).toContain('data-cola-panel="studio-generation-settings"');
    expect(markup).toContain("w-[min(360px,calc(100vw-32px))]");
    expect(markup).toContain("p-3");
    expect(markup).toContain("h-[72px]");
    expect(markup).toContain("bottom-[62px]");
    expect(markup).toContain("opacity:0");
    expect(markup).toContain("pointer-events:none");
    expect(markup).not.toContain("w-[min(436px,calc(100vw-32px))]");
    expect(markup).not.toContain("h-24");
    expect(markup).toContain("h-[72px]");
    expect(markup).toContain('data-cola-group="ratio-options"');
    expect(markup).toContain('data-cola-group="count-options"');
    expect(markup).toContain('data-cola-state="auto"');
    expect(markup).toContain('data-cola-ratio-option="1:1"');
    expect(markup).toContain('data-cola-ratio-option="16:9"');
    expect(markup).toContain('data-cola-ratio-option="4:3"');
    expect(markup).toContain('data-cola-ratio-option="3:4"');
    expect(markup).toContain('data-cola-ratio-option="9:16"');
    expect(markup).toContain('data-cola-count-option="1"');
    expect(markup).toContain('data-cola-count-option="2"');
    expect(markup).toContain('data-cola-count-option="3"');
    expect(markup).toContain('data-cola-count-option="4"');
    expect(markup).not.toContain('data-cola-count-option="8"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="true" data-cola-count-option="1"');
    expect(markup).toContain("公开");
    expect(markup).toContain('data-cola-control="public-mode"');
    expect(markup).toContain('aria-pressed="false" data-cola-control="public-mode"');
    expect(markup).toContain("left-0.5");
    expect(markup).toContain("生成");
    expect(markup).toContain("今日已生成");
    expect(markup).toContain("公共精选");
    expect(markup).toContain("来自 ColaAI 社区");
    expect(markup).not.toContain("来自你的灵感");
    expect(markup).toContain("下拉刷新灵感");
    expect(markup).toContain("释放更新");
    expect(markup).toContain("正在加载灵感");
    expect(markup).toContain("做同款");
    expect(markup).toContain("复制");
    expect(markup).toContain('data-cola-action="copy-prompt"');
    expect(markup).toContain('data-cola-action="remix"');
    expect(markup).toContain("md:min-h-[704px]");
    expect(markup).toContain("md:pt-[169px]");
    expect(markup).toContain("mt-[17px]");
    expect(markup).toContain("mt-[24px]");
    expect(markup).not.toContain("md:min-h-[620px]");
    expect(markup).toContain("提示词");
    expect(markup).toContain("资产");
    expect(markup).toContain("API");
    expect(markup).toContain("画布");
    expect(markup).toContain("设置");
    expect(markup).toContain("公告");
    expect(markup).toContain("EN");
    expect(markup.indexOf("生图")).toBeLessThan(markup.indexOf("画布"));
    expect(markup.indexOf("画布")).toBeLessThan(markup.indexOf("提示词"));
    expect(markup).toContain('data-cola-mobile-mode="prompts"');
    expect(markup).not.toContain("联系管理员");
    expect(markup).not.toContain("积分明细");
    expect(markup).not.toContain("获取更多积分");
    expect(markup).not.toContain("今日免费 3/3 +20");
    expect(markup).not.toContain("3/3");
    expect(markup).not.toContain("+20");
    expect(markup).toContain("更多");
    expect(markup).toContain("登录 / 注册");
    expect(markup).toContain("任务队列");
    expect(markup).toContain("图片库");
    expect(markup).toContain("提示词");
    expect(markup).not.toContain('data-cola-panel="floating-topbar"');
    expect(markup).not.toContain('data-cola-visual="virtual-idol-muse"');
    expect(markup).not.toContain("青绿双马尾虚拟歌姬");
    expect(markup).not.toContain("Cola Muse");
    expect(markup).not.toContain('data-cola-effect="meteor-field"');
  });

  test("hides the public auth bar after login", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} />);

    expect(markup).not.toContain('data-cola-panel="public-auth-bar"');
    expect(markup).toContain('data-cola-panel="user-summary-bar"');
    expect(markup).toContain("普通用户");
    expect(markup).toContain("剩余 27 积分");
    expect(markup).not.toContain('href="/login"');
    expect(markup).not.toContain('href="/register"');
    expect(markup).not.toContain('href="/ColaAI/login"');
    expect(markup).not.toContain('href="/ColaAI/register"');
  });

  test("reads remaining credit aliases from the stored ordinary user session", () => {
    const markup = renderToStaticMarkup(
      <ColaAIWorkbench
        session={{
          key: "test-key",
          role: "creator",
          subjectId: "cola-user",
          name: "Credit Alias Tester",
          limits: {
            creditsRemaining: 27,
          },
        }}
      />,
    );

    expect(markup).toContain("剩余 27 积分");
  });

  test("renders a ColaAI-only top-right login and register entry in public preview", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={publicSession} />);

    expect(markup).toContain('data-cola-panel="public-auth-bar"');
    expect(markup).toContain('data-cola-action="public-login"');
    expect(markup).toContain('data-cola-action="public-register"');
    expect(markup).toContain('href="/ColaAI/login"');
    expect(markup).toContain('href="/ColaAI/register"');
    expect(markup).not.toContain('href="/login"');
    expect(markup).not.toContain('href="/register"');
    expect(markup.indexOf("登录")).toBeLessThan(markup.indexOf("注册"));
    expect(markup).not.toContain("退出");
    expect(markup).not.toContain('data-cola-panel="floating-topbar"');
  });

  test("omits API, duplicate modal announcement, and public login actions from the desktop side rail", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={publicSession} />);
    const sideNavMarkup = extractSideNavMarkup(markup);
    const announcementMatches = sideNavMarkup.match(/公告/g) ?? [];

    expect(sideNavMarkup).toContain("公告");
    expect(announcementMatches).toHaveLength(1);
    expect(sideNavMarkup).toContain("设置");
    expect(sideNavMarkup).toContain("EN");
    expect(sideNavMarkup).not.toContain("API");
    expect(sideNavMarkup).not.toContain("签到");
    expect(sideNavMarkup).not.toContain('data-cola-action="check-in"');
    expect(sideNavMarkup).not.toContain('data-cola-action="open-announcement"');
    expect(sideNavMarkup).not.toContain('data-cola-action="open-login"');
    expect(sideNavMarkup).not.toContain("登录");
  });

  test("renders a check-in action in the desktop side rail after login", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} />);
    const sideNavMarkup = extractSideNavMarkup(markup);

    expect(sideNavMarkup).toContain("签到");
    expect(sideNavMarkup).toContain('data-cola-action="check-in"');
  });

  test("routes check-in feedback through a dialog instead of generation errors", () => {
    expect(workbenchSource).toContain("CheckInDialog");
    expect(workbenchSource).toContain("setCheckInResult");
    expect(workbenchSource).toContain('data-cola-panel="check-in-dialog"');
    expect(workbenchSource).not.toContain('setGenerationError(result.awarded ? "签到成功');
    expect(workbenchSource).not.toContain('setGenerationError(error instanceof Error ? error.message : "签到失败');
  });

  test("does not import the shared project auth store or old auth validation", () => {
    expect(workbenchSource).toContain("@/store/cola-auth");
    expect(workbenchSource).toContain("clearStoredAuthSession");
    expect(workbenchSource).not.toContain('href="/login"');
    expect(workbenchSource).not.toContain('href="/register"');
    expect(workbenchSource).not.toContain('window.location.href = "/login"');
  });

  test("renders the landing hero before discover home in discover mode", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} />);

    expect(markup).toContain('data-cola-panel="discover-stack"');
    expect(markup).toContain('data-cola-panel="landing-hero"');
    expect(markup).toContain('data-cola-scroll-sync="scroll-listener animation-frame"');
    expect(markup).toContain('data-cola-action="scroll-to-discover"');
    expect(markup).toContain('data-cola-panel="discover-handoff"');
    expect(markup).toContain('data-cola-panel="discover-home"');
    expect(markup.indexOf('data-cola-panel="landing-hero"')).toBeLessThan(
      markup.indexOf('data-cola-panel="discover-home"'),
    );
  });

  test("coalesces landing animation updates into scheduled animation frames", () => {
    expect(workbenchSource).toContain('window.addEventListener("scroll", scheduleLandingHeroSync');
    expect(workbenchSource).toContain('window.removeEventListener("scroll", scheduleLandingHeroSync');
    expect(workbenchSource).toContain('window.addEventListener("resize", syncLandingHeroFromResize');
    expect(workbenchSource).toContain("window.requestAnimationFrame(syncLandingHeroFrame");
    expect(workbenchSource).not.toContain("window.setInterval(syncLandingHeroFromScroll");
    expect(workbenchSource).not.toContain("const landingSyncInterval");
    expect(workbenchSource).not.toContain("requestAnimationFrame(tick)");
    expect(workbenchSource).not.toContain('scrollToDiscoverHero(reduceMotion ? "auto" : "smooth")');
  });

  test("calculates landing orbit card slots once and animates cards with compositor transforms", () => {
    expect(workbenchSource).toContain("writeLandingHeroOrbitLayout");
    expect(workbenchSource).toContain("landingHeroGeometryRef");
    expect(workbenchSource).toContain("ResizeObserver");
    expect(workbenchSource).toContain("timelineLine.offsetWidth");
    expect(workbenchSource).toContain("stage.offsetWidth");
    expect(workbenchSource).toContain("--landing-orbit-one-target-left");
    expect(workbenchSource).toContain("--landing-orbit-four-target-width");
    expect(workbenchSource).toContain("setLandingHeroStyleProperty(hero, properties.translateX");
    expect(workbenchSource).toContain("setLandingHeroStyleProperty(hero, properties.scaleX");
    expect(workbenchSource).not.toContain("set(properties.left, px(current.left))");
    expect(workbenchSource).not.toContain("set(properties.top, px(current.top))");
    expect(workbenchSource).not.toContain("set(properties.width, px(current.width))");
    expect(workbenchSource).not.toContain("set(properties.height, px(current.height))");
  });

  test("keeps landing hero scroll styles compositor friendly", () => {
    expect(globalsSource).toContain("--landing-orbit-one-translate-x");
    expect(globalsSource).toContain("scale(var(--landing-orbit-one-scale-x), var(--landing-orbit-one-scale-y))");
    expect(globalsSource).toContain("will-change: transform, opacity");
    expect(globalsSource).not.toContain("filter: blur(var(--landing-copy-blur))");
    expect(globalsSource).not.toContain("filter: blur(var(--landing-primary-title-blur))");
    expect(globalsSource).not.toContain("filter: blur(var(--landing-secondary-title-blur))");
    expect(globalsSource).not.toContain("filter: blur(var(--landing-core-blur))");
    expect(globalsSource).not.toContain("filter: blur(0.75rem)");
  });

  test("keeps the discover sticky composer hidden until the discover hero has scrolled past", () => {
    expect(workbenchSource).toContain('mode !== "discover"');
    expect(workbenchSource).toContain("entry.boundingClientRect.bottom <= 80");
    expect(workbenchSource).not.toContain("setStickyVisible(!entry.isIntersecting)");
  });

  test("renders the discover handoff markers for landing-to-discover snapping", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={publicSession} />);

    expect(markup).toContain('data-cola-behavior="landing-to-discover-flow"');
    expect(markup).toContain('data-cola-panel="discover-handoff"');
    expect(markup).toContain('data-cola-state="idle"');
  });

  test("renders AI developing placeholders while the recent creation feed loads", () => {
    const markup = renderToStaticMarkup(
      <CreationFeed
        creations={[]}
        isLoading
        isRefreshing={false}
        onOpen={() => undefined}
        onUsePrompt={() => undefined}
        onCopyPrompt={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="creation-feed"');
    expect(markup).toContain('data-cola-state="loading"');
    expect(markup).toContain('data-cola-effect="creation-developing-loader"');
    expect(markup).toContain('data-cola-panel="creation-feed-skeleton"');
    expect(markup).toContain('data-cola-skeleton-card="0"');
    expect(markup).toContain('data-cola-skeleton-card="11"');
    expect(markup).toContain("正在显影作品");
    expect(markup).not.toContain("做同款");
  });

  test("keeps existing recent creations visible while syncing the feed", () => {
    const markup = renderToStaticMarkup(
      <CreationFeed
        creations={[creationFeedItem]}
        isLoading={false}
        isRefreshing
        onOpen={() => undefined}
        onUsePrompt={() => undefined}
        onCopyPrompt={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-state="refreshing"');
    expect(markup).toContain('data-cola-effect="creation-feed-sync"');
    expect(markup).toContain("同步中");
    expect(markup).toContain("最近创作 1");
    expect(markup).toContain("/api/images/recent-image-1.png");
    expect(markup).toContain("做同款");
    expect(markup).not.toContain('data-cola-panel="creation-feed-skeleton"');
  });

  test("renders scroll cinematic treatment for recent creation cards", () => {
    const markup = renderToStaticMarkup(
      <CreationFeed
        creations={[creationFeedItem]}
        isLoading={false}
        isRefreshing={false}
        onOpen={() => undefined}
        onUsePrompt={() => undefined}
        onCopyPrompt={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-scroll-effect="creation-scroll-develop"');
    expect(markup).toContain('data-cola-scroll-index="0"');
    expect(markup).toContain('data-cola-layer="creation-depth-media"');
    expect(markup).toContain('data-cola-effect="creation-specular-sweep"');
    expect(markup).toContain("creation-scroll-card");
  });

  test("renders the selected clear studio textarea composer structure", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} />);

    expect(markup).toContain('data-cola-layout="rova-selected-composer"');
    expect(markup).toContain('data-cola-design="clear-studio-composer"');
    expect(markup).toContain('data-cola-part="composer-input-panel"');
    expect(markup).toContain('data-cola-part="composer-input-row"');
    expect(markup).toContain('data-cola-part="composer-toolbar"');
    expect(markup).toContain('data-cola-fit="rova-homepage-width"');
    expect(markup).toContain("max-w-[960px]");
    expect(markup).toContain("rounded-[20px]");
    expect(markup).toContain("border-slate-200/80");
    expect(markup).toContain("bg-white/86");
    expect(markup).toContain("backdrop-blur-xl");
    expect(markup).toContain("px-5 pt-[18px] pb-2");
    expect(markup).toContain("h-[88px]");
    expect(markup).toContain("gap-3");
    expect(markup).toContain("size-11");
    expect(markup).toContain("border-dashed");
    expect(markup).toContain("bg-slate-50");
    expect(markup).toContain("text-slate-400");
    expect(markup).toContain("min-h-[88px]");
    expect(markup).toContain("py-2.5");
    expect(markup).toContain("text-[15px]");
    expect(markup).toContain("leading-6");
    expect(markup).toContain("text-[#1a1a1a]");
    expect(markup).toContain("placeholder:text-[#999999]");
    expect(markup).toContain("min-h-[58px]");
    expect(markup).toContain("border-[#f0f0f0]");
    expect(markup).toContain("max-[520px]:basis-full");
    expect(markup).toContain("max-[520px]:justify-start");
    expect(markup).toContain("max-[520px]:w-full");
    expect(markup).toContain("max-[520px]:justify-between");
    expect(markup).toContain("h-7");
    expect(markup).toContain("bg-slate-950");
    expect(markup).toContain("h-[29px]");
    expect(markup).toContain("text-[#555555]");
    expect(markup).toContain("h-[37px]");
    expect(markup).toContain("rounded-[20px]");
    expect(markup).toContain("px-[22px]");
    expect(markup).toContain("text-[13px]");
    expect(markup).not.toContain("bg-[linear-gradient(180deg,#3a3a3a_0%,#1a1a1a_100%)]");
    expect(markup).not.toContain("shadow-[0_10px_40px_5px_rgba(194,194,194,0.25)]");
  });

  test("renders a dedicated generate workspace", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="generate" />);

    expect(markup).toContain('data-cola-mode="generate"');
    expect(markup).toContain('data-cola-panel="generate-workspace"');
    expect(markup).toContain('data-cola-layout="rova-generate-focus"');
    expect(markup).toContain('data-cola-behavior="drop-reference-image"');
    expect(markup).toContain('data-cola-drop-target="image-reference"');
    expect(markup).toContain('data-cola-panel="generate-hero-dock"');
    expect(markup).toContain('data-cola-part="generate-hero-top"');
    expect(markup).toContain('data-cola-panel="generate-session-topbar"');
    expect(markup).toContain('data-cola-behavior="fixed-session-header"');
    expect(markup).toContain('data-cola-panel="generate-stage-area"');
    expect(markup).toContain('data-cola-panel="generate-conversation-stage"');
    expect(markup).toContain('data-cola-state="empty"');
    expect(markup).toContain('data-cola-layout="conversation-results-feed"');
    expect(markup).toContain('data-cola-behavior="middle-conversation-scroll"');
    expect(markup).toContain('data-cola-panel="generate-conversation-thread"');
    expect(markup).toContain('data-cola-panel="generate-empty-conversation-space"');
    expect(markup).toContain('data-cola-panel="generate-conversation-thread" class="hide-scrollbar flex min-h-0 flex-1 flex-col gap-7 overflow-hidden');
    expect(markup).toContain('data-cola-behavior="fixed-session-header" class="relative z-20 mx-auto w-full max-w-[1240px] shrink-0"');
    expect(markup).toContain("shrink-0");
    expect(markup).toContain('data-cola-mobile-layout="compact-generation"');
    expect(markup).toContain('data-cola-mobile-layout="status-stack"');
    expect(markup).toContain('data-cola-mobile-layout="full-width-results"');
    expect(markup).toContain("max-[560px]:px-3 max-[560px]:pb-[calc(env(safe-area-inset-bottom)+112px)] max-[560px]:pt-[calc(env(safe-area-inset-top)+58px)]");
    expect(markup).toContain("max-[560px]:w-full max-[560px]:rounded-[18px] max-[560px]:px-2");
    expect(markup).toContain("max-[560px]:grid max-[560px]:w-full max-[560px]:grid-cols-2 max-[560px]:items-stretch");
    expect(markup).toContain("max-[560px]:w-full");
    expect(markup).not.toContain('data-cola-panel="generate-run-card"');
    expect(markup).not.toContain('data-cola-panel="generate-result-summary"');
    expect(markup).not.toContain('data-cola-panel="generate-result-gallery"');
    expect(markup).not.toContain('data-cola-panel="generate-result-placeholder"');
    expect(markup).not.toContain("第 1 轮");
    expect(markup).not.toContain("生成结果");
    expect(markup).not.toContain("成功 0 / 失败 0");
    expect(markup).not.toContain("本次耗时 -");
    expect(markup).not.toContain('data-cola-panel="generate-empty-turn"');
    expect(markup).not.toContain("等待创意输入");
    expect(markup).toContain('data-cola-panel="generate-composer-dock"');
    expect(markup).toContain('data-cola-panel="generate-composer"');
    expect(markup).toContain('data-cola-variant="rova-large-generate"');
    expect(markup).toContain('data-cola-density="bottom-compact"');
    expect(markup).toContain("生图");
    expect(markup).not.toContain('data-cola-panel="generate-recent-strip"');
    expect(markup).not.toContain("最近创作");
    expect(markup).toContain("min-h-[116px]");
    expect(markup).toContain("max-w-[1164px]");
    expect(markup).toContain("rounded-[24px]");
    expect(markup).toContain("px-6 pt-5 pb-3");
    expect(markup).toContain("size-[52px]");
    expect(markup).toContain("flex h-dvh");
    expect(markup).toContain("overflow-hidden");
    expect(markup).toContain("md:pt-[30px]");
    expect(markup).toContain("min-h-0 flex-1");
    expect(markup).not.toContain("min-h-[calc(100dvh-176px)]");
    expect(markup).not.toContain("md:min-h-[calc(100dvh-88px)]");
    expect(markup).not.toContain('data-cola-panel="generate-hero-dock" class="mx-auto flex min-h-0 flex-1 w-full max-w-[1240px] flex-col items-center justify-end');
    expect(markup.indexOf('data-cola-panel="generate-stage-area"')).toBeLessThan(markup.indexOf('data-cola-panel="generate-composer-dock"'));
    expect(markup.indexOf('data-cola-panel="generate-conversation-stage"')).toBeLessThan(markup.indexOf('data-cola-panel="generate-composer-dock"'));
    expect(markup.indexOf('data-cola-panel="generate-session-topbar"')).toBeLessThan(markup.indexOf('data-cola-panel="generate-stage-area"'));
    expect(markup).not.toContain('data-cola-panel="generate-mode-pill"');
    expect(markup).toContain("h-[46px]");
    expect(markup).toContain("gpt-image-2");
    expect(markup).toContain("Auto | 1K | 1张");
    expect(markup).toContain('data-cola-panel="studio-generation-settings"');
    expect(markup).toContain('data-cola-group="image-model-options"');
    expect(markup).toContain('data-cola-model-option="auto"');
    expect(markup).toContain('data-cola-model-option="gpt-image-2"');
    expect(markup).toContain('data-cola-model-option="codex-gpt-image-2"');
    expect(markup).toContain("模型");
    expect(markup).toContain("官方链路");
    expect(markup).toContain("自动选择当前可用的官方图片模型。");
    expect(markup).toContain("默认使用 gpt-image-2");
    expect(markup).toContain("Auto");
    expect(markup).toContain("按比例");
    expect(markup).toContain('data-cola-ratio-option="4:3"');
    expect(markup).toContain('data-cola-ratio-option="3:4"');
    expect(markup).toContain('data-cola-count-option="8"');
    expect(markup).toContain("官方链路只会把比例写入提示词作为构图偏好");
    expect(markup).toContain("格式");
    expect(markup).toContain("PNG");
    expect(markup).toContain("压缩率");
    expect(markup).toContain("N/A");
    expect(markup).toContain('data-cola-toolbar="generate-actions"');
    expect(markup).toContain('data-cola-control="public-mode"');
    expect(markup).toContain('data-cola-state="empty"');
    expect(markup).toContain('aria-pressed="false" data-cola-control="public-mode"');
    expect(markup.indexOf('data-cola-action="upload-reference"')).toBeLessThan(markup.indexOf('aria-label="请输入你的创意"'));
    expect(markup.indexOf('data-cola-control="public-mode"')).toBeLessThan(markup.indexOf('data-cola-action="submit-generation"'));
    expect(markup).not.toContain('data-cola-panel="generate-status-strip"');
    expect(markup).not.toContain(">参考图</span>");
    expect(markup).not.toContain("min-h-[190px]");
    expect(markup).not.toContain('data-cola-part="generate-input-row" class="flex min-h-[190px] gap-4');
    expect(markup).not.toContain('data-cola-panel="generation-stage"');
    expect(markup).not.toContain('data-cola-effect="rova-generation-loader"');
    expect(markup).not.toContain('data-cola-effect="paint-drip-loader"');
    expect(markup).not.toContain('data-cola-effect="generation-shimmer"');
    expect(markup).not.toContain("正在调配完美的色彩");
    expect(markup).not.toContain("AI 画笔正在起舞");
    expect(markup).not.toContain("生成画面并细化视觉细节");
    expect(markup).not.toContain("创作工作台");
    expect(markup).not.toContain("任务状态");
    expect(markup).not.toContain("任务队列空闲");
    expect(markup).not.toContain('data-cola-panel="task-status"');
    expect(markup).not.toContain('data-cola-panel="sticky-composer"');
  });

  test("renders the prompt discovery library as its own view", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="prompts" />);

    expect(markup).toContain('data-cola-mode="prompts"');
    expect(markup).toContain('data-cola-panel="prompt-library"');
    expect(markup).toContain('data-cola-design="clear-studio-prompt-library"');
    expect(markup).toContain("发现无尽创意");
    expect(markup).toContain("搜索提示词、风格或元素");
    expect(markup).toContain("精选提示词");
    expect(markup).toContain('data-cola-control="prompt-search"');
    expect(markup).toContain('data-cola-panel="prompt-result-summary"');
    expect(markup).toContain('data-cola-action="clear-prompt-filters"');
    expect(markup).toContain('data-cola-action="load-more-prompts"');
    expect(markup).toContain('data-cola-card="prompt-template"');
    expect(markup).toContain('data-cola-action="copy-library-prompt"');
    expect(markup).toContain('data-cola-action="use-library-prompt"');
    expect(markup).toContain("适合");
    expect(markup).toContain("无匹配灵感");
    expect(markup).toContain("复制提示词");
    expect(markup).toContain("去生成");
    expect(markup).toContain("加载更多灵感");
    expect(markup).not.toContain('data-cola-design="rova-prompt-library"');
    expect(markup).not.toContain('data-cola-effect="prompt-meteor-field"');
    expect(markup).not.toContain('data-cola-effect="animated-gradient-border"');
    expect(markup).toContain('data-cola-effect="clear-studio-kicker"');
    expect(markup).toContain("精选提示词库 · 来自 GitHub 开源社区");
    expect(markup).toContain("banana-prompt-quicker");
    expect(markup).toContain("awesome-gpt-image-2");
    expect(markup).toContain("苹果风格海报");
    expect(markup).toContain("Convenience Store Neon Portrait");
    expect(markup).toContain("正在同步公开模板库");
  });

  test("renders the assets workspace as its own view", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="assets" />);

    expect(markup).toContain('data-cola-mode="assets"');
    expect(markup).toContain('data-cola-panel="assets-workspace"');
    expect(markup).toContain("图片库");
    expect(markup).toContain("最近生成结果和可复用素材");
    expect(markup).toContain("任务队列");
    expect(markup).toContain("Images");
    expect(markup).toContain("Videos");
    expect(markup).toContain("Favorites");
    expect(markup).toContain("Videos coming soon");
  });

  test("renders original images in the assets workspace while keeping thumbnail fallback", () => {
    const markup = renderToStaticMarkup(
      <AssetsWorkspace
        images={[
          {
            rel: "managed-asset-1",
            name: "asset-image.png",
            date: "2026-06-01",
            size: 2048,
            url: "/images/asset-image.png",
            thumbnail_url: "/image-thumbnails/asset-image.png",
            created_at: "2026-06-01T00:00:00Z",
          },
        ]}
        creations={[]}
        onOpenCreation={() => undefined}
        onCopyImage={() => undefined}
        onDownloadImage={() => undefined}
      />,
    );

    expect(markup).toContain('src="/images/asset-image.png"');
    expect(markup).not.toContain('src="/image-thumbnails/asset-image.png"');
  });

  test("renders the API developer console as its own view", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="developer" />);

    expect(markup).toContain('data-cola-mode="developer"');
    expect(markup).toContain('data-cola-panel="developer-console"');
    expect(markup).toContain("API");
    expect(markup).toContain("开发者控制台");
    expect(markup).toContain("接口调用");
    expect(markup).toContain("密钥状态");
    expect(markup).toContain("概览");
    expect(markup).toContain("API 密钥");
    expect(markup).toContain("调用记录");
    expect(markup).toContain("接口文档");
    expect(markup).toContain("Base URL");
    expect(markup).toContain("POST /v1/images/edits");
    expect(markup).toContain("GET /v1/images/tasks");
    expect(markup).not.toContain("GET /v1/account/credits");
    expect(markup).not.toContain("可用额度");
    expect(markup).not.toContain("额度");
  });

  test("renders the announcement center as its own view", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="notice" />);

    expect(markup).toContain('data-cola-mode="notice"');
    expect(markup).toContain('data-cola-panel="announcement-center"');
    expect(markup).toContain("公告");
    expect(markup).toContain("更新动态");
    expect(markup).toContain("GPT-IMAGE-2");
  });

  test("renders settings as a rova-style coming-soon workspace", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="settings" />);

    expect(markup).toContain('data-cola-mode="settings"');
    expect(markup).toContain('data-cola-panel="settings-workspace"');
    expect(markup).toContain("设置");
    expect(markup).toContain("账号设置和偏好");
    expect(markup).toContain("即将上线");
  });

  test("renders the canvas homepage instead of dropping directly into the editor", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} initialMode="canvas" />);

    expect(markup).toContain('data-cola-mode="canvas"');
    expect(markup).toContain('data-cola-panel="canvas-home"');
    expect(markup).toContain('data-cola-section="canvas-library"');
    expect(markup).toContain("无限画布");
    expect(markup).toContain("我的画布");
    expect(markup).toContain("创建第一张画布");
    expect(markup).toContain("新建空白画布");
    expect(markup).toContain("品牌情绪板");
    expect(markup).not.toContain('data-cola-panel="canvas-workspace"');
  });

  test("renders the canvas editor shell when directly mounting CanvasWorkspace", () => {
    const markup = renderToStaticMarkup(<CanvasWorkspace onBack={() => undefined} />);

    expect(markup).toContain('data-cola-panel="canvas-workspace"');
    expect(markup).toContain('data-cola-canvas="floating-studio-light"');
    expect(markup).toContain("继续生成");
  });

  test("gates auth-only workspaces in public preview", () => {
    const assetsMarkup = renderToStaticMarkup(<ColaAIWorkbench session={publicSession} initialMode="assets" />);
    const developerMarkup = renderToStaticMarkup(<ColaAIWorkbench session={publicSession} initialMode="developer" />);

    expect(assetsMarkup).toContain('data-cola-panel="auth-required"');
    expect(assetsMarkup).toContain("需要登录");
    expect(assetsMarkup).toContain("登录后查看图片库");
    expect(assetsMarkup).toContain('href="/ColaAI/login"');
    expect(developerMarkup).toContain('data-cola-panel="auth-required"');
    expect(developerMarkup).toContain("登录后使用 API");
    expect(developerMarkup).toContain('href="/ColaAI/login"');
  });
});
