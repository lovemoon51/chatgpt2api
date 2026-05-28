"use client";

import { ArrowLeft, Bot, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchImageTasks, type ImageTask } from "@/lib/api";
import { CanvasGenerationPanel } from "./canvas-generation-panel";
import { createCanvasGenerationTasks } from "./canvas-generation-tasks";
import { readCanvasImageFile } from "./canvas-image-files";
import { CanvasNodeInspector } from "./canvas-node-inspector";
import { CanvasToolbar } from "./canvas-toolbar";
import { getCanvasViewport } from "./canvas-viewport-store";
import { CanvasZoomControls } from "./canvas-zoom-controls";
import { collectCanvasGenerationSettings, summarizeCanvasUpstream } from "./canvas-workflow";
import { InfiniteCanvasSurface } from "./infinite-canvas-surface";
import { useCanvasStore } from "./use-canvas-store";
import type { CanvasNodeData, CanvasNodeStatus } from "./canvas-types";

type CanvasWorkspaceProps = {
  onBack: () => void;
  onOpenSourceTask?: (task: CanvasSourceTaskFocus) => void;
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

function sourceTaskFocusFromNode(node: CanvasNodeData): CanvasSourceTaskFocus | null {
  const sourceTaskId = node.metadata?.sourceTaskId;
  if (node.type !== "generation" || !sourceTaskId) {
    return null;
  }

  return {
    id: sourceTaskId,
    nodeId: node.id,
    prompt: node.metadata?.prompt || node.metadata?.content || "",
    error: node.metadata?.errorDetails || "",
    status: node.metadata?.status || "idle",
    model: node.metadata?.model || "gpt-image-2",
    size: node.metadata?.size || "智能",
    attempt: Math.max(1, node.metadata?.attempt || 1),
  };
}

export function CanvasWorkspace({ onBack, onOpenSourceTask }: CanvasWorkspaceProps) {
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
    updateGenerationTaskNode,
    updateImageNode,
    updateViewport,
    undo,
  } = useCanvasStore();
  const [panelOpen, setPanelOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeTaskIds, setActiveTaskIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<GenerationSettings>({
    prompt: "霓虹城市夜景，电影感光影，高质量细节。",
    model: "gpt-image-2",
    size: "1:1",
    count: 1,
  });
  const nodesRef = useRef(state.nodes);
  const retryingNodeIdsRef = useRef(new Set<string>());

  useEffect(() => {
    nodesRef.current = state.nodes;
  }, [state.nodes]);

  const canGenerate = Boolean(
    state.selectedNodeIds.length === 1 &&
    selectedNode &&
    ["image", "config", "generation"].includes(selectedNode.type),
  );
  const canDelete = Boolean(state.selectedNodeIds.length > 0 || state.selectedConnectionId);

  const derivedPrompt = useMemo(() => {
    if (!selectedNode) {
      return settings.prompt;
    }
    return collectCanvasGenerationSettings(state, selectedNode.id, settings).prompt;
  }, [selectedNode, settings, state]);

  const upstreamSummary = useMemo(() => (
    selectedNode ? summarizeCanvasUpstream(state, selectedNode.id) : null
  ), [selectedNode, state]);

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

  function createNodePosition() {
    const viewport = getCanvasViewport();
    return {
      x: (320 - viewport.x) / viewport.k,
      y: (220 - viewport.y) / viewport.k,
    };
  }

  function openGeneration() {
    if (!canGenerate) {
      return;
    }
    const workflowSettings = selectedNode
      ? collectCanvasGenerationSettings(state, selectedNode.id, settings)
      : null;
    setSettings((current) => ({
      ...current,
      prompt: workflowSettings?.prompt || derivedPrompt,
      model: workflowSettings?.model || current.model,
      size: workflowSettings?.size || current.size,
      count: workflowSettings?.count || current.count,
    }));
    setPanelOpen(true);
  }

  const openGenerationForNode = useCallback((nodeId: string) => {
    selectNode(nodeId);
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (node && ["image", "config", "generation"].includes(node.type)) {
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
        prompt: workflowSettings.prompt,
        model: workflowSettings.model || current.model,
        size: workflowSettings.size || current.size,
        count: workflowSettings.count || current.count,
      }));
      setPanelOpen(true);
    }
  }, [selectNode, settings, state]);

  const applyImageFileToNode = useCallback(async (nodeId: string, file: File) => {
    const payload = await readCanvasImageFile(file);
    updateImageNode(nodeId, {
      imageUrl: payload.imageUrl,
      content: payload.content,
    });
    renameNode(nodeId, payload.title);
  }, [renameNode, updateImageNode]);

  const openSourceTask = useCallback((taskId: string) => {
    const node = nodesRef.current.find((item) => item.metadata?.sourceTaskId === taskId);
    if (!node) {
      return;
    }
    const focus = sourceTaskFocusFromNode(node);
    if (focus) {
      onOpenSourceTask?.(focus);
    }
  }, [onOpenSourceTask]);

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

  async function handleSubmitGeneration() {
    if (!selectedNode) {
      return;
    }

    setSubmitting(true);
    try {
      const workflowSettings = collectCanvasGenerationSettings(state, selectedNode.id, settings);
      if (!workflowSettings.prompt.trim()) {
        return;
      }

      const tasks = await createCanvasGenerationTasks(workflowSettings, {
        createTaskId: createClientTaskId,
      });

      tasks.forEach((task) => {
        const imageUrl = imageUrlFromTask(task) || selectedNode.metadata?.imageUrl || "";
        appendGenerationNode(selectedNode.id, {
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
          appendGenerationNode(retryNode.id, {
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
        appendGenerationNode(retryNode.id, {
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
  }, [appendGenerationNode, settings, state, updateGenerationNodeRetrying]);

  return (
    <main
      data-cola-panel="canvas-workspace"
      data-cola-canvas="immersive-light"
      className="fixed inset-0 z-50 overflow-hidden bg-[#fafafa] text-slate-950"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(167,139,250,0.16),transparent_34%),linear-gradient(#e5e7eb_1px,transparent_1px),linear-gradient(90deg,#e5e7eb_1px,transparent_1px)] bg-[length:auto,24px_24px,24px_24px]"
      />

      <div className="absolute left-5 top-4 z-40 flex items-center gap-3 rounded-[14px] border border-black/5 bg-white/96 px-3 py-2 shadow-[0_8px_20px_-18px_rgba(15,23,42,0.18)]">
        <button type="button" aria-label="返回" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </button>
        <span className="h-5 w-px bg-slate-200" />
        <span className="rounded-md px-2 py-1 text-sm font-medium text-slate-900">{state.title}</span>
      </div>

      <div className="absolute right-5 top-4 z-40">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_28px_-22px_rgba(15,23,42,0.3)] disabled:cursor-not-allowed disabled:opacity-45"
          onClick={openGeneration}
          disabled={!canGenerate}
        >
          <Sparkles className="size-4" />
          继续生成
        </button>
      </div>

      <InfiniteCanvasSurface
        state={state}
        onAddConnectedNode={addConnectedNode}
        onAddConnection={addConnection}
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
        onViewportChange={updateViewport}
      />

      <CanvasToolbar
        canDelete={canDelete}
        canGenerate={canGenerate}
        canRedo={canRedo}
        canUndo={canUndo}
        onAddConfig={() => addConfigNode(createNodePosition())}
        onAddImage={() => addImageNode({ position: createNodePosition(), imageUrl: "", title: "图片节点" })}
        onAddText={() => addTextNode(createNodePosition())}
        onDelete={deleteSelected}
        onOpenGeneration={openGeneration}
        onRedo={redo}
        onUndo={undo}
      />

      <CanvasZoomControls
        onFitView={() => updateViewport({ x: 0, y: 0, k: 1 })}
        onZoomIn={() => {
          const current = getCanvasViewport();
          updateViewport({ ...current, k: current.k * 1.16 });
        }}
        onZoomOut={() => {
          const current = getCanvasViewport();
          updateViewport({ ...current, k: current.k / 1.16 });
        }}
      />

      <CanvasNodeInspector
        node={selectedNode}
        upstreamSummary={upstreamSummary}
        onConfigChange={updateConfigNode}
        onContentChange={updateNodeContent}
        onImageChange={updateImageNode}
        onImageClear={(nodeId) => updateImageNode(nodeId, { imageUrl: "", content: "" })}
        onImageFileChange={(nodeId, file) => void applyImageFileToNode(nodeId, file)}
        onOpenGeneration={openGeneration}
        onOpenSourceTask={openSourceTask}
      />

      <button
        type="button"
        data-cola-action="canvas-ai-entry"
        className="absolute bottom-[72px] right-6 z-40 grid size-11 place-items-center rounded-full bg-gradient-to-br from-violet-400 via-fuchsia-400 to-sky-400 text-white shadow-[0_14px_32px_-18px_rgba(124,58,237,0.8)] disabled:cursor-not-allowed disabled:opacity-45"
        onClick={openGeneration}
        disabled={!canGenerate}
        aria-label="画布 AI 生成"
      >
        <Bot className="size-5" />
      </button>

      <CanvasGenerationPanel
        open={panelOpen}
        selectedNode={selectedNode}
        prompt={settings.prompt}
        model={settings.model}
        size={settings.size}
        count={settings.count}
        submitting={submitting}
        onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
        onClose={() => setPanelOpen(false)}
        onSubmit={() => void handleSubmitGeneration()}
      />
    </main>
  );
}
