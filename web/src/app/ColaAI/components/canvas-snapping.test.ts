import { describe, expect, test } from "bun:test";

import type { CanvasNodeData } from "./canvas-types";
import { getSnappedDelta } from "./canvas-snapping";

const movingNode: CanvasNodeData = {
  id: "moving",
  type: "text",
  title: "Moving",
  position: { x: 100, y: 100 },
  width: 100,
  height: 80,
};

const stationaryNode: CanvasNodeData = {
  id: "stationary",
  type: "image",
  title: "Stationary",
  position: { x: 210, y: 160 },
  width: 140,
  height: 120,
};

describe("canvas snapping helpers", () => {
  test("snaps a moving node edge onto a nearby stationary node edge", () => {
    const snapped = getSnappedDelta({
      movingNodes: [movingNode],
      stationaryNodes: [stationaryNode],
      delta: { x: 5, y: 0 },
      threshold: 12,
    });

    expect(snapped.delta).toEqual({ x: 10, y: 0 });
    expect(snapped.guides).toHaveLength(1);
    expect(snapped.guides[0]).toMatchObject({
      axis: "vertical",
      position: 210,
    });
  });

  test("snaps center lines independently on the vertical axis", () => {
    const snapped = getSnappedDelta({
      movingNodes: [movingNode],
      stationaryNodes: [
        {
          ...stationaryNode,
          position: { x: 420, y: 85 },
        },
      ],
      delta: { x: 0, y: 0 },
      threshold: 10,
    });

    expect(snapped.delta).toEqual({ x: 0, y: 5 });
    expect(snapped.guides[0]).toMatchObject({
      axis: "horizontal",
      position: 145,
    });
  });

  test("keeps the original delta when no snap target is within threshold", () => {
    const snapped = getSnappedDelta({
      movingNodes: [movingNode],
      stationaryNodes: [stationaryNode],
      delta: { x: 27, y: 11 },
      threshold: 8,
    });

    expect(snapped.delta).toEqual({ x: 27, y: 11 });
    expect(snapped.guides).toEqual([]);
  });
});
