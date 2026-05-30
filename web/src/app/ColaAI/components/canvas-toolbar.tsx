"use client";

import { Boxes, Hand, ImagePlus, LayoutGrid, MousePointer2, Redo2, Sparkles, Trash2, Type, Undo2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CanvasInteractionMode } from "./canvas-types";

type CanvasToolbarProps = {
  canDelete: boolean;
  canGenerate: boolean;
  interactionMode: CanvasInteractionMode;
  canOrganize: boolean;
  canRedo: boolean;
  canUndo: boolean;
  onAddConfig: () => void;
  onAddImage: () => void;
  onAddText: () => void;
  onDelete: () => void;
  onInteractionModeChange: (mode: CanvasInteractionMode) => void;
  onOpenGeneration: () => void;
  onOrganize: () => void;
  onRedo: () => void;
  onUndo: () => void;
};

export function CanvasToolbar({
  canDelete,
  canGenerate,
  interactionMode,
  canOrganize,
  canRedo,
  canUndo,
  onAddConfig,
  onAddImage,
  onAddText,
  onDelete,
  onInteractionModeChange,
  onOpenGeneration,
  onOrganize,
  onRedo,
  onUndo,
}: CanvasToolbarProps) {
  const toolButtonClass = "grid size-9 place-items-center rounded-xl transition hover:-translate-y-px hover:bg-white hover:text-slate-950 hover:shadow-sm disabled:hover:translate-y-0";
  const activeToolButtonClass = "bg-slate-950 text-white shadow-[0_10px_22px_-15px_rgba(15,23,42,0.75)]";
  const toolbarGroupClass = "flex items-center gap-1 rounded-[14px] bg-white/66 p-1 ring-1 ring-slate-900/5";

  return (
    <div
      data-cola-panel="canvas-toolbar"
      data-cola-toolbar-style="studio-dock"
      className="absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-[22px] border border-white/70 bg-white/86 p-2 text-slate-500 shadow-[0_22px_58px_-38px_rgba(15,23,42,0.62)] ring-1 ring-slate-900/5 backdrop-blur-xl"
    >
      <div data-cola-toolbar-group="navigation" className={toolbarGroupClass}>
        <button
          type="button"
          title="指针工具"
          data-cola-action="canvas-tool-pointer"
          aria-pressed={interactionMode === "pointer"}
          className={cn(toolButtonClass, interactionMode === "pointer" && activeToolButtonClass)}
          onClick={() => onInteractionModeChange("pointer")}
        >
          <MousePointer2 className="size-4" />
        </button>
        <button
          type="button"
          title="手型工具"
          data-cola-action="canvas-tool-hand"
          aria-pressed={interactionMode === "hand"}
          className={cn(toolButtonClass, interactionMode === "hand" && activeToolButtonClass)}
          onClick={() => onInteractionModeChange("hand")}
        >
          <Hand className="size-4" />
        </button>
        <button
          type="button"
          title="撤销"
          data-cola-action="undo-canvas"
          className={cn(toolButtonClass, !canUndo && "opacity-35")}
          onClick={onUndo}
          disabled={!canUndo}
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          title="重做"
          data-cola-action="redo-canvas"
          className={cn(toolButtonClass, !canRedo && "opacity-35")}
          onClick={onRedo}
          disabled={!canRedo}
        >
          <Redo2 className="size-4" />
        </button>
      </div>

      <div data-cola-toolbar-group="create" className={toolbarGroupClass}>
        <button type="button" title="文本节点" className={toolButtonClass} onClick={onAddText}>
          <Type className="size-4" />
        </button>
        <button type="button" title="图片节点" className={toolButtonClass} onClick={onAddImage}>
          <ImagePlus className="size-4" />
        </button>
        <button
          type="button"
          title="生成配置"
          data-cola-action="add-config-node"
          className={toolButtonClass}
          onClick={onAddConfig}
        >
          <Boxes className="size-4" />
        </button>
      </div>

      <div data-cola-toolbar-group="actions" className={toolbarGroupClass}>
        <button
          type="button"
          title="继续生成"
          className={cn(toolButtonClass, "text-violet-600 hover:text-violet-700", !canGenerate && "opacity-35")}
          onClick={onOpenGeneration}
          disabled={!canGenerate}
        >
          <Sparkles className="size-4" />
        </button>
        <button
          type="button"
          title="一键整理节点"
          data-cola-action="organize-nodes"
          className={cn(toolButtonClass, "hover:text-cyan-700", !canOrganize && "opacity-35")}
          onClick={onOrganize}
          disabled={!canOrganize}
        >
          <LayoutGrid className="size-4" />
        </button>
        <button
          type="button"
          title="删除"
          className={cn(toolButtonClass, "text-rose-500 hover:text-rose-600", !canDelete && "opacity-35")}
          onClick={onDelete}
          disabled={!canDelete}
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
