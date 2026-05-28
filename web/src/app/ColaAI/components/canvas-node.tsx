"use client";

import { memo, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Boxes, ImagePlus, RefreshCw, Sparkles, Type, Video } from "lucide-react";

import { AuthenticatedImage } from "@/components/authenticated-image";
import { cn } from "@/lib/utils";
import { areCanvasNodePropsEqual } from "./canvas-render-guards";
import type { CanvasNodeData } from "./canvas-types";

const nodeIcons = {
  text: Type,
  image: ImagePlus,
  video: Video,
  config: Boxes,
  generation: Sparkles,
};

const nodeStatusLabels = {
  idle: "",
  loading: "生成中",
  success: "已完成",
  error: "生成失败",
};

type CanvasNodeProps = {
  node: CanvasNodeData;
  selected: boolean;
  onConnectionStart?: (event: ReactPointerEvent<HTMLElement>, nodeId: string) => void;
  onContentChange: (nodeId: string, content: string) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>, nodeId: string) => void;
  onOpenGeneration: (nodeId: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, nodeId: string) => void;
  onRetryGeneration?: (nodeId: string) => void;
};

function CanvasNodeComponent({
  node,
  selected,
  onConnectionStart,
  onContentChange,
  onContextMenu,
  onOpenGeneration,
  onPointerDown,
  onRetryGeneration,
}: CanvasNodeProps) {
  const [editing, setEditing] = useState(false);
  const Icon = nodeIcons[node.type];
  const canGenerate = node.type === "image" || node.type === "config" || node.type === "generation";

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (node.type !== "text") {
      return;
    }
    event.stopPropagation();
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

  return (
    <article
      data-cola-canvas-node={node.type}
      data-node-id={node.id}
      data-cola-state={selected ? "selected" : "idle"}
      className={cn(
        "absolute select-none rounded-[18px] border bg-white p-4 text-left shadow-[0_18px_44px_-34px_rgba(15,23,42,0.26)] transition-shadow",
        selected ? "z-30 border-violet-400 ring-4 ring-violet-200/60" : "z-20 border-black/5 hover:border-violet-200",
      )}
      style={{
        contain: "layout style",
        width: node.width,
        height: node.height,
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
      }}
      onContextMenu={(event) => onContextMenu?.(event, node.id)}
      onDoubleClick={handleDoubleClick}
      onPointerDown={(event) => onPointerDown(event, node.id)}
    >
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
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl text-white",
            node.type === "config" ? "bg-violet-600" : "bg-slate-950",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-950">{node.title}</h2>
          {node.type === "config" ? (
            <p className="text-[11px] text-slate-400">
              {node.metadata?.model || "gpt-image-2"} · {node.metadata?.size || "1:1"} · {node.metadata?.count || 1}张
            </p>
          ) : null}
          {showStatus ? (
            <p
              data-cola-node-status={status}
              className={cn(
                "mt-0.5 text-[11px] font-semibold",
                status === "loading" && "text-violet-500",
                status === "success" && "text-emerald-600",
                status === "error" && "text-rose-600",
              )}
            >
              {statusLabel}
            </p>
          ) : null}
        </div>
      </div>

      {imageUrl ? (
        <div
          data-cola-image-container="true"
          className="mt-3 h-[calc(100%-58px)] overflow-hidden rounded-[14px] bg-slate-100"
          style={{ contain: "strict" }}
        >
          <AuthenticatedImage
            src={imageUrl}
            alt={node.title}
            className="h-full w-full object-cover"
            draggable={false}
            loadingMotion="static"
          />
        </div>
      ) : editing ? (
        <textarea
          autoFocus
          className="mt-3 h-[calc(100%-54px)] w-full resize-none rounded-xl border border-violet-100 bg-white/80 p-3 text-xs leading-5 text-slate-700 outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
          value={content}
          onBlur={() => setEditing(false)}
          onChange={(event) => onContentChange(node.id, event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : (
        <p className="mt-3 line-clamp-[7] whitespace-pre-wrap text-xs leading-5 text-slate-500">
          {errorDetails || content || (node.type === "image" ? "空图片节点" : "双击编辑文字")}
        </p>
      )}

      {canGenerate ? (
        <button
          type="button"
          className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-white/86 text-violet-600 opacity-0 shadow-sm ring-1 ring-black/5 transition hover:bg-violet-50 group-hover:opacity-100 data-[visible=true]:opacity-100"
          data-visible={selected}
          aria-label="基于节点继续生成"
          title="继续生成"
          onClick={(event) => {
            event.stopPropagation();
            onOpenGeneration(node.id);
          }}
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
    </article>
  );
}

export const CanvasNode = memo(CanvasNodeComponent, areCanvasNodePropsEqual);

CanvasNode.displayName = "CanvasNode";
