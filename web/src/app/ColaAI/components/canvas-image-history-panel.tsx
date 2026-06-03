"use client";

import { ImageIcon, Layers3, Sparkles, Wand2, X, ZoomIn } from "lucide-react";

import { cn } from "@/lib/utils";

export type CanvasImageHistoryItem = {
  id: string;
  imageUrl: string;
  nodeId: string;
  title: string;
  subtitle?: string;
};

type CanvasImageHistoryPanelProps = {
  open: boolean;
  items: CanvasImageHistoryItem[];
  onClose: () => void;
  onCreateImageNode: (item: CanvasImageHistoryItem) => void;
  onUseAsReference: (item: CanvasImageHistoryItem) => void;
  onUpscale: (item: CanvasImageHistoryItem) => void;
};

export function CanvasImageHistoryPanel({
  open,
  items,
  onClose,
  onCreateImageNode,
  onUpscale,
  onUseAsReference,
}: CanvasImageHistoryPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <aside
      data-cola-panel="image-history"
      data-cola-panel-style="studio-inspector"
      className={cn(
        "absolute bottom-4 right-4 top-4 z-50 flex w-[min(382px,calc(100vw-32px))] flex-col overflow-hidden rounded-[26px] border border-slate-200/75 bg-white/96 text-slate-950 shadow-[0_28px_80px_-54px_rgba(15,23,42,0.78)] ring-1 ring-white/80 backdrop-blur-xl",
      )}
      data-cola-motion="image-history-enter"
    >
      <header className="shrink-0 border-b border-slate-200/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.74),rgba(255,255,255,0.96))] px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Canvas assets</p>
            <h2 className="mt-1 text-[22px] font-semibold leading-7 tracking-[-0.04em] text-slate-950">图片历史</h2>
          </div>
          <button
            type="button"
            aria-label="关闭图片历史"
            className="grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 active:scale-95"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 inline-flex rounded-[18px] border border-slate-200/80 bg-slate-100/80 p-1 shadow-inner shadow-slate-200/40">
          <button
            type="button"
            aria-pressed="true"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[14px] bg-white px-4 text-sm font-semibold text-slate-950 shadow-[0_8px_18px_-14px_rgba(15,23,42,0.68)] ring-1 ring-slate-200/80"
          >
            <ImageIcon className="size-3.5 text-violet-600" />
            图片历史
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [scrollbar-color:rgba(148,163,184,0.5)_transparent] [scrollbar-width:thin]">
        {items.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200/90 bg-slate-50/72 px-6 text-center">
            <span className="grid size-12 place-items-center rounded-[22px] bg-white text-slate-400 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.58)] ring-1 ring-slate-200/80">
              <Layers3 className="size-5" />
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-[-0.03em] text-slate-950">暂无图片历史</h3>
            <p className="mt-2 max-w-[260px] text-sm leading-6 text-slate-500">生成或上传图片后，可以在这里快速引用到画布。</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <article
                key={item.id}
                data-cola-history-item={item.id}
                className="overflow-hidden rounded-[24px] border border-slate-200/75 bg-white shadow-[0_18px_45px_-38px_rgba(15,23,42,0.52)] transition hover:-translate-y-0.5 hover:border-slate-300/90 hover:shadow-[0_24px_52px_-42px_rgba(15,23,42,0.62)]"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
                  <img src={item.imageUrl} alt={item.title} className="size-full object-cover" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-950/42 to-transparent" />
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/88 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm ring-1 ring-white/70 backdrop-blur">
                    <Sparkles className="size-3 text-violet-500" />
                    可复用
                  </span>
                </div>
                <div className="p-3.5">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-950">{item.title}</h3>
                    {item.subtitle ? <p className="mt-1 truncate text-xs font-medium text-slate-400">{item.subtitle}</p> : null}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      data-cola-action="history-create-image-node"
                      className="inline-flex h-9 items-center justify-center gap-1 rounded-[14px] bg-slate-950 px-2 text-xs font-semibold text-white shadow-[0_14px_28px_-20px_rgba(15,23,42,0.78)] transition hover:-translate-y-px active:translate-y-0"
                      onClick={() => onCreateImageNode(item)}
                    >
                      <ImageIcon className="size-3.5" />
                      创建图片节点
                    </button>
                    <button
                      type="button"
                      data-cola-action="history-use-as-reference"
                      className="inline-flex h-9 items-center justify-center gap-1 rounded-[14px] bg-violet-50 px-2 text-xs font-semibold text-violet-700 ring-1 ring-violet-100 transition hover:-translate-y-px hover:bg-violet-100/70 active:translate-y-0"
                      onClick={() => onUseAsReference(item)}
                    >
                      <Wand2 className="size-3.5" />
                      作为参考图
                    </button>
                    <button
                      type="button"
                      data-cola-action="history-upscale-image"
                      className="inline-flex h-9 items-center justify-center gap-1 rounded-[14px] bg-cyan-50 px-2 text-xs font-semibold text-cyan-700 ring-1 ring-cyan-100 transition hover:-translate-y-px hover:bg-cyan-100/70 active:translate-y-0"
                      onClick={() => onUpscale(item)}
                    >
                      <ZoomIn className="size-3.5" />
                      高清
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
