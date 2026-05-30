import type { CanvasNodeData, CanvasNodeType, CanvasState } from "./canvas-types";

export type CanvasReferenceImage = {
  nodeId: string;
  title: string;
  imageUrl: string;
};

export type CanvasGenerationSettings = {
  prompt: string;
  model: string;
  size: string;
  count: number;
  referenceImages: CanvasReferenceImage[];
  sourceNodeIds: string[];
};

export type CanvasUpstreamSummaryNode = {
  id: string;
  title: string;
  type: CanvasNodeType;
};

export type CanvasUpstreamSummary = {
  nodes: CanvasUpstreamSummaryNode[];
  textCount: number;
  imageCount: number;
  configCount: number;
  promptPreview: string;
};

type BaseGenerationSettings = Pick<CanvasGenerationSettings, "prompt" | "model" | "size" | "count">;

function getPromptPart(node: CanvasNodeData) {
  if (node.type === "text") {
    return node.metadata?.content || node.metadata?.prompt || "";
  }
  if (node.type === "config") {
    return node.metadata?.prompt || "";
  }
  if (node.type === "generation") {
    return node.metadata?.prompt || node.metadata?.content || "";
  }
  return "";
}

function getDirectContinuationPromptNodes(state: CanvasState, targetNodeId: string) {
  const nodesById = new Map(state.nodes.map((node) => [node.id, node]));
  return state.connections
    .filter((connection) => connection.toNodeId === targetNodeId)
    .map((connection) => nodesById.get(connection.fromNodeId))
    .filter((node): node is CanvasNodeData => Boolean(node && node.type === "text" && getPromptPart(node).trim()));
}

function collectSourceNodes(state: CanvasState, targetNodeId: string) {
  const nodesById = new Map(state.nodes.map((node) => [node.id, node]));
  const visitedNodeIds = new Set<string>();
  const sourceNodes: CanvasNodeData[] = [];

  function visit(nodeId: string) {
    if (visitedNodeIds.has(nodeId)) {
      return;
    }
    visitedNodeIds.add(nodeId);

    state.connections
      .filter((connection) => connection.toNodeId === nodeId)
      .forEach((connection) => visit(connection.fromNodeId));

    const node = nodesById.get(nodeId);
    if (node) {
      sourceNodes.push(node);
    }
  }

  visit(targetNodeId);
  return sourceNodes;
}

export function collectCanvasGenerationSettings(
  state: CanvasState,
  targetNodeId: string,
  fallback: BaseGenerationSettings,
): CanvasGenerationSettings {
  const sourceNodes = collectSourceNodes(state, targetNodeId);
  const prompt = sourceNodes
    .map(getPromptPart)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n") || fallback.prompt;
  const referenceImages = sourceNodes.flatMap((node) => {
    const imageUrl = node.metadata?.imageUrl;
    if (!imageUrl || (node.type !== "image" && node.type !== "generation")) {
      return [];
    }
    return [{
      nodeId: node.id,
      title: node.title,
      imageUrl,
    }];
  });
  const configNodes = sourceNodes.filter((node) => node.type === "config");
  const config = configNodes.at(-1);

  return {
    prompt,
    model: config?.metadata?.model || fallback.model,
    size: config?.metadata?.size || fallback.size,
    count: config?.metadata?.count || fallback.count,
    referenceImages,
    sourceNodeIds: sourceNodes.map((node) => node.id),
  };
}

export function collectCanvasContinuationSettings(
  state: CanvasState,
  targetNodeId: string,
  draftPrompt: string,
  fallback: BaseGenerationSettings,
): CanvasGenerationSettings {
  const settings = collectCanvasGenerationSettings(state, targetNodeId, fallback);
  const targetNode = state.nodes.find((node) => node.id === targetNodeId);
  const imageUrl = targetNode?.metadata?.imageUrl;

  if (targetNode?.type !== "generation" || !imageUrl) {
    return {
      ...settings,
      prompt: draftPrompt.trim() || settings.prompt,
    };
  }

  const directPromptNodes = getDirectContinuationPromptNodes(state, targetNode.id);
  const prompt = [
    ...directPromptNodes.map((node) => getPromptPart(node).trim()),
    draftPrompt.trim(),
  ].filter(Boolean).join("\n\n");

  return {
    ...settings,
    prompt,
    referenceImages: [{
      nodeId: targetNode.id,
      title: targetNode.title,
      imageUrl,
    }],
    sourceNodeIds: [targetNode.id, ...directPromptNodes.map((node) => node.id)],
  };
}

export function getCanvasContinuationInputCounts(state: CanvasState, targetNodeId: string, draftPrompt: string) {
  const targetNode = state.nodes.find((node) => node.id === targetNodeId);
  if (targetNode?.type === "generation" && targetNode.metadata?.imageUrl) {
    return {
      promptCount: getDirectContinuationPromptNodes(state, targetNode.id).length + (draftPrompt.trim() ? 1 : 0),
      referenceCount: 1,
    };
  }

  const summary = summarizeCanvasUpstream(state, targetNodeId);
  return {
    promptCount: summary.textCount || (draftPrompt.trim() ? 1 : 0),
    referenceCount: summary.imageCount,
  };
}

export function summarizeCanvasUpstream(state: CanvasState, targetNodeId: string): CanvasUpstreamSummary {
  const sourceNodes = collectSourceNodes(state, targetNodeId);
  const promptPreview = sourceNodes
    .map(getPromptPart)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");

  return {
    nodes: sourceNodes.map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type,
    })),
    textCount: sourceNodes.filter((node) => node.type === "text").length,
    imageCount: sourceNodes.filter((node) => (node.type === "image" || node.type === "generation") && Boolean(node.metadata?.imageUrl)).length,
    configCount: sourceNodes.filter((node) => node.type === "config").length,
    promptPreview,
  };
}
