"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  Heart,
  ImageIcon,
  ImagePlus,
  Languages,
  Library,
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
import {
  downloadSingleImage,
  fetchImageTasks,
  fetchManagedImages,
  fetchPromptTemplateStats,
  fetchPromptTemplates,
  type ImageModel,
  type ImageTask,
  type ManagedImage,
  type PromptTemplate,
  type PromptTemplateStats,
  type PromptTemplateApplyPayload,
} from "@/lib/api";
import { downloadImageUrl, fetchImageFile } from "@/lib/image-fetch";
import { cn } from "@/lib/utils";
import { clearStoredAuthSession, type StoredAuthSession } from "@/store/auth";
import {
  deleteImageConversation,
  listImageConversations,
  saveImageConversation,
  saveImageConversations,
  type ImageConversation,
} from "@/store/image-conversations";
import { CanvasHome } from "./canvas-home";
import {
  createBlankCanvasState,
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
import { loadCanvasState, saveCanvasState } from "./use-canvas-store";

type WorkbenchMode = "discover" | "generate" | "prompts" | "assets" | "developer" | "notice" | "settings" | "canvas";

type ColaAIWorkbenchProps = {
  session: StoredAuthSession;
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

const COLA_ACTIVE_GENERATE_SESSION_STORAGE_KEY = "chatgpt2api:colaai_active_generate_conversation_id";

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

function timestampFromIso(value?: string) {
  if (!value) {
    return undefined;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
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

function getSessionElapsedMs(tasks: GenerateTask[], nowMs: number) {
  if (tasks.length === 0) {
    return undefined;
  }
  const startedAtMs = timestampFromIso(tasks[0]?.created_at);
  if (typeof startedAtMs !== "number") {
    return undefined;
  }
  const allFinished = tasks.every((task) => task.status === "success" || task.status === "error" || task.status === "cancelled");
  const finishedAtMs = allFinished
    ? averageDuration(
        tasks.map((task) => {
          const taskFinishedAtMs = timestampFromIso(task.finished_at);
          return typeof taskFinishedAtMs === "number" ? taskFinishedAtMs - startedAtMs : undefined;
        }),
      )
    : undefined;
  return Math.max(0, typeof finishedAtMs === "number" ? finishedAtMs : nowMs - startedAtMs);
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

export function getDroppedImageFile(data: DroppedImageData | null | undefined): File | null {
  if (!data) {
    return null;
  }

  const items = Array.from(data.items ?? []);
  for (const item of items) {
    if (item.kind === "file" && item.type?.startsWith("image/")) {
      const file = item.getAsFile?.() ?? null;
      if (file?.type.startsWith("image/")) {
        return file;
      }
    }
  }

  const files = Array.from(data.files ?? []);
  return files.find((file) => file.type.startsWith("image/")) ?? null;
}

function hasImageDragData(data: DroppedImageData | null | undefined) {
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
  referencePreviewUrlRef: { current: string },
  revokeObjectUrl: (url: string) => void = URL.revokeObjectURL,
) {
  if (!referencePreviewUrlRef.current) {
    return;
  }

  revokeObjectUrl(referencePreviewUrlRef.current);
  referencePreviewUrlRef.current = "";
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
];

function normalizeImageModel(model: string | null | undefined): GenerateImageModel {
  return model === "gpt-image-2" || model === "codex-gpt-image-2" ? model : "auto";
}

const terminalTaskStatuses = new Set<ImageTask["status"]>(["success", "error", "cancelled"]);

const fallbackCreations: CreationItem[] = [
  {
    id: "poster",
    title: "光影角色海报",
    subtitle: "GPT-IMAGE-2",
    prompt: "夜色城堡前的幻想角色海报，柔和月光，电影级光影，细节丰富。",
    imageUrl: "",
  },
  {
    id: "product",
    title: "夏日产品主视觉",
    subtitle: "2:3",
    prompt: "清爽夏日汽水产品海报，冰块、水珠、阳光折射，高级商业摄影。",
    imageUrl: "",
  },
  {
    id: "card",
    title: "镭射收藏卡牌",
    subtitle: "公开",
    prompt: "东方幻想角色镭射收藏卡牌，稀有卡面，金属边框，技能说明布局。",
    imageUrl: "",
  },
  {
    id: "cover",
    title: "小红书封面",
    subtitle: "智能",
    prompt: "小红书封面设计，标题突出，清新明亮，适合 AI 绘图教程内容。",
    imageUrl: "",
  },
  {
    id: "architecture",
    title: "建筑拆解图",
    subtitle: "16:9",
    prompt: "经典建筑拆解信息图，中式美学标注，清晰结构分层，细节注释。",
    imageUrl: "",
  },
  {
    id: "icon-grid",
    title: "游戏图标矩阵",
    subtitle: "1:1",
    prompt: "复古幻想 RPG 物品图标矩阵，统一像素艺术风格，标签清晰。",
    imageUrl: "",
  },
  {
    id: "fashion",
    title: "AI 服装灵感板",
    subtitle: "4:3",
    prompt: "一张 AI Fashion Inspiration Board，三套完整造型，专业提案板排版。",
    imageUrl: "",
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
    id: "brand-board",
    title: "高端品牌提案板",
    prompt: "生成完整高端品牌运营图，包含主视觉、包装、杯套、贴纸、海报和品牌符号，白色摄影棚背景，商业落地感。",
    author: "ColaAI",
    tags: ["branding", "product", "poster"],
    tone: "from-sky-100 via-violet-100 to-rose-100",
    ratio: "4:5",
    category: "品牌视觉",
    useCase: "适合品牌提案、运营图和商业落地页",
  },
  {
    id: "character-sheet",
    title: "角色设定资料卡",
    prompt: "制作官方设定资料卡，包含正面、侧面、背面、表情、装备拆解、配色条和世界观缩略图，半写实插画。",
    author: "AI盒子",
    tags: ["character", "illustration", "game"],
    tone: "from-fuchsia-100 via-indigo-100 to-cyan-100",
    ratio: "16:9",
    category: "角色设计",
    useCase: "适合游戏角色、IP 设定和动画前期",
  },
  {
    id: "fashion-board",
    title: "AI 服装灵感方案",
    prompt: "创作横向 4:3 AI Fashion Inspiration Board，提取色彩、廓形、材质并展示三套完整造型。",
    author: "ColaAI",
    tags: ["fashion", "portrait", "product"],
    tone: "from-rose-100 via-orange-100 to-emerald-100",
    ratio: "4:3",
    category: "时尚灵感",
    useCase: "适合服装企划、穿搭提案和趋势板",
  },
  {
    id: "ui-poster",
    title: "App 视觉世界观",
    prompt: "创建一套未来科技 App 视觉世界观设定图，包含界面、角色、设备、环境和品牌色板，干净高级。",
    author: "UIED",
    tags: ["ui", "3d", "poster"],
    tone: "from-emerald-100 via-sky-100 to-violet-100",
    ratio: "16:9",
    category: "产品 UI",
    useCase: "适合 App 概念稿、视觉世界观和发布物料",
  },
  {
    id: "product-splash",
    title: "清透饮品产品海报",
    prompt: "一张清透夏日饮品产品海报，玻璃瓶置于冰块和水珠之间，阳光穿透液体形成彩色折射，商业摄影质感。",
    author: "ColaAI",
    tags: ["product", "poster", "food"],
    tone: "from-cyan-100 via-lime-100 to-amber-100",
    ratio: "2:3",
    category: "产品广告",
    useCase: "适合饮品、电商主图和新品上市海报",
  },
  {
    id: "social-cover",
    title: "小红书教程封面",
    prompt: "小红书 AI 绘图教程封面，醒目中文标题，步骤卡片、示例图和明亮背景，信息清晰，适合收藏分享。",
    author: "内容实验室",
    tags: ["poster", "ui", "branding"],
    tone: "from-rose-100 via-white to-sky-100",
    ratio: "3:4",
    category: "社媒封面",
    useCase: "适合教程封面、图文笔记和运营内容",
  },
  {
    id: "luxury-phone",
    title: "极简手机广告",
    prompt: "高端智能手机广告主视觉，纯净白底，手机悬浮在柔和阴影上，细节锐利，金属边缘高光，Apple 级极简构图。",
    author: "Pixel Studio",
    tags: ["product", "poster", "3d"],
    tone: "from-slate-100 via-white to-blue-100",
    ratio: "4:5",
    category: "硬件广告",
    useCase: "适合手机、耳机、数码配件和官网首屏",
  },
  {
    id: "architecture-diagram",
    title: "建筑结构拆解图",
    prompt: "经典建筑结构拆解信息图，分层展示屋顶、梁柱、庭院与动线，带简洁中文标注，白底，精密建筑制图风格。",
    author: "Arch Lab",
    tags: ["architecture", "illustration", "poster"],
    tone: "from-stone-100 via-sky-50 to-emerald-100",
    ratio: "16:9",
    category: "建筑图解",
    useCase: "适合建筑展示、文旅图解和课程演示",
  },
  {
    id: "game-icon-grid",
    title: "RPG 道具图标矩阵",
    prompt: "复古幻想 RPG 道具图标矩阵，包含药水、卷轴、徽章、宝石和武器，每个图标统一像素艺术风格，带浅色标签。",
    author: "Game Forge",
    tags: ["game", "illustration", "3d"],
    tone: "from-amber-100 via-purple-100 to-cyan-100",
    ratio: "1:1",
    category: "游戏资产",
    useCase: "适合道具设定、图标风格探索和资产表",
  },
  {
    id: "beauty-storyboard",
    title: "护肤品广告分镜",
    prompt: "干净明亮的护肤品广告分镜图，九宫格镜头，水面、肌肤质感、瓶身特写、自然光和柔和手部动作，电影广告板。",
    author: "Brand Motion",
    tags: ["product", "poster", "portrait"],
    tone: "from-pink-100 via-white to-teal-100",
    ratio: "16:9",
    category: "广告分镜",
    useCase: "适合短片脚本、广告提案和镜头板",
  },
  {
    id: "restaurant-kit",
    title: "餐饮品牌物料套装",
    prompt: "完整餐饮品牌视觉系统展示图，包装袋、菜单、贴纸、杯套、外卖盒整齐陈列，统一色彩系统，真实摄影棚布光。",
    author: "ColaAI",
    tags: ["branding", "food", "product"],
    tone: "from-orange-100 via-red-50 to-lime-100",
    ratio: "4:3",
    category: "餐饮品牌",
    useCase: "适合餐饮开店、包装提案和品牌手册",
  },
  {
    id: "portrait-editorial",
    title: "杂志感人像封面",
    prompt: "高级杂志人像封面，人物侧脸被柔和窗光照亮，服装简洁，留白排版，标题区域干净，胶片颗粒和真实肌理。",
    author: "Portrait Lab",
    tags: ["portrait", "fashion", "poster"],
    tone: "from-zinc-100 via-rose-50 to-amber-100",
    ratio: "3:4",
    category: "人像封面",
    useCase: "适合头像升级、杂志封面和个人品牌视觉",
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
  { key: "logout", label: "退出", icon: LogOut },
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

export function shouldUseRemotePromptTemplates(loadState: PromptTemplateLoadState, stats: PromptTemplateStats, remoteCount: number) {
  return loadState === "ready" && (remoteCount > 0 || stats.public > 0);
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
    previewUrl: previewImage.thumbnail_url || previewImage.url || "",
    previewFallbackUrl: previewImage.url || undefined,
    model: template.model,
    count: template.count,
  };
}

function buildCreations(images: ManagedImage[]) {
  if (images.length === 0) {
    return fallbackCreations;
  }

  return images.slice(0, 12).map((image, index) => ({
    id: image.rel || image.url || String(index),
    title: `最近创作 ${index + 1}`,
    subtitle: image.width && image.height ? `${image.width} x ${image.height}` : "图片库",
    prompt: `复用 ${image.name.replace(/\.[^.]+$/, "") || "这张作品"} 的视觉风格继续创作。`,
    imageUrl: image.thumbnail_url || image.url,
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
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
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
      data-cola-rail-label="ColaAI"
      data-cola-effect="line-shadow-logo"
      className={cn("relative text-center font-serif font-semibold italic tracking-normal text-slate-950", className)}
    >
      <span className="sr-only">ColaAI</span>
      <span aria-hidden="true" className="relative z-10">
        Cola<span className="font-sans text-[0.78em] not-italic text-sky-500">AI</span>
      </span>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-1 text-transparent [-webkit-text-stroke:1px_rgba(15,23,42,0.22)]"
      >
        Cola<span className="font-sans text-[0.78em] not-italic">AI</span>
      </span>
    </div>
  );
}

function RovaComposer({
  prompt,
  count,
  quality,
  ratio,
  imageModel,
  publicMode,
  referenceImageName = "",
  isGenerating = false,
  sticky = false,
  onPromptChange,
  onCountChange,
  onQualityChange,
  onRatioChange,
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
  imageModel: GenerateImageModel;
  publicMode: boolean;
  referenceImageName?: string;
  isGenerating?: boolean;
  sticky?: boolean;
  onPromptChange: (prompt: string) => void;
  onCountChange: (count: number) => void;
  onQualityChange: (quality: string) => void;
  onRatioChange: (ratio: string) => void;
  onImageModelChange: (model: GenerateImageModel) => void;
  onPublicChange: (publicMode: boolean) => void;
  onReferenceFileChange?: (file: File) => void;
  onOpenPrompts: () => void;
  onGenerate: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [localReferenceName, setLocalReferenceName] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const compositionMode = quality === "智能" ? "auto" : "ratio";
  const selectedRatio = compositionMode === "auto" ? "Auto" : ratio;
  const selectedModel = imageModelOptions.find((option) => option.value === imageModel) ?? imageModelOptions[0];
  const hasReferenceName = Boolean(referenceImageName || localReferenceName);
  const modelPopover = (
    <div
      data-cola-panel="image-model-settings"
      className="absolute bottom-[62px] left-5 z-50 w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-[18px] border border-black/5 bg-white p-3 text-left shadow-[0_18px_58px_-38px_rgba(15,23,42,0.38)] max-[520px]:left-1/2 max-[520px]:-translate-x-1/2"
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
      className="absolute bottom-[62px] left-[158px] z-50 max-h-[min(420px,70dvh)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-[18px] border border-black/5 bg-white p-3 text-left shadow-[0_18px_58px_-38px_rgba(15,23,42,0.38)] max-[520px]:left-1/2 max-[520px]:-translate-x-1/2"
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
      data-cola-density="rova-compact"
      data-cola-layout="rova-selected-composer"
      data-cola-fit="rova-homepage-width"
      className={cn(
        "relative w-full max-w-[960px] overflow-visible rounded-[24px] border border-[#e8e8e8] bg-[#fcfcfc] text-left shadow-[0_10px_40px_5px_rgba(194,194,194,0.25)]",
        sticky && "shadow-[0_18px_60px_-42px_rgba(15,23,42,0.42)]",
      )}
    >
      <div data-cola-part="composer-input-panel" className="relative px-5 pt-[18px] pb-2 max-[520px]:px-4">
        <div data-cola-part="composer-input-row" className={cn("flex gap-3", sticky ? "h-[72px]" : "h-[88px]")}>
          <button
            type="button"
            data-cola-action="upload-reference"
            className="mt-0.5 grid size-11 shrink-0 place-items-center rounded-xl border border-dashed border-[#dddddd] bg-[#f5f5f5] text-[#bbbbbb] transition hover:border-[#d2d2d2] hover:bg-[#f1f1f1] hover:text-[#777777]"
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
            className="hidden"
            aria-label="选择参考图"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file?.type.startsWith("image/")) {
                if (onReferenceFileChange) {
                  onReferenceFileChange(file);
                } else {
                  setLocalReferenceName(file.name);
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
            className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-2xl bg-[#1a1a1a] px-3 text-xs font-medium text-white transition hover:bg-[#252525]"
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
              {selectedRatio} | {count}张
              <span className="sr-only">图片比例 智能 9:16 2:3 1:1 3:2 16:9 生成数量</span>
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
            data-cola-effect="shimmer-button"
            data-cola-action="submit-generation"
            className="relative inline-flex h-[37px] shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[20px] bg-[linear-gradient(180deg,#3a3a3a_0%,#1a1a1a_100%)] px-[22px] text-[13px] font-medium text-white shadow-[inset_-4px_-6px_25px_rgba(201,201,201,0.08),inset_4px_4px_10px_rgba(29,29,29,0.24)] transition hover:bg-[#222222] disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isGenerating}
            onClick={onGenerate}
          >
            <span className="absolute inset-y-[-30%] left-[-22%] w-10 rotate-12 bg-white/20" />
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
  imageModel,
  publicMode,
  referenceImage,
  isGenerating = false,
  onPromptChange,
  onCountChange,
  onQualityChange,
  onRatioChange,
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
  imageModel: GenerateImageModel;
  publicMode: boolean;
  referenceImage: ReferenceImage | null;
  isGenerating?: boolean;
  onPromptChange: (prompt: string) => void;
  onCountChange: (count: number) => void;
  onQualityChange: (quality: string) => void;
  onRatioChange: (ratio: string) => void;
  onImageModelChange: (model: GenerateImageModel) => void;
  onPublicChange: (publicMode: boolean) => void;
  onReferenceFileChange: (file: File) => void;
  onReferenceRemove: () => void;
  onOpenPrompts: () => void;
  onGenerate: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const compositionMode = quality === "智能" ? "auto" : "ratio";
  const selectedRatio = compositionMode === "auto" ? "Auto" : ratio;
  const selectedModel = imageModelOptions.find((option) => option.value === imageModel) ?? imageModelOptions[0];

  return (
    <section
      data-cola-panel="generate-composer"
      data-cola-variant="rova-large-generate"
      data-cola-density="bottom-compact"
      data-cola-design="creative-instrument-panel"
      className="relative mx-auto w-full max-w-[1164px] overflow-visible rounded-[24px] border border-teal-950/[0.08] bg-white/90 text-left shadow-[0_28px_84px_-58px_rgba(15,23,42,0.78)] ring-1 ring-white/80 backdrop-blur-2xl before:pointer-events-none before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-teal-300/70 before:to-transparent"
    >
      <div data-cola-part="generate-input-panel" className="relative px-6 pt-5 pb-3 max-[560px]:px-4 max-[560px]:pt-4">
        <div data-cola-part="generate-input-row" className="flex min-h-[116px] gap-4 max-[560px]:min-h-[128px] max-[560px]:gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="选择参考图"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file?.type.startsWith("image/")) {
                onReferenceFileChange(file);
              }
              event.currentTarget.value = "";
            }}
          />
          <div data-cola-panel="reference-material-slot" className="relative size-[60px] shrink-0 max-[560px]:size-[52px]">
            <button
              type="button"
              data-cola-action="upload-reference"
              data-cola-state={referenceImage ? "has-reference" : "empty"}
              className={cn(
                "group grid size-full place-items-center overflow-hidden rounded-[18px] border text-slate-400 transition duration-200 focus:outline-none focus:ring-4 focus:ring-teal-100/80",
                referenceImage
                  ? "border-white bg-white shadow-[0_16px_34px_-24px_rgba(15,23,42,0.62)] ring-1 ring-slate-200/80"
                  : "border-dashed border-slate-300 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(240,253,250,0.62))] hover:border-teal-300 hover:bg-teal-50/70 hover:text-teal-700",
              )}
              aria-label={referenceImage ? `更换参考图 ${referenceImage.name}` : "上传参考图"}
              onClick={() => fileInputRef.current?.click()}
            >
              {referenceImage ? (
                <AuthenticatedImage
                  src={referenceImage.previewUrl}
                  alt={referenceImage.name}
                  data-cola-panel="reference-image-preview"
                  className="h-full w-full object-cover"
                  loadingMotion="static"
                />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-white/86 shadow-[0_10px_28px_-22px_rgba(15,23,42,0.68)] ring-1 ring-slate-200/80 transition group-hover:ring-teal-200">
                  <Plus className="size-4" />
                </span>
              )}
            </button>
            {referenceImage ? (
              <span
                data-cola-panel="reference-image-name"
                className="sr-only"
              >
                {referenceImage.name}
              </span>
            ) : null}
            {referenceImage ? (
              <button
                type="button"
                data-cola-action="remove-reference"
                className="absolute -right-1.5 -top-1.5 z-10 grid size-5 place-items-center rounded-full bg-slate-950 text-white shadow-[0_6px_16px_-10px_rgba(15,23,42,0.8)] ring-2 ring-white transition hover:bg-teal-800"
                aria-label={`删除参考图 ${referenceImage.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onReferenceRemove();
                }}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          <div className="relative min-w-0 flex-1 rounded-[20px] bg-gradient-to-b from-white/20 to-white/0">
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
            {selectedRatio} | {count}张
            <span className="sr-only">图片比例 智能 9:16 2:3 1:1 3:2 16:9 生成数量</span>
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
            data-cola-effect="shimmer-button"
            data-cola-action="submit-generation"
            className="relative inline-flex h-[46px] shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full bg-[linear-gradient(135deg,#111418_0%,#0f766e_100%)] px-7 text-sm font-semibold text-white shadow-[inset_-4px_-6px_25px_rgba(255,255,255,0.07),inset_4px_4px_10px_rgba(5,46,42,0.22),0_18px_40px_-28px_rgba(15,118,110,0.82)] transition hover:-translate-y-px hover:brightness-105 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
            disabled={isGenerating}
            onClick={onGenerate}
          >
            <span className="absolute inset-y-[-30%] left-[-22%] w-10 rotate-12 bg-white/20" />
            <Send className="relative z-10 size-4" />
            <span className="relative z-10">{isGenerating ? "提交中" : "生成"}</span>
          </button>
        </div>
      </div>

      <div
        data-cola-panel="image-model-settings"
        className="absolute bottom-[84px] left-6 z-50 w-[min(392px,calc(100vw-32px))] overflow-y-auto rounded-[20px] border border-teal-950/[0.08] bg-white/96 p-4 text-left shadow-[0_24px_64px_-42px_rgba(15,23,42,0.54)] ring-1 ring-white/80 backdrop-blur-xl max-[560px]:left-1/2 max-[560px]:-translate-x-1/2"
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
        className="absolute bottom-[84px] left-[160px] z-50 max-h-[min(440px,70dvh)] w-[min(372px,calc(100vw-32px))] overflow-y-auto rounded-[20px] border border-teal-950/[0.08] bg-white/96 p-4 text-left shadow-[0_24px_64px_-42px_rgba(15,23,42,0.54)] ring-1 ring-white/80 backdrop-blur-xl max-[560px]:left-1/2 max-[560px]:-translate-x-1/2"
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
  onOpen,
  onUsePrompt,
  onCopyPrompt,
}: {
  creations: CreationItem[];
  flushTop?: boolean;
  isLoading?: boolean;
  isRefreshing?: boolean;
  onOpen: (item: CreationItem) => void;
  onUsePrompt: (prompt: string) => void;
  onCopyPrompt: (prompt: string) => void;
}) {
  const feedState = isLoading ? "loading" : isRefreshing ? "refreshing" : "idle";

  return (
    <section data-cola-panel="creation-feed" data-cola-state={feedState} className={cn(flushTop ? "mt-0" : "mt-10", "pb-12")}>
      <div className={cn(flushTop ? "mb-[28px]" : "mb-5", "text-center")}>
        <div className="inline-flex items-center justify-center gap-2">
          <h2 className="text-[28px] font-medium leading-9 tracking-normal text-[#1a1a1a]">最近创作</h2>
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
        <p className="mt-[5px] text-sm leading-5 text-[#999999]">来自你的灵感</p>
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
  role = "user",
  tasks,
  onClose,
}: {
  open: boolean;
  role?: StoredAuthSession["role"];
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
            {role === "admin" ? "管理员" : "用户"}
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

  return (
    <>
    <section
      data-cola-panel="generate-conversation-stage"
      data-cola-design="developing-studio-stage"
      data-cola-layout="conversation-results-feed"
      data-cola-state={hasConversationContent ? "content" : "empty"}
      data-cola-behavior="middle-conversation-scroll"
      className="flex min-h-0 w-full flex-1 flex-col text-left"
    >
      <div
        data-cola-panel="generate-conversation-thread"
        className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-7 overflow-hidden px-0 py-2 max-[560px]:gap-5"
      >
        {hasConversationContent ? (
          <article
            data-cola-panel="generate-record-card"
            data-cola-behavior="record-scroll-box"
            data-cola-layout="studio-creation-record-flow"
            className="mx-auto flex max-h-full min-h-0 w-full max-w-[1040px] flex-1 overflow-hidden rounded-[32px] bg-white/70 p-3 shadow-[0_24px_80px_-58px_rgba(15,23,42,0.72)] ring-1 ring-emerald-100/62 backdrop-blur-xl max-[560px]:rounded-[26px] max-[560px]:p-2"
          >
          <div
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

              <div data-cola-panel="generate-status-strip" className="inline-flex w-fit max-w-full self-start flex-wrap items-center gap-1.5 text-xs leading-none text-[#51617d]">
                <div data-cola-panel="generate-result-summary" className="flex max-w-full flex-wrap items-center gap-1.5">
                  <span className="font-medium leading-none text-slate-800">结果</span>
                  <span className="rounded-full bg-slate-100/70 px-2 py-1 leading-none">{recordRequestedCountLabel.replace(" ", "")}</span>
                  <span className="rounded-full bg-slate-100/70 px-2 py-1 leading-none">成功{recordResultCount}/失败{recordFailedCount}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 leading-none text-emerald-700">耗时 {formatDuration(recordElapsedMs)}</span>
                  <span className="rounded-full bg-white px-2 py-1 leading-none shadow-sm ring-1 ring-slate-200">等待 {formatDuration(recordWaitingMs)}</span>
                  <span className="rounded-full bg-white px-2 py-1 leading-none shadow-sm ring-1 ring-slate-200">排队 {formatDuration(recordTiming.queueMs)}</span>
                </div>
              </div>

              <div data-cola-panel="generate-result-cards" className="space-y-4">
                <div data-cola-panel="generate-result-gallery" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {recordHasGeneratedResults ? (
                    recordImages.map((image, imageIndex) => (
                      <div
                        key={image.id}
                        data-cola-panel="generate-result-card"
                        data-cola-task-id={image.taskId}
                        className="w-[min(320px,72vw)] overflow-hidden rounded-[22px] bg-white shadow-sm"
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
                      className="w-[min(320px,72vw)] shrink-0 overflow-hidden rounded-[22px] bg-white shadow-[0_22px_62px_-48px_rgba(15,23,42,0.68)]"
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
            className="flex min-h-[420px] flex-1 items-center justify-center rounded-[24px] border border-transparent bg-transparent max-[560px]:min-h-[320px]"
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
  imageModel,
  publicMode,
  referenceImage,
  isGenerating,
  stickyVisible,
  creations,
  creationFeedStatus = "idle",
  onPromptChange,
  onCountChange,
  onQualityChange,
  onRatioChange,
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
  imageModel: GenerateImageModel;
  publicMode: boolean;
  referenceImage: ReferenceImage | null;
  isGenerating: boolean;
  stickyVisible: boolean;
  creations: CreationItem[];
  creationFeedStatus?: CreationFeedStatus;
  onPromptChange: (prompt: string) => void;
  onCountChange: (count: number) => void;
  onQualityChange: (quality: string) => void;
  onRatioChange: (ratio: string) => void;
  onImageModelChange: (model: GenerateImageModel) => void;
  onPublicChange: (publicMode: boolean) => void;
  onReferenceFileChange: (file: File) => void;
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
            className="relative inline-block px-[0.06em] font-serif text-[1.25em] font-normal italic text-[#1a1a1a]"
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
            imageModel={imageModel}
            publicMode={publicMode}
            referenceImageName={referenceImage?.name}
            isGenerating={isGenerating}
            onPromptChange={onPromptChange}
            onCountChange={onCountChange}
            onQualityChange={onQualityChange}
            onRatioChange={onRatioChange}
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
            imageModel={imageModel}
            publicMode={publicMode}
            referenceImageName={referenceImage?.name}
            isGenerating={isGenerating}
            sticky
            onPromptChange={onPromptChange}
            onCountChange={onCountChange}
            onQualityChange={onQualityChange}
            onRatioChange={onRatioChange}
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
  imageModel,
  publicMode,
  referenceImage,
  isGenerating,
  submittedTasks,
  generateSessions,
  activeGenerateSessionId,
  generationError,
  focusedTaskId,
  focusedCanvasTask,
  queueUserRole = "user",
  onPromptChange,
  onCountChange,
  onQualityChange,
  onRatioChange,
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
  imageModel: GenerateImageModel;
  publicMode: boolean;
  referenceImage: ReferenceImage | null;
  isGenerating: boolean;
  submittedTasks: GenerateTask[];
  generateSessions: GenerateSession[];
  activeGenerateSessionId: string;
  generationError: string;
  focusedTaskId?: string;
  focusedCanvasTask?: GenerateTaskDiagnosticsSnapshot | null;
  queueUserRole?: StoredAuthSession["role"];
  onPromptChange: (prompt: string) => void;
  onCountChange: (count: number) => void;
  onQualityChange: (quality: string) => void;
  onRatioChange: (ratio: string) => void;
  onImageModelChange: (model: GenerateImageModel) => void;
  onPublicChange: (publicMode: boolean) => void;
  onReferenceFileChange: (file: File) => void;
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
      data-cola-behavior="drop-reference-image"
      data-cola-drop-target="image-reference"
      className="relative z-10 mx-auto flex h-dvh w-full max-w-none flex-col overflow-hidden px-4 pb-28 pt-[78px] md:pb-6 md:pl-[104px] md:pr-8 md:pt-[30px]"
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
            imageModel={imageModel}
            publicMode={publicMode}
            referenceImage={referenceImage}
            isGenerating={isGenerating}
            onPromptChange={onPromptChange}
            onCountChange={onCountChange}
            onQualityChange={onQualityChange}
            onRatioChange={onRatioChange}
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
  const useRemotePrompts = shouldUseRemotePromptTemplates(promptLoadState, promptStats, remotePromptCards.length);
  const promptSourceCards = useRemotePrompts ? remotePromptCards : promptCards;
  const promptSourceCount = promptStats.public || promptSourceCards.length;
  const activeTagLabel = activeTag === "all" ? "精选提示词" : `#${activeTag}`;
  const promptDataSourceLabel = useRemotePrompts ? "公开模板库" : "本地精选";
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
      data-cola-design="rova-prompt-library"
      className="relative z-10 mx-auto min-h-dvh w-full max-w-[1400px] px-4 pb-28 pt-14 md:pl-[104px] md:pr-8 md:pt-[84px]"
    >
      <div data-cola-effect="prompt-meteor-field" aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {[0, 1, 2, 3, 4].map((item) => (
          <span
            key={item}
            className="absolute h-px w-24 -rotate-45 bg-gradient-to-r from-transparent via-violet-300/50 to-transparent"
            style={{ left: `${12 + item * 18}%`, top: `${12 + item * 7}%` }}
          />
        ))}
      </div>
      <section className="mx-auto max-w-[1180px]">
        <div className="mx-auto max-w-[880px] text-center">
          <div
            data-cola-effect="animated-gradient-border"
            className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-transparent bg-[linear-gradient(#fff,#fff)_padding-box,linear-gradient(135deg,#a78bfa,#f472b6,#fbbf24,#60a5fa)_border-box] px-4 py-1.5 text-xs font-medium text-slate-500"
          >
            <Sparkles className="size-3.5 text-amber-400" />
            精选提示词库 · 来自 GitHub 开源社区
          </div>
          <h1 className="text-[clamp(34px,5vw,64px)] font-medium leading-[1.04] tracking-[-0.04em] text-slate-950">发现无尽创意</h1>
          <p className="mx-auto mt-4 max-w-[620px] text-base leading-7 text-slate-600">
            搜索提示词、风格或元素，复制灵感，或者一键带到生图工作台继续创作。
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-5 text-center sm:gap-8">
            <div>
              <div className="text-3xl font-semibold text-slate-950">{promptCards.length}</div>
              <div className="text-xs text-slate-400">精选提示词</div>
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
            {promptLoadState === "loading"
              ? "正在同步公开模板库"
              : promptLoadState === "error"
                ? "公开模板库暂不可用，正在使用本地精选"
                : normalizedQuery ? `搜索：${query.trim()}` : "按标题、作者、标签和提示词内容匹配"}
          </span>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visiblePromptCards.map((card, index) => (
            <article
              key={card.id}
              data-cola-card="prompt-template"
              data-cola-prompt-id={card.id}
              className="group flex min-h-[430px] flex-col rounded-[24px] border border-white/82 bg-white/72 p-3 shadow-[0_16px_50px_-44px_rgba(15,23,42,0.72)] ring-1 ring-slate-950/[0.03] backdrop-blur-xl transition hover:-translate-y-1 hover:bg-white/86 hover:shadow-[0_24px_70px_-52px_rgba(15,23,42,0.8)] active:translate-y-0"
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
                    className="flex-1 rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-black/5 transition hover:bg-slate-50 active:scale-[0.98]"
                    onClick={() => onCopyPrompt(card.prompt)}
                  >
                    复制提示词
                  </button>
                  <button
                    type="button"
                    data-cola-action="use-library-prompt"
                    className="flex-1 rounded-full bg-slate-950 px-3 py-2 text-xs font-semibold text-white shadow-[0_14px_34px_-25px_rgba(15,23,42,0.9)] transition hover:bg-slate-800 active:scale-[0.98]"
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
            className="mt-5 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-[0.98]"
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
            className="rounded-full bg-white/74 px-5 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:bg-white active:translate-y-0"
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

function AssetsWorkspace({
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
    <main data-cola-panel="assets-workspace" className="relative z-10 mx-auto min-h-dvh w-full max-w-[1400px] px-4 pb-28 pt-16 md:pl-[104px] md:pr-8 md:pt-[92px]">
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
                  <AuthenticatedImage src={image.thumbnail_url || image.url} fallbackSrc={image.url} alt={image.name} className="h-full w-full object-cover" loadingMotion="static" />
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
    <main data-cola-panel="developer-console" className="relative z-10 mx-auto min-h-dvh w-full max-w-[1400px] px-4 pb-28 pt-16 md:pl-[104px] md:pr-8 md:pt-[92px]">
      <section className="mx-auto max-w-[1180px]">
        <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">API</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-5xl">开发者控制台</h1>
            <p className="mt-3 max-w-[560px] text-sm leading-6 text-slate-500">把 ColaAI 的图片生成能力接入你的应用，查看接口调用、任务队列和密钥状态。</p>
          </div>
          <button type="button" className="w-fit rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">创建密钥</button>
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
  onLogin,
}: {
  title: string;
  message: string;
  onLogin: () => void;
}) {
  return (
    <main data-cola-panel="auth-required" className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1400px] place-items-center px-4 pb-28 pt-16 md:pl-[104px] md:pr-8 md:pt-[92px]">
      <section className="w-full max-w-[520px] rounded-[28px] border border-white/80 bg-white/78 p-6 text-center shadow-[0_24px_80px_-54px_rgba(15,23,42,0.75)]">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-950 text-white">
          <Library className="size-5" />
        </div>
        <p className="mt-5 text-sm font-medium text-slate-500">需要登录</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-slate-950">{title}</h1>
        <p className="mx-auto mt-3 max-w-[360px] text-sm leading-6 text-slate-500">{message}</p>
        <button type="button" className="mt-6 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white" onClick={onLogin}>
          去登录
        </button>
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
    <main data-cola-panel="announcement-center" className="relative z-10 mx-auto min-h-dvh w-full max-w-[1400px] px-4 pb-28 pt-16 md:pl-[104px] md:pr-8 md:pt-[92px]">
      <section className="mx-auto max-w-[980px]">
        <div className="text-center">
          <p className="text-sm font-medium text-slate-500">公告</p>
          <h1 className="mt-1 text-4xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-5xl">更新动态</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-sm leading-6 text-slate-500">关注 ColaAI 的界面、模型和工作流改进。</p>
        </div>
        <div className="mt-8 space-y-3">
          {notices.map((notice) => (
            <article key={notice.title} className="rounded-[24px] border border-white/80 bg-white/72 p-5 shadow-[0_18px_60px_-50px_rgba(15,23,42,0.72)]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-slate-950">{notice.title}</h2>
                <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{notice.time}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-500">{notice.body}</p>
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
  onOpenAnnouncement,
  onToggleLanguage,
  onNavigate,
}: {
  open: boolean;
  isPublicPreview: boolean;
  session: StoredAuthSession;
  onClose: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onOpenAnnouncement: () => void;
  onToggleLanguage: () => void;
  onNavigate: (mode: WorkbenchMode) => void;
}) {
  const actions = [
    { label: "公告", icon: Bell, onClick: onOpenAnnouncement },
    { label: "Switch to EN", icon: Languages, onClick: onToggleLanguage },
    { label: "提示词", icon: WandSparkles, onClick: () => onNavigate("prompts") },
    { label: "图片库", icon: Library, onClick: () => onNavigate("assets"), authOnly: true },
    { label: "设置", icon: Settings, onClick: () => onNavigate("settings") },
  ].filter((item) => !item.authOnly || !isPublicPreview);

  return (
    <div
      data-cola-panel="mobile-more-sheet"
      className={cn(
        "fixed inset-0 z-50 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button type="button" aria-label="关闭更多菜单" className={cn("absolute inset-0 bg-black/30 transition", open ? "opacity-100" : "opacity-0")} onClick={onClose} />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 rounded-t-[22px] bg-white p-5 shadow-[0_-20px_60px_-34px_rgba(15,23,42,0.9)] transition duration-300",
          open ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
        )}
      >
        <span className="mx-auto mb-4 block h-1 w-9 rounded-full bg-slate-200" />
        {isPublicPreview ? (
          <button type="button" className="mb-4 w-full rounded-[14px] bg-slate-950 px-4 py-3 text-sm font-semibold text-white" onClick={onLogin}>
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
            <AuthenticatedImage src={item.imageUrl} alt={item.title} className="max-h-[82dvh] w-full object-contain" loadingMotion="static" />
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
  const [mode, setMode] = useState<WorkbenchMode>(initialMode);
  const [canvasSubview, setCanvasSubview] = useState<CanvasSubview>("home");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
  const [quality, setQuality] = useState("智能");
  const [ratio, setRatio] = useState<string>("9:16");
  const [imageModel, setImageModel] = useState<GenerateImageModel>("auto");
  const [publicMode, setPublicMode] = useState(false);
  const [promptMarketOpen, setPromptMarketOpen] = useState(false);
  const [dialog, setDialog] = useState<WorkbenchDialog>(null);
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [images, setImages] = useState<ManagedImage[]>([]);
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
  const [stickyVisible, setStickyVisible] = useState(false);
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null);
  const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
  const referenceDragDepthRef = useRef(0);
  const referencePreviewUrlRef = useRef("");
  const generateConversationsRef = useRef<ImageConversation[]>([]);

  const isPublicPreview = !session.key.trim();
  const creations = useMemo(() => buildCreations(images), [images]);
  const canvasTemplates = useMemo(() => getCanvasTemplateCards(), []);
  const activeTaskIds = useMemo(
    () => submittedTasks.filter((task) => !terminalTaskStatuses.has(task.status)).map((task) => task.id),
    [submittedTasks],
  );
  const canvasHomeEntries = useMemo(() => {
    const storage = typeof window === "undefined"
      ? {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      }
      : window.localStorage;
    return getCanvasHomeEntries(storage);
  }, [activeCanvasId, canvasSubview, mode]);

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
    if (isPublicPreview) {
      setImages([]);
      setCreationFeedStatus("idle");
      return;
    }

    setCreationFeedStatus((current) => (images.length > 0 || current === "refreshing" ? "refreshing" : "loading"));
    try {
      const result = await fetchManagedImages({ page_size: 12 });
      setImages(result.items);
    } catch {
      setImages((current) => current);
    } finally {
      setCreationFeedStatus("idle");
    }
  }, [images.length, isPublicPreview]);

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

    if (isPublicPreview) {
      setImages([]);
      setCreationFeedStatus("idle");
      return () => {
        active = false;
      };
    }

    const loadImages = async () => {
      setCreationFeedStatus("loading");
      try {
        const result = await fetchManagedImages({ page_size: 12 });
        if (active) {
          setImages(result.items);
        }
      } catch {
        if (active) {
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
    const hero = document.getElementById("cola-discover-hero");
    if (!hero || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setStickyVisible(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "-80px 0px 0px 0px" },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [mode]);

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
      window.location.href = "/login";
    }
  }, []);

  const handleLogout = useCallback(() => {
    void (async () => {
      await clearStoredAuthSession();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    })();
  }, []);

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

  const handleReferenceFileChange = useCallback((file: File) => {
    const previewUrl = URL.createObjectURL(file);
    clearReferencePreviewUrl(referencePreviewUrlRef);
    referencePreviewUrlRef.current = previewUrl;
    setReferenceImage({ name: file.name, previewUrl, file });
    setMode("generate");
  }, []);

  const handleReferenceRemove = useCallback(() => {
    clearReferencePreviewUrl(referencePreviewUrlRef);
    setReferenceImage(null);
  }, []);

  const handleEditGeneratedImage = useCallback((image: GeneratedTaskImage) => {
    clearReferencePreviewUrl(referencePreviewUrlRef);
    setGenerationError("");
    setMode("generate");
    void (async () => {
      try {
        const name = getGeneratedImageFileName(image, 0);
        const file = await fetchImageFile(image.src, name);
        setReferenceImage({ name, previewUrl: image.src, file });
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
    const file = getDroppedImageFile(event.dataTransfer);
    if (!file) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    referenceDragDepthRef.current = 0;
    setIsReferenceDragActive(false);
    handleReferenceFileChange(file);
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
  }, []);

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
    const effectiveModel: ImageModel = imageModel === "codex-gpt-image-2" ? "codex-gpt-image-2" : "gpt-image-2";
    const effectiveSize = quality === "智能" ? undefined : ratio;
    const referenceFiles = referenceImage?.file ? [referenceImage.file] : undefined;
    void submitGenerateTasks(
      {
        prompt,
        count: effectiveCount,
        model: effectiveModel,
        size: effectiveSize,
        referenceFiles,
      },
      activeGenerateSessionId,
    );
    setPrompt("");
    handleReferenceRemove();
  }, [activeGenerateSessionId, count, handleReferenceRemove, imageModel, isPublicPreview, prompt, quality, ratio, referenceImage, submitGenerateTasks]);

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

  return (
    <>
      <section
        data-cola-layout="rova-like"
        data-cola-drop-scope="global-reference-image"
        data-cola-performance="paint-optimized"
        data-cola-mode={mode}
        className="relative min-h-dvh overflow-hidden bg-[#fbfdff] text-slate-950"
        onDragEnter={handleReferenceDragEnter}
        onDragOver={handleReferenceDragOver}
        onDragLeave={handleReferenceDragLeave}
        onDrop={handleReferenceDrop}
      >
        <RovaMediaBackground />
        <ReferenceDropOverlay active={isReferenceDragActive} />

        <aside
          data-cola-panel="side-nav"
          data-cola-behavior="rova-glass-rail"
          className="fixed left-4 top-[30px] z-40 hidden h-[calc(100dvh-60px)] w-[72px] flex-col items-center rounded-2xl border border-black/10 bg-white/38 py-5 shadow-[inset_0_4px_4px_rgba(255,255,255,0.26),0_8px_32px_rgba(15,23,42,0.04)] md:flex"
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
                    if (item.key === "canvas") {
                      handleOpenCanvasHome();
                      return;
                    }
                    setMode(item.key);
                  }}
                >
                  <span className={cn("grid size-9 place-items-center rounded-[14px] transition", active && "text-slate-950")}>
                    <Icon className="size-4" />
                  </span>
                  {item.label}
                </button>
              );
            })}
          </nav>

          <nav className="flex flex-col items-center gap-3">
            {lowerNavItems.map((item) => {
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
              data-cola-action="open-announcement"
              className="grid w-full place-items-center gap-1 text-[11px] font-medium text-slate-500 transition hover:text-slate-900"
              onClick={() => openDialog("announcement")}
            >
              <Bell className="size-4" />
              公告
            </button>
            <button
              type="button"
              data-cola-action="toggle-language"
              className="grid w-full place-items-center gap-1 text-[11px] font-medium text-slate-500 transition hover:text-slate-900"
              onClick={handleToggleLanguage}
            >
              <Languages className="size-4" />
              {language === "zh" ? "EN" : "中文"}
            </button>
            {isPublicPreview ? (
              <button
                type="button"
                data-cola-action="open-login"
                className="grid w-full place-items-center gap-1 text-[11px] font-medium text-slate-950 transition hover:text-slate-700"
                onClick={handleLogin}
              >
                <UserPlus className="size-4" />
                登录
              </button>
            ) : null}
          </nav>
        </aside>

        <nav
          data-cola-panel="mobile-nav"
          className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 grid grid-cols-4 rounded-2xl border border-black/10 bg-white/90 px-2 py-2 shadow-[0_18px_55px_-42px_rgba(15,23,42,0.82)] md:hidden"
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
          className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+4.65rem)] z-40 hidden grid-cols-4 gap-1 rounded-2xl border border-black/10 bg-white/82 px-2 py-2 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.75)] md:hidden"
        >
          {lowerNavItems.map((item) => {
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
          <DiscoverHome
            prompt={prompt}
            count={count}
            quality={quality}
            ratio={ratio}
            imageModel={imageModel}
            publicMode={publicMode}
            referenceImage={referenceImage}
            isGenerating={isGenerating}
            stickyVisible={stickyVisible}
            creations={creationFeedStatus === "loading" && images.length === 0 ? [] : creations}
            creationFeedStatus={creationFeedStatus}
            onPromptChange={setPrompt}
            onCountChange={setCount}
            onQualityChange={setQuality}
            onRatioChange={setRatio}
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
        )}

        {mode === "generate" && (
          <GenerateWorkspace
            prompt={prompt}
            count={count}
            quality={quality}
            ratio={ratio}
            imageModel={imageModel}
            publicMode={publicMode}
            referenceImage={referenceImage}
            isGenerating={isGenerating}
            submittedTasks={submittedTasks}
            generateSessions={generateSessions}
            activeGenerateSessionId={activeGenerateSessionId}
            generationError={generationError}
            focusedTaskId={focusedGenerateTaskId}
            focusedCanvasTask={focusedCanvasTask}
            queueUserRole={session.role}
            onPromptChange={setPrompt}
            onCountChange={setCount}
            onQualityChange={setQuality}
            onRatioChange={setRatio}
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
          <AuthRequiredPanel title="图片库" message="登录后查看图片库，管理最近生成结果和可复用素材。" onLogin={handleLogin} />
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
          <AuthRequiredPanel title="开发者控制台" message="登录后使用 API，查看密钥、任务队列和接口调用状态。" onLogin={handleLogin} />
        )}

        {mode === "developer" && !isPublicPreview && <DeveloperConsole />}

        {mode === "notice" && <AnnouncementCenter />}

        {mode === "settings" && <SettingsWorkspace />}
      </section>

      {mode === "canvas" && canvasSubview === "home" && (
        <CanvasHome
          canvases={canvasHomeEntries}
          templates={canvasTemplates}
          onOpenCanvas={handleOpenCanvasRecord}
          onCreateBlank={handleCreateBlankCanvas}
          onSelectTemplate={handleCreateTemplateCanvas}
        />
      )}

      {mode === "canvas" && canvasSubview === "editor" && (
        <CanvasWorkspace onBack={handleOpenCanvasHome} onOpenSourceTask={handleOpenCanvasSourceTask} />
      )}

      <MobileMoreSheet
        open={dialog === "more"}
        isPublicPreview={isPublicPreview}
        session={session}
        onClose={() => setDialog(null)}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onOpenAnnouncement={() => openDialog("announcement")}
        onToggleLanguage={handleToggleLanguage}
        onNavigate={(nextMode) => {
          if (nextMode === "canvas") {
            handleOpenCanvasHome();
          } else {
            setMode(nextMode);
          }
          setDialog(null);
        }}
      />

      <PromptMarketModal
        open={promptMarketOpen}
        onOpenChange={setPromptMarketOpen}
        isAdmin={session.role === "admin"}
        darkMode={false}
        onApplyTemplate={handleApplyTemplate}
      />
      <LightweightDialog
        open={dialog === "more" ? null : dialog}
        onClose={() => setDialog(null)}
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
