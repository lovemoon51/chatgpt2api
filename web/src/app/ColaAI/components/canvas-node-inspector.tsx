"use client";

import { Boxes, ExternalLink, ImagePlus, Sparkles, Trash2, Type, Upload, Video } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CanvasNodeData } from "./canvas-types";
import type { CanvasUpstreamSummary } from "./canvas-workflow";

type CanvasNodeInspectorProps = {
  node: CanvasNodeData | null;
  upstreamSummary: CanvasUpstreamSummary | null;
  onConfigChange: (
    nodeId: string,
    patch: Pick<NonNullable<CanvasNodeData["metadata"]>, "prompt" | "model" | "size" | "count">,
  ) => void;
  onContentChange: (nodeId: string, content: string) => void;
  onImageChange: (
    nodeId: string,
    patch: Pick<NonNullable<CanvasNodeData["metadata"]>, "imageUrl" | "content">,
  ) => void;
  onImageClear?: (nodeId: string) => void;
  onImageFileChange?: (nodeId: string, file: File) => void;
  onOpenGeneration: () => void;
  onOpenSourceTask?: (taskId: string) => void;
};

const modelOptions = ["gpt-image-2", "codex-gpt-image-2", "agnes-image-2.1-flash"];
const sizeOptions = ["智能", "1:1", "16:9", "9:16", "4:3", "3:4"];

const nodeIcons = {
  text: Type,
  image: ImagePlus,
  video: Video,
  config: Boxes,
  generation: Sparkles,
};

const generationStatusLabels = {
  idle: "待生成",
  loading: "生成中",
  success: "已完成",
  error: "生成失败",
};

export function CanvasNodeInspector({
  node,
  upstreamSummary,
  onConfigChange,
  onContentChange,
  onImageClear,
  onImageFileChange,
  onImageChange,
  onOpenGeneration,
  onOpenSourceTask,
}: CanvasNodeInspectorProps) {
  if (!node) {
    return null;
  }

  const Icon = nodeIcons[node.type];
  const canGenerate = node.type === "image" || node.type === "config" || node.type === "generation";
  const content = node.metadata?.content || "";
  const imageUrl = node.metadata?.imageUrl || "";
  const generationStatus = node.metadata?.status || "idle";
  const sourceTaskId = node.metadata?.sourceTaskId || "";
  const canOpenSourceTask = node.type === "generation" && generationStatus === "error" && Boolean(sourceTaskId) && Boolean(onOpenSourceTask);

  return (
    <aside
      data-cola-panel="canvas-node-inspector"
      className="absolute inset-y-20 right-5 z-40 flex w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-[20px] border border-black/5 bg-white/96 text-slate-950 shadow-[0_18px_54px_-34px_rgba(15,23,42,0.45)]"
    >
      <div className="border-b border-slate-100 px-4 py-4">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl text-white",
              node.type === "config" ? "bg-violet-600" : "bg-slate-950",
            )}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-400">节点属性</p>
            <h2 className="truncate text-sm font-semibold text-slate-950">{node.title}</h2>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {node.type === "text" ? (
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">提示词内容</span>
            <textarea
              className="mt-2 min-h-[144px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
              value={content}
              onChange={(event) => onContentChange(node.id, event.target.value)}
            />
          </label>
        ) : null}

        {node.type === "image" || node.type === "generation" ? (
          <div className="grid gap-4">
            <div className="flex items-center gap-2">
              <label
                data-cola-action="upload-canvas-image"
                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                <Upload className="size-4" />
                上传图片
                <input
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onImageFileChange?.(node.id, file);
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                data-cola-action="clear-canvas-image"
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => onImageClear?.(node.id)}
                disabled={!imageUrl}
              >
                <Trash2 className="size-4" />
                清空
              </button>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">图片地址</span>
              <input
                className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                value={imageUrl}
                onChange={(event) => onImageChange(node.id, { imageUrl: event.target.value, content })}
                placeholder="/images/reference.png"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">参考说明</span>
              <textarea
                className="mt-2 min-h-[104px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                value={content}
                onChange={(event) => onImageChange(node.id, { imageUrl, content: event.target.value })}
              />
            </label>
          </div>
        ) : null}

        {node.type === "generation" ? (
          <section data-cola-panel="canvas-task-details" className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-slate-500">任务详情</h3>
              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-500">
                {generationStatusLabels[generationStatus]}
              </span>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-500">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                <span>任务 ID</span>
                <span className="max-w-[190px] truncate font-mono text-[11px] text-slate-700">{node.metadata?.sourceTaskId || "本地任务"}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <span className="rounded-xl bg-white px-2 py-2 text-slate-600">{node.metadata?.model || "gpt-image-2"}</span>
                <span className="rounded-xl bg-white px-2 py-2 text-slate-600">{node.metadata?.size || "智能"}</span>
                <span className="rounded-xl bg-white px-2 py-2 text-slate-600">第 {node.metadata?.attempt || 1} 次</span>
              </div>
              {node.metadata?.errorDetails ? (
                <p className="rounded-xl bg-rose-50 px-3 py-2 leading-5 text-rose-600">{node.metadata.errorDetails}</p>
              ) : null}
              {node.metadata?.prompt ? (
                <p className="line-clamp-4 whitespace-pre-wrap rounded-xl bg-white px-3 py-2 leading-5 text-slate-500">
                  {node.metadata.prompt}
                </p>
              ) : null}
              {canOpenSourceTask ? (
                <button
                  type="button"
                  data-cola-action="open-source-generate-task"
                  data-cola-source-task-id={sourceTaskId}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-white px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 hover:text-slate-950"
                  onClick={() => onOpenSourceTask?.(sourceTaskId)}
                >
                  <ExternalLink className="size-3.5" />
                  查看生图任务
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {node.type === "config" ? (
          <div className="grid gap-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">生成说明</span>
              <textarea
                className="mt-2 min-h-[104px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                value={node.metadata?.prompt || ""}
                onChange={(event) =>
                  onConfigChange(node.id, {
                    prompt: event.target.value,
                    model: node.metadata?.model || "gpt-image-2",
                    size: node.metadata?.size || "1:1",
                    count: node.metadata?.count || 1,
                  })
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">模型</span>
                <select
                  className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-300"
                  value={node.metadata?.model || "gpt-image-2"}
                  onChange={(event) =>
                    onConfigChange(node.id, {
                      prompt: node.metadata?.prompt || "",
                      model: event.target.value,
                      size: node.metadata?.size || "1:1",
                      count: node.metadata?.count || 1,
                    })
                  }
                >
                  {modelOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">比例</span>
                <select
                  className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-300"
                  value={node.metadata?.size || "1:1"}
                  onChange={(event) =>
                    onConfigChange(node.id, {
                      prompt: node.metadata?.prompt || "",
                      model: node.metadata?.model || "gpt-image-2",
                      size: event.target.value,
                      count: node.metadata?.count || 1,
                    })
                  }
                >
                  {sizeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500">生成数量</span>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={cn(
                      "h-9 rounded-xl text-sm font-semibold transition",
                      (node.metadata?.count || 1) === count ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500 hover:bg-violet-100",
                    )}
                    onClick={() =>
                      onConfigChange(node.id, {
                        prompt: node.metadata?.prompt || "",
                        model: node.metadata?.model || "gpt-image-2",
                        size: node.metadata?.size || "1:1",
                        count,
                      })
                    }
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {node.type === "video" ? (
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">视频生成占位</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{content || "视频节点未开发，请勿使用。"}</p>
          </div>
        ) : null}

        {upstreamSummary ? (
          <section className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-500">上游输入</h3>
              <span className="text-[11px] text-slate-400">{upstreamSummary.nodes.length} 个节点</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <span className="rounded-xl bg-white px-2 py-2 text-slate-600">文本 {upstreamSummary.textCount}</span>
              <span className="rounded-xl bg-white px-2 py-2 text-slate-600">图片 {upstreamSummary.imageCount}</span>
              <span className="rounded-xl bg-white px-2 py-2 text-slate-600">配置 {upstreamSummary.configCount}</span>
            </div>
            {upstreamSummary.promptPreview ? (
              <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-500">
                {upstreamSummary.promptPreview}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      {canGenerate ? (
        <div className="border-t border-slate-100 p-4">
          <button
            type="button"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white"
            onClick={onOpenGeneration}
          >
            <Sparkles className="size-4" />
            基于节点继续生成
          </button>
        </div>
      ) : null}
    </aside>
  );
}
