"use client";

import { BookmarkPlus, FolderOpen, ImageIcon, Shapes, Sparkles, Tag, X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export type CanvasAssetLibraryCategory = "全部" | "人物" | "场景" | "物品" | "风格" | "项目空间";

export type CanvasAssetLibraryItem = {
  id: string;
  imageUrl: string;
  nodeId: string;
  title: string;
  category: Exclude<CanvasAssetLibraryCategory, "全部">;
};

type CanvasAssetLibraryPanelProps = {
  open: boolean;
  assets: CanvasAssetLibraryItem[];
  onClose: () => void;
  onUseAsset: (asset: CanvasAssetLibraryItem) => void;
};

const assetCategories: CanvasAssetLibraryCategory[] = ["全部", "人物", "场景", "物品", "风格", "项目空间"];

export function CanvasAssetLibraryPanel({ open, assets, onClose, onUseAsset }: CanvasAssetLibraryPanelProps) {
  const [activeCategory, setActiveCategory] = useState<CanvasAssetLibraryCategory>("全部");

  if (!open) {
    return null;
  }

  const visibleAssets = activeCategory === "全部"
    ? assets
    : assets.filter((asset) => asset.category === activeCategory);

  return (
    <aside
      data-cola-panel="asset-library"
      data-cola-panel-style="studio-inspector"
      data-cola-motion="asset-library-enter"
      className="absolute bottom-4 right-4 top-4 z-50 flex w-[min(392px,calc(100vw-32px))] flex-col overflow-hidden rounded-[26px] border border-slate-200/75 bg-white/96 text-slate-950 shadow-[0_28px_80px_-54px_rgba(15,23,42,0.78)] ring-1 ring-white/80 backdrop-blur-xl"
    >
      <header className="shrink-0 border-b border-slate-200/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.74),rgba(255,255,255,0.96))] px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Prompt references</p>
            <h2 className="mt-1 text-[22px] font-semibold leading-7 tracking-[-0.04em] text-slate-950">素材库</h2>
          </div>
          <button
            type="button"
            aria-label="关闭素材库"
            className="grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 active:scale-95"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {assetCategories.map((category) => (
            <button
              key={category}
              type="button"
              data-cola-asset-category={category}
              aria-pressed={activeCategory === category}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition",
                activeCategory === category
                  ? "bg-slate-950 text-white shadow-[0_14px_30px_-22px_rgba(15,23,42,0.78)]"
                  : "bg-slate-100/80 text-slate-500 ring-1 ring-slate-200/70 hover:bg-white hover:text-slate-900",
              )}
              onClick={() => setActiveCategory(category)}
            >
              {category === "全部" ? <Shapes className="size-3.5" /> : <Tag className="size-3.5" />}
              {category}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [scrollbar-color:rgba(148,163,184,0.5)_transparent] [scrollbar-width:thin]">
        {visibleAssets.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200/90 bg-slate-50/72 px-6 text-center">
            <span className="grid size-12 place-items-center rounded-[22px] bg-white text-slate-400 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.58)] ring-1 ring-slate-200/80">
              <FolderOpen className="size-5" />
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-[-0.03em] text-slate-950">还没有素材</h3>
            <p className="mt-2 max-w-[278px] text-sm leading-6 text-slate-500">上传参考图或保存生成结果后，可以在 prompt 中用 @ 引用。</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visibleAssets.map((asset) => (
              <article
                key={asset.id}
                data-cola-asset-item={asset.id}
                className="overflow-hidden rounded-[22px] border border-slate-200/75 bg-white shadow-[0_16px_42px_-38px_rgba(15,23,42,0.54)] transition hover:-translate-y-0.5 hover:border-slate-300/90"
              >
                <div className="relative aspect-square overflow-hidden bg-slate-100">
                  <img src={asset.imageUrl} alt={asset.title} className="size-full object-cover" />
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/88 px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm ring-1 ring-white/70 backdrop-blur">
                    <ImageIcon className="size-3 text-violet-500" />
                    {asset.category}
                  </span>
                </div>
                <div className="p-3">
                  <h3 className="truncate text-sm font-semibold text-slate-950">{asset.title}</h3>
                  <button
                    type="button"
                    data-cola-action="use-asset-reference"
                    className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[13px] bg-violet-50 text-xs font-semibold text-violet-700 ring-1 ring-violet-100 transition hover:bg-violet-100/70 active:scale-[0.99]"
                    onClick={() => onUseAsset(asset)}
                  >
                    <BookmarkPlus className="size-3.5" />
                    @引用素材
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="mt-4 rounded-[20px] border border-slate-200/70 bg-[linear-gradient(135deg,rgba(238,242,255,0.72),rgba(236,254,255,0.7))] p-3 text-xs leading-5 text-slate-500">
          <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
            <Sparkles className="size-3.5 text-violet-500" />
            图片优先
          </span>
          <span className="mt-1 block">当前版本只沉淀图片素材，方便后续在 prompt 中用 @ 快速引用。</span>
        </div>
      </div>
    </aside>
  );
}
