"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import {
  Bell,
  Boxes,
  Brush,
  ChevronDown,
  Copy,
  Download,
  Gift,
  Heart,
  ImageIcon,
  ImagePlus,
  Languages,
  Library,
  LogIn,
  LogOut,
  Menu,
  PanelLeft,
  PenTool,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  UserPlus,
  WandSparkles,
  X,
} from "lucide-react";

import { PromptMarketModal } from "@/app/studio/components/prompt-market-modal";
import { AuthenticatedImage } from "@/components/authenticated-image";
import { ImageLightbox } from "@/components/image-lightbox";
import webConfig from "@/constants/common-env";
import {
  checkInUser,
  downloadSingleImage,
  fetchImageTasks,
  fetchManagedImages,
  fetchPublicDiscoverImages,
  fetchPromptTemplateStats,
  fetchPromptTemplates,
  type ImageModel,
  type ImageResolution,
  type ImageTask,
  type ManagedImage,
  type PromptTemplate,
  type PromptTemplateStats,
  type PromptTemplateApplyPayload,
  type UserKeyLimits,
} from "@/lib/api";
import { backendDateTimeMs, parseBackendDateTime } from "@/lib/datetime";
import {
  downloadImageUrl,
  fetchImageBlob,
  fetchImageFile,
  getPreferredPreviewUrl,
  getPreviewFallbackUrl,
} from "@/lib/image-fetch";
import { cn } from "@/lib/utils";
import { clearStoredAuthSession, setStoredAuthSession, type StoredAuthLimits } from "@/store/auth";
import { clearStoredColaAuthSession, setStoredColaAuthSession, type ColaAuthSession } from "@/store/cola-auth";
import {
  deleteImageConversation,
  listImageConversations,
  saveImageConversation,
  saveImageConversations,
  type ImageConversation,
} from "@/store/image-conversations";
import { CanvasHome } from "./canvas-home";
import { ColaAILandingHero } from "./cola-ai-landing-hero";
import {
  buildPublicDiscoverLandingHeroItems,
  getLandingHeroScrollMotion,
  shouldSnapLandingHeroToDiscover,
  type LandingHeroScrollMotion,
  type LandingHeroStageState,
} from "./cola-ai-landing-hero-state";
import {
  colaButtonClass,
  colaCardClass,
  colaFocusClass,
  colaInputShellClass,
  colaMutedPanelClass,
  colaPanelClass,
  colaShellClass,
  colaSurfaceClass,
} from "./cola-ai-style";
import {
  createBlankCanvasState,
  deleteCanvasLibraryRecord,
  deleteCanvasLibraryRecords,
  createTemplateCanvasState,
  getActiveCanvasId,
  getCanvasHomeEntries,
  getCanvasTemplateCards,
  loadCanvasLibraryState,
  saveCanvasLibraryRecord,
  type CanvasTemplateCard,
} from "./canvas-home-state";
import { CanvasWorkspace, type CanvasSourceTaskFocus } from "./canvas-workspace";
import {
  imageConversationsToGenerateView,
  mergeGenerateTasksIntoImageConversations,
  upsertGenerateSubmissionIntoImageConversations,
} from "./cola-ai-generate-history";
import {
  buildGenerateRetrySubmissionInput,
  createGenerateSubmissionTasks,
  mergeGenerateTasks,
  setGenerateTaskRetrying,
  type GenerateSubmissionInput,
  type GenerateTask,
} from "./generate-task-submission";
import { RovaMediaBackground } from "./rova-media-background";
import type { CanvasState } from "./canvas-types";
import type { CanvasReferenceImage } from "./canvas-workflow";
import { loadCanvasState, saveCanvasState } from "./use-canvas-store";

type WorkbenchMode = "discover" | "generate" | "prompts" | "assets" | "developer" | "notice" | "settings" | "canvas";

type ColaAIWorkbenchProps = {
  session: ColaAuthSession;
  initialMode?: WorkbenchMode;
};

type CanvasSubview = "home" | "editor";

type WorkbenchDialog = "announcement" | "more" | null;

type PullRefreshPhase = "idle" | "pulling" | "release" | "loading";
type CreationFeedStatus = "idle" | "loading" | "refreshing";

type GenerationPhase = "understanding" | "generating" | "revealing";

type CreationItem = {
  id: string;
  title: string;
  subtitle: string;
  prompt: string;
  imageUrl: string;
  imageFallbackUrl?: string;
};

const creationFeedSkeletonIndexes = Array.from({ length: 12 }, (_, index) => index);

type ReferenceImage = {
  name: string;
  previewUrl: string;
  file?: File;
};

type GenerateTaskDiagnosticsSnapshot = {
  id: string;
  nodeId?: string;
  prompt?: string;
  error?: string;
  status?: string;
  model?: string;
  size?: string;
  attempt?: number;
};

type GeneratedTaskImage = {
  id: string;
  taskId: string;
  src: string;
  revisedPrompt: string;
  model?: string;
  size?: string;
};

type CheckInDialogResult = {
  status: "success" | "error";
  awarded?: boolean;
  bonusCredits?: number;
  remainingCredits?: number | null;
  message: string;
};

const COLA_ACTIVE_GENERATE_SESSION_STORAGE_KEY = "chatgpt2api:colaai_active_generate_conversation_id";
const promptArchitectSystemPrompt = `你现在是一名「专业提示词架构师 Prompt Architect」。

你是一名顶级提示词专家，专注将用户创意转化为高质量、生图优先的可直接执行提示词，自动补全细节、风格和构图。

你的任务是把用户给出的简短创意、角色、场景或画面概念，改写成一段可直接交给图像生成模型执行的高质量提示词。只输出一段可直接用于生图的提示词正文。

输出必须遵守：
- 不要输出开场白、确认语、解释、Markdown 代码块、标题、项目符号、编号列表或结尾追问。
- 不要使用“明白”“我会”“以下是”“如果你想”等聊天式话术。
- 不要输出设计思路、可选增强方向、注意事项或二次确认。
- 不要把用户原始输入包装成对话，只返回优化后的最终提示词。

优化时自动补全画面必要信息：主体特征、姿态动作、场景环境、光影、色彩、镜头语言、构图、风格、材质质感、氛围和高质量渲染细节。

补全必须服务于用户原始目标，不能改变核心主体、角色、时代背景或风格意图。用户输入很短时，直接给出一个默认高质量版本，不要追问。`;

export function buildPromptArchitectMessages(prompt: string) {
  return [
    { role: "system" as const, content: promptArchitectSystemPrompt },
    { role: "user" as const, content: prompt.trim() },
  ];
}

type CanvasReferenceImageMessageInput = {
  title: string;
  imageUrl?: string;
};

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取参考图失败"));
    reader.readAsDataURL(blob);
  });
}

async function normalizeCanvasReferenceImageForChat(image: CanvasReferenceImage) {
  const rawUrl = image.imageUrl.trim();
  if (!rawUrl) {
    return { title: image.title, imageUrl: "" };
  }
  if (rawUrl.startsWith("data:")) {
    return { title: image.title, imageUrl: rawUrl };
  }

  const blob = await fetchImageBlob(rawUrl);
  return {
    title: image.title,
    imageUrl: await blobToDataUrl(blob),
  };
}

export function buildImageReversePromptMessages(prompt: string, referenceImages: CanvasReferenceImageMessageInput[]) {
  const attachedImages = referenceImages.filter((image) => image.imageUrl?.trim());
  const missingImages = referenceImages.filter((image) => !image.imageUrl?.trim());
  return [
    {
      role: "system" as const,
      content: "你是一名图片提示词反推专家。请根据用户给出的图片引用和目标要求，输出结构化中文提示词。不要套用 Prompt Architect 的通用优化格式；只围绕图片内容生成可用于图片生成模型的提示词。",
    },
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: [
            prompt.trim(),
            "",
            attachedImages.length > 0
              ? `已附上 ${attachedImages.length} 张参考图，请直接根据图片内容反推提示词。`
              : "暂无可读取的图片引用，请先根据文字要求给出适合用户补图后的结构化提示词模板。",
            missingImages.length > 0 ? `以下参考图仍待补充：${missingImages.map((image) => image.title).join("、")}` : "",
            "",
            "输出要求：使用中文，覆盖主体描述、环境、光影、镜头语言、风格关键词；如果有多张图片，请分别提取要点后再整合为一段可复制提示词。",
          ].filter(Boolean).join("\n"),
        },
        ...attachedImages.map((image) => ({
          type: "image_url" as const,
          image_url: { url: image.imageUrl!.trim() },
        })),
        ...missingImages.map((image) => ({
          type: "text" as const,
          text: `待补图参考：${image.title}`,
        })),
      ],
    },
  ];
}

export type GenerateSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  taskIds?: string[];
  tasks?: GenerateTask[];
};

// 时间统计工具函数
function formatDuration(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "-";
  }
  const seconds = Math.max(0, ms) / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
}

function averageDuration(values: Array<number | undefined>) {
  const normalized = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (normalized.length === 0) {
    return undefined;
  }
  return Math.round(normalized.reduce((sum, value) => sum + value, 0) / normalized.length);
}

export function timestampFromIso(value?: string) {
  return backendDateTimeMs(value);
}

function getTaskTimingStats(task: GenerateTask) {
  const queueMs = task.queue_duration_ms ?? task.timings?.queue_wait_ms ?? task.timing_ms?.queue_wait_ms ?? task.timings?.queue ?? task.timing_ms?.queue;
  const upstreamMs =
    task.duration_ms ??
    task.timings?.worker_total_ms ??
    task.timing_ms?.worker_total_ms ??
    task.timings?.image_poll_ms ??
    task.timing_ms?.image_poll_ms ??
    task.timings?.generating ??
    task.timings?.running ??
    task.timing_ms?.generating ??
    task.timing_ms?.running;
  return { queueMs, upstreamMs };
}

function getSessionTimingStats(tasks: GenerateTask[]) {
  const queueMs = averageDuration(
    tasks.map((task) => task.queue_duration_ms ?? task.timings?.queue_wait_ms ?? task.timing_ms?.queue_wait_ms ?? task.timings?.queue ?? task.timing_ms?.queue),
  );
  const upstreamMs = averageDuration(
    tasks.map(
      (task) =>
        task.duration_ms ??
        task.timings?.worker_total_ms ??
        task.timing_ms?.worker_total_ms ??
        task.timings?.image_poll_ms ??
        task.timing_ms?.image_poll_ms ??
        task.timings?.generating ??
        task.timings?.running ??
        task.timing_ms?.generating ??
        task.timing_ms?.running,
    ),
  );
  return { queueMs, upstreamMs };
}

function getTaskWorkerElapsedMs(task: GenerateTask, nowMs: number) {
  const explicitMs =
    task.duration_ms ??
    task.timings?.worker_total_ms ??
    task.timing_ms?.worker_total_ms ??
    task.timings?.image_poll_ms ??
    task.timing_ms?.image_poll_ms ??
    task.timings?.generating ??
    task.timings?.running ??
    task.timing_ms?.generating ??
    task.timing_ms?.running;
  if (typeof explicitMs === "number" && Number.isFinite(explicitMs)) {
    return Math.max(0, explicitMs);
  }

  const startedAtMs = timestampFromIso(task.started_at);
  if (typeof startedAtMs === "number") {
    const finishedAtMs = timestampFromIso(task.finished_at);
    return Math.max(0, (typeof finishedAtMs === "number" ? finishedAtMs : nowMs) - startedAtMs);
  }

  if (!terminalTaskStatuses.has(task.status)) {
    return undefined;
  }

  const legacyStartedAtMs = timestampFromIso(task.created_at);
  const legacyFinishedAtMs = timestampFromIso(task.finished_at || task.updated_at);
  return typeof legacyStartedAtMs === "number" && typeof legacyFinishedAtMs === "number" ? Math.max(0, legacyFinishedAtMs - legacyStartedAtMs) : undefined;
}

function getSessionElapsedMs(tasks: GenerateTask[], nowMs: number) {
  if (tasks.length === 0) {
    return undefined;
  }
  return averageDuration(tasks.map((task) => getTaskWorkerElapsedMs(task, nowMs)));
}

function getSessionWaitingMs(tasks: GenerateTask[], nowMs: number) {
  if (tasks.length === 0) {
    return undefined;
  }
  const createdAtMs = timestampFromIso(tasks[0]?.created_at);
  if (typeof createdAtMs !== "number") {
    return undefined;
  }
  const startedAtMs = averageDuration(
    tasks.map((task) => {
      const taskStartedAtMs = timestampFromIso(task.started_at || task.finished_at);
      return typeof taskStartedAtMs === "number" ? taskStartedAtMs - createdAtMs : undefined;
    }),
  );
  const allStarted = tasks.every((task) => task.started_at || task.finished_at);
  return typeof startedAtMs === "number" ? startedAtMs : allStarted ? 0 : nowMs - createdAtMs;
}

type DroppedImageData = {
  files?: ArrayLike<File> | null;
  items?:
    | ArrayLike<{
        kind?: string;
        type?: string;
        getAsFile?: () => File | null;
      }>
    | null;
};

export function getDroppedImageFiles(data: DroppedImageData | null | undefined): File[] {
  if (!data) {
    return [];
  }

  const items = Array.from(data.items ?? []);
  const itemFiles = items.flatMap((item) => {
    if (item.kind !== "file" || !item.type?.startsWith("image/")) {
      return [];
    }
    const file = item.getAsFile?.() ?? null;
    return file?.type.startsWith("image/") ? [file] : [];
  });
  if (itemFiles.length > 0) {
    return itemFiles;
  }

  const files = Array.from(data.files ?? []);
  return files.filter((file) => file.type.startsWith("image/"));
}

export function getDroppedImageFile(data: DroppedImageData | null | undefined): File | null {
  return getDroppedImageFiles(data)[0] ?? null;
}

export function hasImageDragData(data: DroppedImageData | null | undefined) {
  if (!data) {
    return false;
  }

  const items = Array.from(data.items ?? []);
  if (items.some((item) => item.kind === "file" && item.type?.startsWith("image/"))) {
    return true;
  }

  const files = Array.from(data.files ?? []);
  return files.some((file) => file.type.startsWith("image/"));
}

function copyTextToClipboard(value: string) {
  if (!value || typeof document === "undefined") {
    return;
  }

  const fallbackCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  if (typeof navigator === "undefined" || !navigator.clipboard) {
    fallbackCopy();
    return;
  }

  void navigator.clipboard.writeText(value).catch(fallbackCopy);
}

type PromptComposerKeyEvent = {
  key: string;
  shiftKey?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
  preventDefault: () => void;
};

export function handlePromptComposerKeyDown(event: PromptComposerKeyEvent, onGenerate: () => void) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) {
    return;
  }

  event.preventDefault();
  onGenerate();
}

export function clearReferencePreviewUrl(
  referencePreviewUrlRef: { current: string | string[] },
  revokeObjectUrl: (url: string) => void = URL.revokeObjectURL,
) {
  const urls = Array.isArray(referencePreviewUrlRef.current)
    ? referencePreviewUrlRef.current
    : referencePreviewUrlRef.current
      ? [referencePreviewUrlRef.current]
      : [];
  if (urls.length === 0) {
    return;
  }

  urls.forEach((url) => revokeObjectUrl(url));
  referencePreviewUrlRef.current = Array.isArray(referencePreviewUrlRef.current) ? [] : "";
}

export function ReferenceDropOverlay({ active }: { active: boolean }) {
  if (!active) {
    return null;
  }

  return (
    <div
      data-cola-panel="reference-drop-overlay"
      data-cola-state="active"
      className="pointer-events-none fixed inset-4 z-[80] grid place-items-center rounded-[32px] border-2 border-dashed border-slate-300 bg-white/72 text-slate-900 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.55)] ring-1 ring-white/80 backdrop-blur-xl"
    >
      <div className="grid place-items-center gap-3 text-center">
        <div className="grid size-16 place-items-center rounded-[24px] bg-white/90 text-slate-800 shadow-[0_14px_42px_-32px_rgba(15,23,42,0.72)] ring-1 ring-black/5">
          <ImagePlus className="size-8" />
        </div>
        <div className="text-lg font-semibold">松开添加为作画参考图</div>
        <div className="text-sm text-slate-500">会放入下方生图对话框</div>
      </div>
    </div>
  );
}

type PromptCard = {
  id: string;
  title: string;
  prompt: string;
  author: string;
  tags: string[];
  tone: string;
  ratio: string;
  category: string;
  useCase: string;
  previewUrl?: string;
  previewFallbackUrl?: string;
  model?: string;
  count?: number;
};

const ratioOptions = ["9:16", "2:3", "1:1", "3:2", "16:9"] as const;
const composerRatioOptions = ["智能", ...ratioOptions] as const;
const composerCountOptions = [1, 2, 3, 4] as const;
const studioRatioOptions = ["1:1", "16:9", "4:3", "3:4", "9:16"] as const;
const studioCountOptions = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const imageResolutionOptions: Array<{ value: ImageResolution; label: string; cost: number }> = [
  { value: "1k", label: "1K", cost: 1 },
  { value: "2k", label: "2K", cost: 2 },
  { value: "4k", label: "4K", cost: 3 },
];

type GenerateImageModel = "auto" | ImageModel;

const imageModelOptions: Array<{
  value: GenerateImageModel;
  label: string;
  title: string;
  description: string;
  badge: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    title: "Auto",
    description: "自动选择当前可用的官方图片模型。",
    badge: "auto",
  },
  {
    value: "gpt-image-2",
    label: "GPT Image 2",
    title: "gpt-image-2",
    description: "默认官方图片链路，适合海报、插画和通用生成。",
    badge: "openai",
  },
  {
    value: "codex-gpt-image-2",
    label: "Codex Image",
    title: "codex-gpt-image-2",
    description: "兼容 Codex 图片模型别名，用于特殊账号池配置。",
    badge: "openai",
  },
  {
    value: "agnes-image-2.1-flash",
    label: "Agnes Image",
    title: "agnes-image-2.1-flash",
    description: "通过 Agnes AI API 调用的图片模型，使用独立 API Key。",
    badge: "agnes",
  },
];

function colaApiPath(path: string) {
  const baseUrl = webConfig.apiUrl.replace(/\/$/, "");
  return `${baseUrl}${path}`;
}

function extractPromptArchitectResponse(payload: unknown) {
  const parsed = payload as {
    error?: string | { message?: string };
    choices?: Array<{
      message?: { content?: string };
      delta?: { content?: string };
    }>;
  };
  if (parsed?.error) {
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error.message;
    throw new Error(message || "提示词优化失败");
  }
  const choice = parsed?.choices?.[0];
  return String(choice?.message?.content ?? choice?.delta?.content ?? "").trim();
}

function normalizeImageModel(model: string | null | undefined): GenerateImageModel {
  return model === "gpt-image-2" || model === "codex-gpt-image-2" || model === "agnes-image-2.1-flash" ? model : "auto";
}

const terminalTaskStatuses = new Set<ImageTask["status"]>(["success", "error", "cancelled"]);

const fallbackCreations: CreationItem[] = [
  {
    id: "poster",
    title: "光影角色海报",
    subtitle: "GPT-IMAGE-2",
    prompt: "夜色城堡前的幻想角色海报，柔和月光，电影级光影，细节丰富。",
    imageUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1024&h=1024&fit=crop",
  },
  {
    id: "product",
    title: "夏日产品主视觉",
    subtitle: "2:3",
    prompt: "清爽夏日汽水产品海报，冰块、水珠、阳光折射，高级商业摄影。",
    imageUrl: "https://images.unsplash.com/photo-1546548970-71785318a17b?w=800&h=1200&fit=crop",
  },
  {
    id: "card",
    title: "镭射收藏卡牌",
    subtitle: "公开",
    prompt: "东方幻想角色镭射收藏卡牌，稀有卡面，金属边框，技能说明布局。",
    imageUrl: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1024&h=1024&fit=crop",
  },
  {
    id: "cover",
    title: "小红书封面",
    subtitle: "智能",
    prompt: "小红书封面设计，标题突出，清新明亮，适合 AI 绘图教程内容。",
    imageUrl: "https://images.unsplash.com/photo-1557683316-973673baf926?w=1024&h=1024&fit=crop",
  },
  {
    id: "architecture",
    title: "建筑拆解图",
    subtitle: "16:9",
    prompt: "经典建筑拆解信息图，中式美学标注，清晰结构分层，细节注释。",
    imageUrl: "https://images.unsplash.com/photo-1511818966892-d7d671e672a2?w=1600&h=900&fit=crop",
  },
  {
    id: "icon-grid",
    title: "游戏图标矩阵",
    subtitle: "1:1",
    prompt: "复古幻想 RPG 物品图标矩阵，统一像素艺术风格，标签清晰。",
    imageUrl: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1024&h=1024&fit=crop",
  },
  {
    id: "fashion",
    title: "AI 服装灵感板",
    subtitle: "4:3",
    prompt: "一张 AI Fashion Inspiration Board，三套完整造型，专业提案板排版。",
    imageUrl: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&h=900&fit=crop",
  },
  {
    id: "branding",
    title: "餐饮品牌物料",
    subtitle: "9:16",
    prompt: "完整餐饮品牌视觉系统展示图，包装、菜单、贴纸、杯套整齐陈列。",
    imageUrl: "",
  },
  {
    id: "phone",
    title: "高端手机广告",
    subtitle: "4:5",
    prompt: "Apple 级极简主义高端智能手机广告海报，纯净白底，强烈产品主视觉。",
    imageUrl: "",
  },
  {
    id: "storyboard",
    title: "商业广告分镜",
    subtitle: "16:9",
    prompt: "干净明亮的护肤品商业广告分镜图，九个镜头，柔和自然光。",
    imageUrl: "",
  },
];

const promptCards: PromptCard[] = [
  {
    id: "banana-apple-poster",
    title: "苹果风格海报",
    prompt: "充分参考图片的设计风格，配色等，为如下内容生成苹果风格的海报：\n\nBanana Prompt Quicker v1.6.0 1月6号震撼来袭\n全新参考图功能，去他丫的‘反推’",
    author: "Official · banana-prompt-quicker",
    tags: ["poster", "branding", "product"],
    tone: "from-sky-100 via-violet-100 to-rose-100",
    ratio: "海报",
    category: "工作 / 海报",
    useCase: "适合复刻参考图设计语言并生成品牌发布海报",
    previewUrl: "https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/images/apple.png",
  },
  {
    id: "evolink-neon-portrait",
    title: "Convenience Store Neon Portrait",
    prompt: "35mm film photography with harsh convenience store fluorescent lighting mixed with colorful neon signs from outside, authentic film grain, high contrast, slight color cast, cinematic street editorial style, intimate medium shot, late-night convenience store atmosphere, realistic reflections on glass door, no watermark, no text.",
    author: "@BubbleBrain · awesome-gpt-image-2",
    tags: ["portrait", "poster"],
    tone: "from-zinc-100 via-rose-50 to-amber-100",
    ratio: "portrait",
    category: "Portrait & Photography",
    useCase: "适合电影感霓虹人像、街头写真和胶片质感探索",
    previewUrl: "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/portrait_case1/output.jpg",
  },
  {
    id: "banana-zootopia-poster",
    title: "疯狂动物城海报",
    prompt: "加载并使用 Nano Banana Pro 工具作画，而不是分析或给提示词\n---\n\n充分参考图片画风和人物形象，为如下内容画一幅宣传海报图片（3：2 竖屏风格）。看到心动的 PPT 风格、惊艳滤镜效果或参考图时，一键复刻同款视觉语言。",
    author: "Official · banana-prompt-quicker",
    tags: ["poster", "illustration", "character"],
    tone: "from-fuchsia-100 via-indigo-100 to-cyan-100",
    ratio: "3:2",
    category: "工作 / 海报",
    useCase: "适合参考图驱动的宣传海报、插画海报和角色视觉复刻",
    previewUrl: "https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/images/dongwucheng.jpg",
  },
  {
    id: "evolink-one-prompt-ui",
    title: "One-Prompt UI Design Generation",
    prompt: "用这种风格帮我生成一套UI设计系统，包含网页、移动端、卡片、控件、按钮以及其它关键界面元素，保持统一视觉语言、清晰层级和可落地的产品设计质感。",
    author: "@austinit · awesome-gpt-image-2",
    tags: ["ui", "poster", "branding"],
    tone: "from-emerald-100 via-sky-100 to-violet-100",
    ratio: "UI",
    category: "UI & Social Media",
    useCase: "适合从单个风格参考扩展整套 UI 设计系统",
    previewUrl: "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/ui_case1/output.jpg",
  },
  {
    id: "banana-glass-ppt",
    title: "渐变玻璃风格 PPT",
    prompt: "你是一位专家级UI UX演示设计师，请生成高保真、未来科技感的16比9演示文稿幻灯片。风格融合 Apple Keynote 极简主义、现代 SaaS 产品设计和玻璃拟态；使用 Bento 网格、磨砂玻璃容器、高端 3D 物体、霓虹图表和大留白，形成获奖级演示视觉。",
    author: "@op7418 · banana-prompt-quicker",
    tags: ["ui", "3d", "branding"],
    tone: "from-slate-100 via-white to-blue-100",
    ratio: "16:9",
    category: "工作 / PPT",
    useCase: "适合高保真产品演示、SaaS 路演和未来感 Keynote",
    previewUrl: "https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/images/nano_banana_pro_ppt.jpg",
  },
  {
    id: "evolink-luxury-perfume",
    title: "E-commerce Main Image - Luxury Amber Perfume Ad",
    prompt: "A luxurious cinematic product photograph of a classic rectangular perfume bottle on a glossy black marble surface with white veining. The bottle is clear faceted glass with amber-gold perfume glowing from within, dramatic warm lighting, premium commercial product photography, sharp detail, no watermark.",
    author: "@Polanco_IA · awesome-gpt-image-2",
    tags: ["product", "poster", "food"],
    tone: "from-cyan-100 via-lime-100 to-amber-100",
    ratio: "product",
    category: "E-commerce",
    useCase: "适合电商主图、奢侈品香水广告和棚拍产品视觉",
    previewUrl: "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/poster_case113/output.jpg",
  },
  {
    id: "banana-city-poster",
    title: "城市海报艺术生成",
    prompt: "一张针对 [城市名称] 的城市渲染数字艺术海报。主体是漂浮在云海上的微型城市岛屿，融合城市地标、自然景观与文化元素；加入 3D 城市文字、博物馆展板式信息排版、地理坐标与别称，整体像一件珍贵艺术品。",
    author: "@op7418 · banana-prompt-quicker",
    tags: ["architecture", "poster", "3d"],
    tone: "from-stone-100 via-sky-50 to-emerald-100",
    ratio: "poster",
    category: "有趣 / 城市海报",
    useCase: "适合城市文旅海报、地标视觉和微缩世界概念图",
    previewUrl: "https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/images/city_art_poster.jpg",
  },
  {
    id: "evolink-boston-poster",
    title: "Boston Spring 2026 City Poster",
    prompt: "A striking Spring 2026 city poster for Boston with an elegant celebratory mood and bold contemporary design. Use a clean off-white textured background, negative space, miniature sculler and Charles River-inspired calligraphic motion, dreamlike hand-painted panorama, refined civic poster style.",
    author: "@BubbleBrain · awesome-gpt-image-2",
    tags: ["poster", "illustration", "architecture"],
    tone: "from-rose-100 via-white to-sky-100",
    ratio: "poster",
    category: "Poster & Illustration",
    useCase: "适合城市海报、节日视觉和艺术插画式传播物料",
    previewUrl: "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/poster_case1/output.jpg",
  },
  {
    id: "banana-infographic-rating",
    title: "锐评世间万物",
    prompt: "你是拥有实时网络搜索能力和顶尖数据可视化设计能力的 AI 专家。针对用户指定领域做全面调研，并将产品、作品或品牌按“夯、顶级、人上人、NPC、拉完了”五级填入 Bento Grid 信息图中，使用强烈层级、具体名称和清晰视觉对比。",
    author: "@op7418 · banana-prompt-quicker",
    tags: ["poster", "ui", "branding"],
    tone: "from-amber-100 via-purple-100 to-cyan-100",
    ratio: "infographic",
    category: "有趣 / 信息图",
    useCase: "适合排行榜、产品锐评、趋势分析和可视化信息图",
    previewUrl: "https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/images/nano_banana_pro_rating.jpg",
  },
  {
    id: "evolink-persona-card",
    title: "Persona5 Character Reference Card",
    prompt: "基于角色和背景制作一份类似官方设定资料的角色资料卡，包含正面、侧面、背面三视图，面部表情变化，服装和装备拆解，色板与世界观简要说明。白色背景，有组织布局，高分辨率，专业概念艺术风格。",
    author: "@iamrednightS · awesome-gpt-image-2",
    tags: ["character", "illustration", "game"],
    tone: "from-amber-100 via-purple-100 to-cyan-100",
    ratio: "character",
    category: "Character Design",
    useCase: "适合角色设定、三视图资料卡和 IP 世界观整理",
    previewUrl: "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/character_case2/output.jpg",
  },
  {
    id: "banana-food-infographic",
    title: "根据已有食材做菜",
    prompt: "根据现有食材（见附图）建议可以烹饪的菜肴，提供详细的分步食谱，以简单的信息图形式呈现。",
    author: "@AmirMushich · banana-prompt-quicker",
    tags: ["food", "poster", "illustration"],
    tone: "from-pink-100 via-white to-teal-100",
    ratio: "infographic",
    category: "生活 / 美食",
    useCase: "适合食材识别、菜谱建议和生活类信息图",
    previewUrl: "https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/images/food.jpg",
  },
  {
    id: "evolink-ad-banner-grid",
    title: "4-Panel Japanese Digital Ad Banner Grid",
    prompt: "Create a 2x2 grid of Japanese digital advertisement banners with four equal quadrants. Each banner should have a clear theme, photographic subject, visual accents, Japanese text labels, and consistent high-quality digital ad layout suitable for campaign presentation.",
    author: "@makaneko_AI · awesome-gpt-image-2",
    tags: ["branding", "ui", "poster"],
    tone: "from-orange-100 via-red-50 to-lime-100",
    ratio: "2x2",
    category: "Ad Creative",
    useCase: "适合广告 Banner、社媒活动视觉和多版本创意提案",
    previewUrl: "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/ui_case90/output.jpg",
  },
  {
    id: "evolink-bookshelf-test",
    title: "Wooden Bookshelf Prompt Test",
    prompt: "A wooden bookshelf consisting of three shelves: On the top shelf, there should be one book, on the second shelf, there should be three books, and on the bottom shelf, there should be seven books.",
    author: "@chetaslua · awesome-gpt-image-2",
    tags: ["comparison", "illustration", "3d"],
    tone: "from-stone-100 via-sky-50 to-emerald-100",
    ratio: "test",
    category: "Comparison",
    useCase: "适合模型遵循能力测试、空间计数和复杂约束对比",
    previewUrl: "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main/images/comparison_case5/output.jpg",
  },
];

const sideNavItems: Array<{ key: WorkbenchMode; label: string; icon: typeof PanelLeft }> = [
  { key: "discover", label: "发现", icon: PanelLeft },
  { key: "generate", label: "生图", icon: ImageIcon },
  { key: "canvas", label: "画布", icon: PenTool },
  { key: "prompts", label: "提示词", icon: WandSparkles },
  { key: "assets", label: "资产", icon: Library },
];

const lowerNavItems = [
  { key: "api", label: "API", icon: Boxes, mode: "developer" },
  { key: "notice", label: "公告", icon: Bell, mode: "notice" },
  { key: "settings", label: "设置", icon: Settings, mode: "settings" },
  { key: "logout", label: "退出", icon: LogOut, authOnly: true },
] as const;

const mobilePrimaryItems = [
  { key: "discover", label: "发现", icon: PanelLeft },
  { key: "generate", label: "生图", icon: Brush },
  { key: "prompts", label: "提示词", icon: WandSparkles },
] as const;

const promptTags = ["all", "poster", "product", "ui", "portrait", "fashion", "3d", "branding", "character", "illustration", "game", "food", "architecture"];

const promptTagToneMap: Record<string, string> = {
  product: "from-cyan-100 via-lime-100 to-amber-100",
  poster: "from-sky-100 via-violet-100 to-rose-100",
  branding: "from-orange-100 via-red-50 to-lime-100",
  character: "from-fuchsia-100 via-indigo-100 to-cyan-100",
  illustration: "from-amber-100 via-purple-100 to-cyan-100",
  game: "from-amber-100 via-purple-100 to-cyan-100",
  fashion: "from-rose-100 via-orange-100 to-emerald-100",
  portrait: "from-zinc-100 via-rose-50 to-amber-100",
  ui: "from-emerald-100 via-sky-100 to-violet-100",
  "3d": "from-slate-100 via-white to-blue-100",
  food: "from-orange-100 via-red-50 to-lime-100",
  architecture: "from-stone-100 via-sky-50 to-emerald-100",
};

const promptTagCategoryMap: Record<string, string> = {
  product: "产品广告",
  poster: "海报视觉",
  branding: "品牌视觉",
  character: "角色设计",
  illustration: "插画设定",
  game: "游戏资产",
  fashion: "时尚灵感",
  portrait: "人像封面",
  ui: "产品 UI",
  "3d": "三维视觉",
  food: "餐饮品牌",
  architecture: "建筑图解",
};

const emptyPromptStats: PromptTemplateStats = {
  public: 0,
  private: 0,
  favorites: 0,
  submissions: 0,
};

type PromptTemplateLoadState = "loading" | "ready" | "error";

function formatPromptTemplateUseCase(description: string) {
  const trimmed = description.trim();
  if (!trimmed) {
    return "适合快速生成并继续微调";
  }
  if (trimmed.startsWith("适合")) {
    return trimmed;
  }
  if (trimmed.startsWith("用于")) {
    return `适合${trimmed.slice(2)}`;
  }
  return `适合${trimmed}`;
}

export function shouldUseRemotePromptTemplates(loadState: PromptTemplateLoadState, _stats: PromptTemplateStats, remoteCount: number) {
  return loadState === "ready" && remoteCount > 0;
}

export function resolvePromptSourceCards(hasRemotePrompts: boolean, remotePromptCards: PromptCard[]) {
  return hasRemotePrompts ? remotePromptCards : promptCards;
}

export function getPromptLibraryTotalCount(hasRemotePrompts: boolean, stats: PromptTemplateStats, sourceCount: number) {
  if (!hasRemotePrompts) {
    return sourceCount;
  }
  return stats.public > 0 ? stats.public : sourceCount;
}

export function getPromptLibraryStatusText(loadState: PromptTemplateLoadState, normalizedQuery: string, query: string) {
  if (loadState === "loading") {
    return "正在同步公开模板库";
  }
  if (loadState === "error") {
    return "公开模板库暂不可用，正在使用 GitHub 社区源";
  }
  return normalizedQuery ? `搜索：${query.trim()}` : "按标题、作者、标签和提示词内容匹配";
}

export function promptTemplateToPromptCard(template: PromptTemplate): PromptCard {
  const primaryTag = template.tags[0] || "poster";
  const previewImage = template.preview_image;
  return {
    id: template.id,
    title: template.title,
    prompt: template.prompt,
    author: template.owner_name || "ColaAI",
    tags: template.tags.length > 0 ? template.tags : ["poster"],
    tone: promptTagToneMap[primaryTag] || "from-sky-100 via-violet-100 to-rose-100",
    ratio: template.size || "1:1",
    category: promptTagCategoryMap[primaryTag] || "精选提示词",
    useCase: formatPromptTemplateUseCase(template.description),
    previewUrl: getPreferredPreviewUrl(previewImage, "preferThumbnail"),
    previewFallbackUrl: getPreviewFallbackUrl(previewImage, "preferThumbnail"),
    model: template.model,
    count: template.count,
  };
}

export function buildCreations(images: ManagedImage[]) {
  if (images.length === 0) {
    return fallbackCreations;
  }

  return images.slice(0, 12).map((image, index) => ({
    id: image.rel || image.url || String(index),
    title: `最近创作 ${index + 1}`,
    subtitle: image.width && image.height ? `${image.width} x ${image.height}` : "图片库",
    prompt: `复用 ${image.name.replace(/\.[^.]+$/, "") || "这张作品"} 的视觉风格继续创作。`,
    imageUrl: getPreferredPreviewUrl(image, "preferOriginal"),
    imageFallbackUrl: getPreviewFallbackUrl(image, "preferOriginal"),
  }));
}

function createGenerateSessionId() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `colaai-session-${random}`;
}

function createClientTaskId(index: number) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `colaai-${index + 1}-${random}`;
}

function createGenerateSession(title = "空对话"): GenerateSession {
  const now = new Date().toISOString();
  return {
    id: createGenerateSessionId(),
    title,
    createdAt: now,
    updatedAt: now,
    taskIds: [],
  };
}

function getGenerateSessionTaskIds(session: GenerateSession | null | undefined) {
  if (!session) {
    return [];
  }
  if (session.taskIds) {
    return session.taskIds;
  }
  return (session.tasks ?? []).map((task) => task.id);
}

export function prependGenerateSession(sessions: GenerateSession[], nextSession: GenerateSession) {
  return [nextSession, ...sessions];
}

function getGenerateSessionTasks(session: GenerateSession, tasks: GenerateTask[] = []) {
  if (session.tasks) {
    return session.tasks;
  }
  const taskIds = new Set(getGenerateSessionTaskIds(session));
  return tasks.filter((task) => taskIds.has(task.id));
}

function getGenerateSessionResultCount(session: GenerateSession, tasks: GenerateTask[] = []) {
  return getGenerateSessionTasks(session, tasks).reduce((sum, task) => sum + (task.data?.filter((image) => getGeneratedImageSrc(image)).length ?? 0), 0);
}

function findGenerateSessionIdForTask(sessions: GenerateSession[], taskId: string, fallbackSessionId: string) {
  return sessions.find((session) => getGenerateSessionTaskIds(session).includes(taskId))?.id || fallbackSessionId;
}

function formatGenerateSessionTime(value: string) {
  const safeDate = parseBackendDateTime(value) ?? new Date();
  const now = new Date();
  const dateKeyFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const sameDay = dateKeyFormatter.format(safeDate) === dateKeyFormatter.format(now);
  const time = safeDate.toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (sameDay) {
    return `今天 ${time}`;
  }

  return `${safeDate.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" })} ${time}`;
}

const initialGenerateSession: GenerateSession = {
  id: "colaai-session-default",
  title: "空对话",
  createdAt: "",
  updatedAt: "",
  taskIds: [],
};

function BrandLogo({ className }: { className?: string }) {
  return (
    <div
      aria-label="ColaAI"
      data-cola-brand="clear-studio"
      data-cola-rail-label="ColaAI"
      className={cn("relative text-center font-sans font-semibold tracking-[-0.04em] text-slate-950", className)}
    >
      <span className="sr-only">ColaAI</span>
      <span aria-hidden="true" className="relative z-10">
        Cola<span className="text-[0.78em] text-cyan-600">AI</span>
      </span>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-1 text-transparent [-webkit-text-stroke:1px_rgba(15,23,42,0.14)]"
      >
        Cola<span className="text-[0.78em]">AI</span>
      </span>
    </div>
  );
}

function PublicAuthBar() {
  return (
    <nav
      aria-label="登录和注册"
      data-cola-panel="public-auth-bar"
      className={cn(
        "fixed right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 flex items-center gap-1 rounded-full p-1 text-sm",
        "border border-slate-200/80 bg-white/86 shadow-[0_18px_54px_-40px_rgba(15,23,42,0.52)] ring-1 ring-white/80 backdrop-blur-xl",
        "sm:right-5 sm:top-[calc(env(safe-area-inset-top)+1rem)]",
      )}
    >
      <Link
        href="/ColaAI/login"
        data-cola-action="public-login"
        className={colaButtonClass("ghost", "h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-white hover:text-slate-950 sm:px-4 sm:text-sm")}
      >
        <LogIn className="size-3.5" />
        登录
      </Link>
      <Link
        href="/ColaAI/register"
        data-cola-action="public-register"
        className={colaButtonClass("primary", "h-9 px-3 text-xs font-semibold sm:px-4 sm:text-sm")}
      >
        <UserPlus className="size-3.5" />
        注册
      </Link>
    </nav>
  );
}

function formatImageRemaining(limits?: StoredAuthLimits | null) {
  const remaining = limits?.creditsRemaining ?? limits?.imagesRemaining;
  return typeof remaining === "number" ? String(remaining) : "不限";
}

export function imageResolutionCreditCost(resolution?: string) {
  return resolution === "4k" ? 3 : resolution === "2k" ? 2 : 1;
}

function userKeyLimitsToStoredLimits(limits?: UserKeyLimits | null): StoredAuthLimits | null {
  if (!limits) {
    return null;
  }
  return {
    requestsPerDay: typeof limits.requests_per_day === "number" || limits.requests_per_day === null ? limits.requests_per_day : undefined,
    imagesPerDay: typeof limits.images_per_day === "number" || limits.images_per_day === null ? limits.images_per_day : undefined,
    creditsTotal: typeof limits.images_total === "number" || limits.images_total === null ? limits.images_total : undefined,
    creditsUsed: typeof limits.images_used === "number" || limits.images_used === null ? limits.images_used : undefined,
    creditsRemaining: typeof limits.images_remaining === "number" || limits.images_remaining === null ? limits.images_remaining : undefined,
    imagesTotal: typeof limits.images_total === "number" || limits.images_total === null ? limits.images_total : undefined,
    imagesUsed: typeof limits.images_used === "number" || limits.images_used === null ? limits.images_used : undefined,
    imagesRemaining: typeof limits.images_remaining === "number" || limits.images_remaining === null ? limits.images_remaining : undefined,
    concurrency: typeof limits.concurrency === "number" || limits.concurrency === null ? limits.concurrency : undefined,
    models: Array.isArray(limits.models) ? limits.models : undefined,
  };
}

export function decrementSessionImageQuota(session: ColaAuthSession, amount: number): ColaAuthSession {
  const count = Math.max(0, Math.floor(amount));
  if (count <= 0 || !session.limits) {
    return session;
  }

  const nextLimits: StoredAuthLimits = { ...session.limits };
  if (typeof nextLimits.creditsUsed === "number") {
    nextLimits.creditsUsed = nextLimits.creditsUsed + count;
  }
  if (typeof nextLimits.creditsRemaining === "number") {
    nextLimits.creditsRemaining = Math.max(0, nextLimits.creditsRemaining - count);
  }
  if (typeof nextLimits.imagesUsed === "number") {
    nextLimits.imagesUsed = nextLimits.imagesUsed + count;
  }
  if (typeof nextLimits.imagesRemaining === "number") {
    nextLimits.imagesRemaining = Math.max(0, nextLimits.imagesRemaining - count);
  }
  return { ...session, limits: nextLimits };
}

function UserSummaryBar({
  session,
}: {
  session: ColaAuthSession;
}) {
  return (
    <div
      data-cola-panel="user-summary-bar"
      className={cn(
        "fixed right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 hidden max-w-[min(320px,calc(100vw-24px))] items-center gap-3 rounded-full px-4 py-2 text-sm",
        "border border-slate-200/80 bg-white/88 shadow-[0_18px_54px_-40px_rgba(15,23,42,0.52)] ring-1 ring-white/80 backdrop-blur-xl md:flex",
        "sm:right-5 sm:top-[calc(env(safe-area-inset-top)+1rem)]",
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">
        {(session.name || "U").slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-slate-500">普通用户</span>
        <span className="block truncate text-sm font-semibold text-slate-950">
          {session.name || "ColaAI"} · 剩余 {formatImageRemaining(session.limits)} 积分
        </span>
      </span>
    </div>
  );
}

function RovaComposer({
  prompt,
  count,
  quality,
  ratio,
  resolution,
  imageModel,
  publicMode,
  referenceImageName = "",
  isGenerating = false,
  sticky = false,
  onPromptChange,
  onCountChange,
  onQualityChange,
  onRatioChange,
  onResolutionChange,
  onImageModelChange,
  onPublicChange,
  onReferenceFileChange,
  onOpenPrompts,
  onGenerate,
}: {
  prompt: string;
  count: number;
  quality: string;
  ratio: string;
  resolution: ImageResolution;
  imageModel: GenerateImageModel;
  publicMode: boolean;
  referenceImageName?: string;
  isGenerating?: boolean;
  sticky?: boolean;
  onPromptChange: (prompt: string) => void;
  onCountChange: (count: number) => void;
  onQualityChange: (quality: string) => void;
  onRatioChange: (ratio: string) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  onImageModelChange: (model: GenerateImageModel) => void;
  onPublicChange: (publicMode: boolean) => void;
  onReferenceFileChange?: (files: File[]) => void;
  onOpenPrompts: () => void;
  onGenerate: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [localReferenceName, setLocalReferenceName] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const compositionMode = quality === "智能" ? "auto" : "ratio";
  const selectedRatio = compositionMode === "auto" ? "Auto" : ratio;
  const selectedResolution = imageResolutionOptions.find((option) => option.value === resolution) ?? imageResolutionOptions[0];
  const selectedModel = imageModelOptions.find((option) => option.value === imageModel) ?? imageModelOptions[0];
  const hasReferenceName = Boolean(referenceImageName || localReferenceName);
  const modelPopover = (
    <div
      data-cola-panel="image-model-settings"
      className={colaSurfaceClass("overlay", "absolute bottom-[62px] left-5 z-50 w-[min(360px,calc(100vw-32px))] overflow-y-auto p-3 text-left max-[520px]:left-1/2 max-[520px]:-translate-x-1/2")}
      style={{
        opacity: modelOpen ? 1 : 0,
        pointerEvents: modelOpen ? "auto" : "none",
        transform: `translateY(${modelOpen ? "0" : "8px"})`,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-[#555555]">模型</div>
        <div className="text-xs text-[#9a9a9a]">当前官方链路</div>
      </div>
      <div data-cola-group="image-model-options" className="mt-3 grid gap-2">
        {imageModelOptions.map((option) => {
          const selected = imageModel === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              data-cola-model-option={option.value}
              className={cn(
                "flex min-h-[54px] items-center justify-between gap-3 rounded-[14px] border bg-white px-3 py-2 text-left transition",
                selected ? "border-[#1f1f1f] text-[#1f1f1f] shadow-[inset_0_0_0_1px_#1f1f1f]" : "border-[#e7e7e7] text-[#8f8f8f] hover:border-[#d6d6d6] hover:text-[#555555]",
              )}
              onClick={() => {
                onImageModelChange(option.value);
                setModelOpen(false);
              }}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{option.title}</span>
                <span className="mt-0.5 block text-xs leading-5 text-[#8e8e8e]">{option.description}</span>
              </span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">{option.badge}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
  const ratioCountPopover = (
    <div
      data-cola-panel="studio-generation-settings"
      className={colaSurfaceClass("overlay", "absolute bottom-[62px] left-[158px] z-50 max-h-[min(420px,70dvh)] w-[min(360px,calc(100vw-32px))] overflow-y-auto p-3 text-left max-[520px]:left-1/2 max-[520px]:-translate-x-1/2")}
      style={{
        opacity: settingsOpen ? 1 : 0,
        pointerEvents: settingsOpen ? "auto" : "none",
        transform: `translateY(${settingsOpen ? "0" : "8px"})`,
      }}
    >
      <div className="grid grid-cols-2 gap-1.5 rounded-[16px] border border-[#e7e7e7] bg-white p-1">
        <button
          type="button"
          aria-pressed={compositionMode === "auto"}
          className={cn(
            "h-9 rounded-[13px] text-sm font-semibold transition",
            compositionMode === "auto" ? "bg-[#1f1f1f] text-white" : "text-[#666666] hover:bg-[#f6f6f6]",
          )}
          onClick={() => onQualityChange("智能")}
        >
          Auto
        </button>
        <button
          type="button"
          aria-pressed={compositionMode === "ratio"}
          className={cn(
            "h-9 rounded-[13px] text-sm font-semibold transition",
            compositionMode === "ratio" ? "bg-[#1f1f1f] text-white" : "text-[#666666] hover:bg-[#f6f6f6]",
          )}
          onClick={() => {
            onQualityChange(ratio);
            onRatioChange(ratio);
          }}
        >
          按比例
        </button>
      </div>

      <div data-cola-group="ratio-options" data-cola-state={compositionMode} className="mt-3 grid grid-cols-5 gap-1.5">
        {studioRatioOptions.map((option) => {
          const selected = compositionMode === "ratio" && ratio === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              data-cola-ratio-option={option}
              className={cn(
                "h-9 rounded-full text-sm font-semibold ring-1 transition",
                selected ? "bg-sky-50 text-sky-700 ring-sky-200" : "bg-white text-[#666666] ring-[#e7e7e7] hover:bg-[#f6f6f6]",
              )}
              onClick={() => {
                onQualityChange(option);
                onRatioChange(option);
              }}
            >
              {option}
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-sm font-semibold text-[#555555]">分辨率</div>
      <div data-cola-group="resolution-options" className="mt-2 grid grid-cols-3 gap-1.5">
        {imageResolutionOptions.map((option) => {
          const selected = resolution === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              data-cola-resolution-option={option.value}
              className={cn(
                "h-9 rounded-[12px] border bg-white text-sm font-semibold transition",
                selected ? "border-[#1f1f1f] text-[#1f1f1f] shadow-[inset_0_0_0_1px_#1f1f1f]" : "border-[#e7e7e7] text-[#9a9a9a] hover:border-[#d6d6d6] hover:text-[#555555]",
              )}
              onClick={() => onResolutionChange(option.value)}
            >
              {option.label}
              <span className="ml-1 text-[11px] font-medium text-current opacity-60">{option.cost}积分</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-sm font-semibold text-[#555555]">生成数量</div>
      <div data-cola-group="count-options" className="mt-2 grid grid-cols-4 gap-1.5">
        {composerCountOptions.map((option) => {
          const selected = count === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              data-cola-count-option={option}
              className={cn(
                "h-9 rounded-[12px] border bg-white text-sm font-semibold transition",
                selected ? "border-[#1f1f1f] text-[#1f1f1f] shadow-[inset_0_0_0_1px_#1f1f1f]" : "border-[#e7e7e7] text-[#9a9a9a] hover:border-[#d6d6d6] hover:text-[#555555]",
              )}
              onClick={() => onCountChange(option)}
            >
              {option}张
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      data-cola-panel="composer"
      data-cola-design="clear-studio-composer"
      data-cola-density="rova-compact"
      data-cola-layout="rova-selected-composer"
      data-cola-fit="rova-homepage-width"
      className={cn(
        colaInputShellClass,
        "relative w-full max-w-[960px] overflow-visible text-left",
        sticky && "shadow-[0_18px_60px_-42px_rgba(15,23,42,0.42)]",
      )}
    >
      <div data-cola-part="composer-input-panel" className="relative px-5 pt-[18px] pb-2 max-[520px]:px-4">
        <div data-cola-part="composer-input-row" className={cn("flex gap-3", sticky ? "h-[72px]" : "h-[88px]")}>
          <button
            type="button"
            data-cola-action="upload-reference"
            className={cn("mt-0.5 grid size-11 shrink-0 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-400 transition hover:border-cyan-200 hover:bg-cyan-50/60 hover:text-cyan-700", colaFocusClass)}
            aria-label={hasReferenceName ? "更换参考图" : "上传参考图"}
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="size-5" />
            <span className="sr-only">参考图</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label="选择参考图"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
              if (files.length > 0) {
                if (onReferenceFileChange) {
                  onReferenceFileChange(files);
                } else {
                  setLocalReferenceName(files.length === 1 ? files[0].name : `${files.length} 张参考图`);
                }
              }
              event.currentTarget.value = "";
            }}
          />
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => handlePromptComposerKeyDown(event, onGenerate)}
            className={cn(
              "min-h-[88px] flex-1 resize-none border-0 bg-transparent py-2.5 text-[15px] leading-6 text-[#1a1a1a] outline-none placeholder:text-[#999999]",
              sticky && "min-h-[72px]",
            )}
            placeholder="请输入你的创意（按 Enter 发送，Shift+Enter 换行）"
            aria-label="请输入你的创意"
          />
          <span className="sr-only">描述你想创作的图片...</span>
        </div>
      </div>

      <div data-cola-part="composer-toolbar" className="flex min-h-[58px] items-center gap-2 border-t border-[#f0f0f0] px-5 py-2.5 max-[520px]:flex-wrap max-[520px]:px-4">
        <div data-cola-toolbar="prompt-controls" className="hide-scrollbar flex min-w-0 flex-1 flex-nowrap items-center justify-start gap-2 overflow-x-auto max-[520px]:basis-full max-[520px]:justify-start">
          <button
            type="button"
            data-cola-control="image-model"
            data-cola-fit="nowrap-chip"
            className={colaButtonClass("primary", "h-7 px-3 py-0 text-xs font-medium")}
            onClick={() => {
              setModelOpen((open) => !open);
              setSettingsOpen(false);
            }}
            aria-expanded={modelOpen}
            aria-label="图片模型"
          >
            <Sparkles className="size-3.5 shrink-0" />
            {selectedModel.label}
          </button>
          <div className="shrink-0">
            <button
              type="button"
              data-cola-control="ratio-count"
              data-cola-fit="nowrap-chip"
              className={cn(
                "inline-flex h-[29px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-2xl border px-3 text-xs font-normal transition",
                settingsOpen
                  ? "border-violet-200 bg-violet-50 text-[#555555] shadow-[0_10px_24px_-20px_rgba(124,58,237,0.55)]"
                  : "border-transparent bg-[#f5f5f5] text-[#555555] hover:bg-[#eeeeee]",
              )}
              onClick={() => {
                setSettingsOpen((open) => !open);
                setModelOpen(false);
              }}
              aria-expanded={settingsOpen}
              aria-label="图片比例与生成数量"
            >
              <Boxes className="size-3.5 shrink-0" />
              {selectedRatio} | {selectedResolution.label} | {count}张
              <span className="sr-only">图片比例 智能 9:16 2:3 1:1 3:2 16:9 分辨率 1K 2K 4K 生成数量</span>
              <ChevronDown className={cn("size-3.5 shrink-0 transition", settingsOpen && "rotate-180")} />
            </button>
          </div>
          <button
            type="button"
            data-cola-action="open-prompt-market"
            data-cola-fit="nowrap-chip"
            className="sr-only"
            onClick={onOpenPrompts}
          >
            <WandSparkles className="size-3.5 shrink-0" />
            提示词市场
          </button>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 max-[520px]:w-full max-[520px]:justify-between">
          <label className="inline-flex items-center gap-[5px] text-xs font-medium text-[#555555]">
            公开
            <button
              type="button"
              aria-pressed={publicMode}
              data-cola-control="public-mode"
              className={cn("relative h-[18px] w-8 rounded-[9px] transition", publicMode ? "bg-[#d9d9d9]" : "bg-[#d9d9d9]")}
              onClick={() => onPublicChange(!publicMode)}
            >
              <span className={cn("absolute top-0.5 size-3.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition", publicMode ? "left-4" : "left-0.5")} />
            </button>
          </label>
          <button
            type="button"
            aria-label="生成"
            data-cola-action="submit-generation"
            className={colaButtonClass("primary", "h-[37px] px-[22px] py-0 text-[13px] font-medium")}
            disabled={isGenerating}
            onClick={onGenerate}
          >
            <Send className="relative z-10 hidden size-3.5 sm:inline" />
            <span className="relative z-10">{isGenerating ? "提交中" : "生成"}</span>
          </button>
        </div>
      </div>
      {modelPopover}
      {ratioCountPopover}
    </div>
  );
}

export function GenerateComposer({
  prompt,
  count,
  quality,
  ratio,
  resolution,
  imageModel,
  publicMode,
  referenceImage,
  referenceImages,
  isGenerating = false,
  onPromptChange,
  onCountChange,
  onQualityChange,
  onRatioChange,
  onResolutionChange,
  onImageModelChange,
  onPublicChange,
  onReferenceFileChange,
  onReferenceRemove,
  onGenerate,
}: {
  prompt: string;
  count: number;
  quality: string;
  ratio: string;
  resolution: ImageResolution;
  imageModel: GenerateImageModel;
  publicMode: boolean;
  referenceImage?: ReferenceImage | null;
  referenceImages?: ReferenceImage[];
  isGenerating?: boolean;
  onPromptChange: (prompt: string) => void;
  onCountChange: (count: number) => void;
  onQualityChange: (quality: string) => void;
  onRatioChange: (ratio: string) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  onImageModelChange: (model: GenerateImageModel) => void;
  onPublicChange: (publicMode: boolean) => void;
  onReferenceFileChange: (files: File[]) => void;
  onReferenceRemove: () => void;
  onOpenPrompts: () => void;
  onGenerate: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const compositionMode = quality === "智能" ? "auto" : "ratio";
  const selectedRatio = compositionMode === "auto" ? "Auto" : ratio;
  const selectedResolution = imageResolutionOptions.find((option) => option.value === resolution) ?? imageResolutionOptions[0];
  const selectedModel = imageModelOptions.find((option) => option.value === imageModel) ?? imageModelOptions[0];
  const attachedReferenceImages = referenceImages ?? (referenceImage ? [referenceImage] : []);
  const hasReferenceImages = attachedReferenceImages.length > 0;
  const referenceCount = attachedReferenceImages.length;
  const referenceSize = referenceCount === 0
    ? "empty"
    : referenceCount === 1
      ? "single"
      : referenceCount <= 4
        ? "few"
        : "many";
  const referenceInputRowClass = referenceSize === "many"
    ? "min-h-[144px] max-[760px]:min-h-[250px] max-[760px]:flex-col"
    : "min-h-[116px] max-[560px]:min-h-[128px]";
  const referenceSlotClass = referenceSize === "many"
    ? "h-[132px] w-[min(420px,42vw)] max-[760px]:h-[118px] max-[760px]:w-full"
    : referenceSize === "few"
      ? "h-[104px] w-[min(248px,28vw)] max-[760px]:w-[min(248px,44vw)] max-[560px]:h-[94px] max-[560px]:w-full"
      : referenceSize === "single"
        ? "h-[76px] w-[76px] max-[560px]:h-[64px] max-[560px]:w-[64px]"
        : "h-[60px] w-[60px] max-[560px]:h-[52px] max-[560px]:w-[52px]";
  const referenceUploadLabel = hasReferenceImages
    ? `继续添加参考图，当前 ${referenceCount} 张`
    : "上传参考图";
  const referenceRemoveLabel = referenceCount > 1
    ? `删除 ${referenceCount} 张参考图`
    : attachedReferenceImages[0]
      ? `删除参考图 ${attachedReferenceImages[0].name}`
      : "删除参考图";

  return (
    <section
      data-cola-panel="generate-composer"
      data-cola-variant="rova-large-generate"
      data-cola-density="bottom-compact"
      data-cola-design="clear-studio-composer"
      className={cn(colaInputShellClass, "relative mx-auto w-full max-w-[1164px] overflow-visible text-left")}
    >
      <div data-cola-part="generate-input-panel" className="relative px-6 pt-5 pb-3 max-[560px]:px-4 max-[560px]:pt-4">
        <div
          data-cola-part="generate-input-row"
          className={cn(
            "flex gap-4 max-[560px]:gap-3",
            referenceInputRowClass,
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label="选择参考图"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
              if (files.length > 0) {
                onReferenceFileChange(files);
              }
              event.currentTarget.value = "";
            }}
          />
          <div
            data-cola-panel="reference-material-slot"
            data-cola-reference-count={referenceCount}
            data-cola-size={referenceSize}
            className={cn(
              "relative shrink-0",
              referenceSlotClass,
            )}
          >
            <button
              type="button"
              data-cola-action="upload-reference"
              data-cola-state={hasReferenceImages ? "has-references" : "empty"}
              data-cola-reference-count={referenceCount}
              data-cola-size={referenceSize}
              className={cn(
                "group grid h-full w-full overflow-hidden rounded-[18px] border text-slate-400 transition duration-200",
                colaFocusClass,
                hasReferenceImages
                  ? "place-items-stretch border-white bg-white p-2 shadow-[0_16px_34px_-24px_rgba(15,23,42,0.62)] ring-1 ring-slate-200/80"
                  : "place-items-center border-dashed border-slate-300 bg-slate-50/80 hover:border-cyan-300 hover:bg-cyan-50/70 hover:text-cyan-700",
              )}
              aria-label={referenceUploadLabel}
              onClick={() => fileInputRef.current?.click()}
            >
              {referenceSize === "single" && attachedReferenceImages[0] ? (
                <span data-cola-panel="reference-image-single" className="relative h-full w-full overflow-hidden rounded-[15px]">
                  <AuthenticatedImage
                    src={attachedReferenceImages[0].previewUrl}
                    alt={attachedReferenceImages[0].name}
                    data-cola-panel="reference-image-preview"
                    className="h-full w-full object-cover"
                    loadingMotion="static"
                  />
                  <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-slate-950/86 text-[11px] font-semibold leading-none text-white ring-1 ring-white/85">
                    1
                  </span>
                </span>
              ) : hasReferenceImages ? (
                <span data-cola-panel="reference-image-tray" className="flex h-full w-full min-w-0 flex-col gap-1.5">
                  <span className="flex shrink-0 items-center justify-between gap-2 px-0.5">
                    <span className="truncate text-[11px] font-semibold leading-none text-slate-500">
                      参考图 {referenceCount}
                    </span>
                    <span className="text-[10px] font-medium leading-none text-slate-400">点击继续添加</span>
                  </span>
                  <span
                    data-cola-panel="reference-image-grid"
                    className="hide-scrollbar grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5 overflow-y-auto pr-0.5"
                  >
                    {attachedReferenceImages.map((image, index) => (
                      <span
                        key={`${image.previewUrl}-${index}`}
                        data-cola-panel="reference-image-chip"
                        data-cola-index={index + 1}
                        className="relative aspect-square min-h-[44px] overflow-hidden rounded-[12px] bg-slate-100 ring-1 ring-slate-200/80"
                      >
                        <AuthenticatedImage
                          src={image.previewUrl}
                          alt={image.name}
                          data-cola-panel="reference-image-preview"
                          className="h-full w-full object-cover"
                          loadingMotion="static"
                        />
                        <span className="absolute bottom-1 left-1 grid size-4 place-items-center rounded-full bg-slate-950/86 text-[10px] font-semibold leading-none text-white ring-1 ring-white/85">
                          {index + 1}
                        </span>
                      </span>
                    ))}
                  </span>
                </span>
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-white/86 shadow-[0_10px_28px_-22px_rgba(15,23,42,0.68)] ring-1 ring-slate-200/80 transition group-hover:ring-teal-200">
                  <Plus className="size-4" />
                </span>
              )}
            </button>
            {hasReferenceImages ? (
              <span
                data-cola-panel="reference-image-name"
                className="sr-only"
              >
                {attachedReferenceImages.map((image) => image.name).join(", ")}
              </span>
            ) : null}
            {hasReferenceImages ? (
              <button
                type="button"
                data-cola-action="remove-reference"
                className="absolute -right-1.5 -top-1.5 z-10 grid size-5 place-items-center rounded-full bg-slate-950 text-white shadow-[0_6px_16px_-10px_rgba(15,23,42,0.8)] ring-2 ring-white transition hover:bg-teal-800"
                aria-label={referenceRemoveLabel}
                onClick={(event) => {
                  event.stopPropagation();
                  onReferenceRemove();
                }}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          <div className="relative min-w-0 flex-1 rounded-[20px] bg-white/20">
            <div className="mb-1 flex items-center justify-between gap-3 pr-1">
              <span className="text-[11px] font-semibold text-slate-400">创作控制台</span>
              <span className="hidden text-[11px] font-medium text-teal-700/70 sm:inline">Prompt first</span>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={(event) => handlePromptComposerKeyDown(event, onGenerate)}
              className="min-h-[92px] w-full resize-none border-0 bg-transparent text-[17px] leading-7 text-[#16181d] outline-none placeholder:text-[#9ca3af] max-[560px]:min-h-[104px] max-[560px]:text-base max-[560px]:leading-7"
              placeholder="请输入你的创意（按 Enter 发送，Shift+Enter 换行）"
              aria-label="请输入你的创意"
            />
          </div>
        </div>
      </div>

      <div data-cola-part="generate-toolbar" className="flex min-h-[70px] items-center gap-3 border-t border-slate-200/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.2),rgba(248,250,252,0.72))] px-6 py-3 max-[560px]:flex-wrap max-[560px]:px-4">
        <div className="hide-scrollbar flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto max-[560px]:basis-full">
          <button
            type="button"
            data-cola-control="image-model"
            className="inline-flex h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[#111418] px-3.5 text-xs font-semibold text-white shadow-[0_14px_32px_-22px_rgba(15,23,42,0.86)] transition hover:-translate-y-px hover:bg-[#171b20] active:translate-y-0"
            onClick={() => {
              setModelOpen((open) => !open);
              setSettingsOpen(false);
            }}
            aria-expanded={modelOpen}
            aria-label="图片模型"
          >
            <span className="grid size-5 place-items-center rounded-full bg-teal-400/16 text-teal-200">
              <Sparkles className="size-3.5" />
            </span>
            {selectedModel.label}
          </button>
          <button
            type="button"
            data-cola-control="ratio-count"
            data-cola-fit="nowrap-chip"
            className={cn(
              "inline-flex h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition hover:-translate-y-px active:translate-y-0",
              settingsOpen
                ? "border-teal-200 bg-teal-50 text-teal-900 shadow-[0_16px_35px_-28px_rgba(15,118,110,0.78)]"
                : "border-transparent bg-white/78 text-[#4b5563] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.05)] hover:bg-white hover:text-slate-950",
            )}
            onClick={() => {
              setSettingsOpen((open) => !open);
              setModelOpen(false);
            }}
            aria-expanded={settingsOpen}
            aria-label="图片比例与生成数量"
          >
            <Boxes className={cn("size-4 shrink-0", settingsOpen ? "text-teal-700" : "text-slate-500")} />
            {selectedRatio} | {selectedResolution.label} | {count}张
            <span className="sr-only">图片比例 智能 9:16 2:3 1:1 3:2 16:9 分辨率 1K 2K 4K 生成数量</span>
            <ChevronDown className={cn("size-4 shrink-0 transition", settingsOpen && "rotate-180")} />
          </button>
        </div>

        <div data-cola-toolbar="generate-actions" className="flex shrink-0 items-center justify-end gap-3 max-[560px]:w-full max-[560px]:justify-between">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-[#4b5563]">
            公开
            <button
              type="button"
              aria-pressed={publicMode}
              data-cola-control="public-mode"
              className={cn(
                "relative h-5 w-9 rounded-full transition focus:outline-none focus:ring-4 focus:ring-teal-100",
                publicMode ? "bg-teal-500" : "bg-slate-200",
              )}
              onClick={() => onPublicChange(!publicMode)}
            >
              <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)] transition", publicMode ? "left-[18px]" : "left-0.5")} />
            </button>
          </label>
          <button
            type="button"
            aria-label="生成"
            data-cola-action="submit-generation"
            className={colaButtonClass("primary", "h-[46px] px-7 py-0")}
            disabled={isGenerating}
            onClick={onGenerate}
          >
            <Send className="relative z-10 size-4" />
            <span className="relative z-10">{isGenerating ? "提交中" : "生成"}</span>
          </button>
        </div>
      </div>

      <div
        data-cola-panel="image-model-settings"
        className={colaSurfaceClass("overlay", "absolute bottom-[84px] left-6 z-50 w-[min(392px,calc(100vw-32px))] overflow-y-auto p-4 text-left max-[560px]:left-1/2 max-[560px]:-translate-x-1/2")}
        style={{
          opacity: modelOpen ? 1 : 0,
          pointerEvents: modelOpen ? "auto" : "none",
          transform: `translateY(${modelOpen ? "0" : "8px"})`,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[#1f2937]">模型</div>
            <div className="mt-0.5 text-xs text-slate-400">默认使用 gpt-image-2</div>
          </div>
          <div className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">官方链路</div>
        </div>
        <div data-cola-group="image-model-options" className="mt-3 grid gap-2">
          {imageModelOptions.map((option) => {
            const selected = imageModel === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                data-cola-model-option={option.value}
                className={cn(
                  "flex min-h-[58px] items-center justify-between gap-3 rounded-[16px] border bg-white px-3.5 py-2.5 text-left transition hover:-translate-y-px active:translate-y-0",
                  selected
                    ? "border-teal-200 text-slate-950 shadow-[inset_0_0_0_1px_rgba(20,184,166,0.38),0_14px_34px_-28px_rgba(15,118,110,0.72)]"
                    : "border-[#e7e7e7] text-[#6b7280] hover:border-teal-200 hover:text-[#1f2937]",
                )}
                onClick={() => {
                  onImageModelChange(option.value);
                  setModelOpen(false);
                }}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{option.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-[#8e8e8e]">{option.description}</span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", selected ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500")}>{option.badge}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        data-cola-panel="studio-generation-settings"
        data-cola-popover="ratio-count"
        className={colaSurfaceClass("overlay", "absolute bottom-[84px] left-[160px] z-50 max-h-[min(440px,70dvh)] w-[min(372px,calc(100vw-32px))] overflow-y-auto p-4 text-left max-[560px]:left-1/2 max-[560px]:-translate-x-1/2")}
        style={{
          opacity: settingsOpen ? 1 : 0,
          pointerEvents: settingsOpen ? "auto" : "none",
          transform: `translateY(${settingsOpen ? "0" : "8px"})`,
        }}
      >
        <span data-cola-panel="ratio-count-popover" className="sr-only">图片比例与生成数量</span>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[#1f2937]">构图参数</div>
            <div className="mt-0.5 text-xs text-slate-400">官方链路只会把比例写入提示词作为构图偏好</div>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">PNG</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 rounded-[18px] border border-[#e7e7e7] bg-slate-50/80 p-1">
          <button
            type="button"
            aria-pressed={compositionMode === "auto"}
            className={cn(
              "h-9 rounded-[14px] text-sm font-semibold transition",
              compositionMode === "auto" ? "bg-[#111418] text-white shadow-[0_12px_26px_-20px_rgba(15,23,42,0.82)]" : "text-[#666666] hover:bg-white",
            )}
            onClick={() => onQualityChange("智能")}
          >
            Auto
          </button>
          <button
            type="button"
            aria-pressed={compositionMode === "ratio"}
            className={cn(
              "h-9 rounded-[14px] text-sm font-semibold transition",
              compositionMode === "ratio" ? "bg-[#111418] text-white shadow-[0_12px_26px_-20px_rgba(15,23,42,0.82)]" : "text-[#666666] hover:bg-white",
            )}
            onClick={() => {
              onQualityChange(ratio);
              onRatioChange(ratio);
            }}
          >
            按比例
          </button>
        </div>

        <div data-cola-group="ratio-options" data-cola-state={compositionMode} className="mt-3 grid grid-cols-5 gap-1.5">
          {studioRatioOptions.map((option) => {
            const selected = compositionMode === "ratio" && ratio === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                data-cola-ratio-option={option}
                className={cn(
                  "h-9 rounded-full text-sm font-semibold ring-1 transition",
                  selected ? "bg-teal-50 text-teal-700 ring-teal-200 shadow-[0_10px_26px_-22px_rgba(15,118,110,0.7)]" : "bg-white text-[#666666] ring-[#e7e7e7] hover:bg-[#f6f6f6]",
                )}
                onClick={() => {
                  onQualityChange(option);
                  onRatioChange(option);
                }}
              >
                {option}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[#555555]">分辨率</div>
          <div className="text-[11px] font-medium text-slate-400">按积分扣减</div>
        </div>
        <div data-cola-group="resolution-options" className="mt-2 grid grid-cols-3 gap-1.5">
          {imageResolutionOptions.map((option) => {
            const selected = resolution === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                data-cola-resolution-option={option.value}
                className={cn(
                  "h-9 rounded-[12px] border bg-white text-sm font-semibold transition",
                  selected ? "border-teal-200 text-teal-700 shadow-[inset_0_0_0_1px_rgba(20,184,166,0.35),0_10px_26px_-22px_rgba(15,118,110,0.7)]" : "border-[#e7e7e7] text-[#9a9a9a] hover:border-[#d6d6d6] hover:text-[#555555]",
                )}
                onClick={() => onResolutionChange(option.value)}
              >
                {option.label}
                <span className="ml-1 text-[11px] font-medium text-current opacity-60">{option.cost}积分</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[#555555]">生成数量</div>
          <div className="text-[11px] font-medium text-slate-400">格式 PNG · 压缩率 N/A</div>
        </div>
        <div data-cola-group="count-options" className="mt-2 grid grid-cols-4 gap-1.5">
          {studioCountOptions.map((option) => {
            const selected = count === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                data-cola-count-option={option}
                className={cn(
                  "h-9 rounded-[12px] border bg-white text-sm font-semibold transition",
                  selected ? "border-teal-200 text-teal-700 shadow-[inset_0_0_0_1px_rgba(20,184,166,0.35),0_10px_26px_-22px_rgba(15,118,110,0.7)]" : "border-[#e7e7e7] text-[#9a9a9a] hover:border-[#d6d6d6] hover:text-[#555555]",
                )}
                onClick={() => onCountChange(option)}
              >
                {option}张
              </button>
            );
          })}
        </div>

      </div>
    </section>
  );
}

function ImageTile({
  item,
  index,
  onOpen,
  onUsePrompt,
  onCopyPrompt,
}: {
  item: CreationItem;
  index: number;
  onOpen: () => void;
  onUsePrompt: (prompt: string) => void;
  onCopyPrompt: (prompt: string) => void;
}) {
  const aspectClass = ["aspect-[4/5]", "aspect-square", "aspect-[3/4]", "aspect-[5/4]", "aspect-[2/3]", "aspect-[4/3]"][index % 6];

  return (
    <article
      data-cola-effect="creation-tile-reveal"
      data-cola-scroll-effect="creation-scroll-develop"
      data-cola-scroll-index={index}
      className="creation-scroll-card group mb-3 min-w-0 break-inside-avoid overflow-hidden rounded-[14px] bg-white/88 text-left shadow-[0_14px_42px_-34px_rgba(15,23,42,0.58)] ring-1 ring-black/5 transition duration-200 hover:-translate-y-1 hover:bg-white/95 hover:shadow-[0_20px_50px_-38px_rgba(15,23,42,0.68)]"
      style={{ "--creation-scroll-delay": `${Math.min(index, 10) * 42}ms` } as CSSProperties}
    >
      <button type="button" className="block w-full text-left" onClick={onOpen}>
        <div className={cn("relative overflow-hidden bg-slate-100", aspectClass)}>
          <div data-cola-layer="creation-depth-media" className="creation-depth-media">
            {item.imageUrl ? (
              <AuthenticatedImage
                src={item.imageUrl}
                fallbackSrc={item.imageFallbackUrl}
                alt={item.title}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.045]"
                loadingMotion="static"
              />
            ) : (
              <div
                className={cn(
                  "h-full w-full",
                  index % 6 === 0 && "bg-[radial-gradient(circle_at_28%_22%,#fbcfe8,transparent_34%),linear-gradient(135deg,#e0f2fe,#f8fafc_48%,#ddd6fe)]",
                  index % 6 === 1 && "bg-[radial-gradient(circle_at_68%_18%,#bfdbfe,transparent_32%),linear-gradient(135deg,#ccfbf1,#fdf2f8)]",
                  index % 6 === 2 && "bg-[radial-gradient(circle_at_38%_72%,#fde68a,transparent_30%),linear-gradient(135deg,#f5f3ff,#cffafe)]",
                  index % 6 === 3 && "bg-[radial-gradient(circle_at_72%_30%,#f9a8d4,transparent_32%),linear-gradient(135deg,#e0e7ff,#ecfeff)]",
                  index % 6 === 4 && "bg-[radial-gradient(circle_at_30%_72%,#a7f3d0,transparent_33%),linear-gradient(145deg,#fef3c7,#eff6ff_55%,#fecdd3)]",
                  index % 6 === 5 && "bg-[radial-gradient(circle_at_72%_24%,#c4b5fd,transparent_32%),linear-gradient(135deg,#fff7ed,#dbeafe_54%,#ccfbf1)]",
                )}
              />
            )}
          </div>
          <span data-cola-effect="creation-specular-sweep" className="creation-specular-sweep" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/48 to-transparent p-3 text-white">
            <div className="truncate text-sm font-semibold">{item.title}</div>
            <div className="mt-0.5 truncate text-xs text-white/75">{item.subtitle}</div>
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between gap-1 px-2.5 py-2">
        <button
          type="button"
          data-cola-action="remix"
          className="rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-slate-800"
          onClick={() => onUsePrompt(item.prompt)}
        >
          做同款
        </button>
        <button
          type="button"
          data-cola-action="copy-prompt"
          className="rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          onClick={() => onCopyPrompt(item.prompt)}
        >
          复制
        </button>
      </div>
    </article>
  );
}

function CreationFeedSkeletonCard({ index }: { index: number }) {
  const aspectClass = ["aspect-[4/5]", "aspect-square", "aspect-[3/4]", "aspect-[5/4]", "aspect-[2/3]", "aspect-[4/3]"][index % 6];

  return (
    <article
      data-cola-effect="creation-developing-loader"
      data-cola-skeleton-card={index}
      className="mb-3 min-w-0 break-inside-avoid overflow-hidden rounded-[14px] bg-white/78 p-1.5 shadow-[0_14px_42px_-34px_rgba(15,23,42,0.42)] ring-1 ring-black/5"
      style={{ animationDelay: `${Math.min(index, 10) * 64}ms` }}
    >
      <div className={cn("creation-developing-card relative overflow-hidden rounded-[11px]", aspectClass)}>
        <span className="creation-developing-card__grid" aria-hidden="true" />
        <span className="creation-developing-card__scan" aria-hidden="true" />
        <span className="creation-developing-card__chip" aria-hidden="true">
          显影中
        </span>
        {index === 0 && <span className="sr-only">正在显影作品</span>}
      </div>
      <div className="flex items-center justify-between gap-3 px-1.5 py-2">
        <span className="h-5 w-14 rounded-full bg-slate-200/75" />
        <span className="h-5 w-10 rounded-full bg-slate-100" />
      </div>
    </article>
  );
}

function CreationFeedSkeleton() {
  return (
    <div
      data-cola-panel="creation-feed-skeleton"
      data-cola-layout="masonry-feed"
      className="mx-auto max-w-[1400px] columns-2 gap-3 pb-24 sm:columns-3 sm:gap-4 lg:columns-4 xl:columns-5"
      aria-live="polite"
    >
      {creationFeedSkeletonIndexes.map((index) => (
        <CreationFeedSkeletonCard key={index} index={index} />
      ))}
    </div>
  );
}

export function CreationFeed({
  creations,
  flushTop = false,
  isLoading = false,
  isRefreshing = false,
  title = "最近创作",
  subtitle = "来自你的灵感",
  onOpen,
  onUsePrompt,
  onCopyPrompt,
}: {
  creations: CreationItem[];
  flushTop?: boolean;
  isLoading?: boolean;
  isRefreshing?: boolean;
  title?: string;
  subtitle?: string;
  onOpen: (item: CreationItem) => void;
  onUsePrompt: (prompt: string) => void;
  onCopyPrompt: (prompt: string) => void;
}) {
  const feedState = isLoading ? "loading" : isRefreshing ? "refreshing" : "idle";

  return (
    <section data-cola-panel="creation-feed" data-cola-state={feedState} className={cn(flushTop ? "mt-0" : "mt-10", "pb-12")}>
      <div className={cn(flushTop ? "mb-[28px]" : "mb-5", "text-center")}>
        <div className="inline-flex items-center justify-center gap-2">
          <h2 className="text-[28px] font-medium leading-9 tracking-normal text-[#1a1a1a]">{title}</h2>
          {isRefreshing && (
            <span
              data-cola-effect="creation-feed-sync"
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/80 bg-white/88 px-2.5 text-[11px] font-semibold text-slate-500 shadow-[0_10px_28px_-22px_rgba(15,23,42,0.42)] ring-1 ring-black/5"
            >
              <span className="size-1.5 rounded-full bg-sky-500 motion-safe:animate-[pulse_900ms_ease-in-out_infinite]" />
              同步中
            </span>
          )}
        </div>
        <p className="mt-[5px] text-sm leading-5 text-[#999999]">{subtitle}</p>
      </div>
      {isLoading && creations.length === 0 ? (
        <CreationFeedSkeleton />
      ) : (
        <div data-cola-layout="masonry-feed" className="mx-auto max-w-[1400px] columns-2 gap-3 pb-24 sm:columns-3 sm:gap-4 lg:columns-4 xl:columns-5">
          {creations.map((item, index) => (
            <ImageTile
              key={item.id}
              item={item}
              index={index}
              onOpen={() => onOpen(item)}
              onUsePrompt={onUsePrompt}
              onCopyPrompt={onCopyPrompt}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PullRefreshIndicator({ distance, phase }: { distance: number; phase: PullRefreshPhase }) {
  const progress = Math.min(1, distance / 72);
  const label = phase === "loading" ? "正在加载灵感" : phase === "release" ? "释放更新" : "下拉刷新灵感";
  const visible = phase !== "idle";
  const translateY = visible ? Math.min(42, Math.round(distance * 0.42)) : -18;
  const scale = visible ? 0.92 + progress * 0.08 : 0.86;
  const rotation = phase === "loading" ? 0 : Math.round(progress * 300);

  return (
    <div
      data-cola-panel="pull-refresh-indicator"
      data-cola-behavior="pull-to-refresh"
      data-cola-state={phase}
      className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 transition-[opacity,transform] duration-200"
      style={{
        opacity: visible ? 0.98 : 0,
        transform: `translate(-50%, ${translateY}px) scale(${scale})`,
      }}
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-full border border-white/80 bg-white/78 px-3 py-2 text-xs font-medium text-slate-600 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.5)] backdrop-blur-xl">
        <span
          data-cola-effect="rova-pull-loader"
          className={cn(
            "relative grid size-7 place-items-center rounded-full bg-white shadow-inner ring-1 ring-black/5",
            phase === "loading" && "motion-safe:animate-[pulse_900ms_ease-in-out_infinite]",
          )}
          aria-hidden="true"
        >
          <span
            className={cn("absolute inset-0 rounded-full", phase === "loading" && "motion-safe:animate-[spin_780ms_linear_infinite]")}
            style={{
              background: `conic-gradient(from ${rotation}deg, rgba(14,165,233,0.95) ${Math.max(12, Math.round(progress * 76))}%, rgba(226,232,240,0.92) 0)`,
            }}
          />
          <span className="absolute inset-[4px] rounded-full bg-white" />
          <span className={cn("relative size-1.5 rounded-full transition", phase === "release" ? "bg-sky-500" : "bg-slate-400")} />
        </span>
        <span>{label}</span>
      </div>
      <span className="sr-only">下拉刷新灵感</span>
      <span className="sr-only">释放更新</span>
      <span className="sr-only">正在加载灵感</span>
    </div>
  );
}

const generationPhaseItems: Array<{ key: GenerationPhase; label: string }> = [
  { key: "understanding", label: "正在准备生成" },
  { key: "generating", label: "正在生成图片" },
  { key: "revealing", label: "正在整理结果" },
];

function getGenerationPhase(task?: ImageTask, isGenerating = false): GenerationPhase {
  const phase = task?.phase || task?.status;
  if (!phase) {
    return isGenerating ? "understanding" : "generating";
  }
  if (phase === "queued" || phase === "submitting") {
    return "understanding";
  }
  if (phase === "downloading" || phase === "saving" || phase === "completed" || phase === "success") {
    return "revealing";
  }
  return "generating";
}

function getGeneratedImageSrc(image: { b64_json?: string; url?: string }) {
  if (image.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  return image.url || "";
}

function getGeneratedTaskImages(tasks: GenerateTask[]): GeneratedTaskImage[] {
  return tasks.flatMap((task) =>
    (task.data ?? [])
      .map((image, imageIndex) => ({
        id: `${task.id}-${imageIndex}`,
        taskId: task.id,
        src: getGeneratedImageSrc(image),
        revisedPrompt: image.revised_prompt || "",
        model: task.model,
        size: task.size,
      }))
      .filter((image) => image.src),
  );
}

function getGeneratedImageFileName(image: GeneratedTaskImage, index: number) {
  return `colaai-result-${index + 1}-${image.taskId || image.id}.png`;
}

export function GenerateTaskDiagnosticsPanel({
  task,
  canvasTask,
  focusSource,
  onRetryGeneration,
  onClearFocus,
}: {
  task?: GenerateTask | null;
  canvasTask?: GenerateTaskDiagnosticsSnapshot | null;
  focusSource?: "canvas" | "generate";
  onRetryGeneration?: (task: GenerateTask) => void;
  onClearFocus?: () => void;
}) {
  const taskId = task?.id || canvasTask?.id || "";
  if (!taskId) {
    return null;
  }

  const context = task?.submissionContext;
  const detailsPrompt = context?.prompt || canvasTask?.prompt || "";
  const detailsModel = context?.model || canvasTask?.model || task?.model || "gpt-image-2";
  const detailsSize = context?.size || canvasTask?.size || task?.size || "智能";
  const detailsCount = Math.max(1, context?.count || 1);
  const detailsAttempt = Math.max(1, context?.attempt || canvasTask?.attempt || 1);
  const detailsRetrySource = context?.retryOfTaskId || "";
  const detailsStatus = task?.phase_label || task?.phase || task?.status || canvasTask?.status || "error";
  const detailsError = task?.error || canvasTask?.error || "";
  const retrying = Boolean(context?.retrying);
  const canRetry = Boolean(task && (task.status === "error" || task.status === "cancelled") && onRetryGeneration);

  return (
    <section
      data-cola-panel="generate-task-diagnostics"
      data-cola-task-detail-id={taskId}
      data-cola-task-detail-state={focusSource ? "focused" : "idle"}
      data-cola-focus-source={focusSource || undefined}
      className="w-full rounded-[22px] border border-slate-200/80 bg-white/86 p-4 text-left shadow-[0_18px_58px_-46px_rgba(15,23,42,0.52)] backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-950">任务诊断</p>
            {focusSource === "canvas" ? (
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-600">画布定位</span>
            ) : null}
          </div>
          <p className="mt-1 break-all font-mono text-xs text-slate-400">{taskId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-cola-action="copy-generate-task-id"
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:text-slate-950"
            onClick={() => copyTextToClipboard(taskId)}
          >
            <Copy className="size-3.5" />
            复制 ID
          </button>
          <button
            type="button"
            data-cola-action="copy-generate-task-error"
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!detailsError}
            onClick={() => copyTextToClipboard(detailsError)}
          >
            <Copy className="size-3.5" />
            复制错误
          </button>
          {canRetry ? (
            <button
              type="button"
              data-cola-action="retry-failed-generation-detail"
              data-cola-retry-state={retrying ? "retrying" : "idle"}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full bg-rose-50 px-3 text-xs font-semibold text-rose-600 ring-1 ring-rose-100 transition hover:bg-rose-100",
                retrying && "cursor-not-allowed opacity-70 hover:bg-rose-50",
              )}
              disabled={retrying}
              onClick={() => {
                if (!task || retrying) {
                  return;
                }
                onRetryGeneration?.(task);
              }}
            >
              <RefreshCw className={cn("size-3.5", retrying && "animate-spin")} />
              {retrying ? "重试中" : "重试"}
            </button>
          ) : null}
          {onClearFocus ? (
            <button
              type="button"
              data-cola-action="clear-generate-task-focus"
              className="grid size-8 place-items-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200 transition hover:text-slate-950"
              aria-label="关闭任务定位"
              onClick={onClearFocus}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div className="rounded-[14px] bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase text-slate-400">Prompt</dt>
          <dd className="mt-1 break-words text-slate-700">{detailsPrompt || "未记录提示词"}</dd>
        </div>
        <div className="rounded-[14px] bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase text-slate-400">Status</dt>
          <dd className="mt-1 text-slate-700">{detailsStatus}</dd>
        </div>
        <div className="rounded-[14px] bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase text-slate-400">Model</dt>
          <dd className="mt-1 text-slate-700">{detailsModel}</dd>
        </div>
        <div className="rounded-[14px] bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase text-slate-400">Size</dt>
          <dd className="mt-1 text-slate-700">{detailsSize}</dd>
        </div>
        <div className="rounded-[14px] bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase text-slate-400">Count</dt>
          <dd className="mt-1 text-slate-700">{detailsCount} 张</dd>
        </div>
        <div className="rounded-[14px] bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase text-slate-400">Attempt</dt>
          <dd className="mt-1 text-slate-700">第 {detailsAttempt} 次</dd>
        </div>
        {detailsRetrySource ? (
          <div className="rounded-[14px] bg-slate-50 px-3 py-2 md:col-span-2">
            <dt className="text-[11px] font-semibold uppercase text-slate-400">Retry Source</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-700">{detailsRetrySource}</dd>
          </div>
        ) : null}
        {detailsError ? (
          <div className="rounded-[14px] bg-rose-50 px-3 py-2 text-rose-600 md:col-span-2">
            <dt className="text-[11px] font-semibold uppercase text-rose-300">Error</dt>
            <dd className="mt-1 break-words">{detailsError}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export function GenerationStage({
  isActive,
  taskCount,
  activeTask,
}: {
  isActive: boolean;
  taskCount: number;
  activeTask?: GenerateTask;
}) {
  const phase = getGenerationPhase(activeTask, isActive);
  const activePhase = generationPhaseItems.find((item) => item.key === phase) || generationPhaseItems[1];
  const taskStatus = activeTask?.phase_label || activeTask?.phase || activeTask?.status;
  const frameCount = Math.max(1, Math.min(4, taskCount || 1));

  return (
    <section
      data-cola-panel="generation-text-status"
      data-cola-effect="image-developing-stage"
      data-cola-state={isActive ? "loading" : "idle"}
      data-cola-phase={phase}
      className={cn(
        "cola-developing-stage pointer-events-none absolute inset-0 z-10 flex flex-col justify-between overflow-hidden rounded-[22px] p-3 text-left",
        phase === "understanding" && "is-understanding",
        phase === "revealing" && "is-revealing",
      )}
      aria-live="polite"
    >
      <div className="cola-developing-stage__grain" aria-hidden="true" />
      <div className="cola-developing-stage__scan" aria-hidden="true" />

      <div className="relative z-[2] flex items-start justify-between gap-3">
        <div className="min-w-0 rounded-[16px] bg-white/70 px-3 py-2 shadow-sm ring-1 ring-white/70 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className="cola-developing-stage__dot" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-950">生成中</p>
            <span
              data-cola-panel="generation-rhythm-notes"
              data-cola-effect="colorful-music-notes"
              data-cola-tone="rainbow"
              data-cola-motion="syncopated-jump"
              className="cola-rhythm-notes"
              aria-hidden="true"
            >
              {Array.from({ length: 3 }, (_, index) => (
                <span
                  key={index}
                  data-cola-note-index={index}
                  data-cola-note-tone="rainbow"
                  className="cola-rhythm-notes__note"
                  style={{ "--note-index": index } as CSSProperties}
                >
                  🎶
                </span>
              ))}
            </span>
          </div>
          <p className="mt-1 max-w-[220px] truncate text-xs leading-4 text-slate-500">
            正在生成图片 · 队列 {taskCount || 0} · {taskStatus || activePhase.label}
          </p>
        </div>
        <div className="hidden rounded-full bg-slate-950/80 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/86 shadow-sm backdrop-blur-xl min-[420px]:block">
          ColaAI
        </div>
      </div>

      <div
        data-cola-panel="generation-developing-frame"
        className="relative z-[1] grid flex-1 grid-cols-2 gap-2 py-3"
        aria-hidden="true"
      >
        {Array.from({ length: frameCount }, (_, index) => (
          <span
            key={index}
            className="cola-developing-stage__frame rounded-[14px] bg-white/30 shadow-inner ring-1 ring-white/44 backdrop-blur-sm"
            style={{ "--frame-index": index } as CSSProperties}
          >
            <span className="cola-developing-stage__frame-mark" />
          </span>
        ))}
      </div>
    </section>
  );
}

export function GenerateResultGrid({
  tasks,
  sessions,
  activeSessionId,
}: {
  tasks: GenerateTask[];
  sessions?: GenerateSession[];
  activeSessionId?: string;
}) {
  const activeSession = sessions?.find((session) => session.id === activeSessionId) ?? null;
  const visibleTasks = activeSession ? getGenerateSessionTasks(activeSession, tasks) : tasks;
  const images = getGeneratedTaskImages(visibleTasks);

  if (images.length === 0) {
    return null;
  }

  return (
    <div
      data-cola-panel="generate-result-grid"
      className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {images.map((image) => (
        <figure
          key={image.id}
          data-cola-task-id={image.taskId}
          className="group overflow-hidden rounded-[18px] bg-white/72 text-left shadow-[0_18px_55px_-46px_rgba(15,23,42,0.64)] ring-1 ring-black/5 backdrop-blur-xl"
        >
          <div className="aspect-square overflow-hidden bg-slate-100">
            <AuthenticatedImage
              src={image.src}
              alt={image.revisedPrompt || "生成结果"}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              loadingMotion="static"
            />
          </div>
          <figcaption className="space-y-1 px-3 py-2.5">
            <p className="truncate text-xs font-medium text-slate-600">
              {image.revisedPrompt || "生成结果"}
            </p>
            <p className="text-[11px] text-slate-400">
              {[image.model || "GPT-IMAGE-2", image.size].filter(Boolean).join(" · ")}
            </p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function GenerateSessionRail({
  sessions,
  activeSessionId,
  tasks = [],
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onOpenQueue,
}: {
  sessions: GenerateSession[];
  activeSessionId: string;
  tasks?: GenerateTask[];
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: () => void;
  onOpenQueue: () => void;
}) {
  const dragStateRef = useRef<{ pointerId: number; startX: number; scrollLeft: number; moved: boolean } | null>(null);
  const suppressSessionClickRef = useRef(false);
  const [isSessionDragging, setIsSessionDragging] = useState(false);

  const finishSessionDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStateRef.current = null;
    setIsSessionDragging(false);

    if (dragState.moved) {
      suppressSessionClickRef.current = true;
      window.setTimeout(() => {
        suppressSessionClickRef.current = false;
      }, 0);
    }
  }, []);

  const handleSessionPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest("[data-cola-session-click-target]")) {
      dragStateRef.current = null;
      setIsSessionDragging(false);
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsSessionDragging(true);
  }, []);

  const handleSessionPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const distance = event.clientX - dragState.startX;
    if (Math.abs(distance) > 4) {
      dragState.moved = true;
    }
    event.currentTarget.scrollLeft = dragState.scrollLeft - distance;

    if (dragState.moved) {
      event.preventDefault();
    }
  }, []);

  const handleSessionClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>, sessionId: string) => {
    if (suppressSessionClickRef.current) {
      event.preventDefault();
      return;
    }
    onSelectSession(sessionId);
  }, [onSelectSession]);
  const hasActiveSession = sessions.some((session) => session.id === activeSessionId);

  return (
    <aside
      data-cola-panel="generate-session-rail"
      data-cola-design="creative-session-strip"
      data-cola-state={hasActiveSession ? "active" : "idle"}
      data-cola-visual="glass-session-strip"
      className="flex min-h-[62px] w-full flex-nowrap items-start gap-3 overflow-hidden rounded-[22px] border border-emerald-100/55 bg-white/54 px-3 py-2 text-left shadow-[0_18px_70px_-54px_rgba(15,23,42,0.56)] ring-1 ring-white/62 backdrop-blur-2xl"
    >
      <div
        data-cola-panel="generate-session-list"
        data-cola-behavior="drag-scroll-sessions"
        data-cola-dragging={isSessionDragging ? "true" : "false"}
        className={cn(
          "hide-scrollbar flex min-w-0 flex-1 cursor-grab gap-2 overflow-x-auto overscroll-x-contain scroll-smooth select-none [touch-action:pan-y]",
          isSessionDragging && "cursor-grabbing scroll-auto",
        )}
        onPointerDown={handleSessionPointerDown}
        onPointerMove={handleSessionPointerMove}
        onPointerUp={finishSessionDrag}
        onPointerCancel={finishSessionDrag}
        onLostPointerCapture={finishSessionDrag}
      >
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          const resultCount = getGenerateSessionResultCount(session, tasks);
          return (
            <button
              key={session.id}
              type="button"
              data-cola-session-id={session.id}
              data-cola-session-state={active ? "active" : "idle"}
              data-cola-state={active ? "active" : "idle"}
              data-cola-session-click-target="true"
              aria-current={active ? "true" : undefined}
              className={cn(
                "relative min-w-[220px] max-w-[260px] rounded-[16px] border px-3 py-2 text-left backdrop-blur-xl transition",
                active
                  ? "border-emerald-200/90 bg-white text-slate-950 shadow-[0_16px_42px_-28px_rgba(16,185,129,0.8)] ring-2 ring-emerald-100/90"
                  : "border-white/54 bg-white/34 text-slate-500 hover:border-emerald-100 hover:bg-white/72 hover:text-slate-800",
              )}
              onClick={(event) => handleSessionClick(event, session.id)}
            >
              <span className="flex min-w-0 items-center gap-2">
                {active ? (
                  <span
                    data-cola-panel="generate-session-active-dot"
                    className="size-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]"
                    aria-hidden="true"
                  />
                ) : null}
                <span data-cola-panel="generate-session-title" className="block min-w-0 flex-1 truncate whitespace-nowrap text-sm font-semibold">
                  {session.title || "空对话"}
                </span>
                {active ? (
                  <span
                    data-cola-panel="generate-session-active-indicator"
                    className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-700 ring-1 ring-emerald-100"
                  >
                    当前
                  </span>
                ) : null}
              </span>
              <span data-cola-panel="generate-session-meta" className="mt-1 block truncate whitespace-nowrap text-xs text-slate-500">
                {formatGenerateSessionTime(session.updatedAt || session.createdAt)} · 已生成 {resultCount} 张图片
              </span>
            </button>
          );
        })}
      </div>
      <div data-cola-panel="generate-session-actions" className="flex shrink-0 self-stretch items-center gap-2">
        <button
          type="button"
          data-cola-action="delete-generate-session"
          className="grid size-8 place-items-center rounded-full bg-white/70 text-slate-500 ring-1 ring-black/[0.06] transition hover:bg-white hover:text-rose-500"
          aria-label="删除当前对话"
          onClick={onDeleteSession}
        >
          <Trash2 className="size-4" />
        </button>
        <button
          type="button"
          data-cola-action="open-task-queue"
          className="grid size-8 place-items-center rounded-full bg-white/70 text-slate-500 ring-1 ring-black/[0.06] transition hover:bg-white hover:text-emerald-700"
          aria-label="打开任务队列"
          onClick={onOpenQueue}
        >
          <Boxes className="size-4" />
        </button>
        <button
          type="button"
          data-cola-action="create-generate-session"
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-emerald-950"
          onClick={onCreateSession}
        >
          <Plus className="size-3.5" />
          新建对话
        </button>
      </div>
    </aside>
  );
}

function getQueueTaskStatusLabel(task: GenerateTask) {
  if (task.phase_label) {
    return task.phase_label;
  }
  if (task.phase) {
    return task.phase;
  }
  if (task.status === "success") {
    return "已完成";
  }
  if (task.status === "error") {
    return "失败";
  }
  if (task.status === "cancelled") {
    return "已取消";
  }
  return "生成中";
}

export function TaskQueuePopover({
  open,
  role = "creator",
  tasks,
  onClose,
}: {
  open: boolean;
  role?: ColaAuthSession["role"];
  tasks: GenerateTask[];
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  const activeTasks = tasks.filter((task) => !terminalTaskStatuses.has(task.status));
  const recentTasks = tasks.slice(0, 4);
  const queueItems = activeTasks.length > 0 ? activeTasks : recentTasks;

  return (
    <>
      <button
        type="button"
        aria-label="关闭任务队列"
        data-cola-backdrop="task-queue-popover"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        onClick={onClose}
      />
      <section
        data-cola-panel="task-queue-popover"
        data-cola-state={activeTasks.length > 0 ? "active" : "idle"}
        className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-[18px] border border-white/70 bg-white/92 text-left shadow-[0_24px_70px_-36px_rgba(15,23,42,0.52)] ring-1 ring-black/[0.06] backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">任务队列</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {activeTasks.length > 0 ? `${activeTasks.length} 个任务处理中` : "当前没有运行中的任务"}
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {role === "guest" ? "访客" : "创作者"}
          </span>
        </div>
        <div className="max-h-[288px] space-y-2 overflow-y-auto p-3">
          {queueItems.length > 0 ? (
            queueItems.map((task) => (
              <article key={task.id} data-cola-task-id={task.id} className="rounded-[14px] bg-slate-50 px-3 py-2.5 ring-1 ring-black/[0.03]">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-slate-700">{task.submissionContext?.prompt || task.id}</p>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                    {getQueueTaskStatusLabel(task)}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-400">
                  {[task.model || "GPT-IMAGE-2", task.size, formatGenerateSessionTime(task.updated_at || task.created_at || "")].filter(Boolean).join(" · ")}
                </p>
              </article>
            ))
          ) : (
            <div className="rounded-[14px] bg-slate-50 px-3 py-6 text-center">
              <p className="text-sm font-medium text-slate-600">任务队列空闲</p>
              <p className="mt-1 text-xs text-slate-400">开始生成后，任务会显示在这里。</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

type GenerateTurnRecord = {
  id: string;
  prompt: string;
  tasks: GenerateTask[];
  createdAt: string;
  updatedAt: string;
  requestedCount: number;
};

function buildGenerateTurnRecords(
  session: GenerateSession | null,
  tasks: GenerateTask[],
  fallbackPrompt: string,
  fallbackRequestedCount: number,
  includeFallbackRecord: boolean,
) {
  if (tasks.length === 0) {
    return includeFallbackRecord
      ? [
          {
            id: "draft-turn",
            prompt: fallbackPrompt,
            tasks: [],
            createdAt: session?.createdAt || "",
            updatedAt: session?.updatedAt || session?.createdAt || "",
            requestedCount: Math.max(1, fallbackRequestedCount),
          },
        ]
      : [];
  }

  const records: GenerateTurnRecord[] = [];
  const recordIndex = new Map<string, number>();
  for (const task of tasks) {
    const key = task.submissionContext?.turnId || "legacy-turn";
    const existingIndex = recordIndex.get(key);
    const prompt = task.submissionContext?.turnId ? task.submissionContext.prompt : fallbackPrompt;
    const createdAt = task.created_at || session?.createdAt || "";
    const updatedAt = task.updated_at || task.finished_at || createdAt;
    if (existingIndex === undefined) {
      recordIndex.set(key, records.length);
      records.push({
        id: key,
        prompt,
        tasks: [task],
        createdAt,
        updatedAt,
        requestedCount: Math.max(1, task.submissionContext?.count || fallbackRequestedCount),
      });
      continue;
    }
    const record = records[existingIndex];
    record.tasks.push(task);
    record.updatedAt = [record.updatedAt, updatedAt].filter(Boolean).sort().at(-1) || record.updatedAt;
    record.createdAt = [record.createdAt, createdAt].filter(Boolean).sort()[0] || record.createdAt;
    record.requestedCount = Math.max(record.requestedCount, task.submissionContext?.count || fallbackRequestedCount);
  }
  return records;
}

export function GenerateConversationStage({
  session,
  tasks,
  generationError,
  isStageActive,
  stageTaskCount,
  activeTask,
  hasGeneratedResults,
  requestedCount,
  onEditGeneratedImage,
  onRetryGeneration,
}: {
  session: GenerateSession | null;
  tasks: GenerateTask[];
  generationError: string;
  isStageActive: boolean;
  stageTaskCount: number;
  activeTask?: GenerateTask;
  hasGeneratedResults: boolean;
  requestedCount: number;
  onEditGeneratedImage?: (image: GeneratedTaskImage) => void;
  onRetryGeneration?: (task: GenerateTask) => void;
}) {
  const sessionTitle = session?.title || "空对话";
  const visibleTasks = session ? getGenerateSessionTasks(session, tasks) : tasks;
  const fallbackPromptText = sessionTitle === "空对话" ? "生成一张图片" : sessionTitle;
  const [liveNowMs, setLiveNowMs] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const generateRecordScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isStageActive) {
      return;
    }
    const updateNow = () => setLiveNowMs(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 1000);
    return () => window.clearInterval(timer);
  }, [isStageActive]);

  const latestKnownMs =
    visibleTasks
      .map((task) => timestampFromIso(task.finished_at || task.updated_at || task.started_at || task.created_at))
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b)
      .at(-1) ?? timestampFromIso(session?.updatedAt || session?.createdAt) ?? 0;
  const nowMs = isStageActive && liveNowMs ? liveNowMs : latestKnownMs;
  const allImages = getGeneratedTaskImages(visibleTasks);
  const lightboxImages = allImages.map((image) => ({
    id: image.id,
    src: image.src,
    sizeLabel: image.model || "GPT-IMAGE-2",
    dimensions: image.size,
  }));
  const hasConversationContent = Boolean(generationError) || isStageActive || visibleTasks.length > 0 || allImages.length > 0;
  const turnRecords = buildGenerateTurnRecords(session, visibleTasks, fallbackPromptText, requestedCount, hasConversationContent);

  const openGeneratedImage = (image: GeneratedTaskImage) => {
    const nextIndex = Math.max(
      0,
      allImages.findIndex((item) => item.id === image.id),
    );
    setLightboxIndex(nextIndex);
    setLightboxOpen(true);
  };

  const scrollGenerateRecordToBottom = useCallback(() => {
    if (!generateRecordScrollRef.current) {
      return;
    }
    const container = generateRecordScrollRef.current;
    setTimeout(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }, 100);
  }, []);

  useEffect(() => {
    scrollGenerateRecordToBottom();
  }, [visibleTasks.length, scrollGenerateRecordToBottom]);

  useEffect(() => {
    if (visibleTasks.length === 0) {
      return;
    }
    scrollGenerateRecordToBottom();
  }, [visibleTasks[visibleTasks.length - 1]?.status, scrollGenerateRecordToBottom, visibleTasks.length]);

  return (
    <>
    <section
      data-cola-panel="generate-conversation-stage"
      data-cola-design="developing-studio-stage"
      data-cola-layout="conversation-results-feed"
      data-cola-mobile-layout="status-stack"
      data-cola-state={hasConversationContent ? "content" : "empty"}
      data-cola-behavior="middle-conversation-scroll"
      className="flex min-h-0 w-full flex-1 flex-col text-left"
    >
      <div
        data-cola-panel="generate-conversation-thread"
        className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-7 overflow-hidden px-0 py-2 max-[560px]:gap-5"
        data-cola-mobile-layout="full-width-results"
      >
        {hasConversationContent ? (
          <article
            data-cola-panel="generate-record-card"
            data-cola-behavior="record-scroll-box"
            data-cola-layout="studio-creation-record-flow"
            className="mx-auto flex max-h-full min-h-0 w-full max-w-[1040px] flex-1 overflow-hidden rounded-[32px] bg-white/70 p-3 shadow-[0_24px_80px_-58px_rgba(15,23,42,0.72)] ring-1 ring-emerald-100/62 backdrop-blur-xl max-[560px]:w-full max-[560px]:rounded-[18px] max-[560px]:px-2 max-[560px]:py-2"
          >
          <div
            ref={generateRecordScrollRef}
            data-cola-panel="generate-record-scroll"
            data-cola-behavior="internal-record-scroll"
            className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 py-4 pb-12 max-[560px]:gap-5 max-[560px]:px-3"
          >
            {turnRecords.map((record, recordIndex) => {
              const recordImages = getGeneratedTaskImages(record.tasks);
              const recordResultCount = recordImages.length;
              const recordFailedTasks = record.tasks.filter((task) => task.status === "error" || task.status === "cancelled");
              const recordFailedCount = recordFailedTasks.length;
              const recordIsActive =
                isStageActive &&
                (record.tasks.length === 0 || !activeTask || record.tasks.some((task) => task.id === activeTask.id));
              const recordStatusLabel =
                generationError && recordIndex === turnRecords.length - 1
                  ? "失败"
                  : recordFailedCount > 0
                    ? "失败"
                    : recordResultCount > 0
                      ? "成功"
                      : recordIsActive
                        ? "生成中"
                        : "待生成";
              const recordNowMs = recordIsActive && liveNowMs ? liveNowMs : nowMs;
              const recordElapsedMs = getSessionElapsedMs(record.tasks, recordNowMs);
              const recordWaitingMs = getSessionWaitingMs(record.tasks, recordNowMs);
              const recordTiming = getSessionTimingStats(record.tasks);
              const recordHasGeneratedResults = recordImages.length > 0;
              const recordRequestedCountLabel = `${Math.max(1, record.requestedCount)} 张`;

              return (
                <div key={record.id} data-cola-panel="generate-turn-record" className="contents">
                  <article
                    data-cola-panel="generate-prompt-card"
                    className="relative ml-auto w-full max-w-[560px] rounded-[22px] bg-white/92 px-3.5 py-2.5 shadow-[0_14px_48px_-40px_rgba(15,23,42,0.64)] ring-1 ring-emerald-100/60 backdrop-blur-xl max-[560px]:rounded-[20px] max-[560px]:px-3 max-[560px]:py-2.5"
                  >
                    <div data-cola-panel="generate-run-card" className="min-w-0">
                      <div data-cola-panel="generate-prompt-meta" className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap pr-16 text-[11px] text-[#51617d]">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">第 {recordIndex + 1} 轮</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">文生图</span>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-100/70">官方图片工具</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">{recordStatusLabel}</span>
                        <span className="truncate px-1">{formatGenerateSessionTime(record.updatedAt || record.createdAt)}</span>
                      </div>
                      <div className="absolute right-3 top-2 flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          aria-label="编辑生成记录"
                          className="grid size-8 place-items-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-950"
                        >
                          <PenTool className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="重新生成"
                          className="grid size-8 place-items-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-950"
                        >
                          <RefreshCw className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <p
                      data-cola-panel="generate-user-message-bubble"
                      data-cola-role="user"
                      className="mt-1.5 text-sm font-semibold leading-6 text-slate-950"
                    >
                      {record.prompt}
                    </p>
                  </article>

              <div
                data-cola-panel="generate-status-strip"
                className="inline-flex w-fit max-w-full self-start flex-wrap items-center gap-1.5 text-xs leading-none text-[#51617d] max-[560px]:grid max-[560px]:w-full max-[560px]:grid-cols-2 max-[560px]:items-stretch max-[560px]:gap-2"
                data-cola-mobile-layout="status-stack"
              >
                <div data-cola-panel="generate-result-summary" className="flex max-w-full flex-wrap items-center gap-1.5 max-[560px]:contents">
                  <span className="font-medium leading-none text-slate-800">结果</span>
                  <span className="rounded-full bg-slate-100/70 px-2 py-1 leading-none">{recordRequestedCountLabel.replace(" ", "")}</span>
                  <span className="rounded-full bg-slate-100/70 px-2 py-1 leading-none">成功{recordResultCount}/失败{recordFailedCount}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 leading-none text-emerald-700">耗时 {formatDuration(recordElapsedMs)}</span>
                  <span className="rounded-full bg-white px-2 py-1 leading-none shadow-sm ring-1 ring-slate-200">等待 {formatDuration(recordWaitingMs)}</span>
                  <span className="rounded-full bg-white px-2 py-1 leading-none shadow-sm ring-1 ring-slate-200">排队 {formatDuration(recordTiming.queueMs)}</span>
                </div>
              </div>

              <div data-cola-panel="generate-result-cards" className="space-y-4 max-[560px]:w-full" data-cola-mobile-layout="full-width-results">
                <div data-cola-panel="generate-result-gallery" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-[560px]:w-full max-[560px]:grid-cols-1 max-[560px]:gap-3" data-cola-mobile-layout="full-width-results">
                  {recordHasGeneratedResults ? (
                    recordImages.map((image, imageIndex) => (
                      <div
                        key={image.id}
                        data-cola-panel="generate-result-card"
                        data-cola-task-id={image.taskId}
                        className="w-[min(320px,72vw)] overflow-hidden rounded-[22px] bg-white shadow-sm max-[560px]:w-full max-[560px]:rounded-[18px]"
                      >
                        <div className="relative aspect-square w-full overflow-hidden rounded-[22px] bg-slate-100">
                          <button type="button" className="block h-full w-full cursor-zoom-in" onClick={() => openGeneratedImage(image)}>
                            <AuthenticatedImage
                              src={image.src}
                              alt={image.revisedPrompt || `生成结果 ${imageIndex + 1}`}
                              className="h-full w-full rounded-[22px] object-cover transition duration-300 hover:scale-[1.02]"
                              loadingMotion="static"
                            />
                          </button>
                          <div
                            data-cola-panel="generate-result-card-footer"
                            className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-slate-950/54 via-slate-950/16 to-transparent p-3"
                          >
                            <span className="rounded-full bg-white/18 px-2.5 py-1 text-xs font-medium text-white shadow-sm backdrop-blur-md">结果 {imageIndex + 1}</span>
                            <div data-cola-panel="generate-result-actions" className="pointer-events-auto flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label={`复制结果 ${imageIndex + 1}`}
                              className="grid size-8 place-items-center rounded-full bg-white/72 text-slate-700 shadow-sm ring-1 ring-white/65 backdrop-blur-md transition hover:bg-white hover:text-slate-950"
                              onClick={(event) => {
                                event.stopPropagation();
                                copyTextToClipboard(image.src);
                              }}
                            >
                              <Copy className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`编辑结果 ${imageIndex + 1}`}
                              className="grid size-8 place-items-center rounded-full bg-white/72 text-slate-700 shadow-sm ring-1 ring-white/65 backdrop-blur-md transition hover:bg-white hover:text-slate-950"
                              onClick={(event) => {
                                event.stopPropagation();
                                onEditGeneratedImage?.(image);
                              }}
                            >
                              <PenTool className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`下载结果 ${imageIndex + 1}`}
                              className="grid size-8 place-items-center rounded-full bg-white/72 text-slate-700 shadow-sm ring-1 ring-white/65 backdrop-blur-md transition hover:bg-white hover:text-slate-950"
                              onClick={(event) => {
                                event.stopPropagation();
                                void downloadImageUrl(image.src, getGeneratedImageFileName(image, imageIndex));
                              }}
                            >
                              <Download className="size-3.5" />
                            </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <figure
                      data-cola-panel="generate-result-card"
                      className="w-[min(320px,72vw)] shrink-0 overflow-hidden rounded-[22px] bg-white shadow-[0_22px_62px_-48px_rgba(15,23,42,0.68)] max-[560px]:w-full max-[560px]:rounded-[18px]"
                    >
                      <div data-cola-panel="generate-result-placeholder" className="relative aspect-square rounded-[22px] bg-[linear-gradient(135deg,#e5e7eb,#f8fafc)] shadow-inner">
                        <span className="sr-only">生成图片占位</span>
                        {recordIsActive ? <GenerationStage isActive={recordIsActive} taskCount={stageTaskCount} activeTask={activeTask} /> : null}
                        {!recordIsActive ? (
                          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-slate-950/24 to-transparent p-3">
                            <span className="rounded-full bg-white/60 px-2.5 py-1 text-xs font-medium text-slate-500 shadow-sm backdrop-blur-md">结果 1</span>
                            <div data-cola-panel="generate-result-actions" className="flex items-center gap-1.5 text-slate-400">
                              <button type="button" aria-label="复制结果 1" className="grid size-8 place-items-center rounded-full bg-white/70 shadow-sm ring-1 ring-white/70 backdrop-blur-md" disabled>
                                <Copy className="size-3.5" />
                              </button>
                              <button type="button" aria-label="编辑结果 1" className="grid size-8 place-items-center rounded-full bg-white/70 shadow-sm ring-1 ring-white/70 backdrop-blur-md" disabled>
                                <PenTool className="size-3.5" />
                              </button>
                              <button type="button" aria-label="下载结果 1" className="grid size-8 place-items-center rounded-full bg-white/70 shadow-sm ring-1 ring-white/70 backdrop-blur-md" disabled>
                                <Download className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </figure>
                  )}
                </div>

                {recordFailedTasks.length > 0 ? (
                  <div data-cola-panel="generate-task-errors" className="grid max-w-[720px] gap-2">
                    {recordFailedTasks.map((task) => {
                      const retrying = Boolean(task.submissionContext?.retrying);
                      return (
                        <div
                          key={task.id}
                          data-cola-task-id={task.id}
                          className="flex items-start justify-between gap-3 rounded-[18px] bg-rose-50/92 px-4 py-3 text-sm text-rose-600 ring-1 ring-rose-100 backdrop-blur-xl"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold">任务提交失败</p>
                            <p className="mt-1 break-words text-xs leading-5">{task.error || "提交生成任务失败，请稍后重试。"}</p>
                            <p className="mt-1 truncate font-mono text-[11px] text-rose-400">{task.id}</p>
                          </div>
                          <button
                            type="button"
                            data-cola-action="retry-failed-generation"
                            data-cola-retry-state={retrying ? "retrying" : "idle"}
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-100 transition hover:bg-rose-100",
                              retrying && "cursor-not-allowed opacity-70 hover:bg-white",
                            )}
                            disabled={retrying}
                            onClick={() => {
                              if (retrying) {
                                return;
                              }
                              onRetryGeneration?.(task);
                            }}
                          >
                            <RefreshCw className={cn("size-3.5", retrying && "animate-spin")} />
                            {retrying ? "重试中" : "重试"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {generationError && recordIndex === turnRecords.length - 1 ? (
                  <div data-cola-panel="generate-error" className="w-full max-w-[720px] rounded-[18px] bg-rose-50/92 px-4 py-3 text-sm text-rose-600 ring-1 ring-rose-100 backdrop-blur-xl">
                    {generationError}
                  </div>
                ) : null}

              </div>
                </div>
              );
            })}
            </div>
          </article>
        ) : (
          <div
            data-cola-panel="generate-empty-conversation-space"
            className="flex min-h-[420px] flex-1 items-center justify-center rounded-[24px] border border-transparent bg-transparent max-[560px]:min-h-[320px] max-[560px]:w-full max-[560px]:rounded-[18px] max-[560px]:px-2 max-[560px]:grid max-[560px]:w-full max-[560px]:grid-cols-2 max-[560px]:items-stretch"
          >
            <span className="sr-only">空对话区域</span>
          </div>
        )}
      </div>
    </section>
    <ImageLightbox
      images={lightboxImages}
      currentIndex={lightboxIndex}
      open={lightboxOpen}
      onOpenChange={setLightboxOpen}
      onIndexChange={setLightboxIndex}
    />
    </>
  );
}

function DiscoverHome({
  prompt,
  count,
  quality,
  ratio,
  resolution,
  imageModel,
  publicMode,
  referenceImages,
  isGenerating,
  stickyVisible,
  creations,
  creationFeedStatus = "idle",
  onPromptChange,
  onCountChange,
  onQualityChange,
  onRatioChange,
  onResolutionChange,
  onImageModelChange,
  onPublicChange,
  onReferenceFileChange,
  onOpenPrompts,
  onGenerate,
  onOpenCreation,
  onUsePrompt,
  onCopyPrompt,
  onRefreshCreations,
}: {
  prompt: string;
  count: number;
  quality: string;
  ratio: string;
  resolution: ImageResolution;
  imageModel: GenerateImageModel;
  publicMode: boolean;
  referenceImages: ReferenceImage[];
  isGenerating: boolean;
  stickyVisible: boolean;
  creations: CreationItem[];
  creationFeedStatus?: CreationFeedStatus;
  onPromptChange: (prompt: string) => void;
  onCountChange: (count: number) => void;
  onQualityChange: (quality: string) => void;
  onRatioChange: (ratio: string) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  onImageModelChange: (model: GenerateImageModel) => void;
  onPublicChange: (publicMode: boolean) => void;
  onReferenceFileChange: (files: File[]) => void;
  onOpenPrompts: () => void;
  onGenerate: () => void;
  onOpenCreation: (item: CreationItem) => void;
  onUsePrompt: (prompt: string) => void;
  onCopyPrompt: (prompt: string) => void;
  onRefreshCreations?: () => Promise<void>;
}) {
  const pullStartY = useRef<number | null>(null);
  const pullInput = useRef<"pointer" | "touch" | null>(null);
  const resetPullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullThreshold = 72;
  const pullPhase: PullRefreshPhase = isRefreshing ? "loading" : pullDistance >= pullThreshold ? "release" : isPulling && pullDistance > 4 ? "pulling" : "idle";

  const clearResetTimer = useCallback(() => {
    if (resetPullTimer.current) {
      clearTimeout(resetPullTimer.current);
      resetPullTimer.current = null;
    }
  }, []);

  const beginPull = useCallback((clientY: number, input: "pointer" | "touch") => {
    if (isRefreshing || (pullInput.current && pullInput.current !== input)) {
      return;
    }
    if (typeof window !== "undefined" && window.scrollY > 2) {
      return;
    }
    clearResetTimer();
    pullInput.current = input;
    pullStartY.current = clientY;
    setIsPulling(true);
  }, [clearResetTimer, isRefreshing]);

  const updatePull = useCallback((clientY: number, input: "pointer" | "touch", preventDefault?: () => void) => {
    if (pullInput.current !== input || pullStartY.current === null || isRefreshing) {
      return;
    }
    const delta = clientY - pullStartY.current;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }
    if (typeof window !== "undefined" && window.scrollY > 2) {
      pullStartY.current = null;
      pullInput.current = null;
      setIsPulling(false);
      setPullDistance(0);
      return;
    }
    preventDefault?.();
    setPullDistance(Math.min(96, Math.round(delta * 0.52)));
  }, [isRefreshing]);

  const finishPull = useCallback((input: "pointer" | "touch") => {
    if (pullInput.current !== input || pullStartY.current === null) {
      return;
    }

    const shouldRefresh = pullDistance >= pullThreshold;
    pullInput.current = null;
    pullStartY.current = null;
    setIsPulling(false);

    if (!shouldRefresh) {
      setPullDistance(0);
      return;
    }

    setPullDistance(pullThreshold);
    setIsRefreshing(true);
    clearResetTimer();
    void (async () => {
      try {
        await onRefreshCreations?.();
      } finally {
        resetPullTimer.current = setTimeout(() => {
          setIsRefreshing(false);
          setPullDistance(0);
          resetPullTimer.current = null;
        }, 360);
      }
    })();
  }, [clearResetTimer, onRefreshCreations, pullDistance]);

  useEffect(() => () => clearResetTimer(), [clearResetTimer]);

  return (
    <main
      data-cola-panel="discover-home"
      data-cola-behavior="drop-reference-image"
      data-cola-drop-target="image-reference"
      className="relative z-10 mx-auto flex min-h-dvh w-full max-w-none flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-0 md:pb-12 md:pl-[104px] md:pr-0"
      onPointerDown={(event: ReactPointerEvent<HTMLElement>) => {
        if (event.pointerType === "mouse" && event.button === 0) {
          beginPull(event.clientY, "pointer");
        }
      }}
      onPointerMove={(event: ReactPointerEvent<HTMLElement>) => {
        updatePull(event.clientY, "pointer");
      }}
      onPointerUp={() => finishPull("pointer")}
      onPointerCancel={() => finishPull("pointer")}
      onTouchStart={(event: ReactTouchEvent<HTMLElement>) => {
        const touch = event.touches[0];
        if (touch) {
          beginPull(touch.clientY, "touch");
        }
      }}
      onTouchMove={(event: ReactTouchEvent<HTMLElement>) => {
        const touch = event.touches[0];
        if (touch) {
          updatePull(touch.clientY, "touch", () => {
            if (event.cancelable) {
              event.preventDefault();
            }
          });
        }
      }}
      onTouchEnd={() => finishPull("touch")}
      onTouchCancel={() => finishPull("touch")}
    >
      <PullRefreshIndicator distance={pullDistance} phase={pullPhase} />
      <section
        id="cola-discover-hero"
        data-cola-panel="discover-hero"
        data-cola-variant="rova-compact-hero"
        data-cola-layout="rova-export-hero"
        className="flex min-h-[640px] flex-col items-center justify-start pt-[112px] text-center md:min-h-[704px] md:pt-[169px]"
      >
        <h1 className="max-w-[900px] text-[clamp(40px,10vw,48px)] font-medium leading-none tracking-normal text-[#1a1a1a] sm:text-[clamp(56px,6vw,80px)] md:text-[80px]">
          <span className="sr-only">用想象力 创造世界</span>
          <span aria-hidden="true">用想象力</span>
          <span
            aria-hidden="true"
            data-cola-effect="sparkle-text"
            className="relative inline-block px-[0.06em] font-sans text-[1.12em] font-semibold tracking-[-0.045em] text-slate-950"
          >
            创造
          </span>
          <span aria-hidden="true">世界</span>
        </h1>
        <p className="mt-[26px] max-w-[574px] text-base leading-[1.6] text-[#373a46] sm:text-lg">
          用 GPT-IMAGE-2 将你的创意变为精美图片，只需描述你脑海中的画面。
        </p>
        <div className="mt-[17px] w-full max-w-[960px]">
          <RovaComposer
            prompt={prompt}
            count={count}
            quality={quality}
            ratio={ratio}
            resolution={resolution}
            imageModel={imageModel}
            publicMode={publicMode}
            referenceImageName={referenceImages.length > 1 ? `${referenceImages.length} 张参考图` : referenceImages[0]?.name}
            isGenerating={isGenerating}
            onPromptChange={onPromptChange}
            onCountChange={onCountChange}
            onQualityChange={onQualityChange}
            onRatioChange={onRatioChange}
            onResolutionChange={onResolutionChange}
            onImageModelChange={onImageModelChange}
            onPublicChange={onPublicChange}
            onReferenceFileChange={onReferenceFileChange}
            onOpenPrompts={onOpenPrompts}
            onGenerate={onGenerate}
          />
        </div>
        <div className="mt-[24px] flex flex-wrap items-center justify-center gap-2 text-sm text-[#373a46]/70">
          <span className="text-amber-400" aria-hidden="true">★★★★★</span>
          <span>今日已生成 4,200+ 张图片</span>
          <span className="flex gap-1" aria-hidden="true">
            {["bg-sky-400", "bg-rose-400", "bg-amber-400", "bg-emerald-400", "bg-violet-400"].map((color) => (
              <span key={color} className={cn("size-2 rounded-full", color)} />
            ))}
          </span>
        </div>
      </section>

      <CreationFeed
        flushTop
        creations={creations}
        title="公共精选"
        subtitle="来自 ColaAI 社区"
        isLoading={creationFeedStatus === "loading"}
        isRefreshing={creationFeedStatus === "refreshing"}
        onOpen={onOpenCreation}
        onUsePrompt={onUsePrompt}
        onCopyPrompt={onCopyPrompt}
      />

      <div
        data-cola-panel="sticky-composer"
        data-cola-behavior="appears-after-hero"
        className={cn(
          "fixed bottom-[56px] left-0 right-0 z-30 px-4 pb-4 transition duration-300 sm:bottom-0 sm:left-[104px] sm:px-8",
          stickyVisible ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
        )}
      >
        <div className="mx-auto max-w-[960px] pt-4">
          <RovaComposer
            prompt={prompt}
            count={count}
            quality={quality}
            ratio={ratio}
            resolution={resolution}
            imageModel={imageModel}
            publicMode={publicMode}
            referenceImageName={referenceImages.length > 1 ? `${referenceImages.length} 张参考图` : referenceImages[0]?.name}
            isGenerating={isGenerating}
            sticky
            onPromptChange={onPromptChange}
            onCountChange={onCountChange}
            onQualityChange={onQualityChange}
            onRatioChange={onRatioChange}
            onResolutionChange={onResolutionChange}
            onImageModelChange={onImageModelChange}
            onPublicChange={onPublicChange}
            onReferenceFileChange={onReferenceFileChange}
            onOpenPrompts={onOpenPrompts}
            onGenerate={onGenerate}
          />
        </div>
      </div>
    </main>
  );
}

export function GenerateWorkspace({
  prompt,
  count,
  quality,
  ratio,
  resolution,
  imageModel,
  publicMode,
  referenceImages,
  isGenerating,
  submittedTasks,
  generateSessions,
  activeGenerateSessionId,
  generationError,
  focusedTaskId,
  focusedCanvasTask,
  queueUserRole = "creator",
  onPromptChange,
  onCountChange,
  onQualityChange,
  onRatioChange,
  onResolutionChange,
  onImageModelChange,
  onPublicChange,
  onReferenceFileChange,
  onReferenceRemove,
  onOpenPrompts,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onOpenQueue,
  onGenerate,
  onEditGeneratedImage,
  onRetryGeneration,
  onClearFocusedTask,
}: {
  prompt: string;
  count: number;
  quality: string;
  ratio: string;
  resolution: ImageResolution;
  imageModel: GenerateImageModel;
  publicMode: boolean;
  referenceImages: ReferenceImage[];
  isGenerating: boolean;
  submittedTasks: GenerateTask[];
  generateSessions: GenerateSession[];
  activeGenerateSessionId: string;
  generationError: string;
  focusedTaskId?: string;
  focusedCanvasTask?: GenerateTaskDiagnosticsSnapshot | null;
  queueUserRole?: ColaAuthSession["role"];
  onPromptChange: (prompt: string) => void;
  onCountChange: (count: number) => void;
  onQualityChange: (quality: string) => void;
  onRatioChange: (ratio: string) => void;
  onResolutionChange: (resolution: ImageResolution) => void;
  onImageModelChange: (model: GenerateImageModel) => void;
  onPublicChange: (publicMode: boolean) => void;
  onReferenceFileChange: (files: File[]) => void;
  onReferenceRemove: () => void;
  onOpenPrompts: () => void;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: () => void;
  onOpenQueue: () => void;
  onGenerate: () => void;
  onEditGeneratedImage?: (image: GeneratedTaskImage) => void;
  onRetryGeneration: (task: GenerateTask) => void;
  onClearFocusedTask?: () => void;
}) {
  const [taskQueueOpen, setTaskQueueOpen] = useState(false);
  const activeSession = generateSessions.find((session) => session.id === activeGenerateSessionId) ?? generateSessions[0] ?? null;
  const visibleTasks = activeSession ? getGenerateSessionTasks(activeSession, submittedTasks) : submittedTasks;
  const activeTasks = visibleTasks.filter((task) => !terminalTaskStatuses.has(task.status));
  const activeTask = activeTasks[0] ?? visibleTasks[0];
  const isStageActive = isGenerating || activeTasks.length > 0;
  const stageTaskCount = activeTasks.length || (isGenerating ? count : visibleTasks.length);
  const hasGeneratedResults = getGeneratedTaskImages(visibleTasks).length > 0;
  const focusedTask = focusedTaskId ? submittedTasks.find((task) => task.id === focusedTaskId) ?? null : null;
  const focusedCanvasSnapshot = focusedCanvasTask?.id === focusedTaskId ? focusedCanvasTask : null;
  const showFocusedDiagnostics = Boolean(focusedTaskId && (focusedTask || focusedCanvasSnapshot));
  const handleOpenQueue = useCallback(() => {
    setTaskQueueOpen((current) => !current);
    onOpenQueue();
  }, [onOpenQueue]);

  return (
    <main
      data-cola-panel="generate-workspace"
      data-cola-layout="rova-generate-focus"
      data-cola-mobile-layout="compact-generation"
      data-cola-behavior="drop-reference-image"
      data-cola-drop-target="image-reference"
      className="relative z-10 mx-auto flex h-dvh w-full max-w-none flex-col overflow-hidden px-4 pb-28 pt-[78px] md:pb-6 md:pl-[104px] md:pr-8 md:pt-[30px] max-[560px]:px-3 max-[560px]:pb-[calc(env(safe-area-inset-bottom)+112px)] max-[560px]:pt-[calc(env(safe-area-inset-top)+58px)]"
    >
      <div
        data-cola-panel="generate-session-topbar"
        data-cola-behavior="fixed-session-header"
        className="relative z-20 mx-auto w-full max-w-[1240px] shrink-0"
      >
        <GenerateSessionRail
          sessions={generateSessions}
          activeSessionId={activeGenerateSessionId}
          tasks={submittedTasks}
          onCreateSession={onCreateSession}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          onOpenQueue={handleOpenQueue}
        />
        <TaskQueuePopover
          open={taskQueueOpen}
          role={queueUserRole}
          tasks={submittedTasks}
          onClose={() => setTaskQueueOpen(false)}
        />
      </div>

      <div data-cola-panel="generate-hero-dock" className="mx-auto flex min-h-0 flex-1 w-full max-w-[1240px] flex-col items-center gap-4 pb-7 pt-4 md:pb-2 max-[560px]:pb-5">
        <div data-cola-part="generate-hero-top" className="flex min-h-0 w-full flex-1 flex-col items-center">
          <div data-cola-panel="generate-stage-area" className="flex min-h-0 w-full max-w-[1164px] flex-1 flex-col items-start gap-3">
            <GenerateConversationStage
              session={activeSession}
              tasks={submittedTasks}
              generationError={generationError}
              isStageActive={isStageActive}
              stageTaskCount={stageTaskCount}
              activeTask={activeTask}
              hasGeneratedResults={hasGeneratedResults}
              requestedCount={count}
              onEditGeneratedImage={onEditGeneratedImage}
              onRetryGeneration={onRetryGeneration}
            />
          </div>
        </div>

        {showFocusedDiagnostics ? (
          <div data-cola-panel="generate-diagnostics-dock" className="w-full max-w-[1164px]">
            <GenerateTaskDiagnosticsPanel
              task={focusedTask}
              canvasTask={focusedCanvasSnapshot}
              focusSource={focusedCanvasSnapshot ? "canvas" : "generate"}
              onRetryGeneration={onRetryGeneration}
              onClearFocus={onClearFocusedTask}
            />
          </div>
        ) : null}

        <div data-cola-panel="generate-composer-dock" className="w-full shrink-0">
          <GenerateComposer
            prompt={prompt}
            count={count}
            quality={quality}
            ratio={ratio}
            resolution={resolution}
            imageModel={imageModel}
            publicMode={publicMode}
            referenceImages={referenceImages}
            isGenerating={isGenerating}
            onPromptChange={onPromptChange}
            onCountChange={onCountChange}
            onQualityChange={onQualityChange}
            onRatioChange={onRatioChange}
            onResolutionChange={onResolutionChange}
            onImageModelChange={onImageModelChange}
            onPublicChange={onPublicChange}
            onReferenceFileChange={onReferenceFileChange}
            onReferenceRemove={onReferenceRemove}
            onOpenPrompts={onOpenPrompts}
            onGenerate={onGenerate}
          />

        </div>
      </div>
    </main>
  );
}

export function PromptCardArtwork({ card }: { card: PromptCard }) {
  return (
    <div
      data-cola-panel="prompt-template-preview"
      className={cn("relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br", card.tone)}
    >
      {card.previewUrl ? (
        <AuthenticatedImage
          src={card.previewUrl}
          fallbackSrc={card.previewFallbackUrl}
          alt={`${card.title} 预览图`}
          data-cola-media="prompt-template-preview-image"
          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          loadingMotion="static"
        />
      ) : (
        <>
          <div className="absolute inset-4 rounded-[22px] bg-white/36 ring-1 ring-white/70 transition group-hover:scale-[0.98]" />
          <div className="absolute bottom-5 left-5 right-5 space-y-2">
            <span className="block h-3 w-2/3 rounded-full bg-white/72" />
            <span className="block h-3 w-1/2 rounded-full bg-white/54" />
            <span className="block h-8 w-full rounded-[12px] bg-white/42" />
          </div>
        </>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/34 via-transparent to-white/14" aria-hidden="true" />
      <div className="absolute left-4 top-4 flex items-center gap-1.5">
        <span className="rounded-full bg-white/82 px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur">{card.category}</span>
        <span className="rounded-full bg-slate-950/82 px-2.5 py-1 text-[11px] font-semibold text-white">{card.ratio}</span>
      </div>
    </div>
  );
}

function PromptLibrary({
  onUsePrompt,
  onCopyPrompt,
}: {
  onUsePrompt: (prompt: string) => void;
  onCopyPrompt: (prompt: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("all");
  const [visiblePage, setVisiblePage] = useState(1);
  const [remotePromptCards, setRemotePromptCards] = useState<PromptCard[]>([]);
  const [promptStats, setPromptStats] = useState<PromptTemplateStats>(emptyPromptStats);
  const [promptLoadState, setPromptLoadState] = useState<PromptTemplateLoadState>("loading");
  const pageSize = 8;

  const normalizedQuery = query.trim().toLowerCase();
  const hasRemotePrompts = shouldUseRemotePromptTemplates(promptLoadState, promptStats, remotePromptCards.length);
  const promptSourceCards = useMemo(
    () => resolvePromptSourceCards(hasRemotePrompts, remotePromptCards),
    [hasRemotePrompts, remotePromptCards],
  );
  const promptSourceCount = promptSourceCards.length;
  const promptLibraryTotalCount = getPromptLibraryTotalCount(hasRemotePrompts, promptStats, promptSourceCount);
  const activeTagLabel = activeTag === "all" ? "精选提示词" : `#${activeTag}`;
  const promptDataSourceLabel = hasRemotePrompts ? "公开模板库" : "GitHub 社区源";
  const promptLibraryTags = useMemo(
    () => {
      const allTags = new Set(promptTags);
      for (const card of promptSourceCards) {
        for (const tag of card.tags) {
          allTags.add(tag);
        }
      }
      return Array.from(allTags).map((tag) => ({
        tag,
        label: tag === "all" ? "精选提示词" : tag,
        count: tag === "all" ? promptSourceCards.length : promptSourceCards.filter((card) => card.tags.includes(tag)).length,
      }));
    },
    [promptSourceCards],
  );
  const filteredPromptCards = useMemo(() => {
    return promptSourceCards.filter((card) => {
      const matchesTag = activeTag === "all" || card.tags.includes(activeTag);
      const searchableText = [
        card.title,
        card.prompt,
        card.author,
        card.category,
        card.useCase,
        card.ratio,
        ...card.tags,
      ].join(" ").toLowerCase();
      return matchesTag && (!normalizedQuery || searchableText.includes(normalizedQuery));
    });
  }, [activeTag, normalizedQuery, promptSourceCards]);
  const visiblePromptCards = filteredPromptCards.slice(0, visiblePage * pageSize);
  const hasMorePrompts = visiblePromptCards.length < filteredPromptCards.length;
  const hasActiveFilters = Boolean(normalizedQuery) || activeTag !== "all";

  useEffect(() => {
    let active = true;
    const loadPromptTemplates = async () => {
      setPromptLoadState("loading");
      try {
        const [statsResult, templatesResult] = await Promise.all([
          fetchPromptTemplateStats(),
          fetchPromptTemplates({
            scope: "public",
            q: query.trim(),
            tag: activeTag === "all" ? undefined : activeTag,
          }),
        ]);
        if (!active) {
          return;
        }
        setPromptStats(statsResult);
        setRemotePromptCards(templatesResult.items.map(promptTemplateToPromptCard));
        setPromptLoadState("ready");
      } catch {
        if (!active) {
          return;
        }
        setPromptStats(emptyPromptStats);
        setRemotePromptCards([]);
        setPromptLoadState("error");
      }
    };

    void loadPromptTemplates();
    return () => {
      active = false;
    };
  }, [activeTag, query]);

  const clearPromptFilters = () => {
    setQuery("");
    setActiveTag("all");
    setVisiblePage(1);
  };

  const handlePromptSearchChange = (value: string) => {
    setQuery(value);
    setVisiblePage(1);
  };

  const handlePromptTagChange = (tag: string) => {
    setActiveTag(tag);
    setVisiblePage(1);
  };

  return (
    <main
      data-cola-panel="prompt-library"
      data-cola-design="clear-studio-prompt-library"
      className="relative z-10 mx-auto min-h-dvh w-full max-w-[1400px] px-4 pb-28 pt-14 md:pl-[104px] md:pr-8 md:pt-[84px]"
    >
      <section className="mx-auto max-w-[1180px]">
        <div className="mx-auto max-w-[880px] text-center">
          <div
            data-cola-effect="clear-studio-kicker"
            className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/84 px-4 py-1.5 text-xs font-medium text-slate-500 shadow-[0_12px_32px_-28px_rgba(15,23,42,0.48)]"
          >
            <Sparkles className="size-3.5 text-cyan-500" />
            精选提示词库 · 来自 GitHub 开源社区
          </div>
          <h1 className="text-[clamp(34px,5vw,64px)] font-medium leading-[1.04] tracking-[-0.04em] text-slate-950">发现无尽创意</h1>
          <p className="mx-auto mt-4 max-w-[620px] text-base leading-7 text-slate-600">
            搜索提示词、风格或元素，复制灵感，或者一键带到生图工作台继续创作。
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-5 text-center sm:gap-8">
            <div>
              <div className="text-3xl font-semibold text-slate-950">{promptLibraryTotalCount}</div>
              <div className="text-xs text-slate-400">提示词总数</div>
            </div>
            <div className="hidden h-11 w-px bg-slate-200 sm:block" />
            <div>
              <div className="text-3xl font-semibold text-slate-950">{promptSourceCount}</div>
              <div className="text-xs text-slate-400">当前结果</div>
            </div>
            <div className="hidden h-11 w-px bg-slate-200 sm:block" />
            <div>
              <div className="text-3xl font-semibold text-slate-950">{promptLibraryTags.length - 1}</div>
              <div className="text-xs text-slate-400">{promptDataSourceLabel}</div>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-8 flex max-w-[820px] items-center gap-3 rounded-[24px] border border-white/80 bg-white/78 px-4 py-3 shadow-[0_18px_65px_-52px_rgba(15,23,42,0.72)] backdrop-blur-xl">
          <Search className="size-5 shrink-0 text-slate-400" />
          <input
            type="search"
            data-cola-control="prompt-search"
            value={query}
            onChange={(event) => handlePromptSearchChange(event.target.value)}
            placeholder="搜索提示词、风格或元素..."
            className="min-w-0 flex-1 bg-transparent py-2 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
            aria-label="搜索提示词、风格、作者或元素"
          />
          <button
            type="button"
            data-cola-action="clear-prompt-filters"
            className={cn(
              "shrink-0 rounded-full px-3 py-2 text-xs font-medium transition",
              hasActiveFilters ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-slate-50 text-slate-300",
            )}
            onClick={clearPromptFilters}
            disabled={!hasActiveFilters}
          >
            清除
          </button>
        </div>

        <div className="hide-scrollbar mt-5 flex gap-2 overflow-x-auto pb-2">
          {promptLibraryTags.map((item) => {
            const selected = item.tag === activeTag;
            return (
            <button
              key={item.tag}
              type="button"
              data-cola-tag={item.tag}
              aria-pressed={selected}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                selected
                  ? "border-slate-950 bg-slate-950 text-white shadow-[0_14px_32px_-24px_rgba(15,23,42,0.88)]"
                  : "border-black/5 bg-white/72 text-slate-600 hover:border-slate-200 hover:bg-white",
              )}
              onClick={() => handlePromptTagChange(item.tag)}
            >
              #{item.label}
              <span className={cn("ml-1", selected ? "text-white/60" : "text-slate-400")}>{item.count}</span>
            </button>
            );
          })}
        </div>

        <div data-cola-panel="prompt-result-summary" className="mt-3 flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            正在浏览 {activeTagLabel}，显示 {visiblePromptCards.length} / {filteredPromptCards.length} 条灵感
          </span>
          <span className="text-xs text-slate-400">
            {getPromptLibraryStatusText(promptLoadState, normalizedQuery, query)}
          </span>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visiblePromptCards.map((card, index) => (
            <article
              key={card.id}
              data-cola-card="prompt-template"
              data-cola-prompt-id={card.id}
              className={cn(colaCardClass, "group flex min-h-[430px] flex-col p-3")}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <PromptCardArtwork card={card} />
              <div className="flex flex-1 flex-col pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-semibold leading-5 text-slate-950">{card.title}</div>
                    <div className="mt-1 text-[11px] font-medium text-slate-400">{card.author}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">{card.tags[0]}</span>
                </div>
                <p className="mt-3 line-clamp-2 text-xs font-medium leading-5 text-slate-500">{card.useCase}</p>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">{card.prompt}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {card.model ? (
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700">{card.model}</span>
                  ) : null}
                  {card.count ? (
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-black/5">{card.count} 张</span>
                  ) : null}
                  {card.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500">{tag}</span>
                  ))}
                </div>
                <div className="mt-auto flex items-center gap-2 pt-4">
                  <button
                    type="button"
                    data-cola-action="copy-library-prompt"
                    className={colaButtonClass("secondary", "flex-1 px-3 py-2 text-xs font-medium")}
                    onClick={() => onCopyPrompt(card.prompt)}
                  >
                    复制提示词
                  </button>
                  <button
                    type="button"
                    data-cola-action="use-library-prompt"
                    className={colaButtonClass("primary", "flex-1 px-3 py-2 text-xs")}
                    onClick={() => onUsePrompt(card.prompt)}
                  >
                    去生成
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div
          data-cola-panel="prompt-empty-state"
          aria-hidden={filteredPromptCards.length > 0}
          className={cn(
            "mt-8 place-items-center rounded-[24px] border border-dashed border-slate-200 bg-white/66 p-10 text-center shadow-[0_18px_60px_-52px_rgba(15,23,42,0.6)]",
            filteredPromptCards.length === 0 ? "grid" : "hidden",
          )}
        >
          <div className="grid size-12 place-items-center rounded-2xl bg-slate-950 text-white">
            <Search className="size-5" />
          </div>
          <h2 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-slate-950">无匹配灵感</h2>
          <p className="mt-2 max-w-[420px] text-sm leading-6 text-slate-500">换一个关键词，或者清除筛选后继续浏览全部精选提示词。</p>
          <button
            type="button"
            data-cola-action="clear-prompt-filters"
            className={colaButtonClass("primary", "mt-5")}
            onClick={clearPromptFilters}
          >
            清除筛选
          </button>
        </div>

        {hasMorePrompts ? (
        <div className="mt-8 text-center">
          <button
            type="button"
            data-cola-action="load-more-prompts"
            className={colaButtonClass("secondary")}
            onClick={() => setVisiblePage((page) => page + 1)}
          >
            加载更多灵感
          </button>
        </div>
        ) : null}
      </section>
    </main>
  );
}

export function AssetsWorkspace({
  images,
  creations,
  onOpenCreation,
  onCopyImage,
  onDownloadImage,
}: {
  images: ManagedImage[];
  creations: CreationItem[];
  onOpenCreation: (item: CreationItem) => void;
  onCopyImage: (image: ManagedImage) => void;
  onDownloadImage: (image: ManagedImage) => void;
}) {
  return (
    <main data-cola-panel="assets-workspace" data-cola-design="clear-studio-assets" className="relative z-10 mx-auto min-h-dvh w-full max-w-[1400px] px-4 pb-28 pt-16 md:pl-[104px] md:pr-8 md:pt-[92px]">
      <section className="mx-auto max-w-[1180px]">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">资产</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-5xl">图片库</h1>
            <p className="mt-3 text-sm text-slate-500">最近生成结果和可复用素材</p>
          </div>
          <div className="rounded-[18px] bg-white/70 px-4 py-3 text-sm text-slate-500 ring-1 ring-black/5">任务队列：空闲</div>
        </div>

        <div className="sticky top-0 z-20 mb-6 inline-flex rounded-[10px] bg-slate-100 p-1 text-sm">
          {["All", "Images", "Videos", "Favorites"].map((tab, index) => (
            <button
              key={tab}
              type="button"
              className={cn(
                "min-w-16 rounded-lg px-3 py-1.5 font-medium transition",
                index === 0 ? "bg-white text-slate-950 shadow-sm" : "text-slate-500",
              )}
            >
              {tab === "Favorites" ? <Heart className="mr-1 inline size-3.5" /> : null}
              {tab}
            </button>
          ))}
        </div>
        <p className="sr-only">Videos coming soon</p>

        {images.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {images.map((image) => (
              <article key={image.rel || image.url} className="overflow-hidden rounded-[18px] bg-white/80 ring-1 ring-black/5">
                <div className="aspect-square overflow-hidden bg-slate-100">
                  <AuthenticatedImage
                    src={getPreferredPreviewUrl(image, "preferOriginal")}
                    fallbackSrc={getPreviewFallbackUrl(image, "preferOriginal")}
                    alt={image.name}
                    className="h-full w-full object-cover"
                    loadingMotion="static"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 p-2">
                  <span className="min-w-0 truncate text-xs font-medium text-slate-600">{image.name}</span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" className="grid size-7 place-items-center rounded-full hover:bg-white" onClick={() => onCopyImage(image)} aria-label="复制图片地址">
                      <Copy className="size-3.5" />
                    </button>
                    <button type="button" className="grid size-7 place-items-center rounded-full hover:bg-white" onClick={() => onDownloadImage(image)} aria-label="下载图片">
                      <Download className="size-3.5" />
                    </button>
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {creations.slice(0, 8).map((item, index) => (
              <button key={item.id} type="button" className="overflow-hidden rounded-[18px] bg-white/78 text-left ring-1 ring-black/5" onClick={() => onOpenCreation(item)}>
                <div className={cn("aspect-square", index % 2 ? "bg-gradient-to-br from-sky-100 via-violet-100 to-rose-100" : "bg-gradient-to-br from-emerald-100 via-sky-100 to-amber-100")} />
                <div className="p-3">
                  <div className="truncate text-sm font-semibold text-slate-800">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.subtitle}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function DeveloperConsole() {
  return (
    <main data-cola-panel="developer-console" data-cola-design="clear-studio-utility" className="relative z-10 mx-auto min-h-dvh w-full max-w-[1400px] px-4 pb-28 pt-16 md:pl-[104px] md:pr-8 md:pt-[92px]">
      <section className="mx-auto max-w-[1180px]">
        <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">API</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-5xl">开发者控制台</h1>
            <p className="mt-3 max-w-[560px] text-sm leading-6 text-slate-500">把 ColaAI 的图片生成能力接入你的应用，查看接口调用、任务队列和密钥状态。</p>
          </div>
          <button type="button" className={colaButtonClass("primary", "w-fit")}>创建密钥</button>
        </div>

        <div className="mb-6 flex gap-0 border-b border-slate-200">
          {["概览", "API 密钥", "调用记录", "接口文档"].map((tab, index) => (
            <button
              key={tab}
              type="button"
              className={cn(
                "px-5 py-3 text-sm font-medium",
                index === 0 ? "border-b-2 border-slate-950 text-slate-950" : "text-slate-500",
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[24px] border border-white/80 bg-white/72 p-5 shadow-[0_18px_60px_-48px_rgba(15,23,42,0.72)]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">接口调用</h2>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">在线</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["今日请求", "0"],
                ["平均耗时", "1.8s"],
                ["队列任务", "0"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[18px] bg-slate-50 px-4 py-4">
                  <div className="text-xs text-slate-400">{label}</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
                </div>
              ))}
            </div>
            <pre className="mt-5 overflow-x-auto rounded-[18px] bg-slate-950 p-4 text-xs leading-6 text-slate-200">
{`POST /v1/images/generations
Authorization: Bearer cola_sk_...

{
  "model": "gpt-image-2",
  "prompt": "A refined product poster",
  "size": "1024x1536"
}`}
            </pre>
            <div className="mt-5 space-y-4 text-sm leading-6 text-slate-600">
              <section>
                <h3 className="font-semibold text-slate-950">Base URL</h3>
                <code className="mt-2 block rounded-[12px] bg-slate-100 px-3 py-2 text-xs text-slate-700">https://api.colaai.local/v1</code>
              </section>
              <section>
                <h3 className="font-semibold text-slate-950">POST /v1/images/edits</h3>
                <p className="mt-1">提交图像编辑任务，使用参考图、编辑指令和模型参数。</p>
              </section>
              <section>
                <h3 className="font-semibold text-slate-950">GET /v1/images/tasks</h3>
                <p className="mt-1">查询图片生成任务状态、结果地址和错误信息。</p>
              </section>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/80 bg-white/72 p-5 shadow-[0_18px_60px_-48px_rgba(15,23,42,0.72)]">
              <h2 className="text-lg font-semibold text-slate-950">密钥状态</h2>
              <div className="mt-4 space-y-3">
                {["生产环境", "测试环境", "Webhook"].map((item, index) => (
                  <div key={item} className="flex items-center justify-between rounded-[16px] bg-slate-50 px-4 py-3 text-sm">
                    <span className="font-medium text-slate-700">{item}</span>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs", index === 2 ? "bg-slate-200 text-slate-500" : "bg-emerald-100 text-emerald-700")}>
                      {index === 2 ? "未配置" : "可用"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[24px] border border-white/80 bg-white/72 p-5 text-sm leading-6 text-slate-500">
              任务队列会在这里同步展示生成状态，适合开发调试和批量接入时快速确认结果。
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthRequiredPanel({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <main data-cola-panel="auth-required" data-cola-design="clear-studio-utility" className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1400px] place-items-center px-4 pb-28 pt-16 md:pl-[104px] md:pr-8 md:pt-[92px]">
      <section className={colaSurfaceClass("raised", "w-full max-w-[520px] p-6 text-center")}>
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-950 text-white">
          <Library className="size-5" />
        </div>
        <p className="mt-5 text-sm font-medium text-slate-500">需要登录</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">{title}</h1>
        <p className="mx-auto mt-3 max-w-[360px] text-sm leading-6 text-slate-500">{message}</p>
        <Link href="/ColaAI/login" className={colaButtonClass("primary", "mt-6")}>
          去登录
        </Link>
      </section>
    </main>
  );
}

function AnnouncementCenter() {
  const notices = [
    {
      title: "GPT-IMAGE-2 创作体验优化",
      body: "输入框、生成参数和作品瀑布流已调整为更接近 Rova 的发现体验。",
      time: "今天",
    },
    {
      title: "提示词库上线",
      body: "新增精选提示词、复制提示词和去生成操作，支持从灵感直接进入生图。",
      time: "本周",
    },
    {
      title: "资产工作区更新",
      body: "图片库、下载、复制地址和本地 fallback 预览整合到资产页面。",
      time: "最近",
    },
  ];

  return (
    <main data-cola-panel="announcement-center" data-cola-design="clear-studio-utility" className="relative z-10 mx-auto min-h-dvh w-full max-w-[1400px] px-4 pb-28 pt-16 md:pl-[104px] md:pr-8 md:pt-[92px]">
      <section className="mx-auto max-w-[980px]">
        <div className="text-center">
          <p className="text-sm font-medium text-slate-500">公告</p>
          <h1 className="mt-1 text-4xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-5xl">更新动态</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-sm leading-6 text-slate-500">关注 ColaAI 的界面、模型和工作流改进。</p>
        </div>
        <div className="mt-8 space-y-3">
          {notices.map((notice) => (
            <article key={notice.title} className={colaCardClass}>
              <div className="p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-slate-950">{notice.title}</h2>
                <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{notice.time}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-500">{notice.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function SettingsWorkspace() {
  return (
    <main
      data-cola-panel="settings-workspace"
      data-cola-design="clear-studio-utility"
      className="relative z-10 mx-auto min-h-dvh w-full max-w-[1400px] px-4 pb-28 pt-16 md:pl-[104px] md:pr-8 md:pt-[92px]"
    >
      <section className="mx-auto max-w-[980px]">
        <p className="text-sm font-medium text-slate-500">设置</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-5xl">账号设置和偏好</h1>
        <div className="mt-10 grid min-h-[300px] place-items-center rounded-[28px] border-2 border-dashed border-slate-200 bg-white/70 p-8 text-center">
          <div>
            <Settings className="mx-auto size-12 text-slate-300" />
            <p className="mt-4 text-sm text-slate-400">即将上线</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function MobileMoreSheet({
  open,
  isPublicPreview,
  session,
  onClose,
  onLogin,
  onLogout,
  onCheckIn,
  onOpenAnnouncement,
  onToggleLanguage,
  onNavigate,
}: {
  open: boolean;
  isPublicPreview: boolean;
  session: ColaAuthSession;
  onClose: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onCheckIn: () => void;
  onOpenAnnouncement: () => void;
  onToggleLanguage: () => void;
  onNavigate: (mode: WorkbenchMode) => void;
}) {
  const actions = [
    { label: "公告", icon: Bell, onClick: onOpenAnnouncement },
    { label: "Switch to EN", icon: Languages, onClick: onToggleLanguage },
    { label: "签到", icon: Gift, onClick: onCheckIn, authOnly: true },
    { label: "提示词", icon: WandSparkles, onClick: () => onNavigate("prompts") },
    { label: "图片库", icon: Library, onClick: () => onNavigate("assets"), authOnly: true },
    { label: "设置", icon: Settings, onClick: () => onNavigate("settings") },
  ].filter((item) => !item.authOnly || !isPublicPreview);

  return (
    <div
      data-cola-panel="mobile-more-sheet"
      data-cola-design="clear-studio-utility"
      className={cn(
        "fixed inset-0 z-50 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button type="button" aria-label="关闭更多菜单" className={cn("absolute inset-0 bg-black/30 transition", open ? "opacity-100" : "opacity-0")} onClick={onClose} />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 rounded-t-[22px] border border-slate-200/80 bg-white/96 p-5 shadow-[0_-20px_60px_-34px_rgba(15,23,42,0.9)] ring-1 ring-white/80 backdrop-blur-xl transition duration-300",
          open ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
        )}
      >
        <span className="mx-auto mb-4 block h-1 w-9 rounded-full bg-slate-200" />
        {isPublicPreview ? (
          <button type="button" className={colaButtonClass("primary", "mb-4 w-full rounded-[14px] py-3")} onClick={onLogin}>
            登录 / 注册
          </button>
        ) : (
          <div className="mb-4 flex items-center gap-3 px-1">
            <span className="sr-only">登录 / 注册</span>
            <span className="grid size-10 place-items-center rounded-full bg-slate-100 text-slate-500">
              <UserPlus className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">{session.name || "ColaAI"}</p>
            </div>
          </div>
        )}
        <div className="space-y-1">
          {actions.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                aria-label={item.label}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={item.onClick}
              >
                <Icon className="size-4 text-slate-500" />
                {item.label}
              </button>
            );
          })}
          {!isPublicPreview ? (
            <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-rose-500 hover:bg-rose-50" onClick={onLogout}>
              <LogOut className="size-4" />
              退出登录
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DialogShell({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/42 px-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-[520px] overflow-hidden rounded-[24px] bg-white shadow-[0_32px_90px_-42px_rgba(15,23,42,0.62)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <button type="button" aria-label="关闭" className="grid size-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-950" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function LightweightDialog({
  open,
  onClose,
}: {
  open: WorkbenchDialog;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  if (open === "announcement") {
    return (
      <DialogShell title="公告" onClose={onClose}>
        <div className="space-y-3 p-5">
          {["GPT-IMAGE-2 创作体验优化", "提示词库上线", "资产工作区更新"].map((item, index) => (
            <article key={item} className="rounded-[16px] bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-950">{item}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">{index === 0 ? "输入框、参数栏、瀑布流和吸顶切换已按 Rova 结构整理。" : "更多功能正在逐步接入 ColaAI 工作流。"}</p>
            </article>
          ))}
        </div>
      </DialogShell>
    );
  }

  return null;
}

function CheckInDialog({
  result,
  onClose,
}: {
  result: CheckInDialogResult | null;
  onClose: () => void;
}) {
  if (!result) {
    return null;
  }

  const isSuccess = result.status === "success";
  return (
    <DialogShell title="签到" onClose={onClose}>
      <div data-cola-panel="check-in-dialog" data-cola-state={result.status} className="space-y-4 p-5">
        <div className={cn("rounded-[18px] px-4 py-3", isSuccess ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600")}>
          <p className="text-sm font-semibold">{result.message}</p>
          {isSuccess && typeof result.remainingCredits === "number" ? (
            <p className="mt-1 text-xs leading-5 text-emerald-700/78">当前剩余 {result.remainingCredits} 积分。</p>
          ) : null}
        </div>
        <button
          type="button"
          className={colaButtonClass("primary", "h-11 w-full px-5 text-sm")}
          onClick={onClose}
        >
          知道了
        </button>
      </div>
    </DialogShell>
  );
}

const landingHeroIdleMotion: LandingHeroScrollMotion = {
  progress: 0,
  coreProgress: 0,
  orbitProgress: 0,
  titleProgress: 0,
  timelineProgress: 0,
  exitProgress: 0,
  stageState: "idle",
};

const landingOrbitCardNames = ["one", "two", "three", "four"] as const;
const landingOrbitSlotGap = 10;
const landingOrbitBaseOffset = 140;
const landingOrbitExtraY = [0, 55, 0, 55] as const;

type LandingOrbitCardName = (typeof landingOrbitCardNames)[number];
const landingOrbitGeometryProperties: Record<
  LandingOrbitCardName,
  {
    left: string;
    top: string;
    width: string;
    height: string;
    targetLeft: string;
    targetWidth: string;
    translateX: string;
    translateY: string;
    scaleX: string;
    scaleY: string;
    exitX: string;
    exitY: string;
  }
> = {
  one: {
    left: "--landing-orbit-one-left",
    top: "--landing-orbit-one-top",
    width: "--landing-orbit-one-width",
    height: "--landing-orbit-one-height",
    targetLeft: "--landing-orbit-one-target-left",
    targetWidth: "--landing-orbit-one-target-width",
    translateX: "--landing-orbit-one-translate-x",
    translateY: "--landing-orbit-one-translate-y",
    scaleX: "--landing-orbit-one-scale-x",
    scaleY: "--landing-orbit-one-scale-y",
    exitX: "--landing-orbit-one-exit-x",
    exitY: "--landing-orbit-one-exit-y",
  },
  two: {
    left: "--landing-orbit-two-left",
    top: "--landing-orbit-two-top",
    width: "--landing-orbit-two-width",
    height: "--landing-orbit-two-height",
    targetLeft: "--landing-orbit-two-target-left",
    targetWidth: "--landing-orbit-two-target-width",
    translateX: "--landing-orbit-two-translate-x",
    translateY: "--landing-orbit-two-translate-y",
    scaleX: "--landing-orbit-two-scale-x",
    scaleY: "--landing-orbit-two-scale-y",
    exitX: "--landing-orbit-two-exit-x",
    exitY: "--landing-orbit-two-exit-y",
  },
  three: {
    left: "--landing-orbit-three-left",
    top: "--landing-orbit-three-top",
    width: "--landing-orbit-three-width",
    height: "--landing-orbit-three-height",
    targetLeft: "--landing-orbit-three-target-left",
    targetWidth: "--landing-orbit-three-target-width",
    translateX: "--landing-orbit-three-translate-x",
    translateY: "--landing-orbit-three-translate-y",
    scaleX: "--landing-orbit-three-scale-x",
    scaleY: "--landing-orbit-three-scale-y",
    exitX: "--landing-orbit-three-exit-x",
    exitY: "--landing-orbit-three-exit-y",
  },
  four: {
    left: "--landing-orbit-four-left",
    top: "--landing-orbit-four-top",
    width: "--landing-orbit-four-width",
    height: "--landing-orbit-four-height",
    targetLeft: "--landing-orbit-four-target-left",
    targetWidth: "--landing-orbit-four-target-width",
    translateX: "--landing-orbit-four-translate-x",
    translateY: "--landing-orbit-four-translate-y",
    scaleX: "--landing-orbit-four-scale-x",
    scaleY: "--landing-orbit-four-scale-y",
    exitX: "--landing-orbit-four-exit-x",
    exitY: "--landing-orbit-four-exit-y",
  },
};
type LandingOrbitBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type LandingHeroOrbitLayout = {
  lineWidth: number;
  exitDistance: number;
  cards: Record<LandingOrbitCardName, {
    start: LandingOrbitBox;
    target: LandingOrbitBox;
  }>;
};

function clampMotionProgress(value: number) {
  return Math.min(1, Math.max(0, value));
}

function mixLandingOrbitValue(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function px(value: number) {
  return `${value.toFixed(2)}px`;
}

function setLandingHeroStyleProperty(hero: HTMLElement, name: string, value: string | number) {
  const nextValue = String(value);
  if (hero.style.getPropertyValue(name) !== nextValue) {
    hero.style.setProperty(name, nextValue);
  }
}

function getLandingOrbitStartBox({
  index,
  stageWidth,
  stageHeight,
  viewportWidth,
  rootFontSize,
}: {
  index: number;
  stageWidth: number;
  stageHeight: number;
  viewportWidth: number;
  rootFontSize: number;
}): LandingOrbitBox {
  const isMobile = viewportWidth <= 640;
  const width = isMobile ? rootFontSize * 9 : Math.min(viewportWidth * 0.19, 230);
  const height = isMobile ? rootFontSize * 15 : 188;
  const topPercents = isMobile ? [0.4, 0.36, 0.11, 0.08] : [0.35, 0.32, 0.11, 0.08];
  const sidePercents = isMobile ? [0.05, 0.05, 0.08, 0.04] : [0.05, 0.05, 0.08, 0.04];

  if (index === 0) {
    return { left: stageWidth * sidePercents[0], top: stageHeight * topPercents[0], width, height };
  }
  if (index === 1) {
    return { left: stageWidth - stageWidth * sidePercents[1] - width, top: stageHeight * topPercents[1], width, height };
  }
  if (index === 2) {
    return { left: stageWidth * sidePercents[2], top: stageHeight - stageHeight * topPercents[2] - height, width, height };
  }
  return { left: stageWidth - stageWidth * sidePercents[3] - width, top: stageHeight - stageHeight * topPercents[3] - height, width, height };
}

function getLandingOrbitTargetBoxes({
  stageWidth,
  lineLeft,
  lineTop,
  lineWidth,
  rootFontSize,
  isMobile,
}: {
  stageWidth: number;
  lineLeft: number;
  lineTop: number;
  lineWidth: number;
  rootFontSize: number;
  isMobile: boolean;
}): LandingOrbitBox[] {
  if (isMobile) {
    const widthPercents = [0.58, 0.52, 0.48, 0.42];
    let cursorLeft = lineLeft;
    return widthPercents.map((widthPercent, index) => {
      const width = stageWidth * widthPercent;
      const box = {
        left: cursorLeft,
        top: lineTop - (landingOrbitBaseOffset + landingOrbitExtraY[index]),
        width,
        height: rootFontSize * 15,
      };
      cursorLeft += width + 4;
      return box;
    });
  }

  const usableWidth = Math.max(lineWidth - landingOrbitSlotGap * (landingOrbitCardNames.length - 1), 1);
  const slotWidth = usableWidth / landingOrbitCardNames.length;

  return landingOrbitCardNames.map((_, index) => ({
    left: lineLeft + index * (slotWidth + landingOrbitSlotGap),
    top: lineTop - (landingOrbitBaseOffset + landingOrbitExtraY[index]),
    width: slotWidth,
    height: 96,
  }));
}

function writeLandingHeroOrbitLayout(hero: HTMLElement): LandingHeroOrbitLayout | null {
  const stage = hero.querySelector<HTMLElement>(".orbit_stage");
  const timelineLine = hero.querySelector<HTMLElement>(".timeline_line");
  if (!stage || !timelineLine) {
    return null;
  }

  const stageWidth = stage.offsetWidth;
  const stageHeight = stage.offsetHeight;
  const lineLeft = timelineLine.offsetLeft;
  const lineTop = timelineLine.offsetTop;
  const lineWidth = timelineLine.offsetWidth;
  if (stageWidth <= 0 || stageHeight <= 0 || lineWidth <= 0) {
    return null;
  }

  const view = hero.ownerDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? stageWidth;
  const rootFontSize = Number.parseFloat(view?.getComputedStyle(hero.ownerDocument.documentElement).fontSize || "16") || 16;
  const isMobile = viewportWidth <= 640;
  const targetBoxes = getLandingOrbitTargetBoxes({ stageWidth, lineLeft, lineTop, lineWidth, rootFontSize, isMobile });
  const exitDistance = stageWidth * 0.8;
  const cards = {} as LandingHeroOrbitLayout["cards"];

  setLandingHeroStyleProperty(hero, "--landing-timeline-width", px(lineWidth));

  landingOrbitCardNames.forEach((name: LandingOrbitCardName, index) => {
    const start = getLandingOrbitStartBox({ index, stageWidth, stageHeight, viewportWidth, rootFontSize });
    const target = targetBoxes[index];
    const properties = landingOrbitGeometryProperties[name];

    cards[name] = { start, target };
    setLandingHeroStyleProperty(hero, properties.left, px(start.left));
    setLandingHeroStyleProperty(hero, properties.top, px(start.top));
    setLandingHeroStyleProperty(hero, properties.width, px(start.width));
    setLandingHeroStyleProperty(hero, properties.height, px(start.height));
    setLandingHeroStyleProperty(hero, properties.targetLeft, px(target.left));
    setLandingHeroStyleProperty(hero, properties.targetWidth, px(target.width));
  });

  return { lineWidth, exitDistance, cards };
}

function writeLandingHeroOrbitMotion(
  hero: HTMLElement,
  layout: LandingHeroOrbitLayout | null,
  orbitProgress: number,
  exitProgress: number,
) {
  if (!layout) {
    return;
  }

  const orbit = clampMotionProgress(orbitProgress);
  const exit = clampMotionProgress(exitProgress);

  landingOrbitCardNames.forEach((name: LandingOrbitCardName, index) => {
    const card = layout.cards[name];
    const properties = landingOrbitGeometryProperties[name];
    const current = {
      left: mixLandingOrbitValue(card.start.left, card.target.left, orbit),
      top: mixLandingOrbitValue(card.start.top, card.target.top, orbit),
      width: mixLandingOrbitValue(card.start.width, card.target.width, orbit),
      height: mixLandingOrbitValue(card.start.height, card.target.height, orbit),
    };
    const exitDirection = index < 2 ? -1 : 1;
    const scaleX = card.start.width > 0 ? current.width / card.start.width : 1;
    const scaleY = card.start.height > 0 ? current.height / card.start.height : 1;

    setLandingHeroStyleProperty(hero, properties.translateX, px(current.left - card.start.left));
    setLandingHeroStyleProperty(hero, properties.translateY, px(current.top - card.start.top));
    setLandingHeroStyleProperty(hero, properties.scaleX, scaleX.toFixed(4));
    setLandingHeroStyleProperty(hero, properties.scaleY, scaleY.toFixed(4));
    setLandingHeroStyleProperty(hero, properties.exitX, px(exitDirection * layout.exitDistance * exit));
    setLandingHeroStyleProperty(hero, properties.exitY, px(40 * exit));
  });
}

function writeLandingHeroMotionStyle(
  hero: HTMLElement,
  motion: LandingHeroScrollMotion,
  layout: LandingHeroOrbitLayout | null = null,
) {
  const orbit = motion.orbitProgress;
  const timeline = motion.timelineProgress;
  const exit = motion.exitProgress;

  setLandingHeroStyleProperty(hero, "--landing-progress", motion.progress.toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-core-progress", motion.coreProgress.toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-orbit-progress", orbit.toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-title-progress", motion.titleProgress.toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-timeline-progress", timeline.toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-exit-progress", exit.toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-copy-opacity", Math.max(0, 1 - exit * 1.08).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-copy-y", `${(-16 * motion.titleProgress - 28 * exit).toFixed(2)}px`);
  setLandingHeroStyleProperty(hero, "--landing-copy-scale", (1 - exit * 0.2).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-primary-title-opacity", (1 - motion.titleProgress).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-primary-title-rotate", `${(-75 * motion.titleProgress).toFixed(2)}deg`);
  setLandingHeroStyleProperty(hero, "--landing-primary-title-y", `${(-42 * motion.titleProgress - 16 * exit).toFixed(2)}px`);
  setLandingHeroStyleProperty(hero, "--landing-primary-title-z", `${(-90 * motion.titleProgress).toFixed(2)}px`);
  setLandingHeroStyleProperty(hero, "--landing-secondary-title-opacity", motion.titleProgress.toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-secondary-title-rotate", `${(75 * (1 - motion.titleProgress)).toFixed(2)}deg`);
  setLandingHeroStyleProperty(hero, "--landing-secondary-title-y", `${(42 * (1 - motion.titleProgress) - 16 * exit).toFixed(2)}px`);
  setLandingHeroStyleProperty(hero, "--landing-secondary-title-z", `${(90 * (1 - motion.titleProgress)).toFixed(2)}px`);
  setLandingHeroStyleProperty(hero, "--landing-core-y", `${(-34 * motion.coreProgress - 22 * exit).toFixed(2)}px`);
  setLandingHeroStyleProperty(hero, "--landing-core-scale", (1 + motion.coreProgress * 0.25 - exit * 0.9).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-core-opacity", Math.max(0, 1 - exit * 1.18).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-timeline-opacity", Math.max(0, 0.1 + timeline * 0.95 - exit * 0.95).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-line-opacity", Math.max(0, timeline - exit * 0.95).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-cursor-x", px((layout?.lineWidth ?? 0) * timeline));
  setLandingHeroStyleProperty(hero, "--landing-cursor-scale", (timeline * (1 - exit)).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-cursor-opacity", Math.max(0, timeline - exit).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-mark-opacity", (0.18 + timeline * 0.82).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-orbit-one-rotate", `${(-10 + orbit * 10 - exit * 4).toFixed(2)}deg`);
  setLandingHeroStyleProperty(hero, "--landing-orbit-one-scale", (1 - orbit * 0.08 - exit * 0.16).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-orbit-two-rotate", `${(8 - orbit * 8 + exit * 4).toFixed(2)}deg`);
  setLandingHeroStyleProperty(hero, "--landing-orbit-two-scale", (1 - orbit * 0.08 - exit * 0.16).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-orbit-three-rotate", `${(7 - orbit * 7 - exit * 3).toFixed(2)}deg`);
  setLandingHeroStyleProperty(hero, "--landing-orbit-three-scale", (1 - orbit * 0.08 - exit * 0.16).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-orbit-four-rotate", `${(-8 + orbit * 8 + exit * 3).toFixed(2)}deg`);
  setLandingHeroStyleProperty(hero, "--landing-orbit-four-scale", (1 - orbit * 0.08 - exit * 0.16).toFixed(4));
  setLandingHeroStyleProperty(hero, "--landing-orbit-card-opacity", Math.max(0, 1 - exit * 1.15).toFixed(4));
  writeLandingHeroOrbitMotion(hero, layout, orbit, exit);
}

function writeLandingHeroPinState(hero: HTMLElement, viewportHeight: number) {
  const rect = hero.getBoundingClientRect();
  const heroHeight = Math.max(hero.offsetHeight, viewportHeight);
  const pinEnd = Math.max(heroHeight - viewportHeight, 0);
  const heroScrollY = Math.min(Math.max(-rect.top, 0), pinEnd);
  const pinState = rect.top > 0 ? "before" : heroScrollY >= pinEnd ? "after" : "pinned";

  if (hero.getAttribute("data-cola-pin-state") !== pinState) {
    hero.setAttribute("data-cola-pin-state", pinState);
  }
  setLandingHeroStyleProperty(hero, "--landing-pin-left", `${rect.left.toFixed(2)}px`);
  setLandingHeroStyleProperty(hero, "--landing-pin-width", `${rect.width.toFixed(2)}px`);
  setLandingHeroStyleProperty(hero, "--landing-pin-height", `${viewportHeight.toFixed(2)}px`);

  return { heroHeight, heroScrollY };
}

function CreationPreviewDialog({
  item,
  onClose,
  onUsePrompt,
  onCopyPrompt,
}: {
  item: CreationItem | null;
  onClose: () => void;
  onUsePrompt: (prompt: string) => void;
  onCopyPrompt: (prompt: string) => void;
}) {
  if (!item) {
    return null;
  }

  return (
    <div data-cola-panel="creation-preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-5 text-white" onClick={onClose}>
      <div className="grid w-full max-w-[1000px] gap-5 md:grid-cols-[1fr_300px]" onClick={(event) => event.stopPropagation()}>
        <div className="overflow-hidden rounded-[14px] bg-white/8">
          {item.imageUrl ? (
            <AuthenticatedImage
              src={item.imageUrl}
              fallbackSrc={item.imageFallbackUrl}
              alt={item.title}
              className="max-h-[82dvh] w-full object-contain"
              loadingMotion="static"
            />
          ) : (
            <div className="aspect-[4/5] bg-gradient-to-br from-sky-200 via-violet-200 to-rose-200" />
          )}
        </div>
        <aside className="self-end rounded-[14px] border border-white/10 bg-white/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{item.title}</h2>
              <p className="mt-1 text-xs text-white/40">GPT-IMAGE-2</p>
            </div>
            <button type="button" className="rounded-full bg-white/10 px-2.5 py-1 text-sm" onClick={onClose}>×</button>
          </div>
          <div className="mt-4 max-h-52 overflow-y-auto rounded-[14px] bg-white/5 p-3 text-sm leading-6 text-white/72">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35">Prompt</div>
            {item.prompt}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" className="flex-1 rounded-[10px] bg-white/10 px-3 py-2 text-sm" onClick={() => onCopyPrompt(item.prompt)}>
              Copy
            </button>
            <button type="button" className="flex-1 rounded-[10px] bg-violet-500 px-3 py-2 text-sm font-semibold" onClick={() => onUsePrompt(item.prompt)}>
              做同款
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function ColaAIWorkbench({ session, initialMode = "discover" }: ColaAIWorkbenchProps) {
  const [sessionOverride, setSessionOverride] = useState<ColaAuthSession | null>(null);
  const [mode, setMode] = useState<WorkbenchMode>(initialMode);
  const [canvasSubview, setCanvasSubview] = useState<CanvasSubview>("home");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
  const [quality, setQuality] = useState("智能");
  const [ratio, setRatio] = useState<string>("9:16");
  const [resolution, setResolution] = useState<ImageResolution>("1k");
  const [imageModel, setImageModel] = useState<GenerateImageModel>("auto");
  const [publicMode, setPublicMode] = useState(false);
  const [promptMarketOpen, setPromptMarketOpen] = useState(false);
  const [dialog, setDialog] = useState<WorkbenchDialog>(null);
  const [checkInResult, setCheckInResult] = useState<CheckInDialogResult | null>(null);
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [images, setImages] = useState<ManagedImage[]>([]);
  const [publicDiscoverImages, setPublicDiscoverImages] = useState<CreationItem[]>([]);
  const [creationFeedStatus, setCreationFeedStatus] = useState<CreationFeedStatus>("idle");
  const [submittedTasks, setSubmittedTasks] = useState<GenerateTask[]>([]);
  const [generateSessions, setGenerateSessions] = useState<GenerateSession[]>(() => [initialGenerateSession]);
  const [generateConversations, setGenerateConversations] = useState<ImageConversation[]>([]);
  const [activeGenerateSessionId, setActiveGenerateSessionId] = useState(initialGenerateSession.id);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [focusedGenerateTaskId, setFocusedGenerateTaskId] = useState("");
  const [focusedCanvasTask, setFocusedCanvasTask] = useState<GenerateTaskDiagnosticsSnapshot | null>(null);
  const [activeCanvasId, setActiveCanvasIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    try {
      return getActiveCanvasId(window.localStorage);
    } catch {
      return null;
    }
  });
  const [selectedCreation, setSelectedCreation] = useState<CreationItem | null>(null);
  const [selectedCanvasIds, setSelectedCanvasIds] = useState<string[]>([]);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [landingHeroState, setLandingHeroState] = useState<LandingHeroStageState>("idle");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
  const [canvasLibraryRevision, setCanvasLibraryRevision] = useState(0);
  const landingHeroRef = useRef<HTMLElement | null>(null);
  const landingSnapLockRef = useRef(false);
  const landingHeroStateRef = useRef<LandingHeroStageState>("idle");
  const landingHeroGeometryRef = useRef<LandingHeroOrbitLayout | null>(null);
  const lastDiscoverScrollYRef = useRef(0);
  const referenceDragDepthRef = useRef(0);
  const referencePreviewUrlRef = useRef<string[]>([]);
  const generateConversationsRef = useRef<ImageConversation[]>([]);

  const currentSession = sessionOverride ?? session;
  const isPublicPreview = !currentSession.key.trim();
  const publicDiscoverCreations = useMemo(
    () => (publicDiscoverImages.length > 0 ? publicDiscoverImages : fallbackCreations),
    [publicDiscoverImages],
  );
  const creations = useMemo(
    () => publicDiscoverCreations,
    [publicDiscoverCreations],
  );
  const landingHeroItems = useMemo(
    () => buildPublicDiscoverLandingHeroItems(publicDiscoverCreations),
    [publicDiscoverCreations],
  );
  const canvasTemplates = useMemo(() => getCanvasTemplateCards(), []);
  const activeTaskIds = useMemo(
    () => submittedTasks.filter((task) => !terminalTaskStatuses.has(task.status)).map((task) => task.id),
    [submittedTasks],
  );
  const canvasHomeEntries = useMemo(() => {
    void canvasLibraryRevision;
    const storage = typeof window === "undefined"
      ? {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      }
      : window.localStorage;
    return getCanvasHomeEntries(storage);
  }, [canvasLibraryRevision]);

  useEffect(() => {
    const visibleCanvasIds = new Set(canvasHomeEntries.map((entry) => entry.id));
    setSelectedCanvasIds((current) => current.filter((canvasId) => visibleCanvasIds.has(canvasId)));
  }, [canvasHomeEntries]);

  const applyGenerateConversations = useCallback((conversations: ImageConversation[], preferredActiveId?: string) => {
    generateConversationsRef.current = conversations;
    setGenerateConversations(conversations);
    const view = imageConversationsToGenerateView(conversations);
    setSubmittedTasks(view.tasks);
    setGenerateSessions(view.sessions.length > 0 ? view.sessions : [initialGenerateSession]);
    const nextActiveId =
      preferredActiveId && view.sessions.some((sessionItem) => sessionItem.id === preferredActiveId)
        ? preferredActiveId
        : view.sessions[0]?.id ?? initialGenerateSession.id;
    setActiveGenerateSessionId(nextActiveId);
  }, []);

  const loadRecentCreations = useCallback(async () => {
    const hasCurrentCreations = publicDiscoverImages.length > 0;
    setCreationFeedStatus((current) => (hasCurrentCreations || current === "refreshing" ? "refreshing" : "loading"));
    try {
      const result = await fetchPublicDiscoverImages({ page_size: 12 });
      setPublicDiscoverImages(result.items);
    } catch {
      setPublicDiscoverImages((current) => current);
    } finally {
      setCreationFeedStatus("idle");
    }
  }, [publicDiscoverImages.length]);

  const refreshAssets = useCallback(async () => {
    if (isPublicPreview) {
      setImages([]);
      return;
    }

    try {
      const personalResult = await fetchManagedImages({ page_size: 12 });
      setImages(personalResult.items);
    } catch {
      setImages((current) => current);
    }
  }, [isPublicPreview]);

  const scrollToDiscoverHero = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (typeof window === "undefined") {
      return;
    }
    const discoverHero = document.getElementById("cola-discover-hero");
    if (!discoverHero) {
      return;
    }
    discoverHero.scrollIntoView({ behavior, block: "start" });
  }, []);

  useEffect(() => {
    generateConversationsRef.current = generateConversations;
  }, [generateConversations]);

  useEffect(() => {
    let active = true;

    const loadGenerateHistory = async () => {
      try {
        const conversations = await listImageConversations();
        if (!active) {
          return;
        }
        const storedActiveId =
          typeof window !== "undefined" ? window.localStorage.getItem(COLA_ACTIVE_GENERATE_SESSION_STORAGE_KEY) : null;
        applyGenerateConversations(conversations, storedActiveId || undefined);
      } catch {
        if (active) {
          applyGenerateConversations([]);
        }
      }
    };

    void loadGenerateHistory();
    return () => {
      active = false;
    };
  }, [applyGenerateConversations]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (activeGenerateSessionId && activeGenerateSessionId !== initialGenerateSession.id) {
      window.localStorage.setItem(COLA_ACTIVE_GENERATE_SESSION_STORAGE_KEY, activeGenerateSessionId);
      return;
    }
    window.localStorage.removeItem(COLA_ACTIVE_GENERATE_SESSION_STORAGE_KEY);
  }, [activeGenerateSessionId]);

  useEffect(() => {
    let active = true;

    const loadImages = async () => {
      setCreationFeedStatus("loading");
      try {
        const publicResult = await fetchPublicDiscoverImages({ page_size: 12 });
        if (active) {
          setPublicDiscoverImages(publicResult.items);
        }
        if (isPublicPreview) {
          if (active) {
            setImages([]);
          }
          return;
        }

        const personalResult = await fetchManagedImages({ page_size: 12 });
        if (active) {
          setImages(personalResult.items);
        }
      } catch {
        if (active) {
          setPublicDiscoverImages((current) => current);
          setImages((current) => current);
        }
      } finally {
        if (active) {
          setCreationFeedStatus("idle");
        }
      }
    };

    void loadImages();
    return () => {
      active = false;
    };
  }, [isPublicPreview]);

  useEffect(() => {
    if (activeTaskIds.length === 0) {
      return;
    }

    let active = true;
    const pollTasks = async () => {
      try {
        const result = await fetchImageTasks(activeTaskIds);
        if (active) {
          const nextConversations = mergeGenerateTasksIntoImageConversations(
            generateConversationsRef.current,
            result.items,
          );
          if (nextConversations !== generateConversationsRef.current) {
            const preferredActiveId = activeGenerateSessionId;
            generateConversationsRef.current = nextConversations;
            setGenerateConversations(nextConversations);
            const view = imageConversationsToGenerateView(nextConversations);
            setSubmittedTasks(view.tasks);
            setGenerateSessions(view.sessions.length > 0 ? view.sessions : [initialGenerateSession]);
            if (view.sessions.some((sessionItem) => sessionItem.id === preferredActiveId)) {
              setActiveGenerateSessionId(preferredActiveId);
            }
            void saveImageConversations(nextConversations);
            return;
          }
          setSubmittedTasks((previous) => mergeGenerateTasks(previous, result.items));
        }
      } catch {
        if (active) {
          setGenerationError("任务状态同步失败，稍后会自动重试。");
        }
      }
    };

    void pollTasks();
    const timer = window.setInterval(() => void pollTasks(), 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeGenerateSessionId, activeTaskIds]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.scrollTo !== "function") {
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, [mode]);

  useEffect(() => {
    if (mode !== "canvas" && canvasSubview !== "home") {
      setCanvasSubview("home");
    }
  }, [canvasSubview, mode]);

  useEffect(() => {
    if (mode !== "discover") {
      setStickyVisible(false);
      return;
    }

    const hero = document.getElementById("cola-discover-hero");
    if (!hero || typeof IntersectionObserver === "undefined") {
      setStickyVisible(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setStickyVisible(entry.boundingClientRect.bottom <= 80);
      },
      { threshold: 0, rootMargin: "-80px 0px 0px 0px" },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [mode]);

  useEffect(() => {
    if (mode !== "discover" || typeof window === "undefined") {
      setLandingHeroState("idle");
      if (landingHeroRef.current) {
        landingHeroRef.current.setAttribute("data-cola-pin-state", "before");
        landingHeroGeometryRef.current = writeLandingHeroOrbitLayout(landingHeroRef.current);
        writeLandingHeroMotionStyle(landingHeroRef.current, landingHeroIdleMotion, landingHeroGeometryRef.current);
      }
      landingHeroStateRef.current = "idle";
      landingHeroGeometryRef.current = null;
      landingSnapLockRef.current = false;
      lastDiscoverScrollYRef.current = 0;
      return;
    }

    let frame = 0;
    let active = true;

    const refreshLandingHeroLayout = () => {
      const hero = landingHeroRef.current;
      landingHeroGeometryRef.current = hero ? writeLandingHeroOrbitLayout(hero) : null;
    };

    const updateDiscoverHandoff = (measurements?: {
      currentScrollY: number;
      heroHeight: number;
      viewportHeight: number;
    }) => {
      const hero = landingHeroRef.current;
      const discoverHero = document.getElementById("cola-discover-hero");
      if (!hero || !discoverHero) {
        return false;
      }

      const currentScrollY = measurements?.currentScrollY ?? window.scrollY;
      const viewportHeight = measurements?.viewportHeight ?? window.innerHeight;
      const pinMeasurement = writeLandingHeroPinState(hero, viewportHeight);
      const heroHeight = pinMeasurement.heroHeight;
      const goingDown = currentScrollY > lastDiscoverScrollYRef.current;
      lastDiscoverScrollYRef.current = currentScrollY;

      const heroScrollY = pinMeasurement.heroScrollY;
      const motion = getLandingHeroScrollMotion({
        scrollY: heroScrollY,
        heroHeight,
        viewportHeight,
      });
      const layout = landingHeroGeometryRef.current ?? writeLandingHeroOrbitLayout(hero);
      landingHeroGeometryRef.current = layout;
      writeLandingHeroMotionStyle(hero, motion, layout);
      if (motion.stageState !== landingHeroStateRef.current) {
        landingHeroStateRef.current = motion.stageState;
        setLandingHeroState(motion.stageState);
      }

      const discoverViewportTop = discoverHero.getBoundingClientRect().top;

      if (
        shouldSnapLandingHeroToDiscover({
          goingDown,
          snapLocked: landingSnapLockRef.current,
          heroScrollY,
          heroHeight,
          viewportHeight,
          discoverViewportTop,
        })
      ) {
        landingSnapLockRef.current = true;
        scrollToDiscoverHero("smooth");
        window.setTimeout(() => {
          landingSnapLockRef.current = false;
        }, 420);
      }

      if (!goingDown && motion.progress < 0.28) {
        landingSnapLockRef.current = false;
      }

      return true;
    };

    const syncLandingHeroFrame = () => {
      frame = 0;
      if (!active) {
        return;
      }

      const hero = landingHeroRef.current;
      const viewportHeight = window.innerHeight;
      const currentScrollY = window.scrollY;
      const heroHeight = hero ? Math.max(hero.offsetHeight, viewportHeight) : 0;
      updateDiscoverHandoff({
        currentScrollY,
        heroHeight,
        viewportHeight,
      });
    };

    const scheduleLandingHeroSync = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(syncLandingHeroFrame);
    };

    const syncLandingHeroFromResize = () => {
      refreshLandingHeroLayout();
      scheduleLandingHeroSync();
    };

    refreshLandingHeroLayout();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      const hero = landingHeroRef.current;
      const stage = hero?.querySelector<HTMLElement>(".orbit_stage") ?? null;
      const timelineLine = hero?.querySelector<HTMLElement>(".timeline_line") ?? null;
      resizeObserver = new ResizeObserver(syncLandingHeroFromResize);
      if (hero) {
        resizeObserver.observe(hero);
      }
      if (stage) {
        resizeObserver.observe(stage);
      }
      if (timelineLine) {
        resizeObserver.observe(timelineLine);
      }
    }

    window.addEventListener("scroll", scheduleLandingHeroSync, { passive: true });
    window.addEventListener("resize", syncLandingHeroFromResize);
    scheduleLandingHeroSync();
    return () => {
      active = false;
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", scheduleLandingHeroSync);
      window.removeEventListener("resize", syncLandingHeroFromResize);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [mode, scrollToDiscoverHero]);

  useEffect(() => () => clearReferencePreviewUrl(referencePreviewUrlRef), []);

  const openPromptMarket = useCallback(() => {
    setPromptMarketOpen(true);
  }, []);

  const handleApplyTemplate = useCallback((payload: PromptTemplateApplyPayload) => {
    setPrompt(payload.prompt);
    setCount(Math.max(1, Math.min(8, Number(payload.count || 1))));
    setImageModel(normalizeImageModel(payload.model));
    if (payload.size) {
      setQuality(payload.size);
      setRatio(payload.size);
    } else {
      setQuality("智能");
      setRatio("1:1");
    }
    setMode("generate");
    setPromptMarketOpen(false);
  }, []);

  const handleLogin = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.href = "/ColaAI/login";
    }
  }, []);

  const handleLogout = useCallback(() => {
    void (async () => {
      await clearStoredColaAuthSession();
      await clearStoredAuthSession();
      if (typeof window !== "undefined") {
        window.location.href = "/ColaAI/login";
      }
    })();
  }, []);

  const handleCheckIn = useCallback(async () => {
    if (isPublicPreview) {
      handleLogin();
      return;
    }

    try {
      const result = await checkInUser();
      const nextLimits = userKeyLimitsToStoredLimits(result.user.limits);
      const nextSession: ColaAuthSession = {
        ...currentSession,
        subjectId: result.user.id || currentSession.subjectId,
        name: result.user.name || currentSession.name,
        limits: nextLimits,
      };

      setSessionOverride(nextSession);
      await Promise.all([
        setStoredColaAuthSession(nextSession),
        setStoredAuthSession({
          key: nextSession.key,
          role: "user",
          subjectId: nextSession.subjectId,
          name: nextSession.name,
          email: nextSession.email,
          limits: nextSession.limits,
        }),
      ]);
      setCheckInResult({
        status: "success",
        awarded: result.awarded,
        bonusCredits: result.bonus_credits ?? result.bonus_images,
        remainingCredits: nextLimits?.creditsRemaining ?? nextLimits?.imagesRemaining,
        message: result.awarded ? `签到成功，积分 +${result.bonus_credits ?? result.bonus_images}。` : "今天已经签到过。",
      });
    } catch (error) {
      setCheckInResult({
        status: "error",
        message: error instanceof Error ? error.message : "签到失败，请稍后重试。",
      });
    }
  }, [currentSession, handleLogin, isPublicPreview]);

  const handleToggleLanguage = useCallback(() => {
    setLanguage((current) => (current === "zh" ? "en" : "zh"));
  }, []);

  const openDialog = useCallback((nextDialog: Exclude<WorkbenchDialog, null>) => {
    setDialog(nextDialog);
  }, []);

  const handleLowerNavAction = useCallback((item: (typeof lowerNavItems)[number]) => {
    if ("mode" in item) {
      setMode(item.mode);
      return;
    }
    if (item.key === "logout") {
      handleLogout();
    }
  }, [handleLogout]);

  const handleCopyImage = useCallback((image: ManagedImage) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(image.url);
    }
  }, []);

  const handleDownloadImage = useCallback((image: ManagedImage) => {
    void downloadSingleImage(image.rel);
  }, []);

  const handleUsePrompt = useCallback((nextPrompt: string) => {
    setPrompt(nextPrompt);
    setSelectedCreation(null);
    setMode("generate");
  }, []);

  const handleCopyPrompt = useCallback((nextPrompt: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(nextPrompt);
    }
  }, []);

  const handleReferenceFileChange = useCallback((files: File[]) => {
    const nextImages = files
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        file,
      }));
    if (nextImages.length === 0) {
      return;
    }
    referencePreviewUrlRef.current = [...referencePreviewUrlRef.current, ...nextImages.map((image) => image.previewUrl)];
    setReferenceImages((current) => [...current, ...nextImages]);
    setMode("generate");
  }, []);

  const handleReferenceRemove = useCallback(() => {
    clearReferencePreviewUrl(referencePreviewUrlRef);
    setReferenceImages([]);
  }, []);

  const handleEditGeneratedImage = useCallback((image: GeneratedTaskImage) => {
    clearReferencePreviewUrl(referencePreviewUrlRef);
    setGenerationError("");
    setMode("generate");
    void (async () => {
      try {
        const name = getGeneratedImageFileName(image, 0);
        const file = await fetchImageFile(image.src, name);
        setReferenceImages([{ name, previewUrl: image.src, file }]);
      } catch (error) {
        setGenerationError(error instanceof Error ? error.message : "读取参考图失败，请稍后重试。");
      }
    })();
  }, []);

  const handleReferenceDragEnter = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!hasImageDragData(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    referenceDragDepthRef.current += 1;
    setIsReferenceDragActive(true);
  }, []);

  const handleReferenceDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!hasImageDragData(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleReferenceDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!hasImageDragData(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    referenceDragDepthRef.current = Math.max(0, referenceDragDepthRef.current - 1);
    if (referenceDragDepthRef.current === 0) {
      setIsReferenceDragActive(false);
    }
  }, []);

  const handleReferenceDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const files = getDroppedImageFiles(event.dataTransfer);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    referenceDragDepthRef.current = 0;
    setIsReferenceDragActive(false);
    handleReferenceFileChange(files);
  }, [handleReferenceFileChange]);

  const handleReferencePaste = useCallback((event: ReactClipboardEvent<HTMLElement>) => {
    const files = getDroppedImageFiles(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    handleReferenceFileChange(files);
  }, [handleReferenceFileChange]);

  const handleCreateGenerateSession = useCallback(() => {
    const nextSession = createGenerateSession();
    setGenerateSessions((previous) => prependGenerateSession(previous, nextSession));
    setActiveGenerateSessionId(nextSession.id);
    setPrompt("");
    setGenerationError("");
  }, []);

  const handleSelectGenerateSession = useCallback((sessionId: string) => {
    if (!generateSessions.some((sessionItem) => sessionItem.id === sessionId)) {
      return;
    }
    setActiveGenerateSessionId(sessionId);
    setFocusedGenerateTaskId("");
    setFocusedCanvasTask(null);
    setGenerationError("");
  }, [generateSessions]);

  const handleDeleteGenerateSession = useCallback(() => {
    const nextConversations = generateConversationsRef.current.filter((conversation) => conversation.id !== activeGenerateSessionId);
    const deletedPersistedConversation = generateConversationsRef.current.some((conversation) => conversation.id === activeGenerateSessionId);
    if (deletedPersistedConversation) {
      applyGenerateConversations(nextConversations);
      void deleteImageConversation(activeGenerateSessionId);
    } else {
      const nextSessions = generateSessions.filter((sessionItem) => sessionItem.id !== activeGenerateSessionId);
      if (nextSessions.length === 0) {
        const nextSession = createGenerateSession();
        setGenerateSessions([nextSession]);
        setActiveGenerateSessionId(nextSession.id);
      } else {
        setGenerateSessions(nextSessions);
        setActiveGenerateSessionId(nextSessions[0].id);
      }
    }
    setFocusedGenerateTaskId("");
    setFocusedCanvasTask(null);
    setGenerationError("");
  }, [activeGenerateSessionId, applyGenerateConversations, generateSessions]);

  const submitGenerateTasks = useCallback((input: GenerateSubmissionInput, sessionId: string) => {
    setIsGenerating(true);
    setGenerationError("");

    return (async () => {
      try {
        const tasks = await createGenerateSubmissionTasks(input, {
          createTaskId: createClientTaskId,
        });
        const acceptedCredits = tasks
          .filter((task) => task.status !== "error")
          .reduce((sum, task) => sum + imageResolutionCreditCost(task.submissionContext?.resolution ?? input.resolution), 0);
        const nextSession = decrementSessionImageQuota(currentSession, acceptedCredits);
        if (nextSession !== currentSession) {
          setSessionOverride(nextSession);
          await Promise.all([
            setStoredColaAuthSession(nextSession),
            setStoredAuthSession({
              key: nextSession.key,
              role: "user",
              subjectId: nextSession.subjectId,
              name: nextSession.name,
              email: nextSession.email,
              limits: nextSession.limits,
            }),
          ]);
        }
        const now = new Date().toISOString();
        const targetSessionId = sessionId === initialGenerateSession.id ? createGenerateSessionId() : sessionId;
        const nextConversations = upsertGenerateSubmissionIntoImageConversations(
          generateConversationsRef.current,
          {
            ...input,
            sessionId: targetSessionId,
            tasks,
            now,
          },
        );
        generateConversationsRef.current = nextConversations;
        setGenerateConversations(nextConversations);
        const view = imageConversationsToGenerateView(nextConversations);
        setSubmittedTasks(view.tasks);
        setGenerateSessions(view.sessions.length > 0 ? view.sessions : [initialGenerateSession]);
        setActiveGenerateSessionId(targetSessionId);
        const persistedConversation = nextConversations.find((conversation) => conversation.id === targetSessionId);
        if (persistedConversation) {
          await saveImageConversation(persistedConversation);
        }
      } catch (error) {
        setGenerationError(error instanceof Error ? error.message : "提交生成任务失败，请稍后重试。");
      } finally {
        setIsGenerating(false);
      }
    })();
  }, [currentSession]);

  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) {
      setPrompt("一张高质感 ColaAI 创意海报，清透光影，丰富细节，适合产品首屏展示。");
      setMode("generate");
      return;
    }
    if (isPublicPreview) {
      setMode("generate");
      setGenerationError("需要登录后才能提交生成任务。");
      return;
    }

    setMode("generate");
    setFocusedGenerateTaskId("");
    setFocusedCanvasTask(null);
    const effectiveCount = Math.max(1, Math.min(8, count));
    const effectiveModel: ImageModel = imageModel === "auto" ? "gpt-image-2" : imageModel;
    const effectiveSize = quality === "智能" ? undefined : ratio;
    const referenceFiles = referenceImages.map((image) => image.file).filter((file): file is File => Boolean(file));
    void submitGenerateTasks(
      {
        prompt,
        count: effectiveCount,
        model: effectiveModel,
        size: effectiveSize,
        resolution,
        referenceFiles: referenceFiles.length > 0 ? referenceFiles : undefined,
        publicMode,
      },
      activeGenerateSessionId,
    );
    setPrompt("");
    handleReferenceRemove();
  }, [activeGenerateSessionId, count, handleReferenceRemove, imageModel, isPublicPreview, prompt, publicMode, quality, ratio, referenceImages, resolution, submitGenerateTasks]);

  const handleRetryGeneration = useCallback((task: GenerateTask) => {
    if (task.submissionContext?.retrying) {
      return;
    }
    const retryInput = buildGenerateRetrySubmissionInput(task);
    if (!retryInput) {
      setGenerationError("找不到这次失败任务的提交参数，请重新输入提示词后再生成。");
      return;
    }

    const targetSessionId = findGenerateSessionIdForTask(generateSessions, task.id, activeGenerateSessionId);
    setSubmittedTasks((previous) => setGenerateTaskRetrying(previous, task.id, true));
    setMode("generate");

    void submitGenerateTasks(retryInput, targetSessionId).finally(() => {
      setSubmittedTasks((previous) => setGenerateTaskRetrying(previous, task.id, false));
    });
  }, [activeGenerateSessionId, generateSessions, submitGenerateTasks]);

  const handleOpenCanvasSourceTask = useCallback((task: CanvasSourceTaskFocus) => {
    const targetSessionId = findGenerateSessionIdForTask(generateSessions, task.id, activeGenerateSessionId);
    setActiveGenerateSessionId(targetSessionId);
    setFocusedGenerateTaskId(task.id);
    setFocusedCanvasTask({
      id: task.id,
      nodeId: task.nodeId,
      prompt: task.prompt,
      error: task.error,
      status: task.status,
      model: task.model,
      size: task.size,
      attempt: task.attempt,
    });
    setGenerationError("");
    setMode("generate");
  }, [activeGenerateSessionId, generateSessions]);

  const handleCanvasAcceptedImageTasks = useCallback((acceptedTaskCount: number) => {
    const nextSession = decrementSessionImageQuota(currentSession, acceptedTaskCount);
    if (nextSession === currentSession) {
      return;
    }

    setSessionOverride(nextSession);
    void Promise.all([
      setStoredColaAuthSession(nextSession),
      setStoredAuthSession({
        key: nextSession.key,
        role: "user",
        subjectId: nextSession.subjectId,
        name: nextSession.name,
        email: nextSession.email,
        limits: nextSession.limits,
      }),
    ]);
  }, [currentSession]);

  const handleOptimizeCanvasTextPrompt = useCallback(async (_nodeId: string, text: string, model: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return "";
    }
    if (!currentSession.key.trim()) {
      throw new Error("请先登录后再使用 GPT 优化提示词。");
    }

    const response = await fetch(colaApiPath("/v1/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${currentSession.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.trim() || "auto",
        stream: false,
        messages: buildPromptArchitectMessages(trimmed),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(errorText || `提示词优化失败 (${response.status})`);
    }

    const optimizedPrompt = extractPromptArchitectResponse(await response.json());
    if (!optimizedPrompt) {
      throw new Error("上游返回为空，请稍后重试。");
    }
    return optimizedPrompt;
  }, [currentSession.key]);

  const handleReverseCanvasImagePrompt = useCallback(async (_nodeId: string, text: string, model: string, referenceImages: CanvasReferenceImage[]) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return "";
    }
    if (!currentSession.key.trim()) {
      throw new Error("请先登录后再使用 GPT 图片反推。");
    }

    const resolvedReferenceImages = await Promise.all(referenceImages.map((image) => normalizeCanvasReferenceImageForChat(image)));
    const response = await fetch(colaApiPath("/v1/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${currentSession.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.trim() || "auto",
        stream: false,
        messages: buildImageReversePromptMessages(trimmed, resolvedReferenceImages),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(errorText || `图片反推失败 (${response.status})`);
    }

    const reversedPrompt = extractPromptArchitectResponse(await response.json());
    if (!reversedPrompt) {
      throw new Error("上游返回为空，请稍后重试。");
    }
    return reversedPrompt;
  }, [currentSession.key]);

  const clearFocusedGenerateTask = useCallback(() => {
    setFocusedGenerateTaskId("");
    setFocusedCanvasTask(null);
  }, []);

  const syncActiveCanvasRecord = useCallback((state?: CanvasState | null) => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const nextState = state ?? loadCanvasState(window.localStorage);
      if (!nextState) {
        return;
      }

      const canvasId = activeCanvasId ?? getActiveCanvasId(window.localStorage) ?? undefined;
      const record = saveCanvasLibraryRecord(window.localStorage, nextState, { canvasId });
      setActiveCanvasIdState(record.id);
    } catch {
      // Storage failures should not block navigation back to the canvas library.
    }
  }, [activeCanvasId]);

  const handleOpenCanvasHome = useCallback((state?: CanvasState) => {
    syncActiveCanvasRecord(state);
    setMode("canvas");
    setCanvasSubview("home");
  }, [syncActiveCanvasRecord]);

  const openWorkbenchMode = useCallback((nextMode: WorkbenchMode) => {
    if (nextMode === "canvas") {
      handleOpenCanvasHome();
      return;
    }
    if (nextMode === "assets") {
      void refreshAssets();
    }
    setMode(nextMode);
  }, [handleOpenCanvasHome, refreshAssets]);

  const handleOpenCanvasEditor = useCallback(() => {
    setMode("canvas");
    setCanvasSubview("editor");
  }, []);

  const persistCanvasDraft = useCallback((state: CanvasState) => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const record = saveCanvasLibraryRecord(window.localStorage, state);
      setActiveCanvasIdState(record.id);
    } catch {
      try {
        saveCanvasState(window.localStorage, state);
      } catch {
        // Fall through and still open the editor with the in-memory default.
      }
    }
  }, []);

  const handleOpenCanvasRecord = useCallback((canvasId: string) => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const state = loadCanvasLibraryState(window.localStorage, canvasId);
      if (!state) {
        return;
      }

      saveCanvasLibraryRecord(window.localStorage, state, { canvasId });
      setActiveCanvasIdState(canvasId);
    } catch {
      return;
    }

    handleOpenCanvasEditor();
  }, [handleOpenCanvasEditor]);

  const handleCreateBlankCanvas = useCallback(() => {
    persistCanvasDraft(createBlankCanvasState());
    handleOpenCanvasEditor();
  }, [handleOpenCanvasEditor, persistCanvasDraft]);

  const handleCreateTemplateCanvas = useCallback((templateId: CanvasTemplateCard["id"]) => {
    persistCanvasDraft(createTemplateCanvasState(templateId));
    handleOpenCanvasEditor();
  }, [handleOpenCanvasEditor, persistCanvasDraft]);

  const handleDeleteCanvasRecord = useCallback((canvasId: string) => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      deleteCanvasLibraryRecord(window.localStorage, canvasId);
      setSelectedCanvasIds((current) => current.filter((selectedCanvasId) => selectedCanvasId !== canvasId));
      setActiveCanvasIdState(getActiveCanvasId(window.localStorage));
      setCanvasLibraryRevision((current) => current + 1);
    } catch {
      // Ignore storage errors and keep the library usable.
    }
  }, []);

  const handleToggleCanvasSelection = useCallback((canvasId: string) => {
    setSelectedCanvasIds((current) => (
      current.includes(canvasId)
        ? current.filter((selectedCanvasId) => selectedCanvasId !== canvasId)
        : [...current, canvasId]
    ));
  }, []);

  const handleToggleAllCanvasSelection = useCallback(() => {
    setSelectedCanvasIds((current) => (
      canvasHomeEntries.length > 0 && current.length === canvasHomeEntries.length
        ? []
        : canvasHomeEntries.map((entry) => entry.id)
    ));
  }, [canvasHomeEntries]);

  const handleDeleteSelectedCanvases = useCallback(() => {
    if (typeof window === "undefined" || selectedCanvasIds.length === 0) {
      return;
    }

    try {
      deleteCanvasLibraryRecords(window.localStorage, selectedCanvasIds);
      setActiveCanvasIdState(getActiveCanvasId(window.localStorage));
      setSelectedCanvasIds([]);
      setCanvasLibraryRevision((current) => current + 1);
    } catch {
      // Ignore storage errors and keep the library usable.
    }
  }, [selectedCanvasIds]);

  return (
    <>
      <section
        data-cola-layout="rova-like"
        data-cola-drop-scope="global-reference-image"
        data-cola-performance="paint-optimized"
        data-cola-mode={mode}
        data-cola-design="clear-studio"
        className={cn("relative isolate min-h-dvh overflow-hidden", colaShellClass)}
        onDragEnter={handleReferenceDragEnter}
        onDragOver={handleReferenceDragOver}
        onDragLeave={handleReferenceDragLeave}
        onDrop={handleReferenceDrop}
        onPaste={handleReferencePaste}
      >
        <RovaMediaBackground />
        <ReferenceDropOverlay active={isReferenceDragActive} />
        {isPublicPreview ? <PublicAuthBar /> : <UserSummaryBar session={currentSession} />}

        <aside
          data-cola-panel="side-nav"
          data-cola-behavior="rova-glass-rail"
          className={cn(
            "fixed left-4 top-1/2 z-40 hidden h-[calc(100dvh-60px)] w-[72px] -translate-y-1/2 flex-col items-center py-5 md:flex",
            colaPanelClass,
          )}
        >
          <BrandLogo className="mb-6 text-[26px]" />

          <nav className="flex flex-1 flex-col items-center gap-3">
            {sideNavItems.map((item) => {
              const Icon = item.icon;
              const active = item.key === mode;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "grid w-full place-items-center gap-1 text-[11px] transition",
                    active ? "font-semibold text-slate-950" : "font-medium text-slate-500 hover:text-slate-900",
                  )}
                  onClick={() => {
                    openWorkbenchMode(item.key);
                  }}
                >
                  <span className={cn("grid size-9 place-items-center rounded-[14px] transition", active && "bg-slate-950 text-white shadow-[0_14px_34px_-24px_rgba(15,23,42,0.88)]")}>
                    <Icon className="size-4" />
                  </span>
                  {item.label}
                </button>
              );
            })}
          </nav>

          <nav className="flex flex-col items-center gap-3">
            {!isPublicPreview ? (
              <button
                type="button"
                data-cola-action="check-in"
                title="签到"
                className="grid w-full place-items-center gap-1 text-[11px] font-medium text-slate-500 transition hover:text-slate-900"
                onClick={() => void handleCheckIn()}
              >
                <Gift className="size-4" />
                签到
              </button>
            ) : null}
            {lowerNavItems.filter((item) => item.key !== "api" && (!("authOnly" in item) || !isPublicPreview)).map((item) => {
              const Icon = item.icon;
              const active = "mode" in item && item.mode === mode;
              return (
                <button
                  key={item.key}
                  type="button"
                  title={item.key === "api" ? "任务队列 / API" : item.key === "settings" ? "设置" : undefined}
                  className={cn(
                    "grid w-full place-items-center gap-1 text-[11px] transition hover:text-slate-900",
                    active ? "font-semibold text-slate-950" : "font-medium text-slate-500",
                  )}
                  onClick={() => {
                    handleLowerNavAction(item);
                  }}
                >
                  <Icon className="size-4" />
                  {item.label}
                </button>
              );
            })}
            <button
              type="button"
              data-cola-action="toggle-language"
              className="grid w-full place-items-center gap-1 text-[11px] font-medium text-slate-500 transition hover:text-slate-900"
              onClick={handleToggleLanguage}
            >
              <Languages className="size-4" />
              {language === "zh" ? "EN" : "中文"}
            </button>
          </nav>
        </aside>

        <nav
          data-cola-panel="mobile-nav"
          className={cn(
            "fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 grid grid-cols-4 px-2 py-2 md:hidden",
            colaPanelClass,
          )}
        >
          {mobilePrimaryItems.map((item) => {
            const Icon = item.icon;
            const active = item.key === mode;
            return (
              <button
                key={item.key}
                type="button"
                data-cola-mobile-mode={item.key}
                className={cn(
                  "grid place-items-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium transition",
                  active ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-white/70 hover:text-slate-950",
                )}
                onClick={() => {
                  setMode(item.key);
                }}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
          <button
            type="button"
            data-cola-action="open-more-menu"
            className="grid place-items-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium text-slate-500 transition hover:bg-white/70 hover:text-slate-950"
            onClick={() => openDialog("more")}
          >
            <Menu className="size-4" />
            更多
          </button>
        </nav>

        <nav
          data-cola-panel="mobile-utility-nav"
          className={cn(
            "fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+4.65rem)] z-40 hidden grid-cols-4 gap-1 px-2 py-2 md:hidden",
            colaPanelClass,
          )}
        >
          {lowerNavItems.filter((item) => !("authOnly" in item) || !isPublicPreview).map((item) => {
            const Icon = item.icon;
            const active = "mode" in item && item.mode === mode;
            return (
              <button
                key={item.key}
                type="button"
                title={item.key === "api" ? "任务队列 / API" : undefined}
                className={cn(
                  "grid place-items-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-medium transition",
                  active ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-white/70 hover:text-slate-950",
                )}
                onClick={() => handleLowerNavAction(item)}
              >
                <Icon className="size-3.5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {mode === "discover" && (
          <div
            data-cola-panel="discover-stack"
            data-cola-behavior="landing-to-discover-flow"
            data-cola-scroll-sync="scroll-listener animation-frame"
            className="relative flex flex-col"
          >
            <ColaAILandingHero
              items={landingHeroItems}
              stageState={landingHeroState}
              heroRef={landingHeroRef}
              onScrollToDiscover={() => scrollToDiscoverHero("smooth")}
            />
            <div data-cola-panel="discover-handoff" className="landing-hero__handoff relative">
              <DiscoverHome
                prompt={prompt}
                count={count}
                quality={quality}
                ratio={ratio}
                resolution={resolution}
                imageModel={imageModel}
                publicMode={publicMode}
                referenceImages={referenceImages}
                isGenerating={isGenerating}
                stickyVisible={stickyVisible}
                creations={creationFeedStatus === "loading" && publicDiscoverImages.length === 0 ? [] : creations}
                creationFeedStatus={creationFeedStatus}
                onPromptChange={setPrompt}
                onCountChange={setCount}
                onQualityChange={setQuality}
                onRatioChange={setRatio}
                onResolutionChange={setResolution}
                onImageModelChange={setImageModel}
                onPublicChange={setPublicMode}
                onReferenceFileChange={handleReferenceFileChange}
                onOpenPrompts={openPromptMarket}
                onGenerate={handleGenerate}
                onOpenCreation={setSelectedCreation}
                onUsePrompt={handleUsePrompt}
                onCopyPrompt={handleCopyPrompt}
                onRefreshCreations={loadRecentCreations}
              />
            </div>
          </div>
        )}

        {mode === "generate" && (
          <GenerateWorkspace
            prompt={prompt}
            count={count}
            quality={quality}
            ratio={ratio}
            resolution={resolution}
            imageModel={imageModel}
            publicMode={publicMode}
            referenceImages={referenceImages}
            isGenerating={isGenerating}
            submittedTasks={submittedTasks}
            generateSessions={generateSessions}
            activeGenerateSessionId={activeGenerateSessionId}
            generationError={generationError}
            focusedTaskId={focusedGenerateTaskId}
            focusedCanvasTask={focusedCanvasTask}
            queueUserRole={currentSession.role}
            onPromptChange={setPrompt}
            onCountChange={setCount}
            onQualityChange={setQuality}
            onRatioChange={setRatio}
            onResolutionChange={setResolution}
            onImageModelChange={setImageModel}
            onPublicChange={setPublicMode}
            onReferenceFileChange={handleReferenceFileChange}
            onReferenceRemove={handleReferenceRemove}
            onOpenPrompts={openPromptMarket}
            onCreateSession={handleCreateGenerateSession}
            onSelectSession={handleSelectGenerateSession}
            onDeleteSession={handleDeleteGenerateSession}
            onOpenQueue={() => {}}
            onGenerate={handleGenerate}
            onEditGeneratedImage={handleEditGeneratedImage}
            onRetryGeneration={handleRetryGeneration}
            onClearFocusedTask={clearFocusedGenerateTask}
          />
        )}

        {mode === "prompts" && <PromptLibrary onUsePrompt={handleUsePrompt} onCopyPrompt={handleCopyPrompt} />}

        {mode === "assets" && isPublicPreview && (
          <AuthRequiredPanel title="图片库" message="登录后查看图片库，管理最近生成结果和可复用素材。" />
        )}

        {mode === "assets" && !isPublicPreview && (
          <AssetsWorkspace
            images={images}
            creations={creations}
            onOpenCreation={setSelectedCreation}
            onCopyImage={handleCopyImage}
            onDownloadImage={handleDownloadImage}
          />
        )}

        {mode === "developer" && isPublicPreview && (
          <AuthRequiredPanel title="开发者控制台" message="登录后使用 API，查看密钥、任务队列和接口调用状态。" />
        )}

        {mode === "developer" && !isPublicPreview && <DeveloperConsole />}

        {mode === "notice" && <AnnouncementCenter />}

        {mode === "settings" && <SettingsWorkspace />}

        {mode === "canvas" && canvasSubview === "home" && (
          <CanvasHome
            canvases={canvasHomeEntries}
            templates={canvasTemplates}
            onOpenCanvas={handleOpenCanvasRecord}
            onCreateBlank={handleCreateBlankCanvas}
            onSelectTemplate={handleCreateTemplateCanvas}
            onDeleteCanvas={handleDeleteCanvasRecord}
            selectedCanvasIds={selectedCanvasIds}
            onToggleCanvasSelection={handleToggleCanvasSelection}
            onToggleAllCanvasSelection={handleToggleAllCanvasSelection}
            onDeleteSelectedCanvases={handleDeleteSelectedCanvases}
          />
        )}
      </section>

      {mode === "canvas" && canvasSubview === "editor" && (
        <CanvasWorkspace
          onBack={handleOpenCanvasHome}
          onAcceptedImageTasks={handleCanvasAcceptedImageTasks}
          onOpenSourceTask={handleOpenCanvasSourceTask}
          onOptimizeTextPrompt={handleOptimizeCanvasTextPrompt}
          onReverseImagePrompt={handleReverseCanvasImagePrompt}
        />
      )}

      <MobileMoreSheet
        open={dialog === "more"}
        isPublicPreview={isPublicPreview}
        session={currentSession}
        onClose={() => setDialog(null)}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onCheckIn={() => void handleCheckIn()}
        onOpenAnnouncement={() => openDialog("announcement")}
        onToggleLanguage={handleToggleLanguage}
        onNavigate={(nextMode) => {
          openWorkbenchMode(nextMode);
          setDialog(null);
        }}
      />

      <PromptMarketModal
        open={promptMarketOpen}
        onOpenChange={setPromptMarketOpen}
        isAdmin={false}
        darkMode={false}
        onApplyTemplate={handleApplyTemplate}
      />
      <LightweightDialog
        open={dialog === "more" ? null : dialog}
        onClose={() => setDialog(null)}
      />
      <CheckInDialog
        result={checkInResult}
        onClose={() => setCheckInResult(null)}
      />
      <CreationPreviewDialog
        item={selectedCreation}
        onClose={() => setSelectedCreation(null)}
        onUsePrompt={handleUsePrompt}
        onCopyPrompt={handleCopyPrompt}
      />
    </>
  );
}
