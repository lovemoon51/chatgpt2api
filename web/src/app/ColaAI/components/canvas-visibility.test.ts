import { describe, expect, test } from "bun:test";

import type { CanvasConnectionData, CanvasNodeData, CanvasViewport } from "./canvas-types";
import {
  getCanvasLayerBounds,
  getVisibleCanvasConnections,
  getVisibleCanvasNodes,
} from "./canvas-visibility";

const viewport: CanvasViewport = {
  x: 0,
  y: 0,
  k: 1,
};

const nodes: CanvasNodeData[] = [
  {
    id: "visible-a",
    type: "text",
    title: "Visible A",
    position: { x: 120, y: 80 },
    width: 240,
    height: 160,
  },
  {
    id: "visible-b",
    type: "image",
    title: "Visible B",
    position: { x: 560, y: 260 },
    width: 220,
    height: 180,
  },
  {
    id: "offscreen",
    type: "config",
    title: "Offscreen",
    position: { x: 1680, y: 1240 },
    width: 250,
    height: 180,
  },
];

const connections: CanvasConnectionData[] = [
  {
    id: "visible-connection",
    fromNodeId: "visible-a",
    toNodeId: "visible-b",
  },
  {
    id: "hidden-connection",
    fromNodeId: "visible-b",
    toNodeId: "offscreen",
  },
];

describe("canvas visibility helpers", () => {
  test("keeps all nodes while the surface size is still unknown", () => {
    expect(
      getVisibleCanvasNodes(nodes, viewport, { width: 0, height: 0 }),
    ).toEqual(nodes);
  });

  test("filters nodes to the current viewport with padding", () => {
    const visibleNodes = getVisibleCanvasNodes(nodes, viewport, { width: 900, height: 600 }, 120);

    expect(visibleNodes.map((node) => node.id)).toEqual(["visible-a", "visible-b"]);
  });

  test("keeps explicitly pinned nodes even when they are offscreen", () => {
    const visibleNodes = getVisibleCanvasNodes(nodes, viewport, { width: 900, height: 600 }, 120, ["offscreen"]);

    expect(visibleNodes.map((node) => node.id)).toEqual(["visible-a", "visible-b", "offscreen"]);
  });

  test("uses a safe viewport scale when filtering visible nodes", () => {
    const visibleNodes = getVisibleCanvasNodes(
      nodes,
      { x: 0, y: 0, k: 0 },
      { width: 900, height: 600 },
      120,
    );

    expect(visibleNodes.map((node) => node.id)).toEqual(["visible-a", "visible-b"]);
  });

  test("renders only connections whose endpoints are visible", () => {
    const visibleNodes = getVisibleCanvasNodes(nodes, viewport, { width: 900, height: 600 }, 120);

    expect(
      getVisibleCanvasConnections(connections, visibleNodes).map((connection) => connection.id),
    ).toEqual(["visible-connection"]);
  });

  test("renders selected offscreen connection only when both endpoints are pinned", () => {
    const visibleNodes = getVisibleCanvasNodes(nodes, viewport, { width: 900, height: 600 }, 120, ["offscreen"]);

    expect(
      getVisibleCanvasConnections(connections, visibleNodes).map((connection) => connection.id),
    ).toEqual(["visible-connection", "hidden-connection"]);
  });

  test("builds tight svg bounds around the rendered nodes", () => {
    const bounds = getCanvasLayerBounds(nodes.slice(0, 2), 80);

    expect(bounds).toEqual({
      left: 40,
      top: 0,
      width: 820,
      height: 520,
    });
  });
});
