"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ClipboardEvent } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Bell,
  Bot,
  CheckCircle2,
  Check,
  ChevronDown,
  ClipboardList,
  Copy,
  Download,
  ImageIcon,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Menu,
  MessageCircle,
  Moon,
  Paintbrush,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  RotateCcw,
  Sparkles,
  Store,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AuthenticatedImage } from "@/components/authenticated-image";
import { ImageLightbox } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import webConfig from "@/constants/common-env";
import {
  cancelImageTask,
  createImageEditTask,
  createImageGenerationTask,
  downloadSingleImage,
  fetchManagedImages,
  fetchImageTasks,
  fetchModels,
  optimizePrompt,
  reportImageTaskTiming,
  type ImageModel,
  type ManagedImage,
  type ImageTask,
  type OpenAIModel,
} from "@/lib/api";
import { getFailureNextStep, getFriendlyErrorMessage } from "@/lib/error-messages";
import { downloadImageUrl, fetchImageFile } from "@/lib/image-fetch";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";
import {
  deleteImageConversation,
  getImageConversationStats,
  listImageConversations,
  saveImageConversation,
  saveImageConversations,
  type ImageConversation,
  type ImageConversationMode,
  type ImageTurn,
  type StoredImage,
  type StoredReferenceImage,
} from "@/store/image-conversations";
import type { StoredAuthSession } from "@/store/auth";

const ACTIVE_CONVERSATION_STORAGE_KEY = "chatgpt2api:studio_active_conversation_id";
const STUDIO_SIZE_STORAGE_KEY = "chatgpt2api:studio_last_size";
const STUDIO_COUNT_STORAGE_KEY = "chatgpt2api:studio_last_count";
const STUDIO_MODE_STORAGE_KEY = "chatgpt2api:studio_last_mode";
const STUDIO_IMAGE_MODEL_STORAGE_KEY = "chatgpt2api:studio_last_model";
const STUDIO_CHAT_MODEL_STORAGE_KEY = "chatgpt2api:studio_last_chat_model";
const STUDIO_THEME_STORAGE_KEY = "chatgpt2api:studio_theme";
const IMAGE_TASK_POLL_DELAYS_MS = [700, 1000, 1500, 2500, 4000];
const activeQueueIds = new Set<string>();
const studioTimingReportInFlight = new Set<string>();

type StudioMode = "chat" | "image";
type StudioTheme = "light" | "dark";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  model?: string;
  referenceImages?: StoredReferenceImage[];
  createdAt: string;
};

type StudioModelOption = {
  value: string;
  label: string;
  description: string;
  title?: string;
  badge?: string;
};

type StudioTaskQueueItem = {
  id: string;
  conversationId: string;
  conversationTitle: string;
  turn: ImageTurn;
  turnIndex: number;
  stats: {
    total: number;
    success: number;
    failed: number;
    loading: number;
  };
};

type ImageGenerationPhase = "understanding" | "generating" | "revealing";

const imageModelValues = new Set(["gpt-image-2", "codex-gpt-image-2"]);

function apiPath(path: string) {
  const baseUrl = webConfig.apiUrl.replace(/\/$/, "");
  return `${baseUrl}${path}`;
}

const defaultChatModelOptions: StudioModelOption[] = [
  {
    value: "auto",
    label: "Auto",
    description: "自动选择当前可用的文本对话模型。",
    title: "Auto",
    badge: "auto",
  },
];

const imageModelOptions: StudioModelOption[] = [
  {
    value: "auto",
    label: "Auto",
    description: "自动选择当前可用的官方图片模型。",
    title: "Auto",
    badge: "auto",
  },
  {
    value: "gpt-image-2",
    label: "GPT Image 2",
    description: "默认官方图片链路，适合海报、插画和通用生成。",
    title: "gpt-image-2",
    badge: "openai",
  },
  {
    value: "codex-gpt-image-2",
    label: "Codex Image",
    description: "兼容 Codex 图片模型别名，用于特殊账号池配置。",
    title: "codex-gpt-image-2",
    badge: "openai",
  },
];

function humanizeModelName(modelId: string) {
  return modelId
    .split("-")
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "gpt") return "GPT";
      if (lower === "codex") return "Codex";
      if (lower === "mini") return "Mini";
      if (lower === "image") return "Image";
      if (lower === "auto") return "Auto";
      if (lower === "review") return "Review";
      return part.slice(0, 1).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function buildChatModelOptions(models: OpenAIModel[]): StudioModelOption[] {
  const options: StudioModelOption[] = [];

  for (const model of models) {
    const id = String(model.id || "").trim();
    if (!id || imageModelValues.has(id)) {
      continue;
    }

    const ownedBy = String(model.owned_by || "").trim();
    options.push({
      value: id,
      label: id,
      title: id,
      description: humanizeModelName(id),
      badge: ownedBy || "openai",
    });
  }

  return options.length > 0 ? options : defaultChatModelOptions;
}

function clampImageCount(value: string) {
  return Math.min(8, Math.max(1, Math.floor(Number(value) || 1)));
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildConversationTitle(prompt: string) {
  const trimmed = prompt.trim();
  return trimmed.length <= 18 ? trimmed : `${trimmed.slice(0, 18)}...`;
}

function parseSseBlock(block: string) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}

function extractChatDelta(payload: string) {
  if (!payload || payload === "[DONE]") {
    return "";
  }
  const parsed = JSON.parse(payload) as {
    error?: string | { message?: string };
    choices?: Array<{
      delta?: { content?: string };
      message?: { content?: string };
    }>;
  };
  if (parsed.error) {
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error.message;
    throw new Error(message || "对话请求失败");
  }
  const choice = parsed.choices?.[0];
  return String(choice?.delta?.content ?? choice?.message?.content ?? "");
}

function chatMessagesForRequest(messages: ChatMessage[], text: string, images: StoredReferenceImage[]) {
  const history = messages
    .filter((message) => message.content.trim() && message.status !== "error")
    .map((message) => ({ role: message.role, content: message.content }));

  if (images.length === 0) {
    return [...history, { role: "user", content: text }];
  }

  return [
    ...history,
    {
      role: "user",
      content: [
        { type: "text", text },
        ...images.map((image) => ({
          type: "image_url",
          image_url: { url: image.dataUrl },
        })),
      ],
    },
  ];
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取参考图失败"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string) {
  const [header, content] = dataUrl.split(",", 2);
  const matchedMimeType = header.match(/data:(.*?);base64/)?.[1];
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mimeType || matchedMimeType || "image/png" });
}

function formatImageFileSize(size: number) {
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(2)} MB` : `${Math.ceil(size / 1024)} KB`;
}

function formatDuration(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "-";
  }
  const seconds = Math.max(0, ms) / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
}

function formatLimitValue(value?: number | null) {
  if (value == null) {
    return "不限";
  }
  return String(value);
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

function getTurnTimingStats(turn: ImageTurn) {
  const queueMs = averageDuration(
    turn.images.map((image) =>
      image.queue_duration_ms ??
      image.timings?.queue_wait_ms ??
      image.timing_ms?.queue_wait_ms ??
      image.timings?.queue ??
      image.timing_ms?.queue,
    ),
  );
  const upstreamMs = averageDuration(
    turn.images.map((image) =>
      image.duration_ms ??
      image.timings?.worker_total_ms ??
      image.timing_ms?.worker_total_ms ??
      image.timings?.image_poll_ms ??
      image.timing_ms?.image_poll_ms ??
      image.timings?.generating ??
      image.timings?.running ??
      image.timing_ms?.generating ??
      image.timing_ms?.running,
    ),
  );
  const revealMs = averageDuration(turn.images.map((image) => image.reveal_duration_ms ?? image.timings?.revealing ?? image.timing_ms?.revealing));
  return { queueMs, upstreamMs, revealMs };
}

function getTurnElapsedMs(turn: ImageTurn, nowMs: number) {
  const startedAtMs = timestampFromIso(turn.createdAt);
  if (typeof startedAtMs !== "number") {
    return undefined;
  }
  const finishedAtMs =
    turn.status === "success"
      ? averageDuration(
          turn.images.map((image) => {
            const imageFinishedAtMs = timestampFromIso(image.reveal_finished_at || image.finished_at);
            return typeof imageFinishedAtMs === "number" ? imageFinishedAtMs - startedAtMs : undefined;
          }),
        )
      : undefined;
  return Math.max(0, typeof finishedAtMs === "number" ? finishedAtMs : nowMs - startedAtMs);
}

function getTurnWaitingMs(turn: ImageTurn, nowMs: number) {
  const createdAtMs = timestampFromIso(turn.createdAt);
  if (typeof createdAtMs !== "number") {
    return undefined;
  }
  const startedAtMs = averageDuration(
    turn.images.map((image) => {
      const imageStartedAtMs = timestampFromIso(image.started_at || image.finished_at);
      return typeof imageStartedAtMs === "number" ? imageStartedAtMs - createdAtMs : undefined;
    }),
  );
  if (typeof startedAtMs === "number") {
    return Math.max(0, startedAtMs);
  }
  if (turn.status === "queued" || turn.status === "generating") {
    return Math.max(0, nowMs - createdAtMs);
  }
  return undefined;
}

function getStoredImageSrc(image: StoredImage) {
  if (image.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  return image.url || "";
}

function ImageGenerationPlaceholder({
  className,
  phase,
  index,
}: {
  className?: string;
  phase: ImageGenerationPhase;
  index: number;
}) {
  const phaseItems: Array<{ key: ImageGenerationPhase; label: string; detail: string }> = [
    { key: "understanding", label: "正在理解提示词", detail: "分析主体、风格和构图要求" },
    { key: "generating", label: "正在生图", detail: "生成画面并细化视觉细节" },
    { key: "revealing", label: "正在回显", detail: "加载图片结果并准备展示" },
  ];
  const activePhase = phaseItems.find((item) => item.key === phase) || phaseItems[0];

  return (
    <div
      aria-busy="true"
      aria-label={`${activePhase.label}，图片 ${index + 1}`}
      className={cn("image-generation-loader relative block overflow-hidden bg-stone-100 text-stone-600", `is-${phase}`, className)}
      role="img"
      title={activePhase.label}
    >
      <span className="image-generation-loader__wash" aria-hidden="true" />
      <span className="image-generation-loader__grain" aria-hidden="true" />
      <span className="image-generation-loader__tiles" aria-hidden="true">
        {Array.from({ length: 12 }, (_, tileIndex) => (
          <span key={tileIndex} style={{ "--tile-index": tileIndex } as CSSProperties} />
        ))}
      </span>
      <span className="image-generation-loader__beam" aria-hidden="true" />
      <span className="image-generation-loader__hud">
        <span className="image-generation-loader__status">
          <span className="image-generation-loader__dot" aria-hidden="true" />
          {activePhase.label}
        </span>
        <span className="image-generation-loader__detail">{activePhase.detail}</span>
        <span className="image-generation-loader__phase-list" aria-hidden="true">
          {phaseItems.map((item) => (
            <span key={item.key} className={cn(item.key === phase && "is-active")} />
          ))}
        </span>
      </span>
    </div>
  );
}

async function fetchImageAsFile(url: string, fileName: string) {
  return fetchImageFile(url, fileName);
}

async function buildReferenceImageFromStoredImage(image: StoredImage, fileName: string) {
  if (image.b64_json) {
    const dataUrl = `data:image/png;base64,${image.b64_json}`;
    return {
      referenceImage: { name: fileName, type: "image/png", dataUrl },
      file: dataUrlToFile(dataUrl, fileName, "image/png"),
    };
  }

  if (!image.url) {
    return null;
  }
  const file = await fetchImageAsFile(image.url, fileName);
  return {
    referenceImage: {
      name: file.name,
      type: file.type || "image/png",
      dataUrl: await readFileAsDataUrl(file),
    },
    file,
  };
}

function taskDataToStoredImage(image: StoredImage, task: ImageTask): StoredImage {
  const timings = task.timings || task.timing_ms;
  const timing = {
    phase: task.phase || (task.status === "running" ? "generating" : task.status),
    phase_label: task.phase_label,
    phase_updated_at: task.phase_updated_at || task.updated_at,
    timings,
    timing_ms: task.timing_ms,
    queued_at: task.queued_at,
    submitted_at: task.submitted_at,
    started_at: task.started_at,
    downloading_at: task.downloading_at,
    saving_at: task.saving_at,
    finished_at: task.finished_at,
    duration_ms: task.duration_ms,
    queue_duration_ms: task.queue_duration_ms ?? timings?.queue_wait_ms ?? timings?.queue,
    total_duration_ms: task.total_duration_ms ?? timings?.worker_total_ms ?? timings?.total,
  };
  if (task.status === "success") {
    const first = task.data?.[0];
    if (!first?.b64_json && !first?.url) {
      return { ...image, ...timing, taskId: task.id, status: "error", error: "未返回图片数据" };
    }
    return {
      ...image,
      ...timing,
      taskId: task.id,
      phase: task.phase || "completed",
      status: "success",
      b64_json: first.b64_json,
      url: first.url,
      revised_prompt: first.revised_prompt,
      reveal_started_at: image.reveal_started_at || new Date().toISOString(),
      error: undefined,
    };
  }

  if (task.status === "error" || task.status === "cancelled") {
    const fallback = task.status === "cancelled" ? "任务已取消" : "生成失败";
    return { ...image, ...timing, taskId: task.id, phase: task.phase || "error", status: "error", error: getFriendlyErrorMessage(task.error, fallback) };
  }

  return { ...image, ...timing, taskId: task.id, status: "loading", error: undefined };
}

function deriveTurnStatus(turn: ImageTurn): Pick<ImageTurn, "status" | "error"> {
  const loadingCount = turn.images.filter((image) => image.status === "loading").length;
  const failedCount = turn.images.filter((image) => image.status === "error").length;
  const successCount = turn.images.filter((image) => image.status === "success").length;
  if (loadingCount > 0) {
    return { status: turn.status === "queued" ? "queued" : "generating", error: undefined };
  }
  if (failedCount > 0) {
    return { status: "error", error: `失败 ${failedCount} 张` };
  }
  if (successCount > 0) {
    return { status: "success", error: undefined };
  }
  return { status: "queued", error: undefined };
}

function createLoadingImages(turnId: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const imageId = `${turnId}-${index}`;
    return {
      id: imageId,
      taskId: imageId,
      status: "loading" as const,
      phase: "queued",
      phase_label: "排队中",
      phase_updated_at: new Date().toISOString(),
    };
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getImageTaskPollDelay(attempt: number) {
  return IMAGE_TASK_POLL_DELAYS_MS[Math.min(attempt, IMAGE_TASK_POLL_DELAYS_MS.length - 1)];
}

function sortImageConversations(conversations: ImageConversation[]) {
  return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function pickFallbackConversationId(conversations: ImageConversation[]) {
  const activeConversation = conversations.find((conversation) =>
    conversation.turns.some((turn) => turn.status === "queued" || turn.status === "generating"),
  );
  return activeConversation?.id ?? conversations[0]?.id ?? null;
}

async function recoverConversationHistory(items: ImageConversation[]) {
  let changed = false;
  const normalized = items.map((conversation) => {
    const turns = conversation.turns.map((turn) => {
      if (turn.status !== "queued" && turn.status !== "generating") {
        return turn;
      }
      let turnChanged = false;
      const images = turn.images.map((image) => {
        if (image.status !== "loading" || image.taskId) {
          return image;
        }
        turnChanged = true;
        return { ...image, status: "error" as const, error: "页面刷新或任务中断，未找到任务 ID" };
      });
      const derived = deriveTurnStatus({ ...turn, images });
      if (!turnChanged && derived.status === turn.status && derived.error === turn.error) {
        return turn;
      }
      changed = true;
      return { ...turn, ...derived, images };
    });
    if (!turns.some((turn, index) => turn !== conversation.turns[index])) {
      return conversation;
    }
    return { ...conversation, turns, updatedAt: new Date().toISOString() };
  });

  if (changed) {
    await saveImageConversations(normalized);
  }
  return normalized;
}

function formatTaskStatus(turn: ImageTurn) {
  if (turn.status === "queued") return "排队中";
  if (turn.status === "generating") return "生成中";
  if (turn.status === "success") return "成功";
  return "失败";
}

function formatResultSummary(turn: ImageTurn) {
  const success = turn.images.filter((image) => image.status === "success").length;
  const failed = turn.images.filter((image) => image.status === "error").length;
  if (turn.status === "queued") return "等待处理";
  if (turn.status === "generating") return "正在生成";
  return `成功 ${success} / 失败 ${failed}`;
}

function getTurnImageStats(turn: ImageTurn) {
  const success = turn.images.filter((image) => image.status === "success").length;
  const failed = turn.images.filter((image) => image.status === "error").length;
  const loading = turn.images.filter((image) => image.status === "loading").length;
  return {
    total: Math.max(1, turn.count || turn.images.length || success + failed + loading || 1),
    success,
    failed,
    loading,
  };
}

function taskStatusClassName(turn: ImageTurn) {
  if (turn.status === "queued") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (turn.status === "generating") return "bg-blue-50 text-blue-700 ring-blue-100";
  if (turn.status === "success") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  return "bg-rose-50 text-rose-700 ring-rose-100";
}

async function downloadStoredImage(image: StoredImage, index: number) {
  let blob: Blob;
  if (image.b64_json) {
    const binary = atob(image.b64_json);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: "image/png" });
  } else if (image.url) {
    await downloadImageUrl(image.url, `studio-image-${index + 1}.png`);
    return;
  } else {
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `studio-image-${index + 1}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function StudioChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isError = message.status === "error";

  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? (
        <div className="mt-1 grid size-10 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white shadow-sm dark:bg-slate-100 dark:text-slate-950">
          <Bot className="size-5" />
        </div>
      ) : null}
      <div className={cn("max-w-[min(760px,86%)] space-y-2", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "whitespace-pre-wrap rounded-[24px] px-5 py-4 text-[15px] leading-7 shadow-sm",
            isUser
              ? "bg-slate-950 text-white dark:bg-blue-600"
              : isError
                ? "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200"
                : "border border-white bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100",
          )}
        >
          {message.content || (message.status === "streaming" ? "正在等待回复..." : "")}
          {message.status === "streaming" ? (
            <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-emerald-500 align-middle" />
          ) : null}
        </div>
        {isUser && message.referenceImages?.length ? (
          <div className="flex justify-end gap-2">
            {message.referenceImages.map((image, index) => (
              <div key={`${message.id}-${image.name}-${index}`} className="size-16 overflow-hidden rounded-2xl bg-slate-100 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element -- Local data URL previews are not served through Next image optimization. */}
                <img src={image.dataUrl} alt={image.name || `附件 ${index + 1}`} className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        ) : null}
        <div className={cn("px-2 text-xs text-slate-400 dark:text-slate-500", isUser ? "text-right" : "text-left")}>
          {isUser ? "你" : isError ? "请求失败" : message.status === "streaming" ? "正在回复" : "AI"} · {message.model || "auto"}
        </div>
      </div>
    </div>
  );
}

function StudioPageContent({ session }: { session: StoredAuthSession }) {
  const conversationsRef = useRef<ImageConversation[]>([]);
  const chatAbortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const paramsPanelRef = useRef<HTMLDivElement>(null);
  const paramsButtonRef = useRef<HTMLButtonElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const taskQueuePanelRef = useRef<HTMLDivElement>(null);
  const taskQueueButtonRef = useRef<HTMLButtonElement>(null);
  const taskQueueBellRef = useRef<HTMLButtonElement>(null);

  const [prompt, setPrompt] = useState("");
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [promptOptimizeDialogOpen, setPromptOptimizeDialogOpen] = useState(false);
  const [promptOptimizeOriginal, setPromptOptimizeOriginal] = useState("");
  const [promptOptimizeResult, setPromptOptimizeResult] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [imageSize, setImageSize] = useState("1:1");
  const [imageCount, setImageCount] = useState(1);
  const [compositionMode, setCompositionMode] = useState<"auto" | "ratio">("auto");
  const [studioMode, setStudioMode] = useState<StudioMode>("image");
  const [studioTheme, setStudioTheme] = useState<StudioTheme>("light");
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [chatModelOptions, setChatModelOptions] = useState<StudioModelOption[]>(defaultChatModelOptions);
  const [isLoadingChatModels, setIsLoadingChatModels] = useState(false);
  const [hasLoadedChatModels, setHasLoadedChatModels] = useState(false);
  const [selectedChatModel, setSelectedChatModel] = useState("auto");
  const [selectedImageModel, setSelectedImageModel] = useState("auto");
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [referenceImageFiles, setReferenceImageFiles] = useState<File[]>([]);
  const [referenceImages, setReferenceImages] = useState<StoredReferenceImage[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<Array<{ id: string; src: string }>>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [imageLibraryOpen, setImageLibraryOpen] = useState(false);
  const [imageLibraryItems, setImageLibraryItems] = useState<ManagedImage[]>([]);
  const [isLoadingImageLibrary, setIsLoadingImageLibrary] = useState(false);
  const [hasLoadedImageLibrary, setHasLoadedImageLibrary] = useState(false);
  const [taskQueueOpen, setTaskQueueOpen] = useState(false);
  const [revealedImageIds, setRevealedImageIds] = useState<Set<string>>(() => new Set());
  const [elapsedNowMs, setElapsedNowMs] = useState(() => Date.now());

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  const activeTaskCount = useMemo(
    () =>
      conversations.reduce((sum, conversation) => {
        const stats = getImageConversationStats(conversation);
        return sum + stats.queued + stats.running;
      }, 0),
    [conversations],
  );
  const chatHistoryCount = chatMessages.filter((message) => message.role === "user").length;
  const currentModelOptions = studioMode === "image" ? imageModelOptions : chatModelOptions;
  const currentModel = studioMode === "image" ? selectedImageModel : selectedChatModel;
  const selectedModelOption = currentModelOptions.find((option) => option.value === currentModel) ?? currentModelOptions[0];
  const isImageMode = studioMode === "image";
  const isDarkTheme = studioTheme === "dark";
  const composerPlaceholder = isImageMode ? "输入你想要生成的画面，也可直接粘贴图片" : "输入消息与AI聊天";
  const roleLabel = session.role === "admin" ? "管理员" : "普通用户";
  const displayName = session.name.trim() || roleLabel;
  const sessionLimits = session.limits ?? null;
  const dailyLimitLabel = sessionLimits
    ? `请求 ${formatLimitValue(sessionLimits.requestsPerDay)} / 图片 ${formatLimitValue(sessionLimits.imagesPerDay)}`
    : "待同步";
  const quotaLabel = sessionLimits ? formatLimitValue(sessionLimits.imagesPerDay) : "待同步";
  const concurrencyLabel = sessionLimits
    ? `${activeTaskCount}${sessionLimits.concurrency == null ? "" : ` / ${sessionLimits.concurrency}`}`
    : `${activeTaskCount} / 待同步`;
  const imageLibraryLightboxItems = useMemo(
    () =>
      imageLibraryItems.map((item) => ({
        id: item.rel || item.name,
        src: item.url,
        sizeLabel: formatImageFileSize(item.size),
        dimensions: item.width && item.height ? `${item.width} x ${item.height}` : undefined,
      })),
    [imageLibraryItems],
  );
  const taskQueueItems = useMemo<StudioTaskQueueItem[]>(
    () =>
      conversations
        .flatMap((conversation) =>
          conversation.turns
            .filter((turn) => !turn.resultsDeleted)
            .map((turn, index) => ({
              id: `${conversation.id}:${turn.id}`,
              conversationId: conversation.id,
              conversationTitle: conversation.title || turn.prompt || "未命名对话",
              turn,
              turnIndex: index,
              stats: getTurnImageStats(turn),
            })),
        )
        .sort((a, b) => b.turn.createdAt.localeCompare(a.turn.createdAt)),
    [conversations],
  );

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    const hasActiveImageTurn = conversations.some((conversation) =>
      conversation.turns.some(
        (turn) =>
          turn.status === "queued" ||
          turn.status === "generating" ||
          turn.images.some((image) => image.status === "success" && !image.reveal_finished_at),
      ),
    );
    if (!hasActiveImageTurn) {
      setElapsedNowMs(Date.now());
      return;
    }
    const interval = window.setInterval(() => setElapsedNowMs(Date.now()), 200);
    return () => window.clearInterval(interval);
  }, [conversations]);

  useEffect(() => {
    const currentSuccessKeys = new Set<string>();
    for (const conversation of conversations) {
      for (const turn of conversation.turns) {
        for (const image of turn.images) {
          const src = image.status === "success" ? getStoredImageSrc(image) : "";
          if (src) {
            currentSuccessKeys.add(`${image.id}:${src}`);
          }
        }
      }
    }

    setRevealedImageIds((current) => {
      const next = new Set([...current].filter((key) => currentSuccessKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [conversations]);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const storedSize = typeof window !== "undefined" ? window.localStorage.getItem(STUDIO_SIZE_STORAGE_KEY) : null;
        const storedCount = typeof window !== "undefined" ? window.localStorage.getItem(STUDIO_COUNT_STORAGE_KEY) : null;
        const storedMode = typeof window !== "undefined" ? window.localStorage.getItem(STUDIO_MODE_STORAGE_KEY) : null;
        const storedImageModel =
          typeof window !== "undefined" ? window.localStorage.getItem(STUDIO_IMAGE_MODEL_STORAGE_KEY) : null;
        const storedChatModel =
          typeof window !== "undefined" ? window.localStorage.getItem(STUDIO_CHAT_MODEL_STORAGE_KEY) : null;
        const storedTheme = typeof window !== "undefined" ? window.localStorage.getItem(STUDIO_THEME_STORAGE_KEY) : null;
        setImageSize(storedSize || "1:1");
        setImageCount(clampImageCount(storedCount || "1"));
        setStudioMode(storedMode === "chat" ? "chat" : "image");
        setStudioTheme(storedTheme === "dark" ? "dark" : "light");
        setSelectedImageModel(
          imageModelOptions.some((option) => option.value === storedImageModel) ? String(storedImageModel) : "auto",
        );
        setSelectedChatModel(storedChatModel ? String(storedChatModel) : "auto");

        const items = await recoverConversationHistory(await listImageConversations());
        if (cancelled) {
          return;
        }

        conversationsRef.current = items;
        setConversations(items);
        const storedConversationId =
          typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY) : null;
        setSelectedConversationId(
          storedConversationId && items.some((item) => item.id === storedConversationId)
            ? storedConversationId
            : pickFallbackConversationId(items),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "读取创作历史失败");
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadChatModels = async () => {
      setIsLoadingChatModels(true);
      try {
        const result = await fetchModels();
        if (cancelled) {
          return;
        }
        setChatModelOptions(buildChatModelOptions(result.data || []));
      } catch {
        if (!cancelled) {
          setChatModelOptions(defaultChatModelOptions);
        }
      } finally {
        if (!cancelled) {
          setHasLoadedChatModels(true);
          setIsLoadingChatModels(false);
        }
      }
    };

    void loadChatModels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedChatModels) {
      return;
    }
    if (!chatModelOptions.some((option) => option.value === selectedChatModel)) {
      setSelectedChatModel("auto");
    }
  }, [chatModelOptions, hasLoadedChatModels, selectedChatModel]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (selectedConversationId) {
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, selectedConversationId);
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STUDIO_SIZE_STORAGE_KEY, imageSize);
    }
  }, [imageSize]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STUDIO_COUNT_STORAGE_KEY, String(imageCount));
    }
  }, [imageCount]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STUDIO_MODE_STORAGE_KEY, studioMode);
    }
  }, [studioMode]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STUDIO_IMAGE_MODEL_STORAGE_KEY, selectedImageModel);
    }
  }, [selectedImageModel]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STUDIO_CHAT_MODEL_STORAGE_KEY, selectedChatModel);
    }
  }, [selectedChatModel]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STUDIO_THEME_STORAGE_KEY, studioTheme);
    }
  }, [studioTheme]);

  useEffect(() => {
    if (!isParamsOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (paramsPanelRef.current?.contains(target) || paramsButtonRef.current?.contains(target)) {
        return;
      }
      setIsParamsOpen(false);
    };

    window.document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isParamsOpen]);

  useEffect(() => {
    if (!isModelMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (modelMenuRef.current?.contains(target) || modelButtonRef.current?.contains(target)) {
        return;
      }
      setIsModelMenuOpen(false);
    };

    window.document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isModelMenuOpen]);

  useEffect(() => {
    if (!taskQueueOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        taskQueuePanelRef.current?.contains(target) ||
        taskQueueButtonRef.current?.contains(target) ||
        taskQueueBellRef.current?.contains(target)
      ) {
        return;
      }
      setTaskQueueOpen(false);
    };

    window.document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [taskQueueOpen]);

  const persistConversation = async (conversation: ImageConversation) => {
    const nextConversations = sortImageConversations([
      conversation,
      ...conversationsRef.current.filter((item) => item.id !== conversation.id),
    ]);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    await saveImageConversation(conversation);
  };

  const updateConversation = useCallback(
    async (conversationId: string, updater: (current: ImageConversation | null) => ImageConversation) => {
      const current = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
      const nextConversation = updater(current);
      const nextConversations = sortImageConversations([
        nextConversation,
        ...conversationsRef.current.filter((item) => item.id !== conversationId),
      ]);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      await saveImageConversation(nextConversation);
    },
    [],
  );

  const clearComposer = useCallback(() => {
    setPrompt("");
    setReferenceImageFiles([]);
    setReferenceImages([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const closeStudioOverlays = useCallback(() => {
    setIsModelMenuOpen(false);
    setIsParamsOpen(false);
    setTaskQueueOpen(false);
    setImageLibraryOpen(false);
    setLightboxOpen(false);
  }, []);

  const handleCreateDraft = () => {
    setSelectedConversationId(null);
    setIsSidebarOpen(false);
    closeStudioOverlays();
    if (studioMode === "chat") {
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      setIsChatStreaming(false);
      setChatMessages([]);
    }
    clearComposer();
    textareaRef.current?.focus();
  };

  const handleModeChange = (mode: StudioMode) => {
    setStudioMode(mode);
    closeStudioOverlays();
    textareaRef.current?.focus();
  };

  const loadImageLibrary = useCallback(async () => {
    setIsLoadingImageLibrary(true);
    try {
      const data = await fetchManagedImages({});
      setImageLibraryItems(data.items);
      setHasLoadedImageLibrary(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载图片库失败");
    } finally {
      setIsLoadingImageLibrary(false);
    }
  }, []);

  const openImageLibrary = () => {
    closeStudioOverlays();
    setImageLibraryOpen(true);
    if (!hasLoadedImageLibrary) {
      void loadImageLibrary();
    }
  };

  const toggleTaskQueue = () => {
    setTaskQueueOpen((open) => !open);
    setIsModelMenuOpen(false);
    setIsParamsOpen(false);
    setImageLibraryOpen(false);
    setLightboxOpen(false);
  };

  const openImageLibraryLightbox = (index: number) => {
    if (imageLibraryLightboxItems.length === 0) {
      return;
    }
    setLightboxImages(imageLibraryLightboxItems);
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const handleDownloadLibraryImage = async (item: ManagedImage) => {
    try {
      await downloadSingleImage(item.rel);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
    }
  };

  const handleCopyLibraryImageUrl = async (item: ManagedImage) => {
    try {
      await navigator.clipboard.writeText(item.url);
      toast.success("图片地址已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  const handleReferenceImageChange = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast.error("请选择图片文件");
      return;
    }

    try {
      const nextReferenceImages = await Promise.all(
        imageFiles.map(async (file) => ({
          name: file.name || "reference.png",
          type: file.type || "image/png",
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      setReferenceImageFiles((current) => [...current, ...imageFiles]);
      setReferenceImages((current) => [...current, ...nextReferenceImages]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取参考图失败");
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    void handleReferenceImageChange(Array.from(event.target.files || []));
  };

  const handleTextareaPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    void handleReferenceImageChange(imageFiles);
  };

  const runConversationQueue = useCallback(
    async (conversationId: string) => {
      if (activeQueueIds.has(conversationId)) {
        return;
      }

      const snapshot = conversationsRef.current.find((conversation) => conversation.id === conversationId);
      const activeTurn = snapshot?.turns.find(
        (turn) =>
          (turn.status === "queued" || turn.status === "generating") &&
          turn.images.some((image) => image.status === "loading"),
      );
      if (!snapshot || !activeTurn) {
        return;
      }

      activeQueueIds.add(conversationId);
      const applyTasks = async (tasks: ImageTask[]) => {
        const taskMap = new Map(tasks.map((task) => [task.id, task]));
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          const turns = conversation.turns.map((turn) => {
            if (turn.id !== activeTurn.id) {
              return turn;
            }
            const images = turn.images.map((image) => {
              const taskId = image.taskId || image.id;
              const task = taskMap.get(taskId);
              return task ? taskDataToStoredImage({ ...image, taskId }, task) : image;
            });
            return { ...turn, ...deriveTurnStatus({ ...turn, status: "generating", images }), images };
          });
          return { ...conversation, turns, updatedAt: new Date().toISOString() };
        });
      };

      try {
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === activeTurn.id
                ? {
                    ...turn,
                    status: "generating",
                    error: undefined,
                    images: turn.images.map((image) =>
                      image.status === "loading"
                        ? {
                            ...image,
                            taskId: image.taskId || image.id,
                            phase: image.phase === "queued" ? "submitting" : image.phase,
                            phase_label: image.phase === "queued" ? "提交中" : image.phase_label,
                            phase_updated_at: new Date().toISOString(),
                          }
                        : image,
                    ),
                  }
                : turn,
            ),
          };
        });

        const referenceFiles = activeTurn.referenceImages.map((image, index) =>
          dataUrlToFile(image.dataUrl, image.name || `${activeTurn.id}-${index + 1}.png`, image.type),
        );
        if (activeTurn.mode === "edit" && referenceFiles.length === 0) {
          throw new Error("未找到可用于编辑的参考图");
        }

        const pendingImages = activeTurn.images.filter((image) => image.status === "loading");
        const submitted = await Promise.all(
          pendingImages.map((image) => {
            const taskId = image.taskId || image.id;
            return activeTurn.mode === "edit"
              ? createImageEditTask(taskId, referenceFiles, activeTurn.prompt, activeTurn.model, activeTurn.size)
              : createImageGenerationTask(taskId, activeTurn.prompt, activeTurn.model, activeTurn.size);
          }),
        );
        await applyTasks(submitted);

        let pollAttempt = 0;
        while (true) {
          const latestConversation = conversationsRef.current.find((conversation) => conversation.id === conversationId);
          const latestTurn = latestConversation?.turns.find((turn) => turn.id === activeTurn.id);
          const loadingTaskIds =
            latestTurn?.images.flatMap((image) => (image.status === "loading" && image.taskId ? [image.taskId] : [])) || [];
          if (loadingTaskIds.length === 0) {
            break;
          }

          await sleep(getImageTaskPollDelay(pollAttempt));
          pollAttempt += 1;
          const taskList = await fetchImageTasks(loadingTaskIds);
          if (taskList.items.length > 0) {
            await applyTasks(taskList.items);
          }
        }
      } catch (error) {
        const message = getFriendlyErrorMessage(error, "生成图片失败");
        await updateConversation(conversationId, (current) => {
          const conversation = current ?? snapshot;
          return {
            ...conversation,
            updatedAt: new Date().toISOString(),
            turns: conversation.turns.map((turn) =>
              turn.id === activeTurn.id
                ? {
                    ...turn,
                    status: "error",
                    error: message,
                    images: turn.images.map((image) =>
                      image.status === "loading" ? { ...image, status: "error", error: message } : image,
                    ),
                  }
                : turn,
            ),
          };
        });
        toast.error(message);
      } finally {
        activeQueueIds.delete(conversationId);
      }
    },
    [updateConversation],
  );

  useEffect(() => {
    for (const conversation of conversations) {
      if (
        !activeQueueIds.has(conversation.id) &&
        conversation.turns.some(
          (turn) =>
            !turn.resultsDeleted &&
            (turn.status === "queued" || turn.status === "generating") &&
            turn.images.some((image) => image.status === "loading"),
        )
      ) {
        void runConversationQueue(conversation.id);
      }
    }
  }, [conversations, runConversationQueue]);

  const handleChatSubmit = async (trimmedPrompt: string) => {
    if (isChatStreaming) {
      return;
    }

    const now = new Date().toISOString();
    const assistantId = createId();
    const model = selectedChatModel.trim() || "auto";
    const attachedImages = referenceImages;
    const requestMessages = chatMessagesForRequest(chatMessages, trimmedPrompt, attachedImages);
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmedPrompt,
      status: "done",
      model,
      referenceImages: attachedImages,
      createdAt: now,
    };
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      model,
      createdAt: now,
    };
    const controller = new AbortController();

    chatAbortRef.current = controller;
    setChatMessages((current) => [...current, userMessage, assistantMessage]);
    clearComposer();
    setIsChatStreaming(true);

    try {
      const response = await fetch(apiPath("/v1/chat/completions"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: requestMessages,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => "");
        throw new Error(errorText || `请求失败 (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let shouldStop = false;

      while (!shouldStop) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const payload = parseSseBlock(block);
          if (!payload) {
            continue;
          }
          if (payload === "[DONE]") {
            shouldStop = true;
            await reader.cancel().catch(() => undefined);
            break;
          }
          const delta = extractChatDelta(payload);
          if (!delta) {
            continue;
          }
          assistantText += delta;
          setChatMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, content: assistantText, status: "streaming" } : message,
            ),
          );
        }
      }

      setChatMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: assistantText || message.content || "上游返回为空", status: "done" }
            : message,
        ),
      );
    } catch (error) {
      const message = getFriendlyErrorMessage(error, "对话请求失败");
      if ((error as Error).name === "AbortError") {
        setChatMessages((current) =>
          current.map((item) =>
            item.id === assistantId ? { ...item, content: item.content || "已停止生成", status: "done" } : item,
          ),
        );
      } else {
        setChatMessages((current) =>
          current.map((item) => (item.id === assistantId ? { ...item, content: message, status: "error" } : item)),
        );
        toast.error(message);
      }
    } finally {
      chatAbortRef.current = null;
      setIsChatStreaming(false);
    }
  };

  const handleOptimizePrompt = useCallback(async () => {
    const originalPrompt = prompt.trim();
    if (!isImageMode || !originalPrompt || isOptimizingPrompt) {
      return;
    }

    setIsOptimizingPrompt(true);
    setPromptOptimizeOriginal(originalPrompt);
    setPromptOptimizeResult("");
    try {
      const response = await optimizePrompt(originalPrompt);
      const optimizedPrompt = response.optimized_prompt.trim();
      if (!optimizedPrompt) {
        throw new Error("优化结果为空");
      }
      setPromptOptimizeResult(optimizedPrompt);
      setPromptOptimizeDialogOpen(true);
    } catch (error) {
      toast.error(getFriendlyErrorMessage(error, "提示词优化失败，请稍后重试"));
    } finally {
      setIsOptimizingPrompt(false);
    }
  }, [isImageMode, isOptimizingPrompt, prompt]);

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      toast.error(isImageMode ? "请输入要生成的画面" : "请输入消息");
      return;
    }

    if (!isImageMode) {
      await handleChatSubmit(trimmedPrompt);
      return;
    }

    const effectiveMode: ImageConversationMode = referenceImageFiles.length > 0 ? "edit" : "generate";
    const targetConversation = selectedConversationId
      ? conversationsRef.current.find((conversation) => conversation.id === selectedConversationId) ?? null
      : null;
    const now = new Date().toISOString();
    const conversationId = targetConversation?.id ?? createId();
    const turnId = createId();
    const effectiveCount = clampImageCount(String(imageCount));
    const effectiveSize = compositionMode === "ratio" ? imageSize : "";
    const effectiveModel: ImageModel = selectedImageModel === "codex-gpt-image-2" ? "codex-gpt-image-2" : "gpt-image-2";
    const draftTurn: ImageTurn = {
      id: turnId,
      prompt: trimmedPrompt,
      model: effectiveModel,
      mode: effectiveMode,
      referenceImages: effectiveMode === "edit" ? referenceImages : [],
      count: effectiveCount,
      size: effectiveSize,
      images: createLoadingImages(turnId, effectiveCount),
      createdAt: now,
      status: "queued",
    };

    const nextConversation: ImageConversation = targetConversation
      ? { ...targetConversation, updatedAt: now, turns: [...targetConversation.turns, draftTurn] }
      : {
          id: conversationId,
          title: buildConversationTitle(trimmedPrompt),
          createdAt: now,
          updatedAt: now,
          turns: [draftTurn],
        };

    setSelectedConversationId(conversationId);
    clearComposer();
    await persistConversation(nextConversation);
    void runConversationQueue(conversationId);
    toast.success(targetConversation ? "已发送到当前对话" : "已创建新对话");
  };

  const handleRetryTurn = useCallback(
    async (conversationId: string, turnId: string) => {
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      const sourceTurn = conversation?.turns.find((turn) => turn.id === turnId);
      if (!conversation || !sourceTurn || !sourceTurn.prompt.trim()) {
        return;
      }

      const now = new Date().toISOString();
      const nextTurnId = createId();
      const nextTurn: ImageTurn = {
        id: nextTurnId,
        prompt: sourceTurn.prompt,
        model: sourceTurn.model,
        mode: sourceTurn.mode,
        referenceImages: sourceTurn.referenceImages,
        count: Math.max(1, sourceTurn.count || sourceTurn.images.length || 1),
        size: sourceTurn.size,
        images: createLoadingImages(nextTurnId, Math.max(1, sourceTurn.count || sourceTurn.images.length || 1)),
        createdAt: now,
        status: "queued",
      };
      const nextConversation = { ...conversation, updatedAt: now, turns: [...conversation.turns, nextTurn] };
      setSelectedConversationId(conversationId);
      await persistConversation(nextConversation);
      void runConversationQueue(conversationId);
      toast.success("已重新加入任务队列");
    },
    [runConversationQueue],
  );

  const handleCancelTurn = useCallback(
    async (conversationId: string, turnId: string) => {
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      const turn = conversation?.turns.find((item) => item.id === turnId);
      const loadingTaskIds = turn?.images.flatMap((image) => (image.status === "loading" ? [image.taskId || image.id] : [])) || [];
      if (!conversation || !turn || loadingTaskIds.length === 0) {
        return;
      }

      const results = await Promise.allSettled(loadingTaskIds.map((taskId) => cancelImageTask(taskId)));
      const cancelledIds = new Set(
        results.flatMap((result, index) => (result.status === "fulfilled" ? [loadingTaskIds[index]] : [])),
      );
      await updateConversation(conversationId, (current) => {
        const source = current ?? conversation;
        return {
          ...source,
          updatedAt: new Date().toISOString(),
          turns: source.turns.map((sourceTurn) => {
            if (sourceTurn.id !== turnId) {
              return sourceTurn;
            }
            const images = sourceTurn.images.map((image) => {
              const taskId = image.taskId || image.id;
              if (image.status !== "loading" || !loadingTaskIds.includes(taskId)) {
                return image;
              }
              return {
                ...image,
                taskId,
                status: "error" as const,
                error: cancelledIds.has(taskId) ? "任务已取消" : "任务已在本地取消，服务端可能已结束",
              };
            });
            return { ...sourceTurn, ...deriveTurnStatus({ ...sourceTurn, images }), images };
          }),
        };
      });
      toast.success("已取消队列中的任务");
    },
    [updateConversation],
  );

  const openQueueItem = (item: StudioTaskQueueItem) => {
    setStudioMode("image");
    setSelectedConversationId(item.conversationId);
    setTaskQueueOpen(false);
    setIsSidebarOpen(false);
  };

  const handleContinueEdit = async (image: StoredImage) => {
    try {
      const reference = await buildReferenceImageFromStoredImage(image, `result-${Date.now()}.png`);
      if (!reference) {
        toast.error("这张结果图无法继续编辑");
        return;
      }
      setReferenceImages((current) => [...current, reference.referenceImage]);
      setReferenceImageFiles((current) => [...current, reference.file]);
      textareaRef.current?.focus();
      toast.success("已加入参考图");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取结果图失败");
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    const nextConversations = conversationsRef.current.filter((item) => item.id !== conversationId);
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    if (selectedConversationId === conversationId) {
      setSelectedConversationId(pickFallbackConversationId(nextConversations));
    }
    await deleteImageConversation(conversationId);
  };

  const openLightbox = (items: Array<{ id: string; src: string }>, index: number) => {
    if (items.length === 0) {
      return;
    }
    setLightboxImages(items);
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const canSubmit = Boolean(prompt.trim()) && (isImageMode || !isChatStreaming);
  const canOptimizePrompt = isImageMode && Boolean(prompt.trim()) && !isOptimizingPrompt;

  return (
    <>
      <section
        className={cn(
          "grid h-dvh min-h-[680px] w-full grid-cols-1 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]",
          isDarkTheme ? "dark bg-slate-950 text-slate-100" : "bg-[#f3f6fb] text-slate-950",
        )}
      >
        {isSidebarOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default bg-transparent lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="关闭历史面板"
          />
        ) : null}
        <aside
          className={cn(
            "z-40 flex min-h-0 flex-col border-r border-slate-200/80 bg-[#f6f8fc] p-4 transition dark:border-slate-800 dark:bg-slate-900/95 lg:relative lg:translate-x-0",
            isSidebarOpen
              ? "fixed inset-y-4 left-4 w-[300px] translate-x-0 rounded-[28px] shadow-2xl dark:shadow-black/40"
              : "hidden lg:flex",
          )}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-2xl bg-white text-rose-500 shadow-sm dark:bg-slate-800 dark:text-rose-300">
                <Sparkles className="size-5" />
              </div>
              <div>
                <div className="text-base font-bold tracking-tight text-slate-950 dark:text-slate-100">chatgpt2api</div>
                <div className="text-xs text-slate-400 dark:text-slate-500">普通用户创作台</div>
              </div>
            </div>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100 lg:hidden"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="关闭历史"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mb-4 grid grid-cols-[1fr_44px] gap-2">
            <button
              type="button"
              onClick={handleCreateDraft}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[24px] bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              <MessageCircle className="size-4" />
              新建对话
            </button>
            <button
              type="button"
              onClick={() => {
                if (selectedConversationId) {
                  void handleDeleteConversation(selectedConversationId);
                }
              }}
              disabled={!selectedConversationId}
              className="grid h-12 place-items-center rounded-full bg-white text-slate-500 shadow-sm transition hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-rose-300"
              aria-label="删除当前对话"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          <div className="hide-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {isLoadingHistory ? (
              <div className="flex h-24 items-center justify-center text-slate-400 dark:text-slate-500">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="rounded-2xl bg-white/70 p-4 text-sm leading-6 text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">还没有历史记录。</div>
            ) : (
              conversations.map((conversation) => {
                const active = conversation.id === selectedConversationId;
                const lastTurn = conversation.turns[conversation.turns.length - 1];
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => {
                      setSelectedConversationId(conversation.id);
                      setIsSidebarOpen(false);
                    }}
                    className="block w-full rounded-2xl text-left transition"
                  >
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-3 transition",
                        active
                          ? "bg-white/80 text-slate-950 shadow-[7px_9px_18px_-14px_rgba(15,23,42,0.55)] dark:bg-slate-800 dark:text-slate-100 dark:shadow-[7px_9px_20px_-14px_rgba(0,0,0,0.9)]"
                          : "bg-transparent text-slate-500 hover:bg-white/45 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100",
                      )}
                    >
                      <div className={cn("line-clamp-1 text-sm font-semibold", active ? "text-slate-950 dark:text-slate-100" : "text-slate-700 dark:text-slate-300")}>
                        {conversation.title || lastTurn?.prompt || "未命名对话"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                        {conversation.turns.length} 轮 · {formatConversationTime(conversation.updatedAt)}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div className="flex min-h-0 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/70 bg-[#f6f8fc]/85 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85 sm:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="grid size-10 place-items-center rounded-full bg-white text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-200 lg:hidden"
                onClick={() => setIsSidebarOpen(true)}
                aria-label="打开历史"
              >
                <Menu className="size-5" />
              </button>
              <div className="hidden rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm dark:bg-slate-800 dark:text-slate-100 sm:block">
                创作台
              </div>
              {session.role === "admin" ? (
                <Link
                  href="/dashboard"
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-3 text-sm font-medium text-slate-600 shadow-sm transition hover:text-slate-950 hover:shadow-md dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white dark:hover:shadow-black/30 sm:px-4"
                  aria-label="返回后台"
                >
                  <ArrowLeft className="size-4" />
                  <span className="hidden sm:inline">返回后台</span>
                </Link>
              ) : null}
              <button
                type="button"
                className="hidden h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-slate-500 transition hover:bg-white hover:text-slate-950 hover:shadow-sm dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 sm:inline-flex"
                onClick={openImageLibrary}
              >
                <ImageIcon className="size-4" />
                图片库
              </button>
            </div>
            <div className="relative flex items-center gap-2">
              <button
                ref={taskQueueButtonRef}
                type="button"
                className="hidden h-10 items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:text-slate-950 hover:shadow-md dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white dark:hover:shadow-black/30 sm:flex"
                onClick={toggleTaskQueue}
                aria-expanded={taskQueueOpen}
              >
                <ClipboardList className="size-4" />
                任务队列
                {activeTaskCount > 0 ? <span className="text-amber-600">{activeTaskCount}</span> : null}
              </button>
              <button
                ref={taskQueueBellRef}
                type="button"
                className="relative grid size-10 place-items-center rounded-full bg-white text-slate-600 shadow-sm transition hover:text-slate-950 hover:shadow-md dark:bg-slate-800 dark:text-slate-200 dark:hover:text-white dark:hover:shadow-black/30"
                onClick={toggleTaskQueue}
                aria-expanded={taskQueueOpen}
                aria-label="打开任务队列"
              >
                <Bell className="size-5" />
                {activeTaskCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                    {activeTaskCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className="hidden size-10 place-items-center rounded-full text-slate-500 transition hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:grid"
                onClick={() => setStudioTheme((theme) => (theme === "dark" ? "light" : "dark"))}
                aria-label={isDarkTheme ? "切换亮色模式" : "切换深色模式"}
                title={isDarkTheme ? "切换亮色模式" : "切换深色模式"}
              >
                {isDarkTheme ? <Sun className="size-5" /> : <Moon className="size-5" />}
              </button>
              <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm dark:bg-slate-800 dark:text-slate-100">
                <span className="grid size-7 place-items-center rounded-full bg-slate-950 text-xs text-white dark:bg-slate-100 dark:text-slate-950">
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{displayName}</span>
                <Moon className="size-4 text-slate-400 dark:text-slate-500" />
              </div>
              {taskQueueOpen ? (
                <div
                  ref={taskQueuePanelRef}
                  className="absolute top-[calc(100%+0.75rem)] right-0 z-50 max-h-[min(560px,calc(100dvh-5.5rem))] w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_90px_-42px_rgba(15,23,42,0.48)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_28px_90px_-42px_rgba(0,0,0,0.9)]"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                    <div>
                      <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">任务队列</div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {activeTaskCount > 0 ? `${activeTaskCount} 个处理中` : "当前无进行中任务"} · 共 {taskQueueItems.length} 条
                      </div>
                    </div>
                    <button
                      type="button"
                      className="grid size-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                      onClick={() => setTaskQueueOpen(false)}
                      aria-label="关闭任务队列"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="max-h-[min(480px,calc(100dvh-10rem))] overflow-y-auto p-2">
                    {isLoadingHistory ? (
                      <div className="flex h-40 items-center justify-center text-slate-400 dark:text-slate-500">
                        <LoaderCircle className="size-5 animate-spin" />
                      </div>
                    ) : taskQueueItems.length === 0 ? (
                      <div className="flex h-40 items-center justify-center text-center">
                        <div>
                          <div className="mx-auto mb-3 grid size-10 place-items-center rounded-[18px] bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                            <ClipboardList className="size-5" />
                          </div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">还没有任务</div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {taskQueueItems.map((item) => {
                          const finishedCount = item.stats.success + item.stats.failed;
                          const timing = getTurnTimingStats(item.turn);
                          const waitingMs = getTurnWaitingMs(item.turn, elapsedNowMs);
                          return (
                            <div key={item.id} className="rounded-[18px] border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/70">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1", taskStatusClassName(item.turn))}>
                                      {formatTaskStatus(item.turn)}
                                    </span>
                                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                      第 {item.turnIndex + 1} 轮
                                    </span>
                                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                      {item.turn.mode === "edit" ? "编辑图" : "文生图"}
                                    </span>
                                  </div>
                                  <div className="mt-2 line-clamp-1 text-sm font-semibold text-slate-950 dark:text-slate-100">
                                    {item.turn.prompt || item.conversationTitle}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 dark:text-slate-500">
                                    <span>{item.turn.model}</span>
                                    <span>{formatConversationTime(item.turn.createdAt)}</span>
                                    {item.turn.size ? <span>{item.turn.size}</span> : null}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  {item.turn.status === "queued" || item.turn.status === "generating" ? (
                                    <button
                                      type="button"
                                      className="grid size-8 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-200"
                                      onClick={() => void handleCancelTurn(item.conversationId, item.turn.id)}
                                      aria-label="取消任务"
                                      title="取消"
                                    >
                                      <X className="size-4" />
                                    </button>
                                  ) : null}
                                  {item.turn.status === "error" ? (
                                    <button
                                      type="button"
                                      className="grid size-8 place-items-center rounded-full bg-white text-rose-500 ring-1 ring-rose-100 transition hover:bg-rose-50 dark:bg-slate-800 dark:text-rose-300 dark:ring-rose-900/60 dark:hover:bg-rose-950/40"
                                      onClick={() => void handleRetryTurn(item.conversationId, item.turn.id)}
                                      aria-label="重试任务"
                                      title="重试"
                                    >
                                      <RotateCcw className="size-4" />
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="h-8 rounded-full bg-white px-3 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700"
                                    onClick={() => openQueueItem(item)}
                                  >
                                    查看
                                  </button>
                                </div>
                              </div>
                              <div className="mt-3 space-y-2">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                  <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
                                    成功 {item.stats.success}
                                  </span>
                                  <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
                                    失败 {item.stats.failed}
                                  </span>
                                  <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
                                    处理中 {item.stats.loading}
                                  </span>
                                  <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
                                    {finishedCount} / {item.stats.total}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
                                  <div className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
                                    <div className="text-slate-400 dark:text-slate-500">已等待</div>
                                    <div className="mt-0.5 font-semibold text-slate-700 dark:text-slate-200">{formatDuration(waitingMs)}</div>
                                  </div>
                                  <div className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
                                    <div className="text-slate-400 dark:text-slate-500">排队耗时</div>
                                    <div className="mt-0.5 font-semibold text-slate-700 dark:text-slate-200">{formatDuration(timing.queueMs)}</div>
                                  </div>
                                  <div className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
                                    <div className="text-slate-400 dark:text-slate-500">生成耗时</div>
                                    <div className="mt-0.5 font-semibold text-slate-700 dark:text-slate-200">{formatDuration(timing.upstreamMs)}</div>
                                  </div>
                                  <div className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
                                    <div className="text-slate-400 dark:text-slate-500">回显</div>
                                    <div className="mt-0.5 font-semibold text-slate-700 dark:text-slate-200">{formatDuration(timing.revealMs)}</div>
                                  </div>
                                </div>
                              </div>
                              {item.turn.error ? (
                                <div className="mt-2 space-y-1 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-600 dark:bg-rose-950/45 dark:text-rose-200">
                                  <div>{item.turn.error}</div>
                                  <div className="font-medium">{getFailureNextStep(item.turn.error)}</div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </header>

          <div className="border-b border-white/70 px-4 py-3 dark:border-slate-800 sm:px-8">
            <div className="mx-auto flex w-full max-w-[1060px] flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-white px-3 py-1.5 font-medium text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-300">
                我的额度：{quotaLabel}
              </span>
              <span className="rounded-full bg-white px-3 py-1.5 font-medium text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-300">
                今日限制：{dailyLimitLabel}
              </span>
              <span className="rounded-full bg-white px-3 py-1.5 font-medium text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-300">
                并发：{concurrencyLabel}
              </span>
              {!sessionLimits ? (
                <span className="rounded-full bg-amber-50 px-3 py-1.5 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                  限制信息等待后端登录响应提供
                </span>
              ) : null}
            </div>
          </div>

          <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            <div className="mx-auto flex w-full max-w-[1060px] flex-col gap-7">
              {!isImageMode ? (
                chatMessages.length > 0 ? (
                  chatMessages.map((message) => <StudioChatBubble key={message.id} message={message} />)
                ) : (
                  <div className="flex min-h-[42dvh] items-center justify-center text-center">
                    <div>
                      <div className="mx-auto mb-5 grid size-14 place-items-center rounded-[22px] bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100">
                        <MessageCircle className="size-7" />
                      </div>
                      <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-4xl">想聊什么，直接说</h1>
                      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                        当前使用 {selectedModelOption.label}，支持连续对话{referenceImages.length > 0 ? "和图片输入" : ""}。
                      </p>
                      {chatHistoryCount > 0 ? (
                        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">已有 {chatHistoryCount} 轮对话。</p>
                      ) : null}
                    </div>
                  </div>
                )
              ) : selectedConversation ? (
                selectedConversation.turns.map((turn, turnIndex) => {
                  const elapsedMs = getTurnElapsedMs(turn, elapsedNowMs);
                  const waitingMs = getTurnWaitingMs(turn, elapsedNowMs);
                  const timing = getTurnTimingStats(turn);
                  const successfulImages = turn.images.flatMap((image) => {
                    const src = image.status === "success" ? getStoredImageSrc(image) : "";
                    return src ? [{ id: image.id, src }] : [];
                  });
                  return (
                    <div key={turn.id} className="space-y-5">
                      <div className="ml-auto max-w-[760px] rounded-[24px] bg-white p-5 shadow-[0_18px_55px_-38px_rgba(15,23,42,0.5)] dark:bg-slate-900 dark:shadow-black/20">
                        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800 dark:text-slate-300">第 {turnIndex + 1} 轮</span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800 dark:text-slate-300">{turn.mode === "edit" ? "编辑图" : "文生图"}</span>
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-600 dark:bg-blue-950/45 dark:text-blue-200">官方图片工具</span>
                          <span className={cn("rounded-full px-3 py-1", turn.status === "error" ? "bg-rose-50 text-rose-600" : "bg-slate-100")}>
                            {formatTaskStatus(turn)}
                          </span>
                          <span>{formatConversationTime(turn.createdAt)}</span>
                          <div className="ml-auto flex gap-1">
                            <button
                              type="button"
                              className="grid size-8 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                              onClick={() => {
                                setPrompt(turn.prompt);
                                setImageSize(turn.size || "1:1");
                                setReferenceImages(turn.referenceImages);
                                setReferenceImageFiles(
                                  turn.referenceImages.map((image) => dataUrlToFile(image.dataUrl, image.name, image.type)),
                                );
                                textareaRef.current?.focus();
                              }}
                              aria-label="编辑这轮提示词"
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              className="grid size-8 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                              onClick={() => void handleRetryTurn(selectedConversation.id, turn.id)}
                              aria-label="重新发送"
                            >
                              <RotateCcw className="size-4" />
                            </button>
                          </div>
                        </div>
                        <div className="text-base leading-7 text-slate-900 dark:text-slate-100">{turn.prompt}</div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                          <span>生成结果</span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{turn.count || turn.images.length || 1} 张</span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">PNG</span>
                          <span className={cn("rounded-full px-3 py-1 text-xs", turn.status === "error" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500")}>
                            {formatResultSummary(turn)}
                          </span>
                          {turn.status !== "error" ? (
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-200">
                              本次耗时 {formatDuration(elapsedMs)}
                            </span>
                          ) : null}
                          <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-400">
                            已等待 {formatDuration(waitingMs)}
                          </span>
                          <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-400">
                            排队耗时 {formatDuration(timing.queueMs)}
                          </span>
                          <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-400">
                            生成耗时 {formatDuration(timing.upstreamMs)}
                          </span>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {turn.images.map((image, index) => {
                            const imageSrc = image.status === "success" ? getStoredImageSrc(image) : "";
                            if (image.status === "success" && imageSrc) {
                              const lightboxIndexForImage = successfulImages.findIndex((item) => item.id === image.id);
                              const revealKey = `${image.id}:${imageSrc}`;
                              const isRevealed = revealedImageIds.has(revealKey);
                              return (
                                <div key={image.id} className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                  <button
                                    type="button"
                                    className="relative block aspect-square w-full cursor-zoom-in overflow-hidden bg-slate-100 dark:bg-slate-800"
                                    onClick={() => openLightbox(successfulImages, lightboxIndexForImage)}
                                  >
                                    {!isRevealed ? (
                                      <ImageGenerationPlaceholder
                                        index={index}
                                        phase="revealing"
                                        className="absolute inset-0 rounded-none border-0 shadow-none"
                                      />
                                    ) : null}
                                    <AuthenticatedImage
                                      src={imageSrc}
                                      alt={`生成结果 ${index + 1}`}
                                      className={cn(
                                        "h-full w-full object-cover transition duration-300 hover:scale-[1.02]",
                                        isRevealed ? "opacity-100" : "opacity-0",
                                      )}
                                      onLoad={() => {
                                        const now = new Date();
                                        const reportKey = "reveal_duration_ms";
                                        const revealStartedAt = image.reveal_started_at || image.finished_at || now.toISOString();
                                        const revealStartMs = revealStartedAt ? new Date(revealStartedAt).getTime() : Number.NaN;
                                        const revealDurationMs = Number.isFinite(revealStartMs) ? Math.max(0, now.getTime() - revealStartMs) : undefined;
                                        const taskId = image.taskId;
                                        const shouldReportTiming =
                                          Boolean(taskId) &&
                                          typeof revealDurationMs === "number" &&
                                          !image.reported_timings?.[reportKey];
                                        setRevealedImageIds((current) => {
                                          if (current.has(revealKey)) {
                                            return current;
                                          }
                                          const next = new Set(current);
                                          next.add(revealKey);
                                          return next;
                                        });
                                        if (!image.reveal_finished_at) {
                                          void updateConversation(selectedConversation.id, (current) => {
                                            const source = current ?? selectedConversation;
                                            return {
                                              ...source,
                                              updatedAt: new Date().toISOString(),
                                              turns: source.turns.map((sourceTurn) => {
                                                if (sourceTurn.id !== turn.id) {
                                                  return sourceTurn;
                                                }
                                                return {
                                                  ...sourceTurn,
                                                  images: sourceTurn.images.map((sourceImage) => {
                                                    if (sourceImage.id !== image.id) {
                                                      return sourceImage;
                                                    }
                                                    return {
                                                      ...sourceImage,
                                                      reveal_started_at: sourceImage.reveal_started_at || sourceImage.finished_at || now.toISOString(),
                                                      reveal_finished_at: now.toISOString(),
                                                      reveal_duration_ms: revealDurationMs,
                                                    };
                                                  }),
                                                };
                                              }),
                                            };
                                          });
                                        }
                                        if (!taskId || typeof revealDurationMs !== "number" || !shouldReportTiming) {
                                          return;
                                        }
                                        const inFlightKey = `${taskId}:${reportKey}`;
                                        if (studioTimingReportInFlight.has(inFlightKey)) {
                                          return;
                                        }
                                        studioTimingReportInFlight.add(inFlightKey);
                                        void (async () => {
                                          try {
                                            await reportImageTaskTiming(taskId, {
                                              timing_key: reportKey,
                                              duration_ms: Math.round(revealDurationMs),
                                            });
                                            await updateConversation(selectedConversation.id, (current) => {
                                              const source = current ?? selectedConversation;
                                              return {
                                                ...source,
                                                turns: source.turns.map((sourceTurn) => {
                                                  if (sourceTurn.id !== turn.id) {
                                                    return sourceTurn;
                                                  }
                                                  return {
                                                    ...sourceTurn,
                                                    images: sourceTurn.images.map((sourceImage) =>
                                                      sourceImage.id === image.id
                                                        ? {
                                                            ...sourceImage,
                                                            reported_timings: {
                                                              ...sourceImage.reported_timings,
                                                              [reportKey]: true,
                                                            },
                                                          }
                                                        : sourceImage,
                                                    ),
                                                  };
                                                }),
                                              };
                                            });
                                          } catch {
                                            // Timing reports are best-effort; keep the local reveal duration for display.
                                          } finally {
                                            studioTimingReportInFlight.delete(inFlightKey);
                                          }
                                        })();
                                      }}
                                    />
                                  </button>
                                  <div className="flex items-center justify-between gap-2 p-3">
                                    <span className="text-xs text-slate-500 dark:text-slate-400">结果 {index + 1}</span>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 rounded-full border-slate-200 bg-white text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                        onClick={() => void handleContinueEdit(image)}
                                      >
                                        <Paintbrush className="size-3.5" />
                                        编辑
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 rounded-full border-slate-200 bg-white text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                        onClick={() => void downloadStoredImage(image, index)}
                                      >
                                        下载
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            if (image.status === "error") {
                              return (
                                <div key={image.id} className="flex aspect-square flex-col items-center justify-center gap-4 rounded-[18px] border border-rose-200 bg-rose-50 px-6 text-center text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-200">
                                  <div>
                                    <div className="text-sm leading-6">{image.error || "生成失败"}</div>
                                    <div className="mt-2 text-xs leading-5 text-rose-500 dark:text-rose-200/80">
                                      {getFailureNextStep(image.error || "生成失败")}
                                    </div>
                                  </div>
                                  <Button
                                    variant="outline"
                                    className="rounded-full border-rose-200 bg-white text-rose-600 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-200 dark:hover:bg-rose-950/50"
                                    onClick={() => void handleRetryTurn(selectedConversation.id, turn.id)}
                                  >
                                    <RotateCcw className="size-4" />
                                    重试
                                  </Button>
                                </div>
                              );
                            }

                            return (
                              <ImageGenerationPlaceholder
                                key={image.id}
                                index={index}
                                phase={turn.status === "queued" ? "understanding" : "generating"}
                                className="aspect-square rounded-[18px] border border-slate-200 shadow-sm dark:border-slate-800"
                              />
                            );
                          })}
                        </div>

                        {turn.error ? (
                          <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                            <div>{turn.error}</div>
                            <div className="mt-1 font-medium">{getFailureNextStep(turn.error)}</div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex min-h-[42dvh] items-center justify-center text-center">
                  <div>
                    <div className="mx-auto mb-5 grid size-14 place-items-center rounded-[22px] bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-100">
                      <Bot className="size-7" />
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100 sm:text-4xl">想画什么，直接说</h1>
                    <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">支持文字生成图片，也可以粘贴或上传参考图继续编辑。</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 px-4 pb-5 sm:px-8">
            <div className="mx-auto max-w-[980px] overflow-visible rounded-[26px] border border-white bg-white shadow-[0_22px_80px_-42px_rgba(15,23,42,0.55)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_22px_80px_-42px_rgba(0,0,0,0.8)]">
              <div className="mx-auto mt-2 h-1 w-12 rounded-full bg-slate-300 dark:bg-slate-700" />
              {referenceImages.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto px-5 pt-4">
                  {referenceImages.map((image, index) => (
                    <div key={`${image.name}-${index}`} className="relative size-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800">
                      {/* eslint-disable-next-line @next/next/no-img-element -- Local data URL previews are not served through Next image optimization. */}
                      <img src={image.dataUrl} alt={image.name || `参考图 ${index + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-white/90 text-slate-500 shadow-sm dark:bg-slate-950/90 dark:text-slate-300"
                        onClick={() => {
                          setReferenceImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
                          setReferenceImageFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
                        }}
                        aria-label="移除参考图"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onPaste={handleTextareaPaste}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder={composerPlaceholder}
                className="min-h-[116px] w-full resize-none bg-transparent px-5 py-4 text-[15px] leading-7 text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500 sm:min-h-[132px] sm:px-7"
              />
              <div className="relative flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-7">
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInputChange} />
                <div className="hide-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                  <div className="inline-flex h-12 shrink-0 items-center rounded-full bg-slate-100 p-1 shadow-inner shadow-slate-200/60 dark:bg-slate-950 dark:shadow-black/30">
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm transition hover:text-slate-950",
                        studioMode === "chat"
                          ? "bg-white font-semibold text-slate-950 shadow-[0_6px_18px_-12px_rgba(15,23,42,0.5)] ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"
                          : "font-medium text-slate-500 hover:bg-white/55 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100",
                      )}
                      onClick={() => handleModeChange("chat")}
                      aria-pressed={studioMode === "chat"}
                    >
                      <MessageCircle className="size-4" />
                      对话
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm transition hover:text-slate-950",
                        studioMode === "image"
                          ? "bg-white font-semibold text-slate-950 shadow-[0_6px_18px_-12px_rgba(15,23,42,0.5)] ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"
                          : "font-medium text-slate-500 hover:bg-white/55 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100",
                      )}
                      onClick={() => handleModeChange("image")}
                      aria-pressed={studioMode === "image"}
                    >
                      <ImageIcon className="size-4" />
                      作画
                    </button>
                  </div>
                  <button
                    ref={modelButtonRef}
                    type="button"
                    className={cn(
                      "inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium ring-1 transition",
                      isModelMenuOpen
                        ? "text-slate-950 ring-blue-200 shadow-[0_10px_28px_-22px_rgba(15,23,42,0.65)] dark:bg-slate-800 dark:text-slate-100 dark:ring-blue-500/50"
                        : "text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-950 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700 dark:hover:text-white",
                    )}
                    onClick={() => {
                      setIsModelMenuOpen((open) => !open);
                      setIsParamsOpen(false);
                    }}
                    aria-expanded={isModelMenuOpen}
                  >
                    {isImageMode ? <ImageIcon className="size-4" /> : <MessageCircle className="size-4" />}
                    <span className="max-w-[180px] truncate">模型 {selectedModelOption.label}</span>
                    <ChevronDown className={cn("size-4 text-slate-400 transition dark:text-slate-500", isModelMenuOpen && "rotate-180")} />
                  </button>
                </div>
                {isModelMenuOpen ? (
                  <div
                    ref={modelMenuRef}
                    className="absolute bottom-[calc(100%+0.75rem)] left-4 z-30 max-h-[min(420px,60dvh)] w-[min(360px,calc(100vw-2rem))] overflow-y-auto rounded-[24px] border border-slate-200 bg-white p-2 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_28px_90px_-42px_rgba(0,0,0,0.9)] sm:left-[252px]"
                  >
                    {!isImageMode && isLoadingChatModels ? (
                      <div className="flex items-center gap-3 rounded-[18px] px-3 py-3 text-sm text-slate-500 dark:text-slate-400">
                        <LoaderCircle className="size-4 animate-spin" />
                        正在读取当前可用模型
                      </div>
                    ) : null}
                    {currentModelOptions.map((option) => {
                      const active = option.value === currentModel;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={cn(
                            "flex w-full items-start gap-3 rounded-[18px] px-3 py-3 text-left transition hover:bg-slate-50",
                            "dark:hover:bg-slate-800/80",
                            active && "bg-blue-50/70 dark:bg-blue-950/35",
                          )}
                          onClick={() => {
                            if (isImageMode) {
                              setSelectedImageModel(option.value);
                            } else {
                              setSelectedChatModel(option.value);
                            }
                            setIsModelMenuOpen(false);
                          }}
                        >
                          <div className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", active ? "bg-blue-100 text-blue-700 dark:bg-blue-900/70 dark:text-blue-200" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
                            {isImageMode ? <ImageIcon className="size-4" /> : <MessageCircle className="size-4" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <span className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{option.title ?? option.label}</span>
                                {option.description ? (
                                  <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">{option.description}</span>
                                ) : null}
                              </div>
                              {active ? <Check className="size-4 shrink-0 text-blue-600" /> : null}
                            </div>
                            {option.badge ? (
                              <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                {option.badge}
                              </div>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {isImageMode && isParamsOpen ? (
                  <div
                    ref={paramsPanelRef}
                    className="absolute bottom-[calc(100%+0.75rem)] right-4 z-30 max-h-[min(520px,68dvh)] w-[min(640px,calc(100vw-2rem))] overflow-y-auto rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_28px_90px_-42px_rgba(0,0,0,0.9)] sm:right-7 sm:p-5"
                  >
                    <div className="rounded-[20px] border border-blue-100 bg-blue-50/70 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-950/35">
                      <div className="font-semibold text-slate-950 dark:text-slate-100">官方图片工具</div>
                      <div className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        默认使用 gpt-image-2；比例只作为提示词构图偏好，实际像素由官方返回决定。
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="flex h-14 items-center justify-between rounded-[18px] border border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950/60">
                        <span className="text-sm text-slate-500 dark:text-slate-400">张数</span>
                        <input
                          type="number"
                          min="1"
                          max="8"
                          value={imageCount}
                          onChange={(event) => setImageCount(clampImageCount(event.target.value))}
                          className="w-16 bg-transparent text-right text-lg font-semibold text-slate-950 outline-none dark:text-slate-100"
                        />
                      </label>
                      <div className="flex h-14 items-center justify-between rounded-[18px] border border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950/60">
                        <span className="text-sm text-slate-500 dark:text-slate-400">构图</span>
                        <span className="text-lg font-semibold text-slate-950 dark:text-slate-100">{compositionMode === "auto" ? "Auto" : imageSize}</span>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-[22px] border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-950/60">
                      <button
                        type="button"
                        className={cn(
                          "h-11 rounded-[18px] text-sm font-semibold transition",
                          compositionMode === "auto" ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950" : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                        )}
                        onClick={() => setCompositionMode("auto")}
                      >
                        Auto
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "h-11 rounded-[18px] text-sm font-semibold transition",
                          compositionMode === "ratio" ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950" : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                        )}
                        onClick={() => setCompositionMode("ratio")}
                      >
                        按比例
                      </button>
                    </div>

                    {compositionMode === "ratio" ? (
                      <div className="mt-3 grid grid-cols-5 gap-2">
                        {["1:1", "16:9", "4:3", "3:4", "9:16"].map((size) => (
                          <button
                            key={size}
                            type="button"
                            className={cn(
                              "h-10 rounded-full text-sm font-semibold ring-1 transition",
                              imageSize === size
                                ? "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:ring-blue-700"
                                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 dark:bg-slate-950/60 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800",
                            )}
                            onClick={() => setImageSize(size)}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 rounded-[18px] bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800 dark:bg-sky-950/35 dark:text-sky-200">
                      官方链路只会把比例写入提示词作为构图偏好，不会下发 1080P / 2K / 4K 或质量参数。
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="flex h-14 items-center justify-between rounded-[18px] border border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950/60">
                        <span className="text-sm text-slate-500 dark:text-slate-400">格式</span>
                        <span className="text-lg font-semibold text-slate-950 dark:text-slate-100">PNG</span>
                      </div>
                      <div className="flex h-14 items-center justify-between rounded-[18px] border border-slate-200 bg-white px-4 text-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-600">
                        <span className="text-sm">压缩率</span>
                        <span className="text-lg font-semibold">N/A</span>
                      </div>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-400 dark:text-slate-500">
                      当前任务接口返回 PNG 结果；结果卡会显示实际保存后的格式、尺寸和文件大小。
                    </p>
                  </div>
                ) : null}
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-950 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700 dark:hover:text-white max-[520px]:px-3"
                  >
                    <Store className="size-4" />
                    <span className="hidden sm:inline">市场</span>
                  </button>
                  {isImageMode ? (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium ring-1 transition max-[520px]:px-3",
                        canOptimizePrompt
                          ? "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
                          : "cursor-not-allowed bg-slate-50 text-slate-300 ring-slate-200 dark:bg-slate-900 dark:text-slate-600 dark:ring-slate-800",
                      )}
                      onClick={() => void handleOptimizePrompt()}
                      disabled={!canOptimizePrompt}
                      aria-label="优化提示词"
                      title={prompt.trim() ? "优化当前提示词" : "请输入提示词后再优化"}
                    >
                      {isOptimizingPrompt ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                      <span className="hidden sm:inline">{isOptimizingPrompt ? "优化中" : "优化"}</span>
                    </button>
                  ) : null}
                  {isImageMode ? (
                    <button
                      ref={paramsButtonRef}
                      type="button"
                      className={cn(
                        "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium ring-1 transition max-[520px]:px-3",
                        isParamsOpen
                          ? "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:ring-blue-700"
                          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700 dark:hover:text-white",
                      )}
                      onClick={() => {
                        setIsParamsOpen((open) => !open);
                        setIsModelMenuOpen(false);
                      }}
                      aria-expanded={isParamsOpen}
                    >
                      <SlidersHorizontal className="size-4" />
                      <span className="hidden sm:inline">参数</span>
                    </button>
                  ) : null}
                  {isChatStreaming ? (
                    <div className="hidden h-10 shrink-0 items-center gap-2 rounded-full bg-amber-50 px-4 text-sm font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-200 sm:inline-flex">
                      <LoaderCircle className="size-4 animate-spin" />
                      回复中
                    </div>
                  ) : activeTaskCount > 0 ? (
                    <div className="hidden h-10 shrink-0 items-center gap-2 rounded-full bg-amber-50 px-4 text-sm font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-200 sm:inline-flex">
                      <LoaderCircle className="size-4 animate-spin" />
                      {activeTaskCount} 个任务
                    </div>
                  ) : (
                    <div className="hidden h-10 shrink-0 items-center gap-2 rounded-full bg-emerald-50 px-4 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200 sm:inline-flex">
                      <CheckCircle2 className="size-4" />
                      {isImageMode ? "可生成" : "可对话"}
                    </div>
                  )}
                  <button
                    type="button"
                    className="grid size-12 place-items-center rounded-full bg-white text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-950 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="上传图片"
                    title="上传图片"
                  >
                    <ImagePlus className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit}
                    className="grid size-12 place-items-center rounded-full bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
                    aria-label="发送"
                  >
                    <ArrowUp className="size-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />
      <Dialog open={promptOptimizeDialogOpen} onOpenChange={setPromptOptimizeDialogOpen}>
        <DialogContent
          className={cn(
            "w-[min(94vw,760px)] gap-0 overflow-hidden rounded-[28px] p-0",
            isDarkTheme ? "border-slate-800 bg-slate-950 text-slate-100" : "border-white/80 bg-white",
          )}
        >
          <DialogHeader className={cn("border-b px-6 py-5", isDarkTheme ? "border-slate-800" : "border-slate-100")}>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="size-5 text-blue-500" />
              提示词优化结果
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div>
              <div className={cn("mb-2 text-sm font-semibold", isDarkTheme ? "text-slate-200" : "text-slate-700")}>原始提示词</div>
              <div className={cn("max-h-36 overflow-y-auto rounded-2xl p-4 text-sm leading-6", isDarkTheme ? "bg-slate-900 text-slate-300" : "bg-slate-50 text-slate-600")}>
                {promptOptimizeOriginal}
              </div>
            </div>
            <div>
              <div className={cn("mb-2 text-sm font-semibold", isDarkTheme ? "text-slate-200" : "text-slate-700")}>优化结果</div>
              <div className={cn("max-h-56 overflow-y-auto rounded-2xl border p-4 text-sm leading-6", isDarkTheme ? "border-blue-900/50 bg-blue-950/30 text-slate-100" : "border-blue-100 bg-blue-50/60 text-slate-800")}>
                {promptOptimizeResult}
              </div>
            </div>
          </div>
          <div className={cn("flex flex-wrap justify-end gap-2 border-t px-6 py-4", isDarkTheme ? "border-slate-800" : "border-slate-100")}>
            <Button
              type="button"
              variant="outline"
              className={cn("rounded-full", isDarkTheme ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-600")}
              onClick={() => {
                void navigator.clipboard.writeText(promptOptimizeResult).then(
                  () => toast.success("已复制优化结果"),
                  () => toast.error("复制失败，请手动复制"),
                );
              }}
            >
              <Copy className="size-4" />
              复制
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn("rounded-full", isDarkTheme ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-600")}
              onClick={() => setPromptOptimizeDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              className="rounded-full"
              onClick={() => {
                setPrompt(promptOptimizeResult);
                setPromptOptimizeDialogOpen(false);
                window.requestAnimationFrame(() => textareaRef.current?.focus());
              }}
            >
              使用优化结果
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={imageLibraryOpen} onOpenChange={setImageLibraryOpen}>
        <DialogContent
          className={cn(
            "flex h-[min(88dvh,760px)] w-[min(94vw,1040px)] flex-col gap-0 overflow-hidden rounded-[28px] p-0",
            isDarkTheme ? "border-slate-800 bg-slate-950 text-slate-100" : "border-white/80 bg-[#f7f9fc]",
          )}
        >
          <DialogHeader
            className={cn(
              "shrink-0 border-b px-5 py-4 sm:px-6",
              isDarkTheme ? "border-slate-800 bg-slate-900/80" : "border-slate-200/70 bg-white/80",
            )}
          >
            <div className="flex items-center justify-between gap-4 pr-10">
              <div>
                <DialogTitle className={cn("text-lg", isDarkTheme ? "text-slate-100" : "text-slate-950")}>图片库</DialogTitle>
                <div className={cn("mt-1 text-sm", isDarkTheme ? "text-slate-400" : "text-slate-500")}>
                  共 {imageLibraryItems.length} 张图片
                </div>
              </div>
              <Button
                variant="outline"
                className={cn(
                  "h-9 rounded-full px-3",
                  isDarkTheme ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-slate-200 bg-white text-slate-600",
                )}
                onClick={() => void loadImageLibrary()}
                disabled={isLoadingImageLibrary}
              >
                <RefreshCw className={cn("size-4", isLoadingImageLibrary && "animate-spin")} />
                刷新
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {isLoadingImageLibrary ? (
              <div className={cn("flex h-full min-h-[320px] items-center justify-center", isDarkTheme ? "text-slate-500" : "text-slate-400")}>
                <LoaderCircle className="size-6 animate-spin" />
              </div>
            ) : imageLibraryItems.length === 0 ? (
              <div className="flex h-full min-h-[320px] items-center justify-center text-center">
                <div>
                  <div className={cn("mx-auto mb-4 grid size-12 place-items-center rounded-[20px] shadow-sm", isDarkTheme ? "bg-slate-900 text-slate-500" : "bg-white text-slate-400")}>
                    <ImageIcon className="size-6" />
                  </div>
                  <div className={cn("text-sm", isDarkTheme ? "text-slate-400" : "text-slate-500")}>还没有图片</div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {imageLibraryItems.map((item, index) => (
                  <div
                    key={item.rel || item.url}
                    className={cn(
                      "group overflow-hidden rounded-[20px] border shadow-sm",
                      isDarkTheme ? "border-slate-800 bg-slate-900" : "border-slate-200/70 bg-white",
                    )}
                  >
                    <button
                      type="button"
                      className={cn("relative block aspect-square w-full overflow-hidden text-left", isDarkTheme ? "bg-slate-800" : "bg-slate-100")}
                      onClick={() => openImageLibraryLightbox(index)}
                    >
                      <AuthenticatedImage
                        src={item.thumbnail_url || item.url}
                        fallbackSrc={item.url}
                        alt={item.name}
                        className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                      />
                      <span className="absolute right-2 bottom-2 grid size-8 place-items-center rounded-full bg-black/45 text-white opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                        <Maximize2 className="size-4" />
                      </span>
                    </button>
                    <div className="space-y-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className={cn("truncate text-sm font-medium", isDarkTheme ? "text-slate-100" : "text-slate-800")}>{item.name}</div>
                          <div className={cn("mt-0.5 text-xs", isDarkTheme ? "text-slate-500" : "text-slate-400")}>{item.created_at}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className={cn(
                              "grid size-8 place-items-center rounded-full transition",
                              isDarkTheme ? "text-slate-500 hover:bg-slate-800 hover:text-slate-100" : "text-slate-400 hover:bg-slate-100 hover:text-slate-800",
                            )}
                            onClick={() => void handleCopyLibraryImageUrl(item)}
                            aria-label="复制图片地址"
                            title="复制图片地址"
                          >
                            <Copy className="size-4" />
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "grid size-8 place-items-center rounded-full transition",
                              isDarkTheme ? "text-slate-500 hover:bg-slate-800 hover:text-slate-100" : "text-slate-400 hover:bg-slate-100 hover:text-slate-800",
                            )}
                            onClick={() => void handleDownloadLibraryImage(item)}
                            aria-label="下载图片"
                            title="下载图片"
                          >
                            <Download className="size-4" />
                          </button>
                        </div>
                      </div>
                      <div className={cn("flex items-center justify-between gap-2 text-xs", isDarkTheme ? "text-slate-500" : "text-slate-400")}>
                        <span>{formatImageFileSize(item.size)}</span>
                        <span>{item.width && item.height ? `${item.width} x ${item.height}` : "-"}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function StudioPage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <StudioPageContent session={session} />;
}
