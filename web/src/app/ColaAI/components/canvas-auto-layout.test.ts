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
});
