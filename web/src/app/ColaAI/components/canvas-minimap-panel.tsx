"use client";

import { CircleHelp, Focus, Map, Minus, Plus } from "lucide-react";
import { type CSSProperties, useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { CanvasNodeData, CanvasViewport } from "./canvas-types";
import { useCanvasViewport } from "./canvas-viewport-store";

type CanvasMinimapPanelProps = {
  nodes: CanvasNodeData[];
  selectedNodeIds: string[];
  onViewportChange: (viewport: CanvasViewport) => void;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

const minimapWidth = 224;
const minimapHeight = 128;
const minimapPadding = 10;

type MinimapRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getMinimapBounds(rects: MinimapRect[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  rects.forEach((rect) => {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  });

  return {
    offsetX: minX,
    offsetY: minY,
    boundsWidth: maxX - minX || 1,
    boundsHeight: maxY - minY || 1,
  };
}

function computeMinimapTransform(nodes: CanvasNodeData[], viewportRect: MinimapRect) {
  const nodeRects = nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
  }));
  const bounds = expandMinimapBounds(getMinimapBounds([...nodeRects, viewportRect]), 360);
  const availableWidth = minimapWidth - minimapPadding * 2;
  const availableHeight = minimapHeight - minimapPadding * 2;
  const scale = Math.min(availableWidth / bounds.boundsWidth, availableHeight / bounds.boundsHeight, 1);

  return { ...bounds, scale };
}

function expandMinimapBounds(bounds: ReturnType<typeof getMinimapBounds>, amount: number) {
  return {
    offsetX: bounds.offsetX - amount,
    offsetY: bounds.offsetY - amount,
    boundsWidth: bounds.boundsWidth + amount * 2,
    boundsHeight: bounds.boundsHeight + amount * 2,
  };
}

const nodeColorMap: Record<string, string> = {
  text: "border-slate-400/25 bg-slate-400/70",
  image: "border-sky-300/40 bg-sky-400/75",
  config: "border-teal-300/45 bg-teal-400/75",
  generation: "border-violet-300/40 bg-violet-400/75",
  video: "border-amber-300/45 bg-amber-400/75",
};

export const CANVAS_SHORTCUTS = [
  { key: "指针工具 + 拖拽", description: "框选节点" },
  { key: "手型工具 + 拖拽", description: "移动画布" },
  { key: "滚轮", description: "缩放视图" },
  { key: "Shift + 拖拽", description: "框选节点" },
  { key: "Delete / Backspace", description: "删除选中" },
  { key: "Ctrl / Cmd + Z", description: "撤销" },
  { key: "Ctrl / Cmd + Shift + Z", description: "重做" },
  { key: "Ctrl / Cmd + A", description: "全选节点" },
  { key: "Ctrl / Cmd + D", description: "复制选中" },
  { key: "方向键", description: "微移选中" },
  { key: "Shift + 方向键", description: "快速微移" },
  { key: "Esc", description: "取消操作" },
] as const;

export function CanvasMinimapPanel({
  nodes,
  selectedNodeIds,
  onViewportChange,
  onFitView,
  onZoomIn,
  onZoomOut,
}: CanvasMinimapPanelProps) {
  const viewport = useCanvasViewport();
  const minimapRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [miniMapOpen, setMiniMapOpen] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; viewport: CanvasViewport } | null>(null);

  const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const windowHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const selectedNodeIdSet = new Set(selectedNodeIds);
  const worldViewportRect = {
    x: -viewport.x / viewport.k,
    y: -viewport.y / viewport.k,
    width: windowWidth / viewport.k,
    height: windowHeight / viewport.k,
  };
  const { offsetX, offsetY, scale, boundsWidth, boundsHeight } = computeMinimapTransform(nodes, worldViewportRect);

  const viewportRectWidth = worldViewportRect.width * scale;
  const viewportRectHeight = worldViewportRect.height * scale;
  const viewportRectX = minimapPadding + (worldViewportRect.x - offsetX) * scale;
  const viewportRectY = minimapPadding + (worldViewportRect.y - offsetY) * scale;

  const toMiniRect = useCallback((rect: MinimapRect): CSSProperties => ({
    left: minimapPadding + (rect.x - offsetX) * scale,
    top: minimapPadding + (rect.y - offsetY) * scale,
    width: Math.max(3, rect.width * scale),
    height: Math.max(3, rect.height * scale),
  }), [offsetX, offsetY, scale]);

  const jumpToPointer = useCallback((element: HTMLElement, event: React.PointerEvent<HTMLElement>) => {
    const rect = element.getBoundingClientRect();
    const canvasX = (event.clientX - rect.left - minimapPadding) / scale + offsetX;
    const canvasY = (event.clientY - rect.top - minimapPadding) / scale + offsetY;
    onViewportChange({
      x: -(canvasX - windowWidth / viewport.k / 2) * viewport.k,
      y: -(canvasY - windowHeight / viewport.k / 2) * viewport.k,
      k: viewport.k,
    });
  }, [offsetX, offsetY, onViewportChange, scale, viewport.k, windowHeight, windowWidth]);

  const handleZoomChange = useCallback((zoom: number) => {
    onViewportChange({
      ...viewport,
      k: zoom,
    });
  }, [onViewportChange, viewport]);

  const handleViewportDragStart = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, viewport: { ...viewport } };
  }, [viewport]);

  const handleViewportDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    const canvasDx = dx / scale;
    const canvasDy = dy / scale;

    onViewportChange({
      x: dragStartRef.current.viewport.x - canvasDx * viewport.k,
      y: dragStartRef.current.viewport.y - canvasDy * viewport.k,
      k: viewport.k,
    });
  }, [dragging, onViewportChange, scale, viewport.k]);

  const handleViewportDragEnd = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setDragging(false);
    dragStartRef.current = null;
  }, []);

  return (
    <div
      data-cola-panel="canvas-minimap"
      data-cola-control-surface="studio-map"
      className="absolute bottom-6 left-6 z-40 flex w-[248px] max-w-[calc(100vw-48px)] flex-col items-start gap-2 text-slate-600"
    >
      {miniMapOpen && (
        <section
          data-cola-minimap-card="true"
          className="grid w-[248px] gap-2 rounded-[18px] border border-white/70 bg-white/92 p-2.5 shadow-[0_20px_46px_-34px_rgba(15,23,42,0.54)] ring-1 ring-slate-900/5 backdrop-blur-xl"
          aria-label="画布小地图"
        >
          <div className="flex items-center justify-between gap-2 px-0.5 text-xs font-medium text-slate-500">
            <span className="font-semibold text-slate-600">小地图</span>
            <strong className="rounded-full bg-slate-950 px-2 py-0.5 text-sm font-bold tabular-nums text-white shadow-[0_8px_18px_-14px_rgba(15,23,42,0.85)]">{nodes.length}</strong>
          </div>
          <div
            ref={minimapRef}
            className="relative overflow-hidden rounded-[14px] border border-slate-200/70 bg-white/76 bg-[radial-gradient(circle_at_30%_20%,rgba(124,58,237,0.08),transparent_34%),linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[length:auto,16px_16px,16px_16px] shadow-inner shadow-slate-200/70"
            style={{ width: minimapWidth, height: minimapHeight }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              jumpToPointer(event.currentTarget, event);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              event.preventDefault();
              jumpToPointer(event.currentTarget, event);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
          >
            {nodes.map((node) => {
              const selected = selectedNodeIdSet.has(node.id);
              return (
                <span
                  key={node.id}
                  data-cola-minimap-selected={selected ? "true" : undefined}
                  className={cn(
                    "pointer-events-none absolute rounded-[4px] border shadow-[0_2px_6px_-5px_rgba(15,23,42,0.8)]",
                    selected ? "border-slate-950/70 bg-slate-950/75" : nodeColorMap[node.type] || "border-slate-400/25 bg-slate-400/70",
                  )}
                  style={toMiniRect({
                    x: node.position.x,
                    y: node.position.y,
                    width: node.width,
                    height: node.height,
                  })}
                />
              );
            })}
            <span
              data-cola-minimap-viewport="true"
              data-cola-minimap-x={viewportRectX}
              data-cola-minimap-y={viewportRectY}
              className="absolute rounded-[6px] border border-violet-500/65 bg-violet-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.76),0_10px_24px_-18px_rgba(79,70,229,0.7)]"
              style={{
                left: viewportRectX,
                top: viewportRectY,
                width: Math.max(3, viewportRectWidth),
                height: Math.max(3, viewportRectHeight),
              }}
              onPointerDown={handleViewportDragStart}
              onPointerMove={handleViewportDragMove}
              onPointerUp={handleViewportDragEnd}
            />
          </div>
        </section>
      )}

      <section
        data-cola-zoom-controls="true"
        className="inline-flex min-h-[40px] w-full items-center gap-1 rounded-[16px] border border-white/70 bg-white/92 px-1.5 py-1.5 text-slate-600 shadow-[0_18px_42px_-32px_rgba(15,23,42,0.5)] ring-1 ring-slate-900/5 backdrop-blur-xl"
        aria-label="画布缩放"
      >
        <button type="button" title="缩小" className="grid size-6 place-items-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-950 hover:shadow-sm" onClick={onZoomOut}>
          <Minus className="size-3.5" />
        </button>
        <input
          aria-label="缩放比例"
          className="h-1 min-w-[48px] flex-1 accent-violet-500"
          type="range"
          min="12"
          max="400"
          step="1"
          value={Math.round(viewport.k * 100)}
          onChange={(event) => handleZoomChange(Number(event.currentTarget.value) / 100)}
        />
        <button type="button" title="放大" className="grid size-6 place-items-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-950 hover:shadow-sm" onClick={onZoomIn}>
          <Plus className="size-3.5" />
        </button>
        <span className="min-w-8 text-center text-[11px] font-semibold tabular-nums text-slate-600">{Math.round(viewport.k * 100)}%</span>
        <button type="button" title="适配视图" className="grid size-6 place-items-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-950 hover:shadow-sm" onClick={onFitView}>
          <Focus className="size-3.5" />
        </button>
        <button
          type="button"
          title={miniMapOpen ? "隐藏小地图" : "显示小地图"}
          aria-label={miniMapOpen ? "隐藏小地图" : "显示小地图"}
          data-cola-action="toggle-minimap"
          className={cn(
            "grid size-7 place-items-center rounded-lg transition",
            miniMapOpen ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:bg-white hover:text-slate-950 hover:shadow-sm",
          )}
          onClick={() => setMiniMapOpen((open) => !open)}
        >
          <Map className="size-4" />
        </button>
        <button
          type="button"
          title="快捷键"
          aria-label="快捷键"
          data-cola-action="show-shortcuts"
          className={cn(
            "grid size-6 place-items-center rounded-lg transition",
            shortcutsOpen ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-white hover:text-slate-950 hover:shadow-sm",
          )}
          onClick={() => setShortcutsOpen((open) => !open)}
        >
          <CircleHelp className="size-3.5" />
        </button>
      </section>

      {shortcutsOpen && (
        <div
          role="dialog"
          aria-label="画布快捷键"
          data-cola-shortcuts-dialog="true"
          className={cn(
            "absolute left-0 z-50 grid w-[300px] gap-2 rounded-[18px] border border-white/70 bg-white/94 p-3 text-xs text-slate-600 shadow-[0_20px_46px_-32px_rgba(15,23,42,0.52)] ring-1 ring-slate-900/5 backdrop-blur-xl",
            miniMapOpen ? "bottom-[238px]" : "bottom-[56px]",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm text-slate-900">快捷键</strong>
            <button type="button" className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setShortcutsOpen(false)}>关闭</button>
          </div>
          <div className="grid gap-1.5">
            {CANVAS_SHORTCUTS.map((shortcut) => (
              <span key={shortcut.key} className="flex items-center justify-between gap-3">
                <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">{shortcut.key}</kbd>
                <span className="text-right">{shortcut.description}</span>
              </span>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
