import { describe, expect, test } from "bun:test";

import { getCanvasViewport, resetCanvasViewport, setCanvasViewport } from "./canvas-viewport-store";
import {
  addConfigNode,
  addConnectedNode,
  addConnection,
  addImageDerivativeNode,
  addImageNode,
  appendCroppedImageNode,
  appendGridSplitImageNodes,
  startImageReversePrompt,
  startImageToText,
  addTextNode,
  applyCanvasHistoryMutation,
  addVideoNode,
  appendGenerationNode,
  getImageAdaptiveNodeSize,
  commitCanvasHistory,
  createInitialCanvasState,
  createInitialCanvasHistory,
  deleteSelected,
  disconnectNode,
  duplicateSelectedNodes,
  finalizeCanvasHistoryBatch,
  loadCanvasState,
  moveNode,
  moveSelectedNodes,
  normalizeCanvasNode,
  nudgeSelectedNodes,
  renameNode,
  saveCanvasState,
  selectAllNodes,
  selectConnection,
  selectNode,
  selectNodes,
  toggleNodeSelection,
  updateImageNode,
  updateGenerationNodePayload,
  updateGenerationTaskNode,
  updateGenerationNodeRetrying,
  updateNodeImageNaturalSize,
  updateConfigNode,
  updateNodeContent,
  updateViewport,
} from "./use-canvas-store";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("use-canvas-store helpers", () => {
  test("creates a ColaAI canvas with text, image, config, and generation nodes", () => {
    const state = createInitialCanvasState();

    expect(state.title).toBe("未命名画布");
    expect(state.viewport).toEqual({ x: 0, y: 0, k: 1 });
    expect(state.nodes.map((node) => node.type)).toEqual(["text", "image", "config", "generation"]);
    expect(state.connections.map((connection) => [connection.fromNodeId, connection.toNodeId])).toEqual([
      ["seed-text", "seed-config"],
      ["seed-image", "seed-config"],
      ["seed-config", "seed-generation"],
    ]);
    expect(state.selectedNodeIds).toEqual([]);
    expect(state.selectedConnectionId).toBeNull();
  });

  test("adds, toggles, edits, batch moves, and deletes selected nodes", () => {
    const withText = addTextNode(createInitialCanvasState(), { x: 120, y: 160 });
    const textNode = withText.nodes.at(-1)!;
    const withImage = addImageNode(withText, {
      position: { x: 420, y: 180 },
      imageUrl: "/api/images/reference.png",
      title: "批量参考图",
    });
    const imageNode = withImage.nodes.at(-1)!;
    const selected = selectNodes(withImage, [textNode.id, imageNode.id]);
    const deselected = toggleNodeSelection(selected, imageNode.id);
    const reselected = toggleNodeSelection(deselected, imageNode.id);
    const edited = updateNodeContent(reselected, textNode.id, "新的提示词内容");
    const moved = moveSelectedNodes(edited, { x: 40, y: 20 });
    const deleted = deleteSelected(moved);

    expect(textNode.title).toBe("文本节点");
    expect(textNode.metadata?.content).toBe("双击编辑创意提示词。");
    expect(deselected.selectedNodeIds).toEqual([textNode.id]);
    expect(reselected.selectedNodeIds).toEqual([textNode.id, imageNode.id]);
    expect(moved.nodes.find((node) => node.id === textNode.id)?.metadata?.content).toBe("新的提示词内容");
    expect(moved.nodes.find((node) => node.id === textNode.id)?.position).toEqual({ x: 160, y: 180 });
    expect(moved.nodes.find((node) => node.id === imageNode.id)?.position).toEqual({ x: 460, y: 200 });
    expect(deleted.nodes.some((node) => node.id === textNode.id)).toBe(false);
    expect(deleted.nodes.some((node) => node.id === imageNode.id)).toBe(false);
    expect(deleted.selectedNodeIds).toEqual([]);
  });

  test("adds image and config nodes, then connects them", () => {
    const withImage = addImageNode(createInitialCanvasState(), {
      position: { x: 320, y: 220 },
      imageUrl: "/api/images/reference.png",
      title: "参考图片",
    });
    const imageNode = withImage.nodes.at(-1)!;
    const withConfig = addConfigNode(withImage, { x: 680, y: 220 });
    const configNode = withConfig.nodes.at(-1)!;
    const connected = addConnection(withConfig, imageNode.id, configNode.id);

    expect(configNode.type).toBe("config");
    expect(configNode.metadata?.model).toBe("auto");
    expect(configNode.metadata?.size).toBe("智能");
    expect(configNode.metadata?.count).toBe(1);
    expect(configNode.metadata?.prompt).toBe("");
    expect(connected.connections.some((connection) => connection.fromNodeId === imageNode.id && connection.toNodeId === configNode.id)).toBe(true);
  });

  test("creates a right-side GPT upscale config node from an image node", () => {
    const state = createInitialCanvasState();
    const imageNode = state.nodes.find((node) => node.id === "seed-image")!;
    const updated = addImageDerivativeNode(state, imageNode.id, "upscale");
    const upscaleNode = updated.nodes.at(-1)!;

    expect(upscaleNode.type).toBe("config");
    expect(upscaleNode.title).toBe("高清");
    expect(upscaleNode.position.x).toBe(imageNode.position.x + imageNode.width + 96);
    expect(upscaleNode.position.y).toBe(imageNode.position.y);
    expect(upscaleNode.metadata?.derivativeType).toBe("upscale");
    expect(upscaleNode.metadata?.model).toBe("gpt-image-2");
    expect(upscaleNode.metadata?.upscaleResolution).toBe("4k");
    expect(upscaleNode.metadata?.sourceImageNodeId).toBe(imageNode.id);
    expect(updated.connections.some((connection) => connection.fromNodeId === imageNode.id && connection.toNodeId === upscaleNode.id)).toBe(true);
    expect(updated.selectedNodeIds).toEqual([upscaleNode.id]);
  });

  test("creates a right-side grid split config node from an image node", () => {
    const state = createInitialCanvasState();
    const imageNode = state.nodes.find((node) => node.id === "seed-image")!;
    const updated = addImageDerivativeNode(state, imageNode.id, "slice");
    const splitNode = updated.nodes.at(-1)!;

    expect(splitNode.type).toBe("config");
    expect(splitNode.title).toBe("宫格切分");
    expect(splitNode.position.x).toBe(imageNode.position.x + imageNode.width + 96);
    expect(splitNode.position.y).toBe(imageNode.position.y);
    expect(splitNode.metadata?.derivativeType).toBe("slice");
    expect(splitNode.metadata?.gridSplitMode).toBe("3x3");
    expect(splitNode.metadata?.sourceImageNodeId).toBe(imageNode.id);
    expect(updated.connections.some((connection) => connection.fromNodeId === imageNode.id && connection.toNodeId === splitNode.id)).toBe(true);
    expect(updated.selectedNodeIds).toEqual([splitNode.id]);
  });

  test("appends a cropped image node without replacing the source image", () => {
    const state = createInitialCanvasState();
    const imageNode = state.nodes.find((node) => node.id === "seed-image")!;
    const updated = appendCroppedImageNode(state, imageNode.id, {
      imageUrl: "data:image/png;base64,MA==",
      ratio: "1:1",
      width: 512,
      height: 512,
    });
    const cropNode = updated.nodes.at(-1)!;

    expect(cropNode.type).toBe("image");
    expect(cropNode.title).toBe("裁剪结果");
    expect(cropNode.position.x).toBe(imageNode.position.x + imageNode.width + 96);
    expect(cropNode.position.y).toBe(imageNode.position.y);
    expect(cropNode.metadata?.derivativeType).toBe("crop");
    expect(cropNode.metadata?.sourceImageNodeId).toBe(imageNode.id);
    expect(cropNode.metadata?.cropRatio).toBe("1:1");
    expect(cropNode.metadata?.imageUrl).toBe("data:image/png;base64,MA==");
    expect(state.nodes.find((node) => node.id === imageNode.id)?.metadata?.imageUrl).toBe(imageNode.metadata?.imageUrl);
    expect(updated.connections.some((connection) => connection.fromNodeId === imageNode.id && connection.toNodeId === cropNode.id)).toBe(true);
    expect(updated.selectedNodeIds).toEqual([cropNode.id]);
  });

  test("appends grid split tiles as connected image nodes laid out in a grid", () => {
    const state = createInitialCanvasState();
    const imageNode = state.nodes.find((node) => node.id === "seed-image")!;
    const withSplitNode = addImageDerivativeNode(state, imageNode.id, "slice");
    const splitNode = withSplitNode.nodes.at(-1)!;
    const updated = appendGridSplitImageNodes(withSplitNode, splitNode.id, {
      mode: "2x2",
      tiles: [
        { imageUrl: "data:image/png;base64,MA==", row: 0, col: 0 },
        { imageUrl: "data:image/png;base64,MQ==", row: 0, col: 1 },
        { imageUrl: "data:image/png;base64,Mg==", row: 1, col: 0 },
        { imageUrl: "data:image/png;base64,Mw==", row: 1, col: 1 },
      ],
    });
    const tileNodes = updated.nodes.filter((node) => node.metadata?.derivativeType === "slice" && node.type === "image");

    expect(tileNodes).toHaveLength(4);
    expect(tileNodes.map((node) => node.title)).toEqual(["宫格 1-1", "宫格 1-2", "宫格 2-1", "宫格 2-2"]);
    expect(tileNodes.map((node) => node.metadata?.imageUrl)).toEqual([
      "data:image/png;base64,MA==",
      "data:image/png;base64,MQ==",
      "data:image/png;base64,Mg==",
      "data:image/png;base64,Mw==",
    ]);
    expect(tileNodes[0].position.x).toBe(splitNode.position.x + splitNode.width + 96);
    expect(tileNodes[1].position.x).toBeGreaterThan(tileNodes[0].position.x);
    expect(tileNodes[2].position.y).toBeGreaterThan(tileNodes[0].position.y);
    expect(updated.connections.filter((connection) => connection.fromNodeId === splitNode.id && tileNodes.some((node) => node.id === connection.toNodeId))).toHaveLength(4);
    expect(updated.selectedNodeIds).toEqual([splitNode.id]);
  });

  test("updates grid split tile nodes to the sliced image aspect ratio after image load", () => {
    const state = createInitialCanvasState();
    const imageNode = state.nodes.find((node) => node.id === "seed-image")!;
    const withSplitNode = addImageDerivativeNode(state, imageNode.id, "slice");
    const splitNode = withSplitNode.nodes.at(-1)!;
    const withTiles = appendGridSplitImageNodes(withSplitNode, splitNode.id, {
      mode: "2x2",
      tiles: [
        { imageUrl: "data:image/png;base64,MA==", row: 0, col: 0 },
      ],
    });
    const tileNode = withTiles.nodes.find((node) => node.type === "image" && node.metadata?.derivativeType === "slice")!;
    const resized = updateNodeImageNaturalSize(withTiles, tileNode.id, 1536, 512);
    const resizedTile = resized.nodes.find((node) => node.id === tileNode.id)!;

    expect(resizedTile.width).toBe(160);
    expect(resizedTile.height).toBe(53);
    expect(resizedTile.metadata?.imageNaturalWidth).toBe(1536);
    expect(resizedTile.metadata?.imageNaturalHeight).toBe(512);
  });

  test("sizes grid split tile nodes to the sliced image aspect ratio", () => {
    const state = createInitialCanvasState();
    const imageNode = state.nodes.find((node) => node.id === "seed-image")!;
    const withSplitNode = addImageDerivativeNode(state, imageNode.id, "slice");
    const splitNode = withSplitNode.nodes.at(-1)!;
    const updated = appendGridSplitImageNodes(withSplitNode, splitNode.id, {
      mode: "2x2",
      tiles: [
        { imageUrl: "data:image/png;base64,MA==", row: 0, col: 0, width: 320, height: 180 },
        { imageUrl: "data:image/png;base64,MQ==", row: 0, col: 1, width: 320, height: 180 },
        { imageUrl: "data:image/png;base64,Mg==", row: 1, col: 0, width: 320, height: 180 },
        { imageUrl: "data:image/png;base64,Mw==", row: 1, col: 1, width: 320, height: 180 },
      ],
    });
    const tileNodes = updated.nodes.filter((node) => node.metadata?.derivativeType === "slice" && node.type === "image");

    expect(tileNodes.map((node) => [node.width, node.height])).toEqual([
      [160, 90],
      [160, 90],
      [160, 90],
      [160, 90],
    ]);
    expect(tileNodes[2].position.y).toBe(tileNodes[0].position.y + 90 + 18);
    expect(tileNodes[3].position.y).toBe(tileNodes[1].position.y + 90 + 18);
  });

  test("normalizes stored grid split tile image nodes to the sliced image aspect ratio", () => {
    const state = createInitialCanvasState();
    const legacyTileNode = {
      ...state.nodes.find((node) => node.id === "seed-image")!,
      id: "legacy-slice-tile",
      title: "宫格 1-1",
      width: 420,
      height: 158,
      metadata: {
        imageUrl: "data:image/png;base64,MA==",
        derivativeType: "slice" as const,
        sourceImageNodeId: "slice-config",
        imageNaturalWidth: 1536,
        imageNaturalHeight: 576,
      },
    };
    const normalized = normalizeCanvasNode(legacyTileNode);

    expect(normalized.width).toBe(160);
    expect(normalized.height).toBe(60);
    expect(normalized.metadata?.imageNaturalWidth).toBe(1536);
    expect(normalized.metadata?.imageNaturalHeight).toBe(576);
  });

  test("replaces previous grid split tiles from the same split node", () => {
    const state = createInitialCanvasState();
    const imageNode = state.nodes.find((node) => node.id === "seed-image")!;
    const withSplitNode = addImageDerivativeNode(state, imageNode.id, "slice");
    const splitNode = withSplitNode.nodes.at(-1)!;
    const firstSplit = appendGridSplitImageNodes(withSplitNode, splitNode.id, {
      mode: "2x2",
      tiles: [
        { imageUrl: "data:image/png;base64,MA==", row: 0, col: 0 },
        { imageUrl: "data:image/png;base64,MQ==", row: 0, col: 1 },
        { imageUrl: "data:image/png;base64,Mg==", row: 1, col: 0 },
        { imageUrl: "data:image/png;base64,Mw==", row: 1, col: 1 },
      ],
    });
    const secondSplit = appendGridSplitImageNodes(firstSplit, splitNode.id, {
      mode: "3x3",
      tiles: [
        { imageUrl: "data:image/png;base64,MTA=", row: 0, col: 0 },
        { imageUrl: "data:image/png;base64,MTE=", row: 0, col: 1 },
        { imageUrl: "data:image/png;base64,MTI=", row: 0, col: 2 },
        { imageUrl: "data:image/png;base64,MTM=", row: 1, col: 0 },
        { imageUrl: "data:image/png;base64,MTQ=", row: 1, col: 1 },
        { imageUrl: "data:image/png;base64,MTU=", row: 1, col: 2 },
        { imageUrl: "data:image/png;base64,MTY=", row: 2, col: 0 },
        { imageUrl: "data:image/png;base64,MTc=", row: 2, col: 1 },
        { imageUrl: "data:image/png;base64,MTg=", row: 2, col: 2 },
      ],
    });
    const tileNodes = secondSplit.nodes.filter((node) => node.metadata?.derivativeType === "slice" && node.type === "image");

    expect(tileNodes).toHaveLength(9);
    expect(tileNodes.map((node) => node.title)).toEqual([
      "宫格 1-1",
      "宫格 1-2",
      "宫格 1-3",
      "宫格 2-1",
      "宫格 2-2",
      "宫格 2-3",
      "宫格 3-1",
      "宫格 3-2",
      "宫格 3-3",
    ]);
    expect(tileNodes.map((node) => node.metadata?.imageUrl)).not.toContain("data:image/png;base64,MA==");
    expect(secondSplit.connections.filter((connection) => connection.fromNodeId === splitNode.id && tileNodes.some((node) => node.id === connection.toNodeId))).toHaveLength(9);
  });

  test("normalizes stored 8k upscale config nodes to 4k", () => {
    const state = createInitialCanvasState();
    const legacyUpscaleNode = {
      ...state.nodes.find((node) => node.id === "seed-config")!,
      metadata: {
        derivativeType: "upscale" as const,
        model: "gpt-image-2",
        upscaleResolution: "8k",
      },
    };
    const normalized = normalizeCanvasNode(legacyUpscaleNode);

    expect(normalized.metadata?.upscaleResolution).toBe("4k");
  });

  test("keeps stored 5x5 grid split config nodes during normalization", () => {
    const state = createInitialCanvasState();
    const gridSplitNode = {
      ...state.nodes.find((node) => node.id === "seed-config")!,
      metadata: {
        derivativeType: "slice" as const,
        gridSplitMode: "5x5" as const,
      },
    };
    const normalized = normalizeCanvasNode(gridSplitNode);

    expect(normalized.metadata?.gridSplitMode).toBe("5x5");
  });

  test("keeps stored custom grid split config nodes during normalization", () => {
    const state = createInitialCanvasState();
    const gridSplitNode = {
      ...state.nodes.find((node) => node.id === "seed-config")!,
      metadata: {
        derivativeType: "slice" as const,
        gridSplitMode: "4x3",
      },
    };
    const normalized = normalizeCanvasNode(gridSplitNode);

    expect(normalized.metadata?.gridSplitMode).toBe("4x3");
  });

  test("updates config node generation choices inline", () => {
    const state = createInitialCanvasState();
    const updated = updateConfigNode(state, "seed-config", {
      model: "codex-gpt-image-2",
      size: "16:9",
      count: 3,
    });
    const configNode = updated.nodes.find((node) => node.id === "seed-config")!;

    expect(configNode.metadata?.model).toBe("codex-gpt-image-2");
    expect(configNode.metadata?.size).toBe("16:9");
    expect(configNode.metadata?.count).toBe(3);
    expect(configNode.metadata?.prompt).toBe("读取上游文本和参考图后生成图片。");
  });

  test("updates image node reference data from the node inspector", () => {
    const state = createInitialCanvasState();
    const updated = updateImageNode(state, "seed-image", {
      imageUrl: "/images/new-reference.png",
      content: "新的参考图说明",
    });
    const imageNode = updated.nodes.find((node) => node.id === "seed-image")!;

    expect(imageNode.metadata?.imageUrl).toBe("/images/new-reference.png");
    expect(imageNode.metadata?.content).toBe("新的参考图说明");
    expect(imageNode.metadata?.status).toBe("success");
  });

  test("starts image reverse prompt mode by creating a left reference image node", () => {
    const state = addTextNode(createInitialCanvasState(), { x: 520, y: 260 });
    const textNode = state.nodes.at(-1)!;
    const updated = startImageReversePrompt(state, textNode.id);
    const updatedTextNode = updated.nodes.find((node) => node.id === textNode.id)!;
    const referenceNode = updated.nodes.find((node) => node.id === updatedTextNode.metadata?.referenceImageNodeIds?.[0])!;

    expect(referenceNode.type).toBe("image");
    expect(referenceNode.title).toBe("反推参考图");
    expect(referenceNode.position.x).toBeLessThan(textNode.position.x);
    expect(updated.connections.some((connection) => connection.fromNodeId === referenceNode.id && connection.toNodeId === textNode.id)).toBe(true);
    expect(updatedTextNode.metadata?.promptMode).toBe("imageReverse");
    expect(updatedTextNode.metadata?.content).toBe("根据图片生成结构化中文提示词，包括主体描述、环境、光影、镜头语言、风格关键词。");
    expect(updated.selectedNodeIds).toEqual([textNode.id]);
  });

  test("starts image-to-text mode by creating a left reference image node", () => {
    const state = addTextNode(createInitialCanvasState(), { x: 520, y: 260 });
    const textNode = state.nodes.at(-1)!;
    const updated = startImageToText(state, textNode.id);
    const updatedTextNode = updated.nodes.find((node) => node.id === textNode.id)!;
    const referenceNode = updated.nodes.find((node) => node.id === updatedTextNode.metadata?.referenceImageNodeIds?.[0])!;

    expect(referenceNode.type).toBe("image");
    expect(referenceNode.title).toBe("图生文参考图");
    expect(referenceNode.position.x).toBeLessThan(textNode.position.x);
    expect(updated.connections.some((connection) => connection.fromNodeId === referenceNode.id && connection.toNodeId === textNode.id)).toBe(true);
    expect(updatedTextNode.metadata?.promptMode).toBe("imageToText");
    expect(updatedTextNode.metadata?.content).toContain("正在分析图片");
    expect(updatedTextNode.metadata?.status).toBe("loading");
    expect(updatedTextNode.metadata?.errorDetails).toBeUndefined();
    expect(updated.selectedNodeIds).toEqual([textNode.id]);
  });

  test("adds video nodes as a disabled placeholder", () => {
    const state = addVideoNode(createInitialCanvasState(), { x: 320, y: 220 });
    const videoNode = state.nodes.at(-1)!;

    expect(videoNode.type).toBe("video");
    expect(videoNode.title).toBe("视频节点");
    expect(videoNode.metadata?.content).toContain("未开发");
    expect(state.selectedNodeIds).toEqual([videoNode.id]);
  });

  test("adds a connected node from a connection drop menu action", () => {
    const state = createInitialCanvasState();
    const connected = addConnectedNode(state, "seed-text", "config", { x: 640, y: 260 });
    const configNode = connected.nodes.at(-1)!;

    expect(configNode.type).toBe("config");
    expect(configNode.position).toEqual({ x: 640, y: 260 });
    expect(configNode.metadata?.prompt).toBe("");
    expect(connected.connections.some((connection) => connection.fromNodeId === "seed-text" && connection.toNodeId === configNode.id)).toBe(true);
    expect(connected.selectedNodeIds).toEqual([configNode.id]);
  });

  test("ignores connected node creation when the source node is missing", () => {
    const state = createInitialCanvasState();
    const connected = addConnectedNode(state, "missing-node", "image", { x: 640, y: 260 });

    expect(connected).toBe(state);
  });

  test("appends generation nodes with a connection", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.type === "config")!;
    const generated = appendGenerationNode(state, configNode.id, {
      imageUrl: "/api/images/result.png",
      prompt: "霓虹城市猫咪",
      sourceTaskId: "task-1",
      model: "gpt-image-2",
      size: "1:1",
      attempt: 1,
    });
    const resultNode = generated.nodes.at(-1)!;

    expect(resultNode.type).toBe("generation");
    expect(resultNode.metadata?.imageUrl).toBe("/api/images/result.png");
    expect(resultNode.metadata?.sourceTaskId).toBe("task-1");
    expect(resultNode.metadata?.model).toBe("gpt-image-2");
    expect(resultNode.metadata?.size).toBe("1:1");
    expect(resultNode.metadata?.attempt).toBe(1);
    expect(generated.connections.some((connection) => connection.fromNodeId === configNode.id && connection.toNodeId === resultNode.id)).toBe(true);
    expect(generated.selectedNodeIds).toEqual([resultNode.id]);
  });

  test("appends video result nodes with a connection", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.type === "config")!;
    const generated = appendGenerationNode(state, configNode.id, {
      imageUrl: "",
      videoUrl: "https://cdn.example.test/result.mp4",
      mediaType: "video",
      prompt: "镜头推进产品展示",
      sourceTaskId: "video-task-1",
      model: "agnes-video-v2.0",
      size: "16:9",
      status: "loading",
      attempt: 1,
    });
    const resultNode = generated.nodes.at(-1)!;

    expect(resultNode.type).toBe("video");
    expect(resultNode.title).toBe("AI 视频结果");
    expect(resultNode.metadata?.videoUrl).toBe("https://cdn.example.test/result.mp4");
    expect(resultNode.metadata?.mediaType).toBe("video");
    expect(resultNode.metadata?.generationMode).toBe("video");
    expect(resultNode.metadata?.sourceTaskId).toBe("video-task-1");
    expect(generated.connections.some((connection) => connection.fromNodeId === configNode.id && connection.toNodeId === resultNode.id)).toBe(true);
    expect(generated.selectedNodeIds).toEqual([resultNode.id]);
  });

  test("calculates adaptive generation node sizes from image dimensions", () => {
    const portrait = getImageAdaptiveNodeSize(1024, 1536);
    const landscape = getImageAdaptiveNodeSize(1536, 864);

    expect(portrait.width).toBeGreaterThanOrEqual(260);
    expect(portrait.width).toBeLessThanOrEqual(420);
    expect(portrait.height).toBeGreaterThan(300);
    expect(portrait.height).toBeGreaterThan(portrait.width);
    expect(landscape.width).toBeGreaterThan(280);
    expect(landscape.height).toBeLessThan(portrait.height);
  });

  test("sizes generation nodes so the node box matches the loaded image ratio without internal padding", () => {
    const size = getImageAdaptiveNodeSize(1122, 1402);
    const expectedImageHeight = size.width / (1122 / 1402);

    expect(size.height).toBe(Math.round(expectedImageHeight));
  });

  test("resizes generation nodes to the loaded image aspect ratio", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.type === "config")!;
    const generated = appendGenerationNode(state, configNode.id, {
      imageUrl: "/api/images/portrait-result.png",
      prompt: "竖版海报",
      sourceTaskId: "task-portrait",
      status: "success",
      size: "9:16",
    });
    const resultNode = generated.nodes.at(-1)!;
    const resized = updateNodeImageNaturalSize(generated, resultNode.id, 1024, 1536);
    const resizedNode = resized.nodes.find((node) => node.id === resultNode.id)!;

    expect(resizedNode.width).not.toBe(280);
    expect(resizedNode.height).not.toBe(220);
    expect(resizedNode.height).toBeGreaterThan(resizedNode.width);
    expect(resizedNode.metadata?.imageNaturalWidth).toBe(1024);
    expect(resizedNode.metadata?.imageNaturalHeight).toBe(1536);
  });

  test("marks generation nodes as retrying without changing their failed status", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.type === "config")!;
    const failed = appendGenerationNode(state, configNode.id, {
      imageUrl: "",
      prompt: "霓虹城市猫咪",
      sourceTaskId: "task-1",
      status: "error",
      errorDetails: "提交失败",
      attempt: 1,
    });
    const failedNode = failed.nodes.at(-1)!;
    const retrying = updateGenerationNodeRetrying(failed, failedNode.id, true);
    const retryingNode = retrying.nodes.find((node) => node.id === failedNode.id)!;

    expect(retryingNode.metadata?.status).toBe("error");
    expect(retryingNode.metadata?.errorDetails).toBe("提交失败");
    expect(retryingNode.metadata?.retrying).toBe(true);
  });

  test("updates an existing generation node payload without appending a retry result node", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.type === "config")!;
    const failed = appendGenerationNode(state, configNode.id, {
      imageUrl: "",
      prompt: "霓虹城市猫咪",
      sourceTaskId: "task-1",
      status: "error",
      errorDetails: "提交失败",
      attempt: 1,
    });
    const failedNode = failed.nodes.at(-1)!;
    const updated = updateGenerationNodePayload(failed, failedNode.id, {
      imageUrl: "/api/images/retry-result.png",
      prompt: "霓虹城市猫咪",
      sourceTaskId: "task-2",
      status: "success",
      model: "gpt-image-2",
      size: "1:1",
      attempt: 2,
    });
    const sameNode = updated.nodes.find((node) => node.id === failedNode.id)!;

    expect(updated.nodes).toHaveLength(failed.nodes.length);
    expect(updated.connections).toHaveLength(failed.connections.length);
    expect(sameNode.metadata?.imageUrl).toBe("/api/images/retry-result.png");
    expect(sameNode.metadata?.sourceTaskId).toBe("task-2");
    expect(sameNode.metadata?.status).toBe("success");
    expect(sameNode.metadata?.errorDetails).toBeUndefined();
    expect(sameNode.metadata?.attempt).toBe(2);
    expect(updated.selectedNodeIds).toEqual([failedNode.id]);
  });

  test("stacks multiple generation nodes near the source node without overlap", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.type === "config")!;
    const first = appendGenerationNode(state, configNode.id, {
      imageUrl: "",
      prompt: "第一张",
      sourceTaskId: "task-1",
      status: "loading",
    });
    const second = appendGenerationNode(first, configNode.id, {
      imageUrl: "",
      prompt: "第二张",
      sourceTaskId: "task-2",
      status: "loading",
    });
    const resultNodes = second.nodes.filter((node) => node.type === "generation" && node.id !== "seed-generation");

    expect(resultNodes.map((node) => node.position)).toEqual([
      { x: configNode.position.x + configNode.width + 140, y: configNode.position.y + 26 },
      { x: configNode.position.x + configNode.width + 140, y: configNode.position.y + 286 },
    ]);
  });

  test("updates generation task nodes after polling", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.type === "config")!;
    const pending = appendGenerationNode(state, configNode.id, {
      imageUrl: "",
      prompt: "霓虹城市猫咪",
      sourceTaskId: "task-1",
      status: "loading",
    });
    const updated = updateGenerationTaskNode(pending, "task-1", {
      imageUrl: "/api/images/result.png",
      status: "success",
    });
    const resultNode = updated.nodes.find((node) => node.metadata?.sourceTaskId === "task-1")!;

    expect(resultNode.metadata?.status).toBe("success");
    expect(resultNode.metadata?.imageUrl).toBe("/api/images/result.png");
  });

  test("updates video task nodes after polling", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.type === "config")!;
    const pending = appendGenerationNode(state, configNode.id, {
      imageUrl: "",
      videoUrl: "",
      mediaType: "video",
      prompt: "镜头推进产品展示",
      sourceTaskId: "video-task-1",
      status: "loading",
    });
    const updated = updateGenerationTaskNode(pending, "video-task-1", {
      imageUrl: "",
      videoUrl: "https://cdn.example.test/result.mp4",
      status: "success",
    });
    const resultNode = updated.nodes.find((node) => node.metadata?.sourceTaskId === "video-task-1")!;

    expect(resultNode.type).toBe("video");
    expect(resultNode.metadata?.status).toBe("success");
    expect(resultNode.metadata?.videoUrl).toBe("https://cdn.example.test/result.mp4");
  });

  test("keeps state reference when generation polling returns the same payload", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.type === "config")!;
    const pending = appendGenerationNode(state, configNode.id, {
      imageUrl: "",
      prompt: "霓虹城市猫咪",
      sourceTaskId: "task-1",
      status: "loading",
    });
    const unchanged = updateGenerationTaskNode(pending, "task-1", {
      imageUrl: "",
      status: "loading",
      errorDetails: undefined,
    });

    expect(unchanged).toBe(pending);
  });

  test("selects and deletes connections", () => {
    const state = createInitialCanvasState();
    const connection = state.connections[0];
    const selected = selectConnection(state, connection.id);
    const deleted = deleteSelected(selected);

    expect(selected.selectedConnectionId).toBe(connection.id);
    expect(selected.selectedNodeIds).toEqual([]);
    expect(deleted.connections.some((item) => item.id === connection.id)).toBe(false);
    expect(deleted.selectedConnectionId).toBeNull();
  });

  test("renames nodes from canvas context actions", () => {
    const state = createInitialCanvasState();
    const renamed = renameNode(state, "seed-config", "最终出图配置");
    const configNode = renamed.nodes.find((node) => node.id === "seed-config")!;

    expect(configNode.title).toBe("最终出图配置");
    expect(renamed).not.toBe(state);
  });

  test("disconnects all incoming and outgoing links for a node without clearing selection", () => {
    const state = selectNode(createInitialCanvasState(), "seed-config");
    const disconnected = disconnectNode(state, "seed-config");

    expect(disconnected.connections).toEqual([]);
    expect(disconnected.selectedNodeIds).toEqual(["seed-config"]);
    expect(disconnected.selectedNodeId).toBe("seed-config");
    expect(disconnected.selectedConnectionId).toBeNull();
  });

  test("selects all nodes and nudges them with keyboard-style offsets", () => {
    const state = createInitialCanvasState();
    const selected = selectAllNodes(state);
    const nudged = nudgeSelectedNodes(selected, { x: 1, y: -1 });

    expect(selected.selectedNodeIds).toEqual(state.nodes.map((node) => node.id));
    expect(nudged.nodes.map((node) => node.position)).toEqual([
      { x: 161, y: 169 },
      { x: 521, y: 139 },
      { x: 861, y: 229 },
      { x: 1201, y: 179 },
    ]);
  });

  test("duplicates selected nodes and copies only internal connections", () => {
    const state = createInitialCanvasState();
    const selected = selectNodes(state, ["seed-text", "seed-image", "seed-config"]);
    const duplicated = duplicateSelectedNodes(selected);
    const duplicatedNodes = duplicated.nodes.filter((node) => duplicated.selectedNodeIds.includes(node.id));

    expect(duplicatedNodes).toHaveLength(3);
    expect(duplicatedNodes.map((node) => node.position)).toEqual([
      { x: 208, y: 218 },
      { x: 568, y: 188 },
      { x: 908, y: 278 },
    ]);
    expect(duplicated.connections).toHaveLength(state.connections.length + 2);
  });

  test("updates viewport and persists state", () => {
    const storage = createMemoryStorage();
    const state = updateViewport(createInitialCanvasState(), { x: -40, y: 18, k: 1.25 });

    saveCanvasState(storage, state);
    const loaded = loadCanvasState(storage);

    expect(loaded?.viewport).toEqual({ x: -40, y: 18, k: 1.25 });
    expect(loaded?.title).toBe("未命名画布");
  });

  test("normalizes stored config nodes to the inline generation card size", () => {
    const storage = createMemoryStorage();
    const state = createInitialCanvasState();
    const legacyState = {
      ...state,
      nodes: state.nodes.map((node) => (
        node.type === "config"
          ? { ...node, width: 250, height: 186 }
          : node
      )),
    };

    saveCanvasState(storage, legacyState);
    const loaded = loadCanvasState(storage);
    const configNode = loaded?.nodes.find((node) => node.type === "config");

    expect(configNode?.width).toBe(430);
    expect(configNode?.height).toBe(300);
  });

  test("removes the old default prompt sentence from stored canvas nodes", () => {
    const storage = createMemoryStorage();
    const state = createInitialCanvasState();
    const legacyState = {
      ...state,
      nodes: state.nodes.map((node) => (
        node.id === "seed-config"
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                prompt: "换个姿势\n\n整合上游节点后生成图片。",
              },
            }
          : node.id === "seed-generation"
            ? {
                ...node,
                metadata: {
                  ...node.metadata,
                  prompt: "整合上游节点后生成图片。",
                },
              }
            : node
      )),
    };

    saveCanvasState(storage, legacyState);
    const loaded = loadCanvasState(storage);
    const configNode = loaded?.nodes.find((node) => node.id === "seed-config");
    const resultNode = loaded?.nodes.find((node) => node.id === "seed-generation");

    expect(configNode?.metadata?.prompt).toBe("换个姿势");
    expect(resultNode?.metadata?.prompt).toBe("");
  });

  test("undoes and redoes recordable canvas history mutations", () => {
    const history = createInitialCanvasHistory(createInitialCanvasState());
    const added = applyCanvasHistoryMutation(history, (state) => addTextNode(state, { x: 240, y: 260 }));
    const undone = commitCanvasHistory(added, "undo");
    const redone = commitCanvasHistory(undone, "redo");

    expect(added.present.nodes).toHaveLength(history.present.nodes.length + 1);
    expect(added.canUndo).toBe(true);
    expect(added.canRedo).toBe(false);
    expect(undone.present.nodes).toHaveLength(history.present.nodes.length);
    expect(undone.canUndo).toBe(false);
    expect(undone.canRedo).toBe(true);
    expect(redone.present.nodes).toHaveLength(history.present.nodes.length + 1);
    expect(redone.canUndo).toBe(true);
  });

  test("clears redo history after a new mutation", () => {
    const history = createInitialCanvasHistory(createInitialCanvasState());
    const added = applyCanvasHistoryMutation(history, (state) => addTextNode(state, { x: 240, y: 260 }));
    const undone = commitCanvasHistory(added, "undo");
    const renamed = applyCanvasHistoryMutation(undone, (state) => renameNode(state, "seed-config", "新的配置名"));

    expect(undone.canRedo).toBe(true);
    expect(renamed.canRedo).toBe(false);
    expect(renamed.present.nodes.find((node) => node.id === "seed-config")?.title).toBe("新的配置名");
  });

  test("coalesces drag-style node movement into a single undo entry", () => {
    const history = createInitialCanvasHistory(selectNode(createInitialCanvasState(), "seed-text"));
    const start = history.present.nodes.find((node) => node.id === "seed-text")!.position;
    const movedOnce = applyCanvasHistoryMutation(
      history,
      (state) => moveNode(state, "seed-text", { x: start.x + 20, y: start.y }),
      { coalesceKey: "drag:seed-text" },
    );
    const movedTwice = applyCanvasHistoryMutation(
      movedOnce,
      (state) => moveNode(state, "seed-text", { x: start.x + 40, y: start.y + 10 }),
      { coalesceKey: "drag:seed-text" },
    );
    const undone = commitCanvasHistory(movedTwice, "undo");

    expect(movedTwice.past).toHaveLength(1);
    expect(movedTwice.present.nodes.find((node) => node.id === "seed-text")?.position).toEqual({ x: start.x + 40, y: start.y + 10 });
    expect(undone.present.nodes.find((node) => node.id === "seed-text")?.position).toEqual(start);
  });

  test("starts a new undo entry after a drag history batch is finalized", () => {
    const history = createInitialCanvasHistory(selectNode(createInitialCanvasState(), "seed-text"));
    const start = history.present.nodes.find((node) => node.id === "seed-text")!.position;
    const firstDrag = applyCanvasHistoryMutation(
      history,
      (state) => moveNode(state, "seed-text", { x: start.x + 20, y: start.y }),
      { coalesceKey: "drag:seed-text" },
    );
    const finalized = finalizeCanvasHistoryBatch(firstDrag);
    const secondDrag = applyCanvasHistoryMutation(
      finalized,
      (state) => moveNode(state, "seed-text", { x: start.x + 40, y: start.y }),
      { coalesceKey: "drag:seed-text" },
    );
    const undoneSecondDrag = commitCanvasHistory(secondDrag, "undo");

    expect(secondDrag.past).toHaveLength(2);
    expect(undoneSecondDrag.present.nodes.find((node) => node.id === "seed-text")?.position).toEqual({ x: start.x + 20, y: start.y });
  });
});

describe("useCanvasStore viewport sharding", () => {
  test("updateViewport mutates the module-level viewport store", () => {
    resetCanvasViewport();
    setCanvasViewport({ x: 12, y: 34, k: 1.5 });
    expect(getCanvasViewport()).toEqual({ x: 12, y: 34, k: 1.5 });
  });

  test("updateViewport clamps zoom into the supported range", () => {
    resetCanvasViewport();
    setCanvasViewport({ x: 0, y: 0, k: 99 });
    expect(getCanvasViewport().k).toBe(4);
  });
});
