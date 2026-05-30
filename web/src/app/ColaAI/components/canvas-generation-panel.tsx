"use client";

import { Check, ChevronDown, Eye, ImageIcon, MessageSquareText, Play, Settings2, Sparkles, Video, X, Zap } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { CanvasNodeData } from "./canvas-types";

type CanvasGenerationSettings = {
  prompt: string;
  model: string;
  size: string;
  count: number;
};

type CanvasGenerationPanelProps = CanvasGenerationSettings & {
  open: boolean;
  promptCount?: number;
  referenceCount?: number;
  selectedNode: CanvasNodeData | null;
  submitting: boolean;
  onChange: (patch: Partial<CanvasGenerationSettings>) => void;
  onClose: () => void;
  onSubmit: () => void;
};

const modelOptions = [
  { value: "auto", label: "Auto", description: "按当前链路自动选择" },
  { value: "gpt-image-2", label: "gpt-image-2", description: "官方图片生成模型" },
  { value: "codex-gpt-image-2", label: "codex-gpt-image-2", description: "Codex 兼容别名" },
];
const sizeOptions = [
  { value: "智能", label: "Auto" },
  { value: "9:16", label: "9:16" },
  { value: "2:3", label: "2:3" },
  { value: "1:1", label: "1:1" },
  { value: "3:2", label: "3:2" },
  { value: "16:9", label: "16:9" },
];
const modeOptions = [
  { key: "image", label: "生图", icon: ImageIcon, enabled: true },
  { key: "text", label: "文本", icon: MessageSquareText, enabled: false },
  { key: "video", label: "视频", icon: Video, enabled: false },
] as const;

export function CanvasGenerationPanel({
  open,
  selectedNode,
  prompt,
  promptCount: promptCountProp,
  referenceCount: referenceCountProp,
  model,
  size,
  count,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: CanvasGenerationPanelProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  if (!open) {
    return null;
  }

  const promptCount = promptCountProp ?? (prompt.trim() ? 1 : 0);
  const referenceCount = referenceCountProp ?? (selectedNode?.type === "image" && selectedNode.metadata?.imageUrl ? 1 : 0);
  const activeModel = modelOptions.find((option) => option.value === model) ?? modelOptions[0];
  const modeSummary = `${size === "智能" ? "自动比例" : size} · ${count}张`;

  return (
    <aside
      data-cola-panel="canvas-generation-panel"
      data-cola-panel-style="studio-inspector"
      className={cn(
        "absolute bottom-4 right-4 top-4 z-50 flex w-[min(374px,calc(100vw-32px))] flex-col overflow-hidden rounded-[26px] border border-slate-200/75 bg-white/96 text-slate-950 shadow-[0_28px_80px_-54px_rgba(15,23,42,0.78)] ring-1 ring-white/80 backdrop-blur-xl transition",
        "translate-x-0 opacity-100",
      )}
    >
      <header className="shrink-0 border-b border-slate-200/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.74),rgba(255,255,255,0.96))] px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Canvas output</p>
            <h2 className="mt-1 text-[22px] font-semibold leading-7 tracking-[-0.04em] text-slate-950">生成配置</h2>
          </div>
          <button
            type="button"
            aria-label="关闭生成配置"
            className="grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 active:scale-95"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-[18px] border border-slate-200/80 bg-slate-100/80 p-1 shadow-inner shadow-slate-200/40">
          {modeOptions.map(({ key, label, icon: Icon, enabled }) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === "image"}
              disabled={!enabled}
              className={cn(
                "inline-flex h-10 items-center justify-center gap-1.5 rounded-[14px] text-sm font-medium transition",
                key === "image" ? "bg-white text-slate-950 shadow-[0_8px_18px_-14px_rgba(15,23,42,0.68)] ring-1 ring-slate-200/80" : "text-slate-400",
                !enabled && "cursor-not-allowed opacity-60",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [scrollbar-color:rgba(148,163,184,0.5)_transparent] [scrollbar-width:thin]">
        <section data-cola-generation-section="summary" className="grid grid-cols-3 gap-2.5">
          <div className="rounded-[18px] border border-slate-200/70 bg-white px-3.5 py-3 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.5)]">
            <p className="text-[11px] font-medium text-slate-400">提示词</p>
            <p className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">{promptCount} 个</p>
          </div>
          <div className="rounded-[18px] border border-slate-200/70 bg-white px-3.5 py-3 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.5)]">
            <p className="text-[11px] font-medium text-slate-400">参考图</p>
            <p className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">{referenceCount} 张</p>
          </div>
          <button
            type="button"
            className="rounded-[18px] border border-slate-200/70 bg-white px-3.5 py-3 text-left text-slate-600 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.5)] transition hover:-translate-y-px hover:border-slate-300 hover:text-slate-950 active:translate-y-0"
          >
            <Eye className="size-4 text-slate-500" />
            <span className="mt-1 block text-lg font-semibold tracking-[-0.03em]">预览</span>
          </button>
        </section>

        <section data-cola-generation-section="prompt" className="mt-5 rounded-[22px] border border-slate-200/75 bg-slate-50/70 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
          <label className="block">
            <span className="flex items-center justify-between gap-3 px-0.5 text-sm font-semibold text-slate-500">
              <span>提示词内容</span>
              <span className="grid size-7 place-items-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200/80">
                <Sparkles className="size-3.5" />
              </span>
            </span>
            <textarea
              id="canvas-generation-prompt"
              className="mt-2 min-h-[128px] w-full resize-none rounded-[18px] border border-slate-200/80 bg-white px-4 py-3.5 text-[15px] leading-7 text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70 [scrollbar-color:rgba(100,116,139,0.45)_transparent] [scrollbar-width:thin]"
              value={prompt}
              placeholder="描述画面、风格、主体和希望输出的方向。"
              onChange={(event) => onChange({ prompt: event.target.value })}
            />
          </label>
        </section>

        <section data-cola-generation-section="parameters" className="mt-5 rounded-[22px] border border-slate-200/75 bg-white p-3.5 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.6)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-500">参数</p>
              <p className="mt-0.5 text-sm font-medium text-slate-950">{modeSummary}</p>
            </div>
            <span className="grid size-8 place-items-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200/80">
              <Settings2 className="size-4" />
            </span>
          </div>

          <div className="relative mt-4">
            <span className="text-[11px] font-semibold text-slate-400">模型</span>
            <button
              type="button"
              data-cola-action="canvas-generation-model-trigger"
              aria-expanded={modelMenuOpen}
              className="mt-1.5 flex h-12 w-full items-center gap-2 rounded-[16px] border border-slate-200/80 bg-slate-50/80 px-3 text-left transition hover:border-slate-300 hover:bg-white focus:border-slate-300 focus:outline-none focus:ring-4 focus:ring-slate-200/70"
              onClick={() => setModelMenuOpen((current) => !current)}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200/80">
                <Sparkles className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{activeModel.label}</span>
                <span className="block truncate text-[11px] font-medium text-slate-400">{activeModel.description}</span>
              </span>
              <ChevronDown className={cn("size-4 shrink-0 text-slate-400 transition", modelMenuOpen && "rotate-180")} />
            </button>
            <div
              data-cola-generation-model-menu="true"
              className={cn(
                "absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-[16px] border border-slate-200/90 bg-white p-1.5 shadow-[0_22px_52px_-34px_rgba(15,23,42,0.54)] ring-1 ring-slate-900/[0.04]",
                !modelMenuOpen && "hidden",
              )}
            >
              {modelOptions.map((option) => {
                const selected = option.value === model;
                return (
                  <button
                    key={option.value}
                    type="button"
                    data-cola-generation-model-option={option.value}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[13px] px-3 py-2.5 text-left transition",
                      selected ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
                    )}
                    onClick={() => {
                      onChange({ model: option.value });
                      setModelMenuOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{option.label}</span>
                      <span className={cn("mt-0.5 block truncate text-[11px] font-medium", selected ? "text-white/62" : "text-slate-400")}>{option.description}</span>
                    </span>
                    {selected ? <Check className="size-4 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-400">图片比例</p>
              <span className="text-[11px] font-medium text-slate-400">{size === "智能" ? "自动判断" : "固定画幅"}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 rounded-[18px] bg-slate-50/80 p-1.5 ring-1 ring-slate-200/70">
              {sizeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={size === option.value}
                  className={cn(
                    "h-10 rounded-[14px] text-sm font-semibold transition hover:-translate-y-px active:translate-y-0",
                    size === option.value ? "bg-slate-950 text-white shadow-[0_14px_28px_-18px_rgba(15,23,42,0.78)]" : "text-slate-500 hover:bg-white hover:text-slate-800",
                  )}
                  onClick={() => onChange({ size: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-400">生成数量</p>
              <span className="text-[11px] font-medium text-slate-400">最多 4 张</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={count === item}
                  className={cn(
                    "h-10 rounded-[14px] text-sm font-semibold transition hover:-translate-y-px active:translate-y-0",
                    count === item ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200 shadow-[0_12px_28px_-22px_rgba(109,40,217,0.58)]" : "bg-slate-100/82 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800",
                  )}
                  onClick={() => onChange({ count: item })}
                >
                  {item}张
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section data-cola-generation-section="footer" className="sticky bottom-0 shrink-0 border-t border-slate-200/70 bg-white/96 p-4 shadow-[0_-18px_42px_-34px_rgba(15,23,42,0.34)]">
        <button
          type="button"
          className="flex h-14 w-full items-center justify-center gap-3 rounded-[20px] bg-slate-950 px-4 text-base font-semibold text-white shadow-[0_18px_42px_-28px_rgba(15,23,42,0.72)] transition hover:-translate-y-px hover:bg-slate-900 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
          disabled={!selectedNode || submitting || !prompt.trim()}
          onClick={onSubmit}
        >
          <Zap className="size-4" />
          <span className="text-sm font-medium text-white/70">0</span>
          <Play className="size-4" />
          {submitting ? "生成中" : "开始生成"}
        </button>
      </section>
    </aside>
  );
}
