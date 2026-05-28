import { describe, expect, test } from "bun:test";

import { getCanvasViewport, resetCanvasViewport, setCanvasViewport } from "./canvas-viewport-store";
import {
  addConfigNode,
  addConnectedNode,
  addConnection,
  addImageNode,
  addTextNode,
  applyCanvasHistoryMutation,
  addVideoNode,
  appendGenerationNode,
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
  nudgeSelectedNodes,
  renameNode,
  saveCanvasState,
  selectAllNodes,
  selectConnection,
  selectNode,
  selectNodes,
  toggleNodeSelection,
  updateImageNode,
  updateGenerationTaskNode,
  updateGenerationNodeRetrying,
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
    expect(configNode.metadata?.model).toBe("gpt-image-2");
    expect(configNode.metadata?.count).toBe(1);
    expect(connected.connections.some((connection) => connection.fromNodeId === imageNode.id && connection.toNodeId === configNode.id)).toBe(true);
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
