"use client";

import { Check, ChevronDown, LoaderCircle, SlidersHorizontal, Sparkles, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ImageParamsBarProps = {
  imageCount: string;
  imageSize: string;
  availableQuota: string;
  activeTaskCount: number;
  dailyLimit?: { requests?: number | null; images?: number | null };
  concurrency?: number | null;
  onImageCountChange: (value: string) => void;
  onImageSizeChange: (value: string) => void;
  onOpenPromptMarket?: () => void;
  onOptimizePrompt?: () => void;
  isOptimizingPrompt?: boolean;
  canOptimizePrompt?: boolean;
};

const imageSizeOptions = [
  { value: "", label: "未指定" },
  { value: "1:1", label: "1:1 正方形" },
  { value: "16:9", label: "16:9 横版" },
  { value: "4:3", label: "4:3 横版" },
  { value: "3:4", label: "3:4 竖版" },
  { value: "9:16", label: "9:16 竖版" },
];

const compositionModes = [
  { value: "auto", label: "Auto" },
  { value: "ratio", label: "按比例" },
];

function formatLimitValue(value?: number | null) {
  if (value == null) {
    return "不限";
  }
  return String(value);
}

export function ImageParamsBar({
  imageCount,
  imageSize,
  availableQuota,
  activeTaskCount,
  dailyLimit,
  concurrency,
  onImageCountChange,
  onImageSizeChange,
  onOpenPromptMarket,
  onOptimizePrompt,
  isOptimizingPrompt = false,
  canOptimizePrompt = false,
}: ImageParamsBarProps) {
  const [isSizeMenuOpen, setIsSizeMenuOpen] = useState(false);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [compositionMode, setCompositionMode] = useState<"auto" | "ratio">("auto");
  const sizeMenuRef = useRef<HTMLDivElement>(null);
  const sizeButtonRef = useRef<HTMLButtonElement>(null);
  const paramsPanelRef = useRef<HTMLDivElement>(null);
  const paramsButtonRef = useRef<HTMLButtonElement>(null);

  const imageSizeLabel = imageSizeOptions.find((option) => option.value === imageSize)?.label || "未指定";
  const dailyLimitLabel = dailyLimit
    ? `请求 ${formatLimitValue(dailyLimit.requests)} / 图片 ${formatLimitValue(dailyLimit.images)}`
    : "待同步";
  const concurrencyLabel = concurrency != null ? `${activeTaskCount} / ${concurrency}` : `${activeTaskCount} / 待同步`;

  useEffect(() => {
    if (!isSizeMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (sizeMenuRef.current?.contains(target) || sizeButtonRef.current?.contains(target)) {
        return;
      }
      setIsSizeMenuOpen(false);
    };
    window.document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isSizeMenuOpen]);

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

  return (
    <div className="border-b border-stone-100 bg-white px-4 py-3 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1060px] flex-wrap items-center gap-2">
        {/* 状态信息 */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-stone-100 px-3 py-1.5 font-medium text-stone-600">
            剩余额度：{availableQuota}
          </span>
          <span className="rounded-full bg-stone-100 px-3 py-1.5 font-medium text-stone-600">
            今日限制：{dailyLimitLabel}
          </span>
          <span className="rounded-full bg-stone-100 px-3 py-1.5 font-medium text-stone-600">
            并发：{concurrencyLabel}
          </span>
          {activeTaskCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 font-medium text-amber-700">
              <LoaderCircle className="size-3 animate-spin" />
              {activeTaskCount} 个任务
            </span>
          )}
        </div>

        {/* 分隔线 */}
        <div className="hidden h-6 w-px bg-stone-200 sm:block" />

        {/* 参数控制 */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 张数 */}
          <div className="flex h-9 items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1">
            <span className="text-xs font-medium text-stone-700">张数</span>
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              max="100"
              step="1"
              value={imageCount}
              onChange={(event) => onImageCountChange(event.target.value)}
              className="h-7 w-[48px] border-0 bg-transparent px-0 text-center text-sm font-semibold text-stone-900 shadow-none focus-visible:ring-0"
            />
          </div>

          {/* 比例选择 */}
          <div className="relative">
            <button
              ref={sizeButtonRef}
              type="button"
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium transition",
                isSizeMenuOpen
                  ? "border-blue-200 bg-blue-50 text-blue-700 shadow-sm"
                  : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50",
              )}
              onClick={() => setIsSizeMenuOpen((open) => !open)}
              aria-expanded={isSizeMenuOpen}
            >
              <span className="font-medium">比例</span>
              <span className="font-semibold">{imageSizeLabel}</span>
              <ChevronDown className={cn("size-4 text-stone-400 transition", isSizeMenuOpen && "rotate-180")} />
            </button>
            {isSizeMenuOpen ? (
              <div
                ref={sizeMenuRef}
                className="absolute top-[calc(100%+0.5rem)] left-0 z-50 w-[160px] overflow-hidden rounded-2xl border border-stone-200 bg-white p-1.5 shadow-[0_20px_60px_-32px_rgba(15,23,42,0.4)]"
              >
                {imageSizeOptions.map((option) => {
                  const active = option.value === imageSize;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-stone-50",
                        active && "bg-stone-100 font-semibold text-stone-950",
                      )}
                      onClick={() => {
                        onImageSizeChange(option.value);
                        setIsSizeMenuOpen(false);
                      }}
                    >
                      <span>{option.label}</span>
                      {active ? <Check className="size-4 text-blue-600" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* 高级参数 */}
          <div className="relative">
            <button
              ref={paramsButtonRef}
              type="button"
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium transition",
                isParamsOpen
                  ? "border-blue-200 bg-blue-50 text-blue-700 shadow-sm"
                  : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50",
              )}
              onClick={() => setIsParamsOpen((open) => !open)}
              aria-expanded={isParamsOpen}
            >
              <SlidersHorizontal className="size-4" />
              <span className="hidden sm:inline">参数</span>
            </button>
            {isParamsOpen ? (
              <div
                ref={paramsPanelRef}
                className="absolute top-[calc(100%+0.5rem)] right-0 z-50 w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-stone-200 bg-white p-4 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)] sm:p-5"
              >
                <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                  <div className="font-semibold text-stone-950">官方图片工具</div>
                  <div className="mt-1 text-sm leading-6 text-stone-600">
                    默认使用 gpt-image-2；比例只作为提示词构图偏好，实际像素由官方返回决定。
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="flex h-14 items-center justify-between rounded-2xl border border-stone-200 bg-white px-4">
                    <span className="text-sm text-stone-500">张数</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={imageCount}
                      onChange={(event) => onImageCountChange(event.target.value)}
                      className="w-16 bg-transparent text-right text-lg font-semibold text-stone-950 outline-none"
                    />
                  </label>
                  <div className="flex h-14 items-center justify-between rounded-2xl border border-stone-200 bg-white px-4">
                    <span className="text-sm text-stone-500">构图</span>
                    <span className="text-lg font-semibold text-stone-950">
                      {compositionMode === "auto" ? "Auto" : imageSize || "未指定"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-stone-200 bg-white p-1">
                  {compositionModes.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      className={cn(
                        "h-11 rounded-xl text-sm font-semibold transition",
                        compositionMode === mode.value
                          ? "bg-stone-950 text-white"
                          : "text-stone-600 hover:bg-stone-50",
                      )}
                      onClick={() => setCompositionMode(mode.value as "auto" | "ratio")}
                    >
                      {mode.label}
                    </button>
                  ))}
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
                            ? "bg-blue-50 text-blue-700 ring-blue-200"
                            : "bg-white text-stone-600 ring-stone-200 hover:bg-stone-50",
                        )}
                        onClick={() => onImageSizeChange(size)}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800">
                  官方链路只会把比例写入提示词作为构图偏好，不会下发 1080P / 2K / 4K 或质量参数。
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="flex h-14 items-center justify-between rounded-2xl border border-stone-200 bg-white px-4">
                    <span className="text-sm text-stone-500">格式</span>
                    <span className="text-lg font-semibold text-stone-950">PNG</span>
                  </div>
                  <div className="flex h-14 items-center justify-between rounded-2xl border border-stone-200 bg-white px-4 text-stone-300">
                    <span className="text-sm">压缩率</span>
                    <span className="text-lg font-semibold">N/A</span>
                  </div>
                </div>

                <p className="mt-3 text-sm leading-6 text-stone-400">
                  当前任务接口返回 PNG 结果；结果卡会显示实际保存后的格式、尺寸和文件大小。
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* 分隔线 */}
        <div className="hidden h-6 w-px bg-stone-200 sm:block" />

        {/* 快捷操作 */}
        <div className="flex flex-wrap items-center gap-2">
          {onOpenPromptMarket && (
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-full border-stone-200 bg-white px-3 text-xs font-medium text-stone-700 hover:bg-stone-50"
              onClick={onOpenPromptMarket}
            >
              <Store className="size-4" />
              <span className="hidden sm:inline">市场</span>
            </Button>
          )}
          {onOptimizePrompt && (
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-9 rounded-full border-stone-200 px-3 text-xs font-medium",
                canOptimizePrompt
                  ? "bg-white text-stone-700 hover:bg-stone-50"
                  : "cursor-not-allowed bg-stone-50 text-stone-300",
              )}
              onClick={() => void onOptimizePrompt()}
              disabled={!canOptimizePrompt}
            >
              {isOptimizingPrompt ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              <span className="hidden sm:inline">{isOptimizingPrompt ? "优化中" : "优化"}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
