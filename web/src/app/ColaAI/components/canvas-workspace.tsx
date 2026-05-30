"use client";

import { ArrowLeft, Boxes, ImagePlus, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchImageTasks, type ImageTask } from "@/lib/api";
import { computeAutoLayout, computeFitViewport } from "./canvas-auto-layout";
import { CanvasGenerationPanel } from "./canvas-generation-panel";
import { createCanvasGenerationTasks } from "./canvas-generation-tasks";
import { readCanvasImageFile } from "./canvas-image-files";
import { CanvasMinimapPanel } from "./canvas-minimap-panel";
import { CanvasToolbar } from "./canvas-toolbar";
import { getCanvasViewport } from "./canvas-viewport-store";
import { collectCanvasContinuationSettings, collectCanvasGenerationSettings, getCanvasContinuationInputCounts } from "./canvas-workflow";
import { InfiniteCanvasSurface } from "./infinite-canvas-surface";
import { configNodeHeight, configNodeWidth, useCanvasStore } from "./use-canvas-store";
import type { CanvasInteractionMode, CanvasNodeData, CanvasNodeStatus, CanvasPoint, CanvasState, CanvasViewport } from "./canvas-types";

type CanvasWorkspaceProps = {
  onBack: (state: CanvasState) => void;
  onOpenSourceTask?: (task: CanvasSourceTaskFocus) => void;
  initialState?: CanvasState;
};

export type CanvasSourceTaskFocus = {
  id: string;
  nodeId: string;
  prompt: string;
  error: string;
  status: CanvasNodeStatus;
  model: string;
  size: string;
  attempt: number;
};

type GenerationSettings = {
  prompt: string;
  model: string;
  size: string;
  count: number;
};

const terminalTaskStatuses = new Set<ImageTask["status"]>(["success", "error", "cancelled"]);

function createClientTaskId(index: number) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `canvas-${index + 1}-${random}`;
}

function imageUrlFromTask(task: ImageTask) {
  const first = task.data?.[0];
  // 优先使用签名 URL（公开访问，无需认证下载）
  if (first?.signed_url) {
    return first.signed_url;
  }
  if (first?.url) {
    return first.url;
  }
  if (first?.b64_json) {
    return `data:image/png;base64,${first.b64_json}`;
  }
  return "";
}

function canvasStatusFromTask(task: ImageTask) {
  if (task.status === "success") {
    return "success" as const;
  }
  if (task.status === "error" || task.status === "cancelled") {
    return "error" as const;
  }
  return "loading" as const;
}

function getCanvasViewportSize() {
  return {
    width: typeof window !== "undefined" ? window.innerWidth : 1200,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  };
}

function canvasRectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function findOpenCanvasNodePosition(
  nodes: CanvasNodeData[],
  viewport: CanvasViewport,
  surfaceSize: { width: number; height: number },
  nodeSize: { width: number; height: number },
): CanvasPoint {
  const gap = 40;
  const stepX = nodeSize.width + gap;
  const stepY = nodeSize.height + gap;
  const centerScreenX = Math.max(260, surfaceSize.width / 2 - nodeSize.width / 2);
  const centerScreenY = Math.max(140, surfaceSize.height / 2 - nodeSize.height / 2);
  const base = {
    x: Math.round((centerScreenX - viewport.x) / viewport.k),
    y: Math.round((centerScreenY - viewport.y) / viewport.k),
  };

  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const position = {
        x: base.x + col * stepX,
        y: base.y + row * stepY,
      };
      const candidate = { ...position, width: nodeSize.width, height: nodeSize.height };
      const overlaps = nodes.some((node) =>
        canvasRectsOverlap(candidate, {
          x: node.position.x,
          y: node.position.y,
          width: node.width,
          height: node.height,
        }),
      );
      if (!overlaps) {
        return position;
      }
    }
  }

  return {
    x: base.x + (nodes.length % 6) * stepX,
    y: base.y + Math.floor(nodes.length / 6) * stepY,
  };
}

export function getCanvasContinuationPanelPrompt(
  node: CanvasNodeData | null | undefined,
  workflowPrompt: string,
  fallbackPrompt = "",
) {
  if (node?.type === "generation" && node.metadata?.imageUrl) {
    return "";
  }

  return workflowPrompt || fallbackPrompt;
}

export function getCanvasGenerationPanelConfigTargetId(
  nodes: CanvasNodeData[],
  targetNodeId: string | null | undefined,
) {
  const targetNode = nodes.find((node) => node.id === targetNodeId);
  return targetNode?.type === "config" ? targetNode.id : null;
}

export function getCanvasGenerationLaunchIntent(node: CanvasNodeData | null | undefined) {
  if (!node || !["image", "config", "generation"].includes(node.type)) {
    return "ignore" as const;
  }
  return node.type === "config" ? "submit" as const : "panel" as const;
}

export function CanvasWorkspace({ onBack, initialState }: CanvasWorkspaceProps) {
  const {
    state,
    selectedNode,
    canRedo,
    canUndo,
    addConfigNode,
    addConnectedNode,
    addConnection,
    addImageNode,
    addTextNode,
    appendGenerationNode,
    deleteSelected,
    disconnectNode,
    duplicateSelectedNodes,
    finalizeHistoryBatch,
    moveNode,
    moveNodes,
    nudgeSelectedNodes,
    renameNode,
    redo,
    selectAllNodes,
    selectConnection,
    selectNode,
    selectNodes,
    toggleNodeSelection,
    updateConfigNode,
    updateNodeContent,
    updateGenerationNodeRetrying,
    updateGenerationNodePayload,
    updateGenerationTaskNode,
    updateImageNode,
    updateViewport,
    undo,
  } = useCanvasStore(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTargetNodeId, setPanelTargetNodeId] = useState<string | null>(null);
  const [activeTaskIds, setActiveTaskIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<GenerationSettings>({
    prompt: "霓虹城市夜景，电影感光影，高质量细节。",
    model: "gpt-image-2",
    size: "1:1",
    count: 1,
  });
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>("pointer");
  const nodesRef = useRef(state.nodes);
  const retryingNodeIdsRef = useRef(new Set<string>());
  const surfaceSizeRef = useRef(getCanvasViewportSize());
  const handleBack = useCallback(() => {
    onBack({ ...state, viewport: getCanvasViewport() });
  }, [onBack, state]);

  useEffect(() => {
    nodesRef.current = state.nodes;
  }, [state.nodes]);

  const canGenerate = Boolean(
    state.selectedNodeIds.length === 1 &&
    selectedNode &&
    ["image", "config", "generation"].includes(selectedNode.type),
  );
  const canDelete = Boolean(state.selectedNodeIds.length > 0 || state.selectedConnectionId);

  const panelTargetNode = useMemo(() => {
    if (!panelTargetNodeId) {
      return selectedNode;
    }
    return state.nodes.find((node) => node.id === panelTargetNodeId) ?? null;
  }, [panelTargetNodeId, selectedNode, state.nodes]);

  const panelInputCounts = useMemo(() => {
    if (!panelTargetNode) {
      return { promptCount: 0, referenceCount: 0 };
    }
    return getCanvasContinuationInputCounts(
      state,
      panelTargetNode.id,
      settings.prompt,
    );
  }, [panelTargetNode, settings, state]);

  useEffect(() => {
    if (activeTaskIds.length === 0) {
      return;
    }

    let active = true;

    async function pollTasks() {
      try {
        const result = await fetchImageTasks(activeTaskIds);
        if (!active) {
          return;
        }
        result.items.forEach((task) => {
          updateGenerationTaskNode(task.id, {
            imageUrl: imageUrlFromTask(task),
            status: canvasStatusFromTask(task),
            errorDetails: task.error,
          });
        });
        const terminalIds = new Set(result.items.filter((task) => terminalTaskStatuses.has(task.status)).map((task) => task.id));
        if (terminalIds.size > 0) {
          setActiveTaskIds((current) => current.filter((id) => !terminalIds.has(id)));
        }
      } catch {
        // Keep polling. Existing task state remains visible in the canvas.
      }
    }

    void pollTasks();
    const timer = window.setInterval(() => void pollTasks(), 2600);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeTaskIds, updateGenerationTaskNode]);

  function createNodePosition(nodeSize: { width: number; height: number }) {
    const viewport = getCanvasViewport();
    return findOpenCanvasNodePosition(nodesRef.current, viewport, surfaceSizeRef.current, nodeSize);
  }

  const isBlankCanvas = state.nodes.length === 0;

  const handleStartWithText = useCallback(() => {
    addTextNode(createNodePosition({ width: 280, height: 170 }));
  }, [addTextNode]);

  const handleStartWithImage = useCallback(() => {
    addImageNode({ position: createNodePosition({ width: 240, height: 220 }), imageUrl: "", title: "图片节点" });
  }, [addImageNode]);

  const handleStartWithConfig = useCallback(() => {
    addConfigNode(createNodePosition({ width: configNodeWidth, height: configNodeHeight }));
  }, [addConfigNode]);

  function handleAutoLayout(mode: "grid" | "tree") {
    const selectedNodeIds = new Set(state.selectedNodeIds);
    const targetNodes = state.selectedNodeIds.length > 1
      ? state.nodes.filter((node) => selectedNodeIds.has(node.id))
      : state.nodes;
    const positions = computeAutoLayout(mode, targetNodes, state.connections);
    if (Object.keys(positions).length > 0) {
      const nextNodes = state.nodes.map((node) => (
        positions[node.id]
          ? { ...node, position: positions[node.id] }
          : node
      ));
      moveNodes(positions);
      const viewport = computeFitViewport(
        state.selectedNodeIds.length > 1 ? nextNodes.filter((node) => selectedNodeIds.has(node.id)) : nextNodes,
        surfaceSizeRef.current,
      );
      if (viewport) {
        updateViewport(viewport);
      }
    }
  }

  function handleFitView() {
    if (state.nodes.length === 0) {
      updateViewport({ x: 0, y: 0, k: 1 });
      return;
    }
    const viewport = computeFitViewport(state.nodes, surfaceSizeRef.current);
    if (viewport) {
      updateViewport(viewport);
    }
  }

  const handleSurfaceSizeChange = useCallback((size: { width: number; height: number }) => {
    surfaceSizeRef.current = size;
  }, []);

  const openGenerationForNode = useCallback((nodeId: string) => {
    selectNode(nodeId);
    const node = nodesRef.current.find((item) => item.id === nodeId);
    const launchIntent = getCanvasGenerationLaunchIntent(node);
    if (node && launchIntent !== "ignore") {
      const workflowSettings = collectCanvasGenerationSettings(
        {
          ...state,
          nodes: nodesRef.current,
        },
        node.id,
        settings,
      );
      setSettings((current) => ({
        ...current,
        prompt: getCanvasContinuationPanelPrompt(node, workflowSettings.prompt),
        model: workflowSettings.model || current.model,
        size: workflowSettings.size || current.size,
        count: workflowSettings.count || current.count,
      }));
      if (launchIntent === "submit") {
        void handleSubmitGenerationForNode(node.id, {
          prompt: getCanvasContinuationPanelPrompt(node, workflowSettings.prompt),
          model: workflowSettings.model || settings.model,
          size: workflowSettings.size || settings.size,
          count: workflowSettings.count || settings.count,
        });
        return;
      }
      setPanelTargetNodeId(node.id);
      setPanelOpen(true);
    }
  }, [selectNode, settings, state]);

  const handleGenerationSettingsChange = useCallback((patch: Partial<GenerationSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    const configTargetId = getCanvasGenerationPanelConfigTargetId(nodesRef.current, panelTargetNodeId);
    if (configTargetId) {
      updateConfigNode(configTargetId, patch);
    }
  }, [panelTargetNodeId, updateConfigNode]);

  const handleCanvasImageFileDrop = useCallback(async (file: File, position: { x: number; y: number }, targetNodeId?: string) => {
    const payload = await readCanvasImageFile(file);

    if (targetNodeId) {
      updateImageNode(targetNodeId, {
        imageUrl: payload.imageUrl,
        content: payload.content,
      });
      renameNode(targetNodeId, payload.title);
      return;
    }

    addImageNode({
      position,
      imageUrl: payload.imageUrl,
      title: payload.title,
    });
  }, [addImageNode, renameNode, updateImageNode]);

  async function handleSubmitGenerationForNode(nodeId: string, nextSettings = settings) {
    const targetNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!targetNode) {
      return;
    }

    setSubmitting(true);
    try {
      const workflowSettings = collectCanvasContinuationSettings(
        {
          ...state,
          nodes: nodesRef.current,
        },
        targetNode.id,
        nextSettings.prompt,
        nextSettings,
      );
      if (!workflowSettings.prompt.trim()) {
        return;
      }

      const tasks = await createCanvasGenerationTasks(workflowSettings, {
        createTaskId: createClientTaskId,
      });

      tasks.forEach((task) => {
        const imageUrl = imageUrlFromTask(task) || targetNode.metadata?.imageUrl || "";
        appendGenerationNode(targetNode.id, {
          prompt: workflowSettings.prompt.trim(),
          imageUrl,
          sourceTaskId: task.id,
          status: canvasStatusFromTask(task),
          errorDetails: task.error,
          model: workflowSettings.model,
          size: workflowSettings.size,
          attempt: 1,
        });
      });
      setActiveTaskIds((current) => [
        ...current,
        ...tasks.filter((task) => !terminalTaskStatuses.has(task.status)).map((task) => task.id),
      ]);
      setPanelOpen(false);
      setPanelTargetNodeId(null);
    } finally {
      setSubmitting(false);
    }
  }

  const retryGenerationNode = useCallback((nodeId: string) => {
    const retryNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!retryNode || retryNode.type !== "generation" || retryNode.metadata?.retrying || retryingNodeIdsRef.current.has(nodeId)) {
      return;
    }
    void (async () => {
      const workflowSettings = collectCanvasGenerationSettings(
        {
          ...state,
          nodes: nodesRef.current,
        },
        retryNode.id,
        {
          ...settings,
          prompt: retryNode.metadata?.prompt || retryNode.metadata?.content || settings.prompt,
        },
      );
      const prompt = retryNode.metadata?.prompt || workflowSettings.prompt;
      if (!prompt.trim()) {
        return;
      }

      retryingNodeIdsRef.current.add(nodeId);
      updateGenerationNodeRetrying(retryNode.id, true);
      const attempt = (retryNode.metadata?.attempt || 1) + 1;
      try {
        const tasks = await createCanvasGenerationTasks(
          {
            ...workflowSettings,
            prompt,
            count: 1,
          },
          {
            createTaskId: createClientTaskId,
          },
        );

        tasks.forEach((task) => {
          const imageUrl = imageUrlFromTask(task) || retryNode.metadata?.imageUrl || "";
          updateGenerationNodePayload(retryNode.id, {
            prompt: prompt.trim(),
            imageUrl,
            sourceTaskId: task.id,
            status: canvasStatusFromTask(task),
            errorDetails: task.error,
            model: workflowSettings.model,
            size: workflowSettings.size,
            attempt,
          });
        });
        setActiveTaskIds((current) => [
          ...current,
          ...tasks.filter((task) => !terminalTaskStatuses.has(task.status)).map((task) => task.id),
        ]);
      } catch (error) {
        updateGenerationNodePayload(retryNode.id, {
          prompt: prompt.trim(),
          imageUrl: retryNode.metadata?.imageUrl || "",
          status: "error",
          errorDetails: error instanceof Error ? error.message : "重试提交失败，请稍后再试。",
          model: workflowSettings.model,
          size: workflowSettings.size,
          attempt,
        });
      } finally {
        retryingNodeIdsRef.current.delete(retryNode.id);
        updateGenerationNodeRetrying(retryNode.id, false);
      }
    })();
  }, [settings, state, updateGenerationNodePayload, updateGenerationNodeRetrying]);

  return (
    <main
      data-cola-panel="canvas-workspace"
      data-cola-canvas="floating-studio-light"
      className="fixed inset-0 z-50 overflow-hidden bg-[#f7f8fb] text-slate-950"
    >
      <div
        data-cola-canvas-bg="studio-grid"
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(124,58,237,0.14),transparent_30%),radial-gradient(circle_at_82%_76%,rgba(14,165,233,0.1),transparent_28%),linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[length:auto,auto,28px_28px,28px_28px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0)_22%,rgba(241,245,249,0.34)_100%)]"
      />

      <div
        data-cola-panel="canvas-topbar"
        className="absolute left-5 top-4 z-40 flex items-center gap-3 rounded-[18px] border border-white/70 bg-white/88 px-3 py-2 text-slate-700 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.46)] ring-1 ring-slate-900/5 backdrop-blur-xl"
      >
        <button type="button" aria-label="返回" className="grid size-8 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" onClick={handleBack}>
          <ArrowLeft className="size-4" />
        </button>
        <span className="h-5 w-px bg-slate-200/80" />
        <span className="rounded-xl px-2 py-1 text-sm font-semibold text-slate-950">{state.title}</span>
      </div>

      {isBlankCanvas ? (
        <section
          data-cola-panel="canvas-empty-state"
          className="absolute inset-x-4 top-24 z-30 mx-auto max-w-[760px] rounded-[30px] border border-white/70 bg-white/84 p-6 text-slate-950 shadow-[0_30px_80px_-52px_rgba(15,23,42,0.46)] ring-1 ring-slate-900/5 backdrop-blur-2xl md:left-[104px] md:right-10 md:top-28 md:p-7"
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
            Blank canvas
          </div>
          <h2 className="mt-4 text-[clamp(28px,5vw,42px)] font-semibold tracking-[-0.03em] text-slate-950">
            从第一个节点开始
          </h2>
          <p className="mt-3 max-w-[600px] text-sm leading-7 text-slate-600 md:text-base">
            先放一段提示词、一张参考图，或者直接摆上生成配置。画布会从你放下的第一个节点开始长出来。
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <button
              type="button"
              data-cola-action="canvas-empty-add-text"
              className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300"
              onClick={handleStartWithText}
            >
              <span className="grid size-10 place-items-center rounded-2xl bg-slate-950 text-white">
                <Type className="size-4" />
              </span>
              <div className="mt-4 text-base font-semibold text-slate-950">先写提示词</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">放下第一段创意描述，后面再接参考图和生成配置。</p>
            </button>

            <button
              type="button"
              data-cola-action="canvas-empty-add-image"
              className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300"
              onClick={handleStartWithImage}
            >
              <span className="grid size-10 place-items-center rounded-2xl bg-violet-50 text-violet-700 ring-1 ring-violet-100">
                <ImagePlus className="size-4" />
              </span>
              <div className="mt-4 text-base font-semibold text-slate-950">先放参考图</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">从一张图开始搭构图、角色或产品风格，再把结果串起来。</p>
            </button>

            <button
              type="button"
              data-cola-action="canvas-empty-add-config"
              className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300"
              onClick={handleStartWithConfig}
            >
              <span className="grid size-10 place-items-center rounded-2xl bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
                <Boxes className="size-4" />
              </span>
              <div className="mt-4 text-base font-semibold text-slate-950">先放输出目标</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">先定模型、比例和结果方向，再回头补前面的创意输入。</p>
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-cola-action="canvas-empty-back-home"
              className="inline-flex items-center rounded-full px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-white hover:text-slate-900"
              onClick={handleBack}
            >
              返回画布首页
            </button>
            <span className="text-xs text-slate-400">也可以直接用底部工具条开始搭第一条链路。</span>
          </div>
        </section>
      ) : null}

      <InfiniteCanvasSurface
        interactionMode={interactionMode}
        state={state}
        onAddConnectedNode={addConnectedNode}
        onAddConnection={addConnection}
        onConfigChange={updateConfigNode}
        onContentChange={updateNodeContent}
        onDeleteSelected={deleteSelected}
        onDisconnectNode={disconnectNode}
        onDuplicateSelectedNodes={duplicateSelectedNodes}
        onFinalizeHistoryBatch={finalizeHistoryBatch}
        onImageFileDrop={(file, position, targetNodeId) => void handleCanvasImageFileDrop(file, position, targetNodeId)}
        onMoveNode={moveNode}
        onMoveNodes={moveNodes}
        onNudgeSelectedNodes={nudgeSelectedNodes}
        onOpenGeneration={openGenerationForNode}
        onRedo={redo}
        onRenameNode={renameNode}
        onRetryGeneration={retryGenerationNode}
        onSelectAllNodes={selectAllNodes}
        onSelectConnection={selectConnection}
        onSelectNode={selectNode}
        onSelectNodes={selectNodes}
        onToggleNodeSelection={toggleNodeSelection}
        onUndo={undo}
        onSurfaceSizeChange={handleSurfaceSizeChange}
        onViewportChange={updateViewport}
      />

      <CanvasToolbar
        canDelete={canDelete}
        canGenerate={canGenerate}
        interactionMode={interactionMode}
        canOrganize={state.nodes.length > 1}
        canRedo={canRedo}
        canUndo={canUndo}
        onAddConfig={() => addConfigNode(createNodePosition({ width: configNodeWidth, height: configNodeHeight }))}
        onAddImage={() => addImageNode({ position: createNodePosition({ width: 240, height: 220 }), imageUrl: "", title: "图片节点" })}
        onAddText={() => addTextNode(createNodePosition({ width: 280, height: 170 }))}
        onDelete={deleteSelected}
        onInteractionModeChange={setInteractionMode}
        onOpenGeneration={() => {
          if (selectedNode) {
            openGenerationForNode(selectedNode.id);
          }
        }}
        onOrganize={() => handleAutoLayout("tree")}
        onRedo={redo}
        onUndo={undo}
      />

      <CanvasMinimapPanel
        nodes={state.nodes}
        selectedNodeIds={state.selectedNodeIds}
        onViewportChange={updateViewport}
        onFitView={handleFitView}
        onZoomIn={() => {
          const current = getCanvasViewport();
          updateViewport({ ...current, k: current.k * 1.16 });
        }}
        onZoomOut={() => {
          const current = getCanvasViewport();
          updateViewport({ ...current, k: current.k / 1.16 });
        }}
      />

      <CanvasGenerationPanel
        open={panelOpen}
        selectedNode={panelTargetNode}
        prompt={settings.prompt}
        promptCount={panelInputCounts.promptCount}
        referenceCount={panelInputCounts.referenceCount}
        model={settings.model}
        size={settings.size}
        count={settings.count}
        submitting={submitting}
        onChange={handleGenerationSettingsChange}
        onClose={() => {
          setPanelOpen(false);
          setPanelTargetNodeId(null);
        }}
        onSubmit={() => {
          if (panelTargetNode) {
            void handleSubmitGenerationForNode(panelTargetNode.id);
          }
        }}
      />

    </main>
  );
}
