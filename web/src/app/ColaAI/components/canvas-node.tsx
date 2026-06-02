"use client";

import { memo, useEffect, useRef, useState, type SyntheticEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUp, Boxes, ChevronDown, Eye, ImageIcon, ImagePlus, Info, Languages, MessageSquareText, Play, RefreshCw, Settings2, Sparkles, Type, Video, Zap } from "lucide-react";

import { AuthenticatedImage } from "@/components/authenticated-image";
import { cn } from "@/lib/utils";
import { areCanvasNodePropsEqual } from "./canvas-render-guards";
import type { CanvasNodeData } from "./canvas-types";
import type { CanvasReferenceImage, CanvasUpstreamSummary } from "./canvas-workflow";
import { configNodeHeight, configNodeWidth, type CanvasConfigPatch } from "./use-canvas-store";

const nodeIcons = {
  text: Type,
  image: ImagePlus,
  video: Video,
  config: Boxes,
  generation: Sparkles,
};

const nodeIconToneClasses = {
  text: "bg-slate-950 text-white",
  image: "bg-violet-50 text-violet-700 ring-1 ring-violet-100",
  video: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  config: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100",
  generation: "bg-slate-950 text-white",
};

const nodeStatusLabels = {
  idle: "",
  loading: "生成中",
  success: "已完成",
  error: "生成失败",
};

const textNodePlaceholder = "双击编辑创意提示词。";
const imageNodeUploadHint = "双击上传图片";
const imageNodeReferenceHint = "参考图会跟随画布链路进入继续生成";
const configModeItems = [
  { label: "生图", Icon: ImageIcon, active: true },
  { label: "文本", Icon: MessageSquareText, active: false },
  { label: "视频", Icon: Video, active: false },
] as const;
const configModelOptions = [
  { value: "auto", title: "Auto", description: "自动选择当前可用的官方图片模型。", badge: "auto" },
  { value: "gpt-image-2", title: "gpt-image-2", description: "默认官方图片链路，适合海报、插画和通用生成。", badge: "openai" },
  { value: "codex-gpt-image-2", title: "codex-gpt-image-2", description: "兼容 Codex 图片模型别名，用于特殊账号池配置。", badge: "openai" },
] as const;
const imageOptionItems = [
  { value: "panorama", label: "全景", badge: "NEW" },
  { value: "multiAngle", label: "多角度" },
  { value: "lighting", label: "打光" },
  { value: "grid", label: "九宫格" },
  { value: "upscale", label: "高清" },
  { value: "slice", label: "宫格切分" },
] as const;
const configRatioOptions = ["9:16", "2:3", "1:1", "3:2", "16:9"] as const;
const configCountOptions = [1, 2, 3, 4] as const;
const textPromptModelOptions = ["gpt-5.5", "gpt-5.4"] as const;
const textPromptLoadingMinimumMs = 900;

function isMostlyEnglishText(value: string) {
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const cjk = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return letters >= 8 && letters > cjk * 2;
}

type CanvasNodeProps = {
  node: CanvasNodeData;
  selected: boolean;
  upstreamSummary?: CanvasUpstreamSummary | null;
  onConnectionStart?: (event: ReactPointerEvent<HTMLElement>, nodeId: string) => void;
  onContentChange: (nodeId: string, content: string) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>, nodeId: string) => void;
  onConfigChange?: (nodeId: string, patch: CanvasConfigPatch) => void;
  onInfoOpen?: (nodeId: string) => void;
  onImageFileChange?: (nodeId: string, file: File) => void;
  onImageNaturalSize?: (nodeId: string, width: number, height: number) => void;
  onOpenGeneration: (nodeId: string) => void;
  onOptimizeTextPrompt?: (nodeId: string, prompt: string, model: string) => Promise<string>;
  onReverseImagePrompt?: (nodeId: string, prompt: string, model: string, referenceImages: CanvasReferenceImage[]) => Promise<string>;
  onStartImageReversePrompt?: (nodeId: string) => void;
  optimizingTextPrompt?: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, nodeId: string) => void;
  referenceImages?: CanvasReferenceImage[];
  onRetryGeneration?: (nodeId: string) => void;
  textPromptError?: string;
};

function CanvasNodeComponent({
  node,
  selected,
  upstreamSummary,
  onConnectionStart,
  onConfigChange,
  onContentChange,
  onContextMenu,
  onInfoOpen,
  onImageFileChange,
  onImageNaturalSize,
  onOpenGeneration,
  onPointerDown,
  onRetryGeneration,
  onOptimizeTextPrompt,
  onReverseImagePrompt,
  onStartImageReversePrompt,
  optimizingTextPrompt = false,
  referenceImages = [],
  textPromptError = "",
}: CanvasNodeProps) {
  const [editing, setEditing] = useState(false);
  const [configPopover, setConfigPopover] = useState<"model" | "settings" | null>(null);
  const [textPrompt, setTextPrompt] = useState(() => node.metadata?.content || node.metadata?.prompt || "");
  const [textPromptModel, setTextPromptModel] = useState<(typeof textPromptModelOptions)[number]>("gpt-5.5");
  const [textPromptModelOpen, setTextPromptModelOpen] = useState(false);
  const [submittingTextPrompt, setSubmittingTextPrompt] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const Icon = nodeIcons[node.type];
  const canShowGenerationAction = node.type === "config" || node.type === "generation";

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (node.type === "image") {
      event.stopPropagation();
      uploadInputRef.current?.click();
      return;
    }
    if (node.type !== "text") {
      return;
    }
    event.stopPropagation();
    if (content === textNodePlaceholder) {
      onContentChange(node.id, "");
    }
    setEditing(true);
  };

  const imageUrl = node.metadata?.imageUrl || "";
  const content = node.metadata?.content || node.metadata?.prompt || "";
  const status = node.metadata?.status || "idle";
  const showStatus = node.type === "generation" && status !== "idle";
  const statusLabel = nodeStatusLabels[status];
  const errorDetails = status === "error" ? node.metadata?.errorDetails || "生成失败，请稍后重试。" : "";
  const canRetry = node.type === "generation" && status === "error";
  const retrying = Boolean(node.metadata?.retrying);
  const isConfigNode = node.type === "config";
  const configPromptCount = upstreamSummary ? upstreamSummary.textCount : content.trim() ? 1 : 0;
  const configReferenceCount = upstreamSummary ? upstreamSummary.imageCount : node.metadata?.imageUrl ? 1 : 0;
  const configModel = node.metadata?.model || "auto";
  const configModelTitle = configModelOptions.find((option) => option.value === configModel)?.title || "Auto";
  const configSize = node.metadata?.size || "智能";
  const configCount = node.metadata?.count || 1;
  const configSummary = `${configSize === "智能" ? "自动" : configSize} · ${configCount}张`;
  const showTextPromptDialog = selected && node.type === "text";
  const isImageReversePrompt = node.metadata?.promptMode === "imageReverse";
  const textContentAlignment = node.type === "text" && isMostlyEnglishText(content) ? "center" : "start";
  const textPromptLoading = optimizingTextPrompt || submittingTextPrompt;

  useEffect(() => {
    if (!editing) {
      setTextPrompt(content);
    }
  }, [content, editing]);

  const handleOpenGenerationClick = (event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onOpenGeneration(node.id);
  };
  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    onImageNaturalSize?.(node.id, naturalWidth, naturalHeight);
  };
  const toggleConfigPopover = (event: ReactMouseEvent<HTMLElement>, popover: "model" | "settings") => {
    event.stopPropagation();
    setConfigPopover((current) => (current === popover ? null : popover));
  };
  const applyConfigPatch = (patch: CanvasConfigPatch) => {
    onConfigChange?.(node.id, patch);
  };
  const submitTextPrompt = async () => {
    const nextContent = textPrompt.trim();
    if (!nextContent || textPromptLoading) {
      return;
    }
    setSubmittingTextPrompt(true);
    const startedAt = Date.now();
    try {
      if (isImageReversePrompt && onReverseImagePrompt) {
        const optimizedPrompt = await onReverseImagePrompt(node.id, nextContent, textPromptModel, referenceImages);
        setTextPrompt(optimizedPrompt);
        onContentChange(node.id, optimizedPrompt);
        return;
      }
      if (onOptimizeTextPrompt) {
        const optimizedPrompt = await onOptimizeTextPrompt(node.id, nextContent, textPromptModel);
        setTextPrompt(optimizedPrompt);
        onContentChange(node.id, optimizedPrompt);
        return;
      }
      onContentChange(node.id, nextContent);
    } finally {
      const elapsed = Date.now() - startedAt;
      window.setTimeout(() => {
        setSubmittingTextPrompt(false);
      }, Math.max(0, textPromptLoadingMinimumMs - elapsed));
    }
  };

  return (
    <article
      data-cola-canvas-node={node.type}
      data-node-id={node.id}
      data-cola-state={selected ? "selected" : "idle"}
      data-cola-node-surface="studio-card"
      data-cola-node-layout={isConfigNode ? "inline-generation-config" : undefined}
      className={cn(
        "group absolute select-none rounded-[20px] border bg-white/94 p-4 text-left shadow-[0_22px_54px_-38px_rgba(15,23,42,0.46)] ring-1 ring-white/70 transition-shadow",
        isConfigNode && "rounded-[26px] border-white/70 bg-white/88 p-4 text-slate-950 shadow-[0_22px_58px_-42px_rgba(15,23,42,0.48)] ring-slate-900/5 backdrop-blur-xl",
        selected
          ? isConfigNode
            ? "z-30 border-violet-300 ring-4 ring-violet-200/55"
            : "z-30 border-violet-400 ring-4 ring-violet-200/65"
          : isConfigNode
            ? "z-20 hover:border-violet-200 hover:bg-white/94"
            : "z-20 border-slate-200/60 hover:border-violet-200 hover:shadow-[0_26px_60px_-38px_rgba(79,70,229,0.38)]",
      )}
      style={{
        contain: "layout style",
        width: isConfigNode ? configNodeWidth : node.width,
        height: isConfigNode ? configNodeHeight : node.height,
        minWidth: isConfigNode ? configNodeWidth : undefined,
        minHeight: isConfigNode ? configNodeHeight : node.height,
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
      }}
      onContextMenu={(event) => onContextMenu?.(event, node.id)}
      onDoubleClick={handleDoubleClick}
      onPointerDown={(event) => onPointerDown(event, node.id)}
    >
      <div
        data-cola-node-title-badge="true"
        className="absolute left-2 top-0 z-50 flex max-w-[calc(100%-16px)] -translate-y-[calc(100%+8px)] items-center gap-1.5 rounded-full border border-white/75 bg-white/92 px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.5)] ring-1 ring-slate-900/5 backdrop-blur-md"
      >
        <span
          data-cola-node-icon-tone={node.type}
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]",
            nodeIconToneClasses[node.type],
          )}
        >
          <Icon className="size-3" />
        </span>
        <span className="truncate">{node.title}</span>
        {showStatus ? (
          <span
            data-cola-node-status={status}
            className={cn(
              "shrink-0 text-[11px] font-semibold",
              status === "loading" && "text-violet-500",
              status === "success" && "text-emerald-600",
              status === "error" && "text-rose-600",
            )}
          >
            {statusLabel}
          </span>
        ) : null}
      </div>
      <span
        data-cola-canvas-handle="input"
        data-node-id={node.id}
        className="absolute left-0 top-1/2 z-40 size-4 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white bg-violet-500 shadow-sm ring-1 ring-violet-300/70 transition hover:scale-110 hover:bg-violet-400"
        onPointerDown={(event) => event.stopPropagation()}
      />
      <button
        type="button"
        data-cola-canvas-handle="output"
        data-node-id={node.id}
        aria-label={`连接 ${node.title}`}
        className="absolute right-0 top-1/2 z-40 size-4 -translate-y-1/2 translate-x-1/2 cursor-crosshair rounded-full border-2 border-white bg-violet-600 shadow-sm ring-1 ring-violet-300/80 transition hover:scale-110 hover:bg-violet-500"
        onPointerDown={(event) => {
          event.stopPropagation();
          onConnectionStart?.(event, node.id);
        }}
      />
      {isConfigNode ? (
        <div className="flex h-full flex-col">
          <div className="flex min-w-0 justify-end">
            <div className="inline-grid h-9 shrink-0 grid-cols-3 rounded-[14px] bg-slate-950 p-1 shadow-[0_12px_26px_-22px_rgba(15,23,42,0.82)]">
              {configModeItems.map(({ label, Icon: ModeIcon, active }) => (
                <span
                  key={label}
                  aria-disabled={!active}
                  className={cn(
                    "inline-flex w-[60px] items-center justify-center gap-1 rounded-[11px] text-sm font-medium leading-none",
                    active ? "bg-white text-slate-950" : "text-white/65",
                  )}
                >
                  <ModeIcon className="size-3.5" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex h-9 items-center rounded-[13px] border border-slate-200/80 bg-white/82 px-3 text-sm font-medium text-slate-700 shadow-[0_10px_24px_-21px_rgba(15,23,42,0.32)]">
              提示词 {configPromptCount} 个
            </span>
            <span className="inline-flex h-9 items-center rounded-[13px] border border-slate-200/80 bg-white/82 px-3 text-sm font-medium text-slate-700 shadow-[0_10px_24px_-21px_rgba(15,23,42,0.32)]">
              参考图 {configReferenceCount} 张
            </span>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-[13px] border border-slate-200/80 bg-white/82 px-3 text-sm font-medium text-slate-700 shadow-[0_10px_24px_-21px_rgba(15,23,42,0.32)] transition hover:bg-white hover:text-slate-950"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Eye className="size-3.5" />
              预览
            </button>
          </div>

          <div className="mt-4 flex min-w-0 items-center justify-between gap-3">
            <button
              type="button"
              data-cola-action="canvas-config-model"
              aria-expanded={configPopover === "model"}
              className="inline-flex h-11 min-w-0 max-w-[194px] items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/86 px-3.5 text-slate-850 shadow-[0_12px_26px_-24px_rgba(15,23,42,0.4)] transition hover:bg-white hover:text-slate-950"
              onClick={(event) => toggleConfigPopover(event, "model")}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Sparkles className="size-4 shrink-0 text-violet-500" />
              <span className="truncate text-base font-semibold tracking-[-0.02em]">{configModelTitle}</span>
            </button>
            <button
              type="button"
              data-cola-action="canvas-config-settings"
              aria-expanded={configPopover === "settings"}
              className="inline-flex min-w-[158px] items-center gap-2 rounded-full px-2 py-2 text-base font-medium leading-6 text-slate-700 transition hover:bg-white/80 hover:text-slate-950"
              onClick={(event) => toggleConfigPopover(event, "settings")}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Settings2 className="size-4 shrink-0 text-slate-500" />
              {configSummary}
            </button>
          </div>

          {configPopover === "model" ? (
            <div
              data-cola-panel="canvas-config-model-options"
              className="absolute left-4 top-[154px] z-50 w-[min(360px,calc(100%-32px))] rounded-[18px] border border-black/5 bg-white/96 p-3 text-left shadow-[0_20px_60px_-38px_rgba(15,23,42,0.48)] ring-1 ring-slate-900/[0.04] backdrop-blur-xl"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-slate-500">
                <span>模型</span>
                <span>当前官方链路</span>
              </div>
              <div className="grid gap-2">
                {configModelOptions.map((option) => {
                  const selectedModel = option.value === configModel;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selectedModel}
                      data-cola-model-option={option.value}
                      className={cn(
                        "flex min-h-[54px] items-center justify-between gap-3 rounded-[15px] border bg-white px-3 py-2 text-left transition",
                        selectedModel ? "border-slate-950 text-slate-950 shadow-[inset_0_0_0_1px_#020617]" : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-800",
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        applyConfigPatch({ model: option.value });
                        setConfigPopover(null);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{option.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-400">{option.description}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{option.badge}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {configPopover === "settings" ? (
            <div
              data-cola-panel="canvas-config-generation-settings"
              className="absolute right-4 top-[154px] z-50 w-[min(360px,calc(100%-32px))] rounded-[18px] border border-black/5 bg-white/96 p-3 text-left shadow-[0_20px_60px_-38px_rgba(15,23,42,0.48)] ring-1 ring-slate-900/[0.04] backdrop-blur-xl"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="grid grid-cols-2 gap-1.5 rounded-[16px] border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  aria-pressed={configSize === "智能"}
                  className={cn(
                    "h-9 rounded-[13px] text-sm font-semibold transition",
                    configSize === "智能" ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    applyConfigPatch({ size: "智能" });
                  }}
                >
                  Auto
                </button>
                <button
                  type="button"
                  aria-pressed={configSize !== "智能"}
                  className={cn(
                    "h-9 rounded-[13px] text-sm font-semibold transition",
                    configSize !== "智能" ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    applyConfigPatch({ size: configSize === "智能" ? "1:1" : configSize });
                  }}
                >
                  按比例
                </button>
              </div>

              <div data-cola-group="canvas-ratio-options" className="mt-3 grid grid-cols-5 gap-1.5">
                {configRatioOptions.map((option) => {
                  const selectedRatio = configSize === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selectedRatio}
                      data-cola-ratio-option={option}
                      className={cn(
                        "h-9 rounded-full text-sm font-semibold ring-1 transition",
                        selectedRatio ? "bg-sky-50 text-sky-700 ring-sky-200" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50 hover:text-slate-800",
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        applyConfigPatch({ size: option });
                      }}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 text-sm font-semibold text-slate-600">生成数量</div>
              <div data-cola-group="canvas-count-options" className="mt-2 grid grid-cols-4 gap-1.5">
                {configCountOptions.map((option) => {
                  const selectedCount = option === configCount;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selectedCount}
                      data-cola-count-option={option}
                      className={cn(
                        "h-9 rounded-[12px] border bg-white text-sm font-semibold transition",
                        selectedCount ? "border-slate-950 text-slate-950 shadow-[inset_0_0_0_1px_#020617]" : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-700",
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        applyConfigPatch({ count: option });
                      }}
                    >
                      {option}张
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            data-cola-action="inline-config-start-generation"
            className="mt-auto flex h-11 w-full items-center justify-center gap-2.5 rounded-[16px] bg-slate-950 px-4 text-base font-semibold text-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.88)] transition hover:-translate-y-px hover:bg-slate-800"
            onClick={handleOpenGenerationClick}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Zap className="size-4" />
            <span className="font-medium text-white/76">0</span>
            <Play className="size-4" />
            开始生成
          </button>
        </div>
      ) : null}

      {!isConfigNode ? (
        <div
          data-cola-node-toolbar="true"
          data-cola-node-toolbar-placement="above-title"
          className="absolute left-1/2 top-0 z-[60] flex -translate-x-1/2 -translate-y-[calc(100%+48px)] items-center gap-1 rounded-full border border-white/70 bg-white/90 px-2 py-1.5 text-slate-600 opacity-0 shadow-[0_16px_34px_-24px_rgba(15,23,42,0.42)] ring-1 ring-slate-900/5 backdrop-blur-md transition group-hover:opacity-100 hover:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            data-cola-action="show-node-info"
            title="信息"
            aria-label="信息"
            className="grid size-8 place-items-center rounded-full transition hover:bg-violet-50 hover:text-violet-700"
            onClick={(event) => {
              event.stopPropagation();
              onInfoOpen?.(node.id);
            }}
          >
            <Info className="size-4" />
          </button>
          {node.type === "text" ? (
            <button
              type="button"
              data-cola-action="start-image-reverse-prompt"
              title="图片反推提示词"
              aria-label="图片反推提示词"
              className="grid size-8 place-items-center rounded-full transition hover:bg-sky-50 hover:text-sky-700"
              onClick={(event) => {
                event.stopPropagation();
                onStartImageReversePrompt?.(node.id);
              }}
            >
              <ImageIcon className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}

      {selected && node.type === "image" ? (
        <div
          data-cola-image-option-toolbar="true"
          className="absolute left-1/2 top-0 z-[70] flex -translate-x-1/2 -translate-y-[calc(100%+92px)] items-center gap-1 rounded-full border border-white/70 bg-white/94 px-2 py-1.5 text-slate-600 shadow-[0_18px_38px_-24px_rgba(15,23,42,0.48)] ring-1 ring-slate-900/5 backdrop-blur-md"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {imageOptionItems.map((option) => {
            const active = Boolean(node.metadata?.imageOptions?.includes(option.value));
            return (
              <button
                key={option.value}
                type="button"
                data-cola-image-option={option.value}
                data-cola-image-option-state={active ? "active" : "idle"}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold transition",
                  active ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:bg-violet-50 hover:text-violet-700",
                )}
                onClick={(event) => event.stopPropagation()}
              >
                {option.label}
                {"badge" in option ? (
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none",
                    active ? "bg-white/16 text-white" : "bg-violet-100 text-violet-700",
                  )}>
                    {option.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {!isConfigNode && imageUrl ? (
        <div
          data-cola-image-container="true"
          data-cola-image-fit="adaptive-contain"
          className="flex h-full items-center justify-center overflow-hidden rounded-[15px] bg-slate-100 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)]"
          style={{ contain: "strict" }}
        >
          <AuthenticatedImage
            src={imageUrl}
            alt={node.title}
            className="h-full w-full object-contain"
            draggable={false}
            loadingMotion="static"
            onLoad={handleImageLoad}
          />
        </div>
      ) : !isConfigNode && node.type === "image" ? (
        <div
          data-cola-image-upload-surface="true"
          className="flex h-full flex-col items-center justify-center rounded-[15px] border border-dashed border-violet-200/80 bg-[linear-gradient(135deg,rgba(124,58,237,0.08),rgba(59,130,246,0.05)_48%,rgba(255,255,255,0.92))] px-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_0_0_1px_rgba(255,255,255,0.6)] transition group-hover:border-violet-300 group-hover:bg-violet-50/70"
        >
          <span
            data-cola-image-upload-icon="true"
            className="grid size-10 place-items-center rounded-2xl bg-white text-violet-600 shadow-[0_10px_22px_-16px_rgba(79,70,229,0.75)] ring-1 ring-violet-100"
          >
            <ImagePlus className="size-4" />
          </span>
          <span
            data-cola-node-hint="double-click-upload"
            className="mt-3 text-xs font-semibold text-violet-700"
          >
            {imageNodeUploadHint}
          </span>
          <span className="mt-1 max-w-[150px] text-[11px] leading-4 text-slate-500">
            {imageNodeReferenceHint}
          </span>
        </div>
      ) : !isConfigNode && editing ? (
        <textarea
          autoFocus
          data-cola-wheel-local="true"
          className="h-full w-full resize-none overscroll-contain rounded-xl border border-violet-100 bg-white/80 p-3 text-xs leading-5 text-slate-700 outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
          value={content}
          onBlur={() => setEditing(false)}
          onChange={(event) => onContentChange(node.id, event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        />
      ) : !isConfigNode ? (
        <p
          data-cola-node-content="text-preview"
          data-cola-text-align={textContentAlignment}
          className={cn(
            "max-h-full overflow-hidden break-words whitespace-pre-wrap text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]",
            textContentAlignment === "center" && "flex h-full items-center justify-center text-center",
          )}
        >
          {errorDetails || content || (node.type === "image" ? "空图片节点" : textNodePlaceholder)}
        </p>
      ) : null}

      {node.type === "image" ? (
        <input
          ref={uploadInputRef}
          data-cola-action="double-click-upload-image"
          className="sr-only"
          type="file"
          accept="image/*"
          aria-label="双击上传图片"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              onImageFileChange?.(node.id, file);
            }
            event.currentTarget.value = "";
          }}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : null}

      {canShowGenerationAction && !isConfigNode ? (
        <button
          type="button"
          className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-white/86 text-violet-600 opacity-0 shadow-sm ring-1 ring-black/5 transition hover:bg-violet-50 group-hover:opacity-100 data-[visible=true]:opacity-100"
          data-visible={selected}
          aria-label="基于节点继续生成"
          title="继续生成"
          onClick={handleOpenGenerationClick}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Sparkles className="size-4" />
        </button>
      ) : null}

      {canRetry ? (
        <button
          type="button"
          data-cola-action="retry-generation-node"
          data-cola-retry-state={retrying ? "retrying" : "idle"}
          className="absolute bottom-3 right-3 inline-flex h-8 items-center gap-1.5 rounded-full bg-rose-50 px-3 text-xs font-semibold text-rose-600 ring-1 ring-rose-100 transition hover:bg-rose-100 disabled:cursor-wait disabled:opacity-70"
          disabled={retrying}
          onClick={(event) => {
            event.stopPropagation();
            if (retrying) {
              return;
            }
            onRetryGeneration?.(node.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <RefreshCw className={cn("size-3.5", retrying && "animate-spin")} />
          {retrying ? "重试中" : "重试"}
        </button>
      ) : null}

      {showTextPromptDialog ? (
        <div
          data-cola-panel="canvas-text-prompt-dialog"
          data-cola-theme="light"
          data-cola-mode={isImageReversePrompt ? "imageReverse" : "optimize"}
          data-cola-state={textPromptLoading ? "optimizing" : "idle"}
          className={cn(
            "absolute left-1/2 top-[calc(100%+14px)] z-50 flex w-[min(520px,calc(100vw-40px))] -translate-x-1/2 flex-col rounded-[22px] border border-white/80 bg-white/96 p-3 text-slate-950 shadow-[0_26px_74px_-48px_rgba(15,23,42,0.48)] ring-1 ring-slate-900/5 backdrop-blur-xl",
            referenceImages.length > 0 ? "h-[232px]" : "h-[180px]",
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {referenceImages.length > 0 ? (
            <div
              data-cola-panel="canvas-text-reference-images"
              className="mb-2 flex h-[48px] shrink-0 gap-2 overflow-x-auto rounded-[16px] border border-slate-200/70 bg-slate-50/80 p-1.5"
            >
              {referenceImages.map((referenceImage, index) => (
                <div
                  key={`${referenceImage.nodeId}-${index}`}
                  data-cola-reference-image-node-id={referenceImage.nodeId}
                  className="flex h-full min-w-[128px] items-center gap-2 rounded-[12px] bg-white px-2 shadow-[0_8px_18px_-18px_rgba(15,23,42,0.5)] ring-1 ring-slate-900/5"
                  title={referenceImage.title}
                >
                  <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-slate-100 text-slate-400">
                    {referenceImage.imageUrl ? (
                      <AuthenticatedImage
                        src={referenceImage.imageUrl}
                        alt={referenceImage.title}
                        className="size-full object-cover"
                        draggable={false}
                        loadingMotion="static"
                      />
                    ) : (
                      <ImageIcon className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold text-slate-700">{referenceImage.title}</span>
                    <span className="block text-[10px] font-medium text-slate-400">{referenceImage.imageUrl ? `图 ${index + 1}` : "等待图片"}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <textarea
            data-cola-wheel-local="true"
            aria-label="文本节点对话输入"
            className="min-h-0 flex-1 w-full resize-none rounded-[16px] border border-slate-200/80 bg-slate-50/82 px-3 py-2.5 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-200 focus:bg-white focus:ring-4 focus:ring-violet-100/70"
            placeholder="写下你想讲的故事、场景或角色设定。例如：一个来自未来的机器人，在城市屋顶看星星。"
            value={textPrompt}
            onChange={(event) => setTextPrompt(event.target.value)}
            onWheel={(event) => event.stopPropagation()}
          />
          <div className="flex h-[36px] shrink-0 items-center justify-between gap-3 pt-2">
            <div className="relative">
              <button
                type="button"
                data-cola-action="canvas-text-model"
                aria-expanded={textPromptModelOpen}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-2.5 text-xs font-semibold text-slate-800 shadow-[0_10px_20px_-18px_rgba(15,23,42,0.45)] transition hover:border-violet-200 hover:text-violet-700"
                onClick={() => setTextPromptModelOpen((current) => !current)}
              >
                <Sparkles className="size-3.5 text-violet-500" />
                {textPromptModel}
                <ChevronDown className={cn("size-3 text-slate-400 transition", textPromptModelOpen && "rotate-180")} />
              </button>
              <div
                data-cola-panel="canvas-text-model-options"
                className={cn(
                  "absolute bottom-[calc(100%+8px)] left-0 w-36 rounded-[16px] border border-slate-200/80 bg-white p-1 shadow-[0_18px_44px_-30px_rgba(15,23,42,0.42)] ring-1 ring-slate-900/5",
                  !textPromptModelOpen && "hidden",
                )}
              >
                {textPromptModelOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    data-cola-text-model-option={option}
                    className={cn(
                      "flex h-9 w-full items-center rounded-[12px] px-3 text-sm font-semibold transition",
                      textPromptModel === option ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                    )}
                    onClick={() => {
                      setTextPromptModel(option);
                      setTextPromptModelOpen(false);
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {textPromptError ? (
                <span className="max-w-[180px] truncate text-[11px] font-medium text-rose-500">{textPromptError}</span>
              ) : textPromptLoading ? (
                <span className="text-[11px] font-medium text-violet-500">正在优化</span>
              ) : null}
              <button
                type="button"
                data-cola-action="canvas-text-translate"
                aria-label="翻译"
                title="翻译"
                className="grid size-8 place-items-center rounded-full text-slate-500 transition hover:bg-violet-50 hover:text-violet-700"
              >
                <Languages className="size-4" />
              </button>
              <button
                type="button"
                data-cola-action="canvas-text-send"
                data-cola-local-loading={submittingTextPrompt ? "true" : "false"}
                aria-label="发送文本节点内容"
                className="grid size-9 place-items-center rounded-[13px] bg-slate-950 text-white shadow-[0_12px_26px_-18px_rgba(15,23,42,0.72)] transition hover:-translate-y-px hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                disabled={!textPrompt.trim() || textPromptLoading}
                onClick={() => void submitTextPrompt()}
              >
                {textPromptLoading ? <RefreshCw className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                <span className="sr-only">发送</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export const CanvasNode = memo(CanvasNodeComponent, areCanvasNodePropsEqual);

CanvasNode.displayName = "CanvasNode";
