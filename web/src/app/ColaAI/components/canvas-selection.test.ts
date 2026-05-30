import { describe, expect, test } from "bun:test";

import type { CanvasNodeData } from "./canvas-types";
import { createSelectionRect, getNodesInSelectionRect } from "./canvas-selection";

const nodes: CanvasNodeData[] = [
  {
    id: "node-a",
    type: "text",
    title: "A",
    position: { x: 120, y: 80 },
    width: 180,
    height: 120,
  },
  {
    id: "node-b",
    type: "image",
    title: "B",
    position: { x: 380, y: 120 },
    width: 200,
    height: 160,
  },
  {
    id: "node-c",
    type: "config",
    title: "C",
    position: { x: 760, y: 420 },
    width: 220,
    height: 180,
  },
];

describe("canvas selection helpers", () => {
  test("normalizes a dragged rectangle regardless of drag direction", () => {
    expect(
      createSelectionRect({ x: 460, y: 320 }, { x: 180, y: 120 }),
    ).toEqual({
      left: 180,
      top: 120,
      right: 460,
      bottom: 320,
    });
  });

  test("returns nodes intersecting the selection rectangle", () => {
    const rect = createSelectionRect({ x: 100, y: 60 }, { x: 620, y: 300 });

    expect(getNodesInSelectionRect(nodes, rect)).toEqual(["node-a", "node-b"]);
  });

  test("returns an empty result when nothing intersects the selection rectangle", () => {
    const rect = createSelectionRect({ x: 10, y: 10 }, { x: 60, y: 40 });

    expect(getNodesInSelectionRect(nodes, rect)).toEqual([]);
  });
});
