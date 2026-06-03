import { describe, expect, test } from "bun:test";

import { computeAutoLayout, computeFitViewport, getCanvasNodesBounds } from "./canvas-auto-layout";
import type { CanvasConnectionData, CanvasNodeData } from "./canvas-types";

const nodes: CanvasNodeData[] = [
  { id: "text", type: "text", title: "Text", position: { x: 160, y: 170 }, width: 280, height: 170 },
  { id: "image", type: "image", title: "Image", position: { x: 520, y: 140 }, width: 240, height: 220 },
  { id: "config", type: "config", title: "Config", position: { x: 860, y: 230 }, width: 430, height: 260 },
  { id: "result", type: "generation", title: "Result", position: { x: 1200, y: 180 }, width: 280, height: 220 },
];

const connections: CanvasConnectionData[] = [
  { id: "text-config", fromNodeId: "text", toNodeId: "config" },
  { id: "image-config", fromNodeId: "image", toNodeId: "config" },
  { id: "config-result", fromNodeId: "config", toNodeId: "result" },
];

describe("ColaAI canvas auto layout", () => {
  test("tree layout arranges workflow ranks from the current canvas bounds", () => {
    const positions = computeAutoLayout("tree", nodes, connections);

    expect(positions.text.x).toBe(160);
    expect(positions.image.x).toBe(180);
    expect(positions.config.x).toBe(590);
    expect(positions.result.x).toBe(1170);
    expect(positions.config.x).toBeGreaterThan(positions.image.x);
    expect(positions.result.x).toBeGreaterThan(positions.config.x);
  });

  test("tree layout vertically centers each workflow rank inside the existing bounds", () => {
    const positions = computeAutoLayout("tree", nodes, connections);

    expect(positions.image.y).toBe(84);
    expect(positions.text.y).toBe(376);
    expect(positions.config.y).toBe(185);
    expect(positions.result.y).toBe(205);
  });

  test("tree layout wraps large workflows so fit view keeps nodes visible", () => {
    const manyNodes: CanvasNodeData[] = Array.from({ length: 24 }, (_, index) => ({
      id: `node-${index}`,
      type: index % 4 === 0 ? "text" : "generation",
      title: `Node ${index}`,
      position: { x: index * 360, y: 120 },
      width: 280,
      height: 170,
    }));
    const manyConnections: CanvasConnectionData[] = Array.from({ length: 23 }, (_, index) => ({
      id: `conn-${index}`,
      fromNodeId: `node-${index}`,
      toNodeId: `node-${index + 1}`,
    }));
    const positions = computeAutoLayout("tree", manyNodes, manyConnections);
    const arrangedNodes = manyNodes.map((node) => ({
      ...node,
      position: positions[node.id] ?? node.position,
    }));
    const bounds = getCanvasNodesBounds(arrangedNodes)!;
    const viewport = computeFitViewport(arrangedNodes, { width: 1280, height: 897 })!;

    expect(bounds.width).toBeLessThan(7000);
    expect(viewport.k).toBeGreaterThan(0.12);
  });

  test("tree layout keeps connected workflows grouped before unrelated nodes", () => {
    const groupedNodes: CanvasNodeData[] = [
      { id: "a1", type: "text", title: "A1", position: { x: 0, y: 0 }, width: 200, height: 120 },
      { id: "b1", type: "text", title: "B1", position: { x: 120, y: 0 }, width: 200, height: 120 },
      { id: "a2", type: "config", title: "A2", position: { x: 240, y: 0 }, width: 200, height: 120 },
      { id: "b2", type: "config", title: "B2", position: { x: 360, y: 0 }, width: 200, height: 120 },
      { id: "lonely", type: "image", title: "Single", position: { x: 480, y: 0 }, width: 200, height: 120 },
    ];
    const groupedConnections: CanvasConnectionData[] = [
      { id: "a", fromNodeId: "a1", toNodeId: "a2" },
      { id: "b", fromNodeId: "b1", toNodeId: "b2" },
    ];
    const positions = computeAutoLayout("tree", groupedNodes, groupedConnections);
    const groupAGap = Math.abs(positions.a2.x - positions.a1.x);
    const groupBGap = Math.abs(positions.b2.x - positions.b1.x);
    const groupRowGap = Math.abs(positions.b1.y - positions.a1.y);

    expect(positions.a1.y).toBe(positions.a2.y);
    expect(positions.b1.y).toBe(positions.b2.y);
    expect(groupAGap).toBe(groupBGap);
    expect(groupRowGap).toBeGreaterThan(120);
    expect(positions.lonely.x).toBeGreaterThan(positions.b2.x);
  });

  test("tree layout keeps grid split tiles together as one ordered group", () => {
    const gridNodes: CanvasNodeData[] = [
      { id: "source", type: "image", title: "Source", position: { x: 0, y: 0 }, width: 240, height: 180 },
      {
        id: "split",
        type: "config",
        title: "宫格切分",
        position: { x: 360, y: 0 },
        width: 420,
        height: 320,
        metadata: { derivativeType: "slice", sourceImageNodeId: "source" },
      },
      {
        id: "tile-1-1",
        type: "image",
        title: "宫格 1-1",
        position: { x: 900, y: 20 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      {
        id: "tile-1-2",
        type: "image",
        title: "宫格 1-2",
        position: { x: 1078, y: 20 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      {
        id: "tile-2-1",
        type: "image",
        title: "宫格 2-1",
        position: { x: 900, y: 128 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      {
        id: "tile-2-2",
        type: "image",
        title: "宫格 2-2",
        position: { x: 1078, y: 128 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      { id: "other", type: "generation", title: "Other", position: { x: 1300, y: 0 }, width: 260, height: 180 },
    ];
    const gridConnections: CanvasConnectionData[] = [
      { id: "source-split", fromNodeId: "source", toNodeId: "split" },
      { id: "split-tile-1-1", fromNodeId: "split", toNodeId: "tile-1-1" },
      { id: "split-tile-1-2", fromNodeId: "split", toNodeId: "tile-1-2" },
      { id: "split-tile-2-1", fromNodeId: "split", toNodeId: "tile-2-1" },
      { id: "split-tile-2-2", fromNodeId: "split", toNodeId: "tile-2-2" },
    ];
    const positions = computeAutoLayout("tree", gridNodes, gridConnections);

    expect(positions["tile-1-2"].x - positions["tile-1-1"].x).toBe(178);
    expect(positions["tile-2-2"].x - positions["tile-2-1"].x).toBe(178);
    expect(positions["tile-2-1"].y - positions["tile-1-1"].y).toBe(108);
    expect(positions["tile-2-2"].y - positions["tile-1-2"].y).toBe(108);
    expect(positions["tile-1-1"].y).toBe(positions["tile-1-2"].y);
    expect(positions["tile-2-1"].y).toBe(positions["tile-2-2"].y);
    expect(positions["tile-1-1"].y + (90 * 2 + 18) / 2).toBe(positions.split.y + gridNodes[1].height / 2);
    expect(positions["tile-1-1"].x).toBeGreaterThan(positions.split.x);
  });

  test("tree layout restores a dragged grid split tile group back into grid order", () => {
    const draggedGridNodes: CanvasNodeData[] = [
      { id: "source", type: "image", title: "Source", position: { x: 0, y: 0 }, width: 240, height: 180 },
      {
        id: "split",
        type: "config",
        title: "宫格切分",
        position: { x: 360, y: 0 },
        width: 420,
        height: 320,
        metadata: { derivativeType: "slice", sourceImageNodeId: "source" },
      },
      {
        id: "tile-1-1",
        type: "image",
        title: "宫格 1-1",
        position: { x: 1400, y: 520 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      {
        id: "tile-1-2",
        type: "image",
        title: "宫格 1-2",
        position: { x: 980, y: 40 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      {
        id: "tile-2-1",
        type: "image",
        title: "宫格 2-1",
        position: { x: 1180, y: 740 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      {
        id: "tile-2-2",
        type: "image",
        title: "宫格 2-2",
        position: { x: 760, y: 260 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
    ];
    const draggedGridConnections: CanvasConnectionData[] = [
      { id: "source-split", fromNodeId: "source", toNodeId: "split" },
      { id: "split-tile-1-1", fromNodeId: "split", toNodeId: "tile-1-1" },
      { id: "split-tile-1-2", fromNodeId: "split", toNodeId: "tile-1-2" },
      { id: "split-tile-2-1", fromNodeId: "split", toNodeId: "tile-2-1" },
      { id: "split-tile-2-2", fromNodeId: "split", toNodeId: "tile-2-2" },
    ];
    const positions = computeAutoLayout("tree", draggedGridNodes, draggedGridConnections);

    expect(positions["tile-1-2"].x - positions["tile-1-1"].x).toBe(178);
    expect(positions["tile-2-2"].x - positions["tile-2-1"].x).toBe(178);
    expect(positions["tile-2-1"].y - positions["tile-1-1"].y).toBe(108);
    expect(positions["tile-2-2"].y - positions["tile-1-2"].y).toBe(108);
    expect(positions["tile-1-1"].y).toBe(positions["tile-1-2"].y);
    expect(positions["tile-2-1"].y).toBe(positions["tile-2-2"].y);
    expect(positions["tile-1-1"].y + (90 * 2 + 18) / 2).toBe(positions.split.y + draggedGridNodes[1].height / 2);
    expect(positions["tile-1-1"].x).toBeGreaterThan(positions.split.x);
  });

  test("tree layout vertically centers successful upscale results with their config node", () => {
    const upscaleNodes: CanvasNodeData[] = [
      { id: "source", type: "image", title: "Source", position: { x: 0, y: 0 }, width: 240, height: 180 },
      { id: "other-source", type: "image", title: "Other Source", position: { x: 0, y: 520 }, width: 240, height: 180 },
      {
        id: "upscale",
        type: "config",
        title: "高清",
        position: { x: 420, y: 40 },
        width: 420,
        height: 360,
        metadata: { derivativeType: "upscale", sourceImageNodeId: "source" },
      },
      {
        id: "other-config",
        type: "config",
        title: "Other Config",
        position: { x: 420, y: 520 },
        width: 260,
        height: 140,
      },
      {
        id: "result",
        type: "generation",
        title: "AI 生图结果",
        position: { x: 980, y: 20 },
        width: 280,
        height: 160,
        metadata: { status: "success", imageUrl: "data:image/png;base64,MA==" },
      },
      {
        id: "other-result",
        type: "generation",
        title: "Other Result",
        position: { x: 980, y: 560 },
        width: 280,
        height: 260,
        metadata: { status: "success", imageUrl: "data:image/png;base64,MQ==" },
      },
    ];
    const upscaleConnections: CanvasConnectionData[] = [
      { id: "source-upscale", fromNodeId: "source", toNodeId: "upscale" },
      { id: "upscale-result", fromNodeId: "upscale", toNodeId: "result" },
      { id: "other-source-config", fromNodeId: "other-source", toNodeId: "other-config" },
      { id: "other-config-result", fromNodeId: "other-config", toNodeId: "other-result" },
    ];
    const positions = computeAutoLayout("tree", upscaleNodes, upscaleConnections);

    expect(positions.result.y + upscaleNodes[4].height / 2).toBe(positions.upscale.y + upscaleNodes[2].height / 2);
    expect(positions.result.x).toBeGreaterThan(positions.upscale.x);
  });

  test("tree layout centers an upscale result with its config when grid split results share the next column", () => {
    const mixedNodes: CanvasNodeData[] = [
      { id: "source", type: "image", title: "Source", position: { x: 0, y: 0 }, width: 240, height: 180 },
      {
        id: "split",
        type: "config",
        title: "宫格切分",
        position: { x: 420, y: 0 },
        width: 420,
        height: 320,
        metadata: { derivativeType: "slice", sourceImageNodeId: "source" },
      },
      {
        id: "upscale",
        type: "config",
        title: "高清",
        position: { x: 420, y: 520 },
        width: 420,
        height: 360,
        metadata: { derivativeType: "upscale", sourceImageNodeId: "source" },
      },
      {
        id: "tile-1-1",
        type: "image",
        title: "宫格 1-1",
        position: { x: 980, y: 0 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      {
        id: "tile-1-2",
        type: "image",
        title: "宫格 1-2",
        position: { x: 1158, y: 0 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      {
        id: "tile-2-1",
        type: "image",
        title: "宫格 2-1",
        position: { x: 980, y: 108 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      {
        id: "tile-2-2",
        type: "image",
        title: "宫格 2-2",
        position: { x: 1158, y: 108 },
        width: 160,
        height: 90,
        metadata: { derivativeType: "slice", sourceImageNodeId: "split" },
      },
      {
        id: "upscale-result",
        type: "generation",
        title: "AI 生图结果",
        position: { x: 980, y: 520 },
        width: 280,
        height: 160,
        metadata: { status: "success", imageUrl: "data:image/png;base64,MA==" },
      },
    ];
    const mixedConnections: CanvasConnectionData[] = [
      { id: "source-split", fromNodeId: "source", toNodeId: "split" },
      { id: "source-upscale", fromNodeId: "source", toNodeId: "upscale" },
      { id: "split-tile-1-1", fromNodeId: "split", toNodeId: "tile-1-1" },
      { id: "split-tile-1-2", fromNodeId: "split", toNodeId: "tile-1-2" },
      { id: "split-tile-2-1", fromNodeId: "split", toNodeId: "tile-2-1" },
      { id: "split-tile-2-2", fromNodeId: "split", toNodeId: "tile-2-2" },
      { id: "upscale-result", fromNodeId: "upscale", toNodeId: "upscale-result" },
    ];
    const positions = computeAutoLayout("tree", mixedNodes, mixedConnections);

    expect(positions["upscale-result"].y + mixedNodes[7].height / 2).toBe(positions.upscale.y + mixedNodes[2].height / 2);
    expect(positions["tile-1-1"].y + (90 * 2 + 18) / 2).toBe(positions.split.y + mixedNodes[1].height / 2);
    expect(positions["tile-1-2"].x - positions["tile-1-1"].x).toBe(178);
    expect(positions["tile-2-1"].y - positions["tile-1-1"].y).toBe(108);
  });
});
