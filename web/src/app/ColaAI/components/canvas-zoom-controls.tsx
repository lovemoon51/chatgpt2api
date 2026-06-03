"use client";

import { Focus, Minus, Plus } from "lucide-react";

import { useCanvasViewport } from "./canvas-viewport-store";

type CanvasZoomControlsProps = {
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export function CanvasZoomControls({ onFitView, onZoomIn, onZoomOut }: CanvasZoomControlsProps) {
  const viewport = useCanvasViewport();
  return (
    <div
      data-cola-panel="canvas-zoom-controls"
      className="absolute bottom-6 left-6 z-40 flex items-center gap-2 rounded-2xl border border-black/5 bg-white/96 px-3 py-2 text-sm text-slate-600 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.2)]"
    >
      <button type="button" title="缩小" className="grid size-8 place-items-center rounded-xl hover:bg-slate-100" onClick={onZoomOut}>
        <Minus className="size-4" />
      </button>
      <span className="min-w-12 text-center text-xs font-semibold text-slate-700">{Math.round(viewport.k * 100)}%</span>
      <button type="button" title="放大" className="grid size-8 place-items-center rounded-xl hover:bg-slate-100" onClick={onZoomIn}>
        <Plus className="size-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-slate-200" />
      <button type="button" title="适配视图" className="grid size-8 place-items-center rounded-xl hover:bg-slate-100" onClick={onFitView}>
        <Focus className="size-4" />
      </button>
    </div>
  );
}
