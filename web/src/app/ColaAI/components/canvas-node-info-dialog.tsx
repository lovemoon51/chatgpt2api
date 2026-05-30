"use client";

import { useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CanvasNodeData } from "./canvas-types";
import type { CanvasUpstreamSummary } from "./canvas-workflow";

const nodeTypeLabels = {
  text: "文本",
  image: "图片",
  video: "视频",
  config: "配置",
  generation: "生成结果",
};

type NodeInfoMode = "info" | "json";

type CanvasNodeInfoDialogProps = {
  node: CanvasNodeData;
  upstreamSummary?: CanvasUpstreamSummary | null;
  onClose: () => void;
};

export function CanvasNodeInfoDialog({ node, upstreamSummary, onClose }: CanvasNodeInfoDialogProps) {
  const [infoMode, setInfoMode] = useState<NodeInfoMode>("info");
  const promptText = node.metadata?.prompt || node.metadata?.content || "";
  const nodeInfoRows = [
    ["ID", node.id],
    ["类型", nodeTypeLabels[node.type]],
    ["尺寸", `${node.width} x ${node.height}`],
    ["位置", `${Math.round(node.position.x)}, ${Math.round(node.position.y)}`],
    ["状态", node.metadata?.status || "idle"],
  ];
  const nodeJson = JSON.stringify(node, null, 2);

  function stopDialogPointer(event: ReactMouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function stopDialogWheel(event: ReactWheelEvent<HTMLElement>) {
    event.stopPropagation();
  }

  return (
    <div
      data-cola-backdrop="node-info"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-transparent px-6 py-8"
      onClick={onClose}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <section
        data-cola-panel="canvas-node-property-popover"
        data-cola-wheel-local="true"
        className="flex h-[min(520px,calc(100vh-96px))] w-[min(780px,calc(100vw-64px))] flex-col overflow-hidden rounded-[18px] border border-black/5 bg-white/98 text-left shadow-[0_24px_70px_-38px_rgba(15,23,42,0.42)] ring-1 ring-violet-100/60"
        onClick={stopDialogPointer}
        onWheel={stopDialogWheel}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-7 py-5">
          <h3 className="text-xl font-semibold text-slate-950">节点信息</h3>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm font-semibold text-slate-500">
              <button
                type="button"
                data-cola-action="node-info-tab"
                className={cn(
                  "rounded-md px-3 py-1 transition",
                  infoMode === "info" ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-800",
                )}
                onClick={() => setInfoMode("info")}
              >
                信息
              </button>
              <button
                type="button"
                data-cola-action="node-json-tab"
                className={cn(
                  "rounded-md px-3 py-1 transition",
                  infoMode === "json" ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-800",
                )}
                onClick={() => setInfoMode("json")}
              >
                JSON
              </button>
            </div>
            <button
              type="button"
              data-cola-action="close-node-info"
              aria-label="关闭节点信息"
              className="grid size-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={onClose}
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 py-5">
          {infoMode === "info" ? (
            <div className="grid max-w-[620px] gap-4">
              {nodeInfoRows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[96px_minmax(0,1fr)] gap-8 text-base leading-7">
                  <span className="font-semibold text-slate-400">{label}</span>
                  <span className="min-w-0 break-words font-medium text-slate-800">{value}</span>
                </div>
              ))}
              {promptText ? (
                <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-8 text-base leading-7">
                  <span className="font-semibold text-slate-400">提示词</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words font-medium text-slate-800">{promptText}</span>
                </div>
              ) : null}
              {node.metadata?.model ? (
                <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-8 text-base leading-7">
                  <span className="font-semibold text-slate-400">模型</span>
                  <span className="min-w-0 break-words font-medium text-slate-800">{node.metadata.model}</span>
                </div>
              ) : null}
              {node.metadata?.size ? (
                <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-8 text-base leading-7">
                  <span className="font-semibold text-slate-400">比例</span>
                  <span className="min-w-0 break-words font-medium text-slate-800">{node.metadata.size}</span>
                </div>
              ) : null}
              {node.metadata?.count ? (
                <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-8 text-base leading-7">
                  <span className="font-semibold text-slate-400">数量</span>
                  <span className="min-w-0 break-words font-medium text-slate-800">{node.metadata.count}</span>
                </div>
              ) : null}
              {node.metadata?.sourceTaskId ? (
                <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-8 text-base leading-7">
                  <span className="font-semibold text-slate-400">任务 ID</span>
                  <span className="min-w-0 break-words font-medium text-slate-800">{node.metadata.sourceTaskId}</span>
                </div>
              ) : null}
              {upstreamSummary ? (
                <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-8 text-base leading-7">
                  <span className="font-semibold text-slate-400">上游</span>
                  <span className="min-w-0 break-words font-medium text-slate-800">
                    {upstreamSummary.nodes.length} 个节点 · 文本 {upstreamSummary.textCount} · 图片 {upstreamSummary.imageCount} · 配置 {upstreamSummary.configCount}
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <pre className="h-full overflow-auto rounded-2xl bg-slate-950 p-5 font-mono text-xs leading-5 text-slate-100">
              {nodeJson}
            </pre>
          )}
        </div>
      </section>
    </div>
  );
}
