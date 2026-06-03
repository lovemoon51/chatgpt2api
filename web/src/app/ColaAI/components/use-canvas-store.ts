import { useCallback, useEffect, useMemo, useState } from "react";

import { getCanvasViewport, setCanvasViewport } from "./canvas-viewport-store";
import { createDeferredPersistence } from "./deferred-persistence";
import type {
  CanvasCreatableNodeType,
  CanvasConnectionData,
  CanvasGenerationPayload,
  CanvasGridSplitMode,
  CanvasImageOption,
  CanvasNodeData,
  CanvasPoint,
  CanvasState,
  CanvasStorageLike,
  CanvasViewport,
} from "./canvas-types";

export const COLA_CANVAS_STORAGE_KEY = "chatgpt2api:cola_canvas_state";

const minZoom = 0.12;
const maxZoom = 4;
const persistenceDelayMs = 180;
const duplicateOffset = { x: 48, y: 48 };
const maxHistoryEntries = 80;
export const configNodeWidth = 430;
export const configNodeHeight = 300;
export const upscaleConfigNodeWidth = 420;
export const upscaleConfigNodeHeight = 360;
export const gridSplitConfigNodeWidth = 420;
export const gridSplitConfigNodeHeight = 320;
export const imageReversePromptInstruction = "根据图片生成结构化中文提示词，包括主体描述、环境、光影、镜头语言、风格关键词。";
const gridSplitTileNodeWidth = 160;
const gridSplitTileNodeHeight = 160;
const gridSplitTileNodeGap = 18;
const adaptiveImageMinWidth = 260;
const adaptiveImageMaxWidth = 420;
const adaptiveImageMinHeight = 150;
const adaptiveImageMaxHeight = 440;
export type CanvasConfigPatch = Partial<Pick<NonNullable<CanvasNodeData["metadata"]>, "prompt" | "model" | "size" | "count" | "upscaleResolution" | "gridSplitMode" | "status" | "errorDetails" | "generationMode" | "videoDurationSeconds" | "videoResolution" | "videoCustomWidth" | "videoCustomHeight">>;

export type CanvasGridSplitTileInput = {
  imageUrl: string;
  row: number;
  col: number;
  width?: number;
  height?: number;
};

export type CanvasCropImageInput = {
  imageUrl: string;
  ratio: string;
  width?: number;
  height?: number;
};

export type CanvasHistoryState = {
  past: CanvasState[];
  present: CanvasState;
  future: CanvasState[];
  canUndo: boolean;
  canRedo: boolean;
  lastCoalesceKey: string | null;
};

type CanvasHistoryMutationOptions = {
  coalesceKey?: string;
};

function now() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${random}`;
}

function touch(state: CanvasState): CanvasState {
  return { ...state, updatedAt: now() };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getGridSplitTileNodeSize(naturalWidth?: number, naturalHeight?: number) {
  if (
    !Number.isFinite(naturalWidth)
    || !Number.isFinite(naturalHeight)
    || !naturalWidth
    || !naturalHeight
    || naturalWidth <= 0
    || naturalHeight <= 0
  ) {
    return { width: gridSplitTileNodeWidth, height: gridSplitTileNodeHeight };
  }

  return {
    width: gridSplitTileNodeWidth,
    height: Math.max(1, Math.round((gridSplitTileNodeWidth * naturalHeight) / naturalWidth)),
  };
}

export function getImageAdaptiveNodeSize(naturalWidth: number, naturalHeight: number) {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: 280, height: 220 };
  }

  const ratio = naturalWidth / naturalHeight;
  const preferredImageArea = ratio >= 1 ? 68000 : 76000;
  const rawImageWidth = Math.sqrt(preferredImageArea * ratio);
  const imageWidth = clamp(rawImageWidth, adaptiveImageMinWidth, adaptiveImageMaxWidth);
  const imageHeight = clamp(imageWidth / ratio, adaptiveImageMinHeight, adaptiveImageMaxHeight);

  return {
    width: Math.round(imageWidth),
    height: Math.round(imageHeight),
  };
}

function uniqueNodeIds(nodeIds: string[]) {
  return Array.from(new Set(nodeIds));
}

function withNodeSelection(
  state: CanvasState,
  selectedNodeIds: string[],
): CanvasState {
  const normalized = uniqueNodeIds(selectedNodeIds);
  return {
    ...state,
    selectedNodeIds: normalized,
    selectedNodeId: normalized[0] ?? null,
    selectedConnectionId: null,
  };
}

function normalizeCanvasHistory(history: Omit<CanvasHistoryState, "canUndo" | "canRedo">): CanvasHistoryState {
  return {
    ...history,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}

export function createInitialCanvasHistory(state: CanvasState): CanvasHistoryState {
  return normalizeCanvasHistory({
    past: [],
    present: state,
    future: [],
    lastCoalesceKey: null,
  });
}

export function applyCanvasHistoryMutation(
  history: CanvasHistoryState,
  mutate: (state: CanvasState) => CanvasState,
  options: CanvasHistoryMutationOptions = {},
): CanvasHistoryState {
  const nextState = mutate(history.present);
  if (nextState === history.present) {
    return history;
  }

  const coalesceKey = options.coalesceKey ?? null;
  if (coalesceKey && history.lastCoalesceKey === coalesceKey && history.past.length > 0) {
    return normalizeCanvasHistory({
      past: history.past,
      present: nextState,
      future: [],
      lastCoalesceKey: coalesceKey,
    });
  }

  return normalizeCanvasHistory({
    past: [...history.past, history.present].slice(-maxHistoryEntries),
    present: nextState,
    future: [],
    lastCoalesceKey: coalesceKey,
  });
}

export function commitCanvasHistory(history: CanvasHistoryState, direction: "undo" | "redo"): CanvasHistoryState {
  if (direction === "undo") {
    const previous = history.past.at(-1);
    if (!previous) {
      return history;
    }

    return normalizeCanvasHistory({
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
      lastCoalesceKey: null,
    });
  }

  const next = history.future[0];
  if (!next) {
    return history;
  }

  return normalizeCanvasHistory({
    past: [...history.past, history.present].slice(-maxHistoryEntries),
    present: next,
    future: history.future.slice(1),
    lastCoalesceKey: null,
  });
}

export function finalizeCanvasHistoryBatch(history: CanvasHistoryState): CanvasHistoryState {
  if (!history.lastCoalesceKey) {
    return history;
  }

  return normalizeCanvasHistory({
    past: history.past,
    present: history.present,
    future: history.future,
    lastCoalesceKey: null,
  });
}

function updateCanvasHistoryPresent(
  history: CanvasHistoryState,
  mutate: (state: CanvasState) => CanvasState,
): CanvasHistoryState {
  const nextState = mutate(history.present);
  if (nextState === history.present) {
    return history;
  }

  return normalizeCanvasHistory({
    past: history.past,
    present: nextState,
    future: history.future,
    lastCoalesceKey: null,
  });
}

export function createInitialCanvasState(): CanvasState {
  const textNode: CanvasNodeData = {
    id: "seed-text",
    type: "text",
    title: "创意提示词",
    position: { x: 160, y: 170 },
    width: 280,
    height: 170,
    metadata: {
      content: "一只可爱的猫咪坐在窗台上，窗外是城市夜景，霓虹灯光映照，赛博朋克风格，高质量渲染。",
      status: "idle",
    },
  };
  const imageNode: CanvasNodeData = {
    id: "seed-image",
    type: "image",
    title: "参考图片",
    position: { x: 520, y: 140 },
    width: 240,
    height: 220,
    metadata: {
      content: "拖入参考图，保留构图、角色或产品材质。",
      imageUrl: "",
      status: "idle",
    },
  };
  const configNode: CanvasNodeData = {
    id: "seed-config",
    type: "config",
    title: "生成配置",
    position: { x: 860, y: 230 },
    width: configNodeWidth,
    height: configNodeHeight,
    metadata: {
      prompt: "读取上游文本和参考图后生成图片。",
      model: "auto",
      size: "智能",
      count: 1,
      videoDurationSeconds: 6,
      videoResolution: "720p",
      status: "idle",
    },
  };
  const generationNode: CanvasNodeData = {
    id: "seed-generation",
    type: "generation",
    title: "AI 生图结果",
    position: { x: 1200, y: 180 },
    width: 280,
    height: 220,
    metadata: {
      content: "生成结果会回到画布，并保留创作链路。",
      imageUrl: "",
      status: "idle",
    },
  };

  return {
    title: "未命名画布",
    nodes: [textNode, imageNode, configNode, generationNode],
    connections: [
      { id: "seed-text-to-config", fromNodeId: textNode.id, toNodeId: configNode.id },
      { id: "seed-image-to-config", fromNodeId: imageNode.id, toNodeId: configNode.id },
      { id: "seed-config-to-generation", fromNodeId: configNode.id, toNodeId: generationNode.id },
    ],
    viewport: { x: 0, y: 0, k: 1 },
    selectedNodeIds: [],
    selectedNodeId: null,
    selectedConnectionId: null,
    updatedAt: now(),
  };
}

export function addTextNode(state: CanvasState, position: CanvasPoint): CanvasState {
  const node = createTextNode(position);
  return touch(withNodeSelection({ ...state, nodes: [...state.nodes, node] }, [node.id]));
}

function createTextNode(position: CanvasPoint): CanvasNodeData {
  return {
    id: createId("text"),
    type: "text",
    title: "文本节点",
    position,
    width: 280,
    height: 170,
    metadata: {
      content: "双击编辑创意提示词。",
      status: "idle",
    },
  };
}

export function addImageNode(state: CanvasState, input: { position: CanvasPoint; imageUrl: string; title?: string }): CanvasState {
  const node = createImageNode(input);
  return touch(withNodeSelection({ ...state, nodes: [...state.nodes, node] }, [node.id]));
}

function createImageNode(input: { position: CanvasPoint; imageUrl: string; title?: string }): CanvasNodeData {
  return {
    id: createId("image"),
    type: "image",
    title: input.title || "图片节点",
    position: input.position,
    width: 240,
    height: 220,
    metadata: {
      content: "可作为继续生成的参考图。",
      imageUrl: input.imageUrl,
      status: input.imageUrl ? "success" : "idle",
    },
  };
}

export function startImageReversePrompt(state: CanvasState, textNodeId: string): CanvasState {
  const textNode = state.nodes.find((node) => node.id === textNodeId && node.type === "text");
  if (!textNode) {
    return state;
  }

  const existingReferenceIds = textNode.metadata?.referenceImageNodeIds ?? [];
  const existingReferenceNodes = existingReferenceIds
    .map((nodeId) => state.nodes.find((node) => node.id === nodeId && node.type === "image"))
    .filter((node): node is CanvasNodeData => Boolean(node));
  const referenceNode = existingReferenceNodes[0] ?? createImageNode({
    position: {
      x: textNode.position.x - 240 - 72,
      y: textNode.position.y,
    },
    imageUrl: "",
    title: "反推参考图",
  });
  const referenceNodeIds = uniqueNodeIds([referenceNode.id, ...existingReferenceNodes.map((node) => node.id)]);
  const hasReferenceNode = state.nodes.some((node) => node.id === referenceNode.id);
  const hasConnection = state.connections.some(
    (connection) => connection.fromNodeId === referenceNode.id && connection.toNodeId === textNode.id,
  );

  return touch(withNodeSelection({
    ...state,
    nodes: [
      ...state.nodes.map((node) =>
        node.id === textNode.id
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                content: imageReversePromptInstruction,
                promptMode: "imageReverse" as const,
                referenceImageNodeIds: referenceNodeIds,
              },
            }
          : node,
      ),
      ...(hasReferenceNode ? [] : [referenceNode]),
    ],
    connections: hasConnection
      ? state.connections
      : [
          ...state.connections,
          {
            id: createId("connection"),
            fromNodeId: referenceNode.id,
            toNodeId: textNode.id,
          },
        ],
  }, [textNode.id]));
}

export function startImageToText(state: CanvasState, textNodeId: string): CanvasState {
  const textNode = state.nodes.find((node) => node.id === textNodeId && node.type === "text");
  if (!textNode) {
    return state;
  }

  const existingReferenceIds = textNode.metadata?.referenceImageNodeIds ?? [];
  const existingReferenceNodes = existingReferenceIds
    .map((nodeId) => state.nodes.find((node) => node.id === nodeId && node.type === "image"))
    .filter((node): node is CanvasNodeData => Boolean(node));
  const referenceNode = existingReferenceNodes[0] ?? createImageNode({
    position: {
      x: textNode.position.x - 240 - 72,
      y: textNode.position.y,
    },
    imageUrl: "",
    title: "图生文参考图",
  });
  const referenceNodeIds = uniqueNodeIds([referenceNode.id, ...existingReferenceNodes.map((node) => node.id)]);
  const hasReferenceNode = state.nodes.some((node) => node.id === referenceNode.id);
  const hasConnection = state.connections.some(
    (connection) => connection.fromNodeId === referenceNode.id && connection.toNodeId === textNode.id,
  );

  return touch(withNodeSelection({
    ...state,
    nodes: [
      ...state.nodes.map((node) =>
        node.id === textNode.id
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                content: "正在分析图片，请稍候...",
                promptMode: "imageToText" as const,
                referenceImageNodeIds: referenceNodeIds,
                status: "loading" as const,
                errorDetails: undefined,
                imageTextResult: undefined,
              },
            }
          : node,
      ),
      ...(hasReferenceNode ? [] : [referenceNode]),
    ],
    connections: hasConnection
      ? state.connections
      : [
          ...state.connections,
          {
            id: createId("connection"),
            fromNodeId: referenceNode.id,
            toNodeId: textNode.id,
          },
        ],
  }, [textNode.id]));
}

export function addConfigNode(state: CanvasState, position: CanvasPoint): CanvasState {
  const node = createConfigNode(position);
  return touch(withNodeSelection({ ...state, nodes: [...state.nodes, node] }, [node.id]));
}

function createConfigNode(position: CanvasPoint): CanvasNodeData {
  return {
    id: createId("config"),
    type: "config",
    title: "生成配置",
    position,
    width: configNodeWidth,
    height: configNodeHeight,
    metadata: {
      prompt: "整合上游节点后生成图片。",
      model: "auto",
      size: "智能",
      count: 1,
      videoDurationSeconds: 6,
      videoResolution: "720p",
      status: "idle",
    },
  };
}

export function normalizeCanvasNode(node: CanvasNodeData): CanvasNodeData {
  if (node.type === "image" && node.metadata?.derivativeType === "slice") {
    const tileSize = getGridSplitTileNodeSize(node.metadata.imageNaturalWidth, node.metadata.imageNaturalHeight);
    if (
      node.width === tileSize.width
      && node.height === tileSize.height
    ) {
      return node;
    }
    return {
      ...node,
      width: tileSize.width,
      height: tileSize.height,
    };
  }

  if (node.type !== "config") {
    return node;
  }

  if (node.metadata?.derivativeType === "slice") {
    const gridSplitMode = typeof node.metadata.gridSplitMode === "string" && /^[2-5]x[2-5]$/.test(node.metadata.gridSplitMode)
      ? node.metadata.gridSplitMode
      : "3x3";
    const normalizedMetadata = {
      ...node.metadata,
      gridSplitMode,
    };
    if (
      node.width >= gridSplitConfigNodeWidth
      && node.height >= gridSplitConfigNodeHeight
      && normalizedMetadata.gridSplitMode === node.metadata.gridSplitMode
    ) {
      return node;
    }
    return {
      ...node,
      width: gridSplitConfigNodeWidth,
      height: gridSplitConfigNodeHeight,
      metadata: normalizedMetadata,
    };
  }

  if (node.metadata?.derivativeType === "upscale") {
    const normalizedMetadata = {
      ...node.metadata,
      upscaleResolution: node.metadata.upscaleResolution === "8k" ? "4k" : node.metadata.upscaleResolution,
    };
    if (
      node.width >= upscaleConfigNodeWidth
      && node.height >= upscaleConfigNodeHeight
      && normalizedMetadata.upscaleResolution === node.metadata.upscaleResolution
    ) {
      return node;
    }
    return {
      ...node,
      width: upscaleConfigNodeWidth,
      height: upscaleConfigNodeHeight,
      metadata: normalizedMetadata,
    };
  }

  const isOversizedInlineConfig = node.width > configNodeWidth || node.height > configNodeHeight;
  if (!isOversizedInlineConfig && node.width >= configNodeWidth && node.height >= configNodeHeight) {
    return node;
  }

  return {
    ...node,
    width: configNodeWidth,
    height: configNodeHeight,
  };
}

export function addImageDerivativeNode(
  state: CanvasState,
  sourceNodeId: string,
  derivativeType: CanvasImageOption,
): CanvasState {
  const sourceNode = state.nodes.find((node) => node.id === sourceNodeId && (node.type === "image" || node.type === "generation"));
  if (!sourceNode) {
    return state;
  }

  if (derivativeType !== "upscale" && derivativeType !== "slice") {
    return state;
  }

  const existingDerivativeCount = state.connections
    .filter((connection) => connection.fromNodeId === sourceNode.id)
    .map((connection) => state.nodes.find((node) => node.id === connection.toNodeId))
    .filter((node) => node?.metadata?.derivativeType === derivativeType).length;
  const isSlice = derivativeType === "slice";
  const nodeWidth = isSlice ? gridSplitConfigNodeWidth : upscaleConfigNodeWidth;
  const nodeHeight = isSlice ? gridSplitConfigNodeHeight : upscaleConfigNodeHeight;
  const node: CanvasNodeData = {
    id: createId(isSlice ? "slice" : "upscale"),
    type: "config",
    title: isSlice ? "宫格切分" : "高清",
    position: {
      x: sourceNode.position.x + sourceNode.width + 96,
      y: sourceNode.position.y + existingDerivativeCount * (nodeHeight + 40),
    },
    width: nodeWidth,
    height: nodeHeight,
    metadata: {
      derivativeType,
      sourceImageNodeId: sourceNode.id,
      prompt: isSlice ? "将源图片按宫格切分成独立图片节点。" : "配置参数生成高清图像。",
      ...(isSlice
        ? {
            gridSplitMode: "3x3" satisfies CanvasGridSplitMode,
          }
        : {
            model: "gpt-image-2",
            size: "智能",
            upscaleResolution: "4k",
          }),
      count: 1,
      status: "idle",
    },
  };
  const connection: CanvasConnectionData = {
    id: createId("connection"),
    fromNodeId: sourceNode.id,
    toNodeId: node.id,
  };

  return touch(withNodeSelection({
    ...state,
    nodes: [...state.nodes, node],
    connections: [...state.connections, connection],
  }, [node.id]));
}

export function appendGridSplitImageNodes(
  state: CanvasState,
  sourceNodeId: string,
  payload: { mode: CanvasGridSplitMode | string; tiles: CanvasGridSplitTileInput[] },
): CanvasState {
  const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
  if (!sourceNode || payload.tiles.length === 0) {
    return state;
  }

  const previousTileIds = new Set(
    state.nodes
      .filter((node) => node.type === "image" && node.metadata?.derivativeType === "slice" && node.metadata.sourceImageNodeId === sourceNodeId)
      .map((node) => node.id),
  );
  const tileNodeIds: string[] = [];
  const tileSizes = payload.tiles.map((tile) => getGridSplitTileNodeSize(tile.width, tile.height));
  const rowHeights = payload.tiles.reduce<Record<number, number>>((heights, tile, index) => {
    heights[tile.row] = Math.max(heights[tile.row] ?? 0, tileSizes[index].height);
    return heights;
  }, {});
  const rowOffsets = Object.keys(rowHeights)
    .map(Number)
    .sort((a, b) => a - b)
    .reduce<Record<number, number>>((offsets, row, index, rows) => {
      const previousRow = rows[index - 1];
      offsets[row] = previousRow === undefined
        ? 0
        : offsets[previousRow] + rowHeights[previousRow] + gridSplitTileNodeGap;
      return offsets;
    }, {});
  const tileNodes = payload.tiles.map((tile, index): CanvasNodeData => {
    const id = createId("slice-tile");
    const tileSize = tileSizes[index];
    tileNodeIds.push(id);
    return {
      id,
      type: "image",
      title: `宫格 ${tile.row + 1}-${tile.col + 1}`,
      position: {
        x: sourceNode.position.x + sourceNode.width + 96 + tile.col * (gridSplitTileNodeWidth + gridSplitTileNodeGap),
        y: sourceNode.position.y + (rowOffsets[tile.row] ?? 0),
      },
      width: tileSize.width,
      height: tileSize.height,
      metadata: {
        content: `宫格切分 ${payload.mode} · 第 ${index + 1} 张`,
        imageUrl: tile.imageUrl,
        derivativeType: "slice",
        sourceImageNodeId: sourceNodeId,
        status: "success",
        ...(tile.width && tile.height
          ? {
              imageNaturalWidth: tile.width,
              imageNaturalHeight: tile.height,
            }
          : {}),
      },
    };
  });
  const tileConnections: CanvasConnectionData[] = tileNodes.map((node) => ({
    id: createId("connection"),
    fromNodeId: sourceNodeId,
    toNodeId: node.id,
  }));

  return touch(withNodeSelection({
    ...state,
    nodes: [
      ...state.nodes.filter((node) => !previousTileIds.has(node.id)),
      ...tileNodes,
    ],
    connections: [
      ...state.connections.filter((connection) => !previousTileIds.has(connection.fromNodeId) && !previousTileIds.has(connection.toNodeId)),
      ...tileConnections,
    ],
  }, [sourceNode.id]));
}

export function appendCroppedImageNode(
  state: CanvasState,
  sourceNodeId: string,
  payload: CanvasCropImageInput,
): CanvasState {
  const sourceNode = state.nodes.find((node) => node.id === sourceNodeId && (node.type === "image" || node.type === "generation"));
  if (!sourceNode || !payload.imageUrl) {
    return state;
  }

  const existingCropCount = state.connections
    .filter((connection) => connection.fromNodeId === sourceNode.id)
    .map((connection) => state.nodes.find((node) => node.id === connection.toNodeId))
    .filter((node) => node?.metadata?.derivativeType === "crop").length;
  const imageSize = getImageAdaptiveNodeSize(payload.width ?? sourceNode.metadata?.imageNaturalWidth ?? sourceNode.width, payload.height ?? sourceNode.metadata?.imageNaturalHeight ?? sourceNode.height);
  const node: CanvasNodeData = {
    id: createId("crop"),
    type: "image",
    title: "裁剪结果",
    position: {
      x: sourceNode.position.x + sourceNode.width + 96,
      y: sourceNode.position.y + existingCropCount * (imageSize.height + 40),
    },
    width: imageSize.width,
    height: imageSize.height,
    metadata: {
      content: `裁剪 ${payload.ratio}`,
      imageUrl: payload.imageUrl,
      derivativeType: "crop",
      sourceImageNodeId: sourceNode.id,
      cropRatio: payload.ratio,
      status: "success",
      ...(payload.width && payload.height
        ? {
            imageNaturalWidth: payload.width,
            imageNaturalHeight: payload.height,
          }
        : {}),
    },
  };
  const connection: CanvasConnectionData = {
    id: createId("connection"),
    fromNodeId: sourceNode.id,
    toNodeId: node.id,
  };

  return touch(withNodeSelection({
    ...state,
    nodes: [...state.nodes, node],
    connections: [...state.connections, connection],
  }, [node.id]));
}

export function normalizeCanvasState(state: CanvasState): CanvasState {
  return {
    ...state,
    nodes: state.nodes.map(normalizeCanvasNode),
  };
}

export function addVideoNode(state: CanvasState, position: CanvasPoint): CanvasState {
  const node = createVideoNode(position);
  return touch(withNodeSelection({ ...state, nodes: [...state.nodes, node] }, [node.id]));
}

function createVideoNode(position: CanvasPoint): CanvasNodeData {
  return {
    id: createId("video"),
    type: "video",
    title: "视频节点",
    position,
    width: 260,
    height: 190,
    metadata: {
      content: "视频节点未开发，请勿使用。",
      status: "idle",
    },
  };
}

function createCreatableNode(type: CanvasCreatableNodeType, position: CanvasPoint): CanvasNodeData {
  if (type === "text") {
    return createTextNode(position);
  }
  if (type === "image") {
    return createImageNode({ position, imageUrl: "", title: "图片节点" });
  }
  if (type === "video") {
    return createVideoNode(position);
  }
  return createConfigNode(position);
}

export function addConnectedNode(
  state: CanvasState,
  fromNodeId: string,
  nodeType: CanvasCreatableNodeType,
  position: CanvasPoint,
): CanvasState {
  if (!state.nodes.some((node) => node.id === fromNodeId)) {
    return state;
  }

  const node = createCreatableNode(nodeType, position);
  const connection: CanvasConnectionData = {
    id: createId("connection"),
    fromNodeId,
    toNodeId: node.id,
  };

  return touch(withNodeSelection({
    ...state,
    nodes: [...state.nodes, node],
    connections: [...state.connections, connection],
  }, [node.id]));
}

export function addConnection(state: CanvasState, fromNodeId: string, toNodeId: string): CanvasState {
  if (fromNodeId === toNodeId) {
    return state;
  }
  const nodesById = new Set(state.nodes.map((node) => node.id));
  if (!nodesById.has(fromNodeId) || !nodesById.has(toNodeId)) {
    return state;
  }
  if (state.connections.some((connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId)) {
    return state;
  }
  const connection: CanvasConnectionData = {
    id: createId("connection"),
    fromNodeId,
    toNodeId,
  };
  return touch({
    ...state,
    connections: [...state.connections, connection],
    selectedNodeIds: [],
    selectedNodeId: null,
    selectedConnectionId: connection.id,
  });
}

export function selectNode(state: CanvasState, nodeId: string | null): CanvasState {
  if (!nodeId) {
    return {
      ...state,
      selectedNodeIds: [],
      selectedNodeId: null,
      selectedConnectionId: null,
    };
  }
  return withNodeSelection(state, [nodeId]);
}

export function selectNodes(state: CanvasState, nodeIds: string[]): CanvasState {
  if (nodeIds.length === 0) {
    return selectNode(state, null);
  }
  const validNodeIds = nodeIds.filter((nodeId) => state.nodes.some((node) => node.id === nodeId));
  return withNodeSelection(state, validNodeIds);
}

export function toggleNodeSelection(state: CanvasState, nodeId: string): CanvasState {
  if (!state.nodes.some((node) => node.id === nodeId)) {
    return state;
  }
  const nextNodeIds = state.selectedNodeIds.includes(nodeId)
    ? state.selectedNodeIds.filter((selectedId) => selectedId !== nodeId)
    : [...state.selectedNodeIds, nodeId];

  return withNodeSelection(state, nextNodeIds);
}

export function selectAllNodes(state: CanvasState): CanvasState {
  return withNodeSelection(state, state.nodes.map((node) => node.id));
}

export function selectConnection(state: CanvasState, connectionId: string | null): CanvasState {
  return {
    ...state,
    selectedNodeIds: [],
    selectedNodeId: null,
    selectedConnectionId: connectionId,
  };
}

export function moveNode(state: CanvasState, nodeId: string, position: CanvasPoint): CanvasState {
  const currentNode = state.nodes.find((node) => node.id === nodeId);
  if (!currentNode) {
    return state;
  }
  if (currentNode.position.x === position.x && currentNode.position.y === position.y) {
    return state;
  }
  return touch({
    ...state,
    nodes: state.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
  });
}

export function moveSelectedNodes(state: CanvasState, delta: CanvasPoint): CanvasState {
  if (state.selectedNodeIds.length === 0 || (delta.x === 0 && delta.y === 0)) {
    return state;
  }

  const selectedNodeIds = new Set(state.selectedNodeIds);
  return touch({
    ...state,
    nodes: state.nodes.map((node) => (
      selectedNodeIds.has(node.id)
        ? {
            ...node,
            position: {
              x: node.position.x + delta.x,
              y: node.position.y + delta.y,
            },
          }
        : node
    )),
  });
}

export function moveNodes(state: CanvasState, positions: Record<string, CanvasPoint>): CanvasState {
  const nodeIds = Object.keys(positions);
  if (nodeIds.length === 0) {
    return state;
  }

  let changed = false;
  const nodes = state.nodes.map((node) => {
    const nextPosition = positions[node.id];
    if (!nextPosition) {
      return node;
    }
    if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
      return node;
    }
    changed = true;
    return {
      ...node,
      position: nextPosition,
    };
  });

  if (!changed) {
    return state;
  }

  return touch({
    ...state,
    nodes,
  });
}

export function nudgeSelectedNodes(state: CanvasState, delta: CanvasPoint): CanvasState {
  return moveSelectedNodes(state, delta);
}

export function resizeNode(state: CanvasState, nodeId: string, width: number, height: number): CanvasState {
  return touch({
    ...state,
    nodes: state.nodes.map((node) =>
      node.id === nodeId ? { ...node, width: Math.max(180, width), height: Math.max(120, height) } : node,
    ),
  });
}

export function updateNodeContent(state: CanvasState, nodeId: string, content: string): CanvasState {
  return touch({
    ...state,
    nodes: state.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            metadata: {
              ...node.metadata,
              content,
            },
          }
        : node,
    ),
  });
}

export function renameNode(state: CanvasState, nodeId: string, title: string): CanvasState {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return state;
  }

  let changed = false;
  const nodes = state.nodes.map((node) => {
    if (node.id !== nodeId || node.title === normalizedTitle) {
      return node;
    }
    changed = true;
    return {
      ...node,
      title: normalizedTitle,
    };
  });

  if (!changed) {
    return state;
  }

  return touch({
    ...state,
    nodes,
  });
}

export function updateImageNode(
  state: CanvasState,
  nodeId: string,
  patch: Pick<NonNullable<CanvasNodeData["metadata"]>, "imageUrl" | "content">,
): CanvasState {
  return touch({
    ...state,
    nodes: state.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            metadata: {
              ...node.metadata,
              ...patch,
              status: patch.imageUrl ? "success" : "idle",
            },
          }
        : node,
    ),
  });
}

export function updateNodeImageNaturalSize(
  state: CanvasState,
  nodeId: string,
  naturalWidth: number,
  naturalHeight: number,
): CanvasState {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return state;
  }

  let updated = false;
  const adaptiveSize = getImageAdaptiveNodeSize(naturalWidth, naturalHeight);
  const nodes = state.nodes.map((node) => {
    if (node.id !== nodeId || !["generation", "image"].includes(node.type)) {
      return node;
    }
    if (node.type === "image" && node.metadata?.derivativeType === "slice") {
      const tileSize = getGridSplitTileNodeSize(naturalWidth, naturalHeight);
      if (
        node.width === tileSize.width
        && node.height === tileSize.height
        && node.metadata.imageNaturalWidth === naturalWidth
        && node.metadata.imageNaturalHeight === naturalHeight
      ) {
        return node;
      }
      updated = true;
      return {
        ...node,
        width: tileSize.width,
        height: tileSize.height,
        metadata: {
          ...node.metadata,
          imageNaturalWidth: naturalWidth,
          imageNaturalHeight: naturalHeight,
        },
      };
    }
    if (
      node.width === adaptiveSize.width &&
      node.height === adaptiveSize.height &&
      node.metadata?.imageNaturalWidth === naturalWidth &&
      node.metadata?.imageNaturalHeight === naturalHeight
    ) {
      return node;
    }
    updated = true;
    return {
      ...node,
      width: adaptiveSize.width,
      height: adaptiveSize.height,
      metadata: {
        ...node.metadata,
        imageNaturalWidth: naturalWidth,
        imageNaturalHeight: naturalHeight,
      },
    };
  });

  if (!updated) {
    return state;
  }

  return touch({ ...state, nodes });
}

export function updateConfigNode(
  state: CanvasState,
  nodeId: string,
  patch: CanvasConfigPatch,
): CanvasState {
  return touch({
    ...state,
    nodes: state.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            metadata: {
              ...node.metadata,
              ...patch,
            },
          }
        : node,
    ),
  });
}

export function duplicateSelectedNodes(state: CanvasState): CanvasState {
  if (state.selectedNodeIds.length === 0) {
    return state;
  }

  const selectedNodeIds = new Set(state.selectedNodeIds);
  const duplicatedNodeIds: string[] = [];
  const nextNodes = state.nodes.map((node) => node);
  const sourceToDuplicateNodeId = new Map<string, string>();

  state.nodes.forEach((node) => {
    if (!selectedNodeIds.has(node.id)) {
      return;
    }

    const duplicateNodeId = createId(node.type);
    duplicatedNodeIds.push(duplicateNodeId);
    sourceToDuplicateNodeId.set(node.id, duplicateNodeId);
    nextNodes.push({
      ...node,
      id: duplicateNodeId,
      position: {
        x: node.position.x + duplicateOffset.x,
        y: node.position.y + duplicateOffset.y,
      },
      metadata: node.metadata ? { ...node.metadata } : undefined,
    });
  });

  const duplicatedConnections = state.connections.flatMap((connection) => {
    const nextFromNodeId = sourceToDuplicateNodeId.get(connection.fromNodeId);
    const nextToNodeId = sourceToDuplicateNodeId.get(connection.toNodeId);

    if (!nextFromNodeId || !nextToNodeId) {
      return [];
    }

    return [{
      id: createId("connection"),
      fromNodeId: nextFromNodeId,
      toNodeId: nextToNodeId,
    }];
  });

  return touch(withNodeSelection({
    ...state,
    nodes: nextNodes,
    connections: [...state.connections, ...duplicatedConnections],
  }, duplicatedNodeIds));
}

export function disconnectNode(state: CanvasState, nodeId: string): CanvasState {
  if (!state.nodes.some((node) => node.id === nodeId)) {
    return state;
  }

  const connections = state.connections.filter(
    (connection) => connection.fromNodeId !== nodeId && connection.toNodeId !== nodeId,
  );

  if (connections.length === state.connections.length) {
    return state;
  }

  return touch({
    ...state,
    connections,
    selectedConnectionId: state.selectedConnectionId && connections.some((connection) => connection.id === state.selectedConnectionId)
      ? state.selectedConnectionId
      : null,
  });
}

export function deleteSelected(state: CanvasState): CanvasState {
  if (state.selectedNodeIds.length > 0) {
    const selectedNodeIds = new Set(state.selectedNodeIds);
    return touch({
      ...state,
      nodes: state.nodes.filter((node) => !selectedNodeIds.has(node.id)),
      connections: state.connections.filter(
        (connection) => !selectedNodeIds.has(connection.fromNodeId) && !selectedNodeIds.has(connection.toNodeId),
      ),
      selectedNodeIds: [],
      selectedNodeId: null,
      selectedConnectionId: null,
    });
  }

  if (state.selectedConnectionId) {
    const selectedConnectionId = state.selectedConnectionId;
    return touch({
      ...state,
      connections: state.connections.filter((connection) => connection.id !== selectedConnectionId),
      selectedConnectionId: null,
    });
  }

  return state;
}

export function updateViewport(state: CanvasState, viewport: CanvasViewport): CanvasState {
  const k = Math.min(maxZoom, Math.max(minZoom, viewport.k));
  if (state.viewport.x === viewport.x && state.viewport.y === viewport.y && state.viewport.k === k) {
    return state;
  }
  return touch({ ...state, viewport: { x: viewport.x, y: viewport.y, k } });
}

export function appendGenerationNode(state: CanvasState, sourceNodeId: string, payload: CanvasGenerationPayload): CanvasState {
  const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
  const isVideo = payload.mediaType === "video" || Boolean(payload.videoUrl);
  const existingGeneratedChildren = state.connections
    .filter((connection) => connection.fromNodeId === sourceNodeId)
    .map((connection) => state.nodes.find((node) => node.id === connection.toNodeId))
    .filter((node) => (node?.type === "generation" || node?.type === "video") && Boolean(node.metadata?.sourceTaskId)).length;
  const position = sourceNode
    ? { x: sourceNode.position.x + sourceNode.width + 140, y: sourceNode.position.y + 26 + existingGeneratedChildren * 260 }
    : { x: 320, y: 220 };
  const node: CanvasNodeData = {
    id: createId(isVideo ? "video" : "generation"),
    type: isVideo ? "video" : "generation",
    title: isVideo ? "AI 视频结果" : "AI 生图结果",
    position,
    width: isVideo ? 320 : 280,
    height: isVideo ? 220 : 220,
    metadata: {
      content: payload.prompt,
      imageUrl: payload.imageUrl,
      videoUrl: payload.videoUrl,
      mediaType: isVideo ? "video" : payload.mediaType,
      generationMode: isVideo ? "video" : "image",
      prompt: payload.prompt,
      sourceTaskId: payload.sourceTaskId,
      status: payload.status || (payload.imageUrl || payload.videoUrl ? "success" : "idle"),
      errorDetails: payload.errorDetails,
      model: payload.model,
      size: payload.size,
      attempt: payload.attempt,
    },
  };
  const connection: CanvasConnectionData = {
    id: createId("connection"),
    fromNodeId: sourceNodeId,
    toNodeId: node.id,
  };
  return touch(withNodeSelection({
    ...state,
    nodes: [...state.nodes, node],
    connections: [...state.connections, connection],
  }, [node.id]));
}

export function updateGenerationNodePayload(
  state: CanvasState,
  nodeId: string,
  payload: CanvasGenerationPayload,
): CanvasState {
  let updated = false;
  const nodes = state.nodes.map((node) => {
    if (node.id !== nodeId || (node.type !== "generation" && node.type !== "video")) {
      return node;
    }
    const isVideo = payload.mediaType === "video" || Boolean(payload.videoUrl) || node.type === "video";
    const generationMode: "image" | "video" = isVideo ? "video" : "image";
    updated = true;
    return {
      ...node,
      type: isVideo ? "video" : node.type,
      title: isVideo ? "AI 视频结果" : node.title,
      metadata: {
        ...node.metadata,
        content: payload.prompt,
        imageUrl: payload.imageUrl,
        videoUrl: payload.videoUrl,
        mediaType: isVideo ? "video" : payload.mediaType,
        generationMode,
        prompt: payload.prompt,
        sourceTaskId: payload.sourceTaskId,
        status: payload.status || (payload.imageUrl || payload.videoUrl ? "success" : "idle"),
        errorDetails: payload.errorDetails,
        model: payload.model,
        size: payload.size,
        attempt: payload.attempt,
      },
    };
  });

  if (!updated) {
    return state;
  }

  return touch(withNodeSelection({ ...state, nodes }, [nodeId]));
}

export function updateGenerationTaskNode(
  state: CanvasState,
  sourceTaskId: string,
  patch: Pick<NonNullable<CanvasNodeData["metadata"]>, "imageUrl" | "status" | "errorDetails" | "videoUrl">,
): CanvasState {
  let updated = false;
  const nodes = state.nodes.map((node) =>
    node.metadata?.sourceTaskId === sourceTaskId
      ? (() => {
          if (
            node.metadata.imageUrl === patch.imageUrl &&
            node.metadata.videoUrl === patch.videoUrl &&
            node.metadata.status === patch.status &&
            node.metadata.errorDetails === patch.errorDetails
          ) {
            return node;
          }
          updated = true;
          const isVideo = node.type === "video" || Boolean(patch.videoUrl) || node.metadata.mediaType === "video";
          return {
            ...node,
            type: isVideo ? "video" : node.type,
            title: isVideo ? "AI 视频结果" : node.title,
            metadata: {
              ...node.metadata,
              ...patch,
              mediaType: isVideo ? "video" : node.metadata.mediaType,
              generationMode: isVideo ? "video" : node.metadata.generationMode,
            },
          };
        })()
      : node,
  );

  if (!updated) {
    return state;
  }

  return touch({ ...state, nodes });
}

export function updateGenerationNodeRetrying(
  state: CanvasState,
  nodeId: string,
  retrying: boolean,
): CanvasState {
  let updated = false;
  const nodes = state.nodes.map((node) => {
    if (node.id !== nodeId || (node.type !== "generation" && node.type !== "video")) {
      return node;
    }
    if (node.metadata?.retrying === retrying) {
      return node;
    }
    updated = true;
    return {
      ...node,
      metadata: {
        ...node.metadata,
        retrying,
      },
    };
  });

  if (!updated) {
    return state;
  }

  return touch({ ...state, nodes });
}

export function loadCanvasState(storage: CanvasStorageLike): CanvasState | null {
  const raw = storage.getItem(COLA_CANVAS_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasState>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.connections) || !parsed.viewport) {
      return null;
    }

    const selectedNodeIds = Array.isArray(parsed.selectedNodeIds)
      ? parsed.selectedNodeIds
      : parsed.selectedNodeId
        ? [parsed.selectedNodeId]
        : [];

    return normalizeCanvasState({
      title: parsed.title || "未命名画布",
      nodes: parsed.nodes,
      connections: parsed.connections,
      viewport: parsed.viewport,
      selectedNodeIds,
      selectedNodeId: selectedNodeIds[0] ?? null,
      selectedConnectionId: parsed.selectedConnectionId ?? null,
      updatedAt: parsed.updatedAt || now(),
    });
  } catch {
    return null;
  }
}

export function saveCanvasState(storage: CanvasStorageLike, state: CanvasState) {
  storage.setItem(COLA_CANVAS_STORAGE_KEY, JSON.stringify(state));
}

export function useCanvasStore(initialStateOverride?: CanvasState) {
  const [history, setHistory] = useState<CanvasHistoryState>(() => {
    const initialState = (() => {
      if (initialStateOverride) {
        return normalizeCanvasState(initialStateOverride);
      }
      if (typeof window === "undefined") {
        return createInitialCanvasState();
      }
      return loadCanvasState(window.localStorage) ?? createInitialCanvasState();
    })();

    if (typeof window !== "undefined") {
      setCanvasViewport(initialState.viewport);
    }

    return createInitialCanvasHistory(initialState);
  });
  const state = history.present;

  const applyRecordableMutation = useCallback((
    mutate: (state: CanvasState) => CanvasState,
    options?: CanvasHistoryMutationOptions,
  ) => {
    setHistory((current) => applyCanvasHistoryMutation(current, mutate, options));
  }, []);

  const applyTransientMutation = useCallback((mutate: (state: CanvasState) => CanvasState) => {
    setHistory((current) => updateCanvasHistoryPresent(current, mutate));
  }, []);

  const updateCurrentState = useCallback((mutate: (state: CanvasState) => CanvasState) => {
    setHistory((current) => updateCanvasHistoryPresent(current, mutate));
  }, []);

  const undo = useCallback(() => setHistory((current) => commitCanvasHistory(current, "undo")), []);
  const redo = useCallback(() => setHistory((current) => commitCanvasHistory(current, "redo")), []);
  const finalizeHistoryBatch = useCallback(() => setHistory((current) => finalizeCanvasHistoryBatch(current)), []);

  const persistence = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return createDeferredPersistence(
      (nextState: CanvasState) => {
        saveCanvasState(window.localStorage, nextState);
      },
      (callback, delayMs) => window.setTimeout(callback, delayMs),
      (timerId) => window.clearTimeout(timerId),
      persistenceDelayMs,
    );
  }, []);

  useEffect(() => {
    persistence?.schedule({ ...state, viewport: getCanvasViewport() });
  }, [persistence, state]);

  useEffect(() => {
    if (!persistence || typeof window === "undefined") {
      return;
    }

    const flushPersistence = () => persistence.flush();

    window.addEventListener("pagehide", flushPersistence);
    window.addEventListener("beforeunload", flushPersistence);
    return () => {
      window.removeEventListener("pagehide", flushPersistence);
      window.removeEventListener("beforeunload", flushPersistence);
      persistence.flush();
      persistence.cancel();
    };
  }, [persistence]);

  const selectedNode = useMemo(
    () => state.nodes.find((node) => node.id === state.selectedNodeId) ?? null,
    [state.nodes, state.selectedNodeId],
  );
  const selectedNodes = useMemo(
    () => state.nodes.filter((node) => state.selectedNodeIds.includes(node.id)),
    [state.nodes, state.selectedNodeIds],
  );
  const selectedConnection = useMemo(
    () => state.connections.find((connection) => connection.id === state.selectedConnectionId) ?? null,
    [state.connections, state.selectedConnectionId],
  );

  const actions = useMemo(
    () => ({
      addTextNode: (position: CanvasPoint) => applyRecordableMutation((current) => addTextNode(current, position)),
      addImageNode: (input: { position: CanvasPoint; imageUrl: string; title?: string }) =>
        applyRecordableMutation((current) => addImageNode(current, input)),
      startImageReversePrompt: (textNodeId: string) => applyRecordableMutation((current) => startImageReversePrompt(current, textNodeId)),
      addConfigNode: (position: CanvasPoint) => applyRecordableMutation((current) => addConfigNode(current, position)),
      addImageDerivativeNode: (sourceNodeId: string, derivativeType: CanvasImageOption) =>
        applyRecordableMutation((current) => addImageDerivativeNode(current, sourceNodeId, derivativeType)),
      addVideoNode: (position: CanvasPoint) => applyRecordableMutation((current) => addVideoNode(current, position)),
      addConnection: (fromNodeId: string, toNodeId: string) => applyRecordableMutation((current) => addConnection(current, fromNodeId, toNodeId)),
      addConnectedNode: (fromNodeId: string, nodeType: CanvasCreatableNodeType, position: CanvasPoint) =>
        applyRecordableMutation((current) => addConnectedNode(current, fromNodeId, nodeType, position)),
      appendGenerationNode: (sourceNodeId: string, payload: CanvasGenerationPayload) =>
        applyRecordableMutation((current) => appendGenerationNode(current, sourceNodeId, payload)),
      appendGridSplitImageNodes: (
        sourceNodeId: string,
        payload: { mode: CanvasGridSplitMode | string; tiles: CanvasGridSplitTileInput[] },
      ) => applyRecordableMutation((current) => appendGridSplitImageNodes(current, sourceNodeId, payload)),
      appendCroppedImageNode: (sourceNodeId: string, payload: CanvasCropImageInput) =>
        applyRecordableMutation((current) => appendCroppedImageNode(current, sourceNodeId, payload)),
      updateGenerationNodePayload: (nodeId: string, payload: CanvasGenerationPayload) =>
        updateCurrentState((current) => updateGenerationNodePayload(current, nodeId, payload)),
      deleteSelected: () => applyRecordableMutation((current) => deleteSelected(current)),
      disconnectNode: (nodeId: string) => applyRecordableMutation((current) => disconnectNode(current, nodeId)),
      duplicateSelectedNodes: () => applyRecordableMutation((current) => duplicateSelectedNodes(current)),
      moveNode: (nodeId: string, position: CanvasPoint) =>
        applyRecordableMutation((current) => moveNode(current, nodeId, position), { coalesceKey: `move:${nodeId}` }),
      moveNodes: (positions: Record<string, CanvasPoint>) =>
        applyRecordableMutation((current) => moveNodes(current, positions), { coalesceKey: `move:${Object.keys(positions).sort().join(",")}` }),
      moveSelectedNodes: (delta: CanvasPoint) => applyRecordableMutation((current) => moveSelectedNodes(current, delta)),
      nudgeSelectedNodes: (delta: CanvasPoint) => applyRecordableMutation((current) => nudgeSelectedNodes(current, delta)),
      resizeNode: (nodeId: string, width: number, height: number) =>
        applyRecordableMutation((current) => resizeNode(current, nodeId, width, height), { coalesceKey: `resize:${nodeId}` }),
      updateNodeImageNaturalSize: (nodeId: string, naturalWidth: number, naturalHeight: number) =>
        updateCurrentState((current) => updateNodeImageNaturalSize(current, nodeId, naturalWidth, naturalHeight)),
      renameNode: (nodeId: string, title: string) => applyRecordableMutation((current) => renameNode(current, nodeId, title)),
      selectAllNodes: () => applyTransientMutation((current) => selectAllNodes(current)),
      selectConnection: (connectionId: string | null) => applyTransientMutation((current) => selectConnection(current, connectionId)),
      selectNode: (nodeId: string | null) => applyTransientMutation((current) => selectNode(current, nodeId)),
      selectNodes: (nodeIds: string[]) => applyTransientMutation((current) => selectNodes(current, nodeIds)),
      toggleNodeSelection: (nodeId: string) => applyTransientMutation((current) => toggleNodeSelection(current, nodeId)),
      updateConfigNode: (
        nodeId: string,
        patch: CanvasConfigPatch,
      ) => applyRecordableMutation((current) => updateConfigNode(current, nodeId, patch)),
      updateGenerationTaskNode: (
        sourceTaskId: string,
        patch: Pick<NonNullable<CanvasNodeData["metadata"]>, "imageUrl" | "status" | "errorDetails">,
      ) => updateCurrentState((current) => updateGenerationTaskNode(current, sourceTaskId, patch)),
      updateGenerationNodeRetrying: (nodeId: string, retrying: boolean) =>
        updateCurrentState((current) => updateGenerationNodeRetrying(current, nodeId, retrying)),
      updateImageNode: (
        nodeId: string,
        patch: Pick<NonNullable<CanvasNodeData["metadata"]>, "imageUrl" | "content">,
      ) => applyRecordableMutation((current) => updateImageNode(current, nodeId, patch)),
      updateNodeContent: (nodeId: string, content: string) => applyRecordableMutation((current) => updateNodeContent(current, nodeId, content)),
      updateViewport: (viewport: CanvasViewport) => {
        setCanvasViewport(viewport);
        updateCurrentState((current) => updateViewport(current, viewport));
      },
      undo,
      redo,
      finalizeHistoryBatch,
    }),
    [applyRecordableMutation, applyTransientMutation, finalizeHistoryBatch, redo, undo, updateCurrentState],
  );

  return {
    state,
    selectedNode,
    selectedNodes,
    selectedConnection,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    ...actions,
  };
}
