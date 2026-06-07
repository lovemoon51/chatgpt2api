"use client";

import { Check, ArrowRight, LayoutTemplate, Layers3, Plus, Sparkles, Trash2 } from "lucide-react";

import { parseBackendDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { CanvasHomeEntry, CanvasHomeSummary, CanvasTemplateCard } from "./canvas-home-state";
import { colaButtonClass, colaCardClass, colaFocusClass, colaPanelClass } from "./cola-ai-style";

type CanvasHomeProps = {
  canvases: CanvasHomeEntry[];
  templates: CanvasTemplateCard[];
  onOpenCanvas: (canvasId: string) => void;
  onCreateBlank: () => void;
  onSelectTemplate: (templateId: CanvasTemplateCard["id"]) => void;
  onDeleteCanvas: (canvasId: string) => void;
  selectedCanvasIds: string[];
  onToggleCanvasSelection: (canvasId: string) => void;
  onToggleAllCanvasSelection: () => void;
  onDeleteSelectedCanvases: () => void;
};

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return "刚刚准备好";
  }

  const date = parseBackendDateTime(value);
  if (!date) {
    return "最近编辑";
  }

  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCountLabel(label: string, count: number) {
  if (count <= 0) {
    return null;
  }

  return `${label} ${count}`;
}

function getNodeSummaryChips(summary: CanvasHomeSummary) {
  return [
    formatCountLabel("文本", summary.nodeTypeCounts.text),
    formatCountLabel("参考图", summary.nodeTypeCounts.image),
    formatCountLabel("配置", summary.nodeTypeCounts.config),
    formatCountLabel("生成结果", summary.nodeTypeCounts.generation),
  ].filter((item): item is string => Boolean(item));
}

export function CanvasHome({
  canvases,
  templates,
  onOpenCanvas,
  onCreateBlank,
  onSelectTemplate,
  onDeleteCanvas,
  selectedCanvasIds,
  onToggleCanvasSelection,
  onToggleAllCanvasSelection,
  onDeleteSelectedCanvases,
}: CanvasHomeProps) {
  const hasCanvases = canvases.length > 0;
  const selectedCanvasIdSet = new Set(selectedCanvasIds);
  const selectedCanvasCount = selectedCanvasIds.length;
  const allCanvasesSelected = hasCanvases && selectedCanvasCount === canvases.length;

  return (
    <main
      data-cola-panel="canvas-home"
      data-cola-design="clear-studio-canvas-home"
      className="fixed inset-0 z-30 overflow-y-auto bg-transparent text-slate-950"
    >
      <div className="relative mx-auto min-h-[100dvh] w-full max-w-[1280px] px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-6 md:pb-12 md:pl-[128px] md:pr-8 md:pt-8">
        <section
          data-cola-section="canvas-library"
          className={cn(colaPanelClass, "p-5 md:p-8")}
        >
          <div className="flex flex-col gap-5 border-b border-slate-200/70 pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-sm font-medium text-slate-500">画布库</div>
              <h1 className="mt-3 text-[clamp(34px,4vw,46px)] font-semibold leading-none tracking-[-0.045em] text-slate-950">
                无限画布
              </h1>
              <p className="mt-3 max-w-[44rem] text-sm leading-6 text-slate-500 md:text-[15px]">
                管理你的创意画布，打开上一次的节点链路，或者从空白画布开始新的创作。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-cola-action="create-blank-canvas"
                className={colaButtonClass("primary", "h-11 rounded-[16px]")}
                onClick={onCreateBlank}
              >
                <Plus className="size-4" />
                新建空白画布
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                    <Layers3 className="size-4 text-sky-500" />
                    我的画布
                  </div>
                  {hasCanvases && (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-8 items-center gap-2 rounded-[12px] border px-3 text-xs font-semibold transition",
                        allCanvasesSelected
                          ? "border-sky-200 bg-sky-50 text-sky-700"
                          : "border-slate-200 bg-white/70 text-slate-500 hover:border-sky-200 hover:text-sky-700",
                      )}
                      onClick={onToggleAllCanvasSelection}
                    >
                      <span className={cn(
                        "grid size-4 place-items-center rounded-[5px] border",
                        allCanvasesSelected ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300 bg-white",
                      )}
                      >
                        {allCanvasesSelected && <Check className="size-3" />}
                      </span>
                      全选
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedCanvasCount > 0 && (
                    <>
                      <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                        已选 {selectedCanvasCount}
                      </span>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-2 rounded-[12px] border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                        onClick={onDeleteSelectedCanvases}
                      >
                        <Trash2 className="size-3.5" />
                        删除选中
                      </button>
                    </>
                  )}
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                    {canvases.length} 个项目
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {hasCanvases ? (
                  canvases.map((canvas, index) => {
                    const updatedAt = formatUpdatedAt(canvas.updatedAt);
                    const nodeSummaryChips = getNodeSummaryChips(canvas);
                    const isSelected = selectedCanvasIdSet.has(canvas.id);
                    return (
                      <article
                        key={canvas.id}
                        data-cola-card={index === 0 ? "current-canvas" : "canvas-record"}
                        data-cola-action="continue-canvas-home"
                        data-cola-canvas-id={canvas.id}
                        className={cn(colaCardClass, "group min-h-[212px] p-5 text-left")}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <button
                            type="button"
                            aria-label={`${isSelected ? "取消选择" : "选择"}画布 ${canvas.title}`}
                            aria-pressed={isSelected}
                            className={cn(
                              "grid size-7 place-items-center rounded-[9px] border shadow-inner transition",
                              colaFocusClass,
                              isSelected
                                ? "border-sky-500 bg-sky-500 text-white shadow-sky-500/20"
                                : "border-slate-300 bg-white text-transparent hover:border-sky-300 hover:text-sky-500",
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleCanvasSelection(canvas.id);
                            }}
                          >
                            <Check className="size-4" />
                          </button>
                          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">最近编辑 {updatedAt}</span>
                        </div>

                        <h2 className="mt-5 text-2xl font-semibold tracking-[-0.035em] text-slate-950">{canvas.title}</h2>
                        <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-500">
                          <span>{canvas.nodeCount} 个节点</span>
                          <span className="text-slate-300">·</span>
                          <span>{canvas.hasGenerativeContent ? "已包含生成结果" : "尚未生成"}</span>
                        </div>

                        <div className="mt-8 flex items-end justify-between gap-4">
                          <div className="flex flex-wrap gap-2">
                            {nodeSummaryChips.length > 0 ? (
                              nodeSummaryChips.map((chip) => (
                                <span key={chip} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                  {chip}
                                </span>
                              ))
                            ) : (
                              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">空白画布</span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-label={`删除画布 ${canvas.title}`}
                              title="删除"
                              className={colaButtonClass("ghost", "size-10 rounded-[14px] p-0 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600")}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteCanvas(canvas.id);
                              }}
                            >
                              <Trash2 className="size-4" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950"
                              onClick={() => onOpenCanvas(canvas.id)}
                            >
                              打开画布
                              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <button
                    type="button"
                    data-cola-card="current-canvas"
                    className={cn(colaCardClass, "group min-h-[212px] border-dashed border-cyan-200 bg-cyan-50/62 p-5 text-left")}
                    onClick={onCreateBlank}
                  >
                    <div className="grid size-11 place-items-center rounded-[18px] bg-white text-sky-600 shadow-[0_16px_36px_-28px_rgba(14,165,233,0.8)]">
                      <Plus className="size-5" />
                    </div>
                    <h2 className="mt-5 text-2xl font-semibold tracking-[-0.035em] text-slate-950">还没有画布</h2>
                    <p className="mt-3 max-w-[24rem] text-sm leading-6 text-slate-500">先创建一张画布，把提示词、参考图和生成配置放进同一个工作空间。</p>
                    <span className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-sky-700">
                      创建第一张画布
                      <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                    </span>
                  </button>
                )}
              </div>
            </section>

            <aside className={cn(colaPanelClass, "p-5")}>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Sparkles className="size-4 text-sky-500" />
                快速开始
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                不需要先想结构。你可以新建空白画布，再在编辑器里添加文字、参考图和生成配置。
              </p>
              <button
                type="button"
                className={colaButtonClass("secondary", "mt-5 h-11 w-full rounded-[16px]")}
                onClick={onCreateBlank}
              >
                <Plus className="size-4" />
                新建空白画布
              </button>
            </aside>
          </div>

          <section data-cola-section="canvas-templates" className="mt-8 border-t border-slate-200/70 pt-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <LayoutTemplate className="size-4 text-sky-500" />
                模板起步
              </div>
              <p className="text-sm text-slate-500">选择一个模板会直接生成可编辑的画布节点。</p>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  data-cola-template={template.id}
                  className={cn(colaCardClass, "group p-4 text-left")}
                  onClick={() => onSelectTemplate(template.id)}
                >
                  <div className={cn("h-2 w-16 rounded-full bg-gradient-to-r", template.accentClassName)} />
                  <div className="mt-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold tracking-[-0.025em] text-slate-950">{template.title}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-500">{template.description}</p>
                    </div>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-sky-500" />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {template.highlights.map((highlight) => (
                      <span key={highlight} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {highlight}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
