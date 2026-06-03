import { describe, expect, test } from "bun:test";

import { findNearestConnectorHandle } from "./canvas-connectors";

describe("canvas connector helpers", () => {
  test("returns the nearest input handle inside the hit radius", () => {
    const handle = findNearestConnectorHandle(
      [
        { nodeId: "source", kind: "output", center: { x: 100, y: 100 } },
        { nodeId: "target-a", kind: "input", center: { x: 210, y: 100 } },
        { nodeId: "target-b", kind: "input", center: { x: 260, y: 100 } },
      ],
      { x: 218, y: 106 },
      {
        excludeNodeId: "source",
        kind: "input",
        radius: 16,
      },
    );

    expect(handle?.nodeId).toBe("target-a");
  });

  test("ignores handles outside radius and handles on the source node", () => {
    const handle = findNearestConnectorHandle(
      [
        { nodeId: "source", kind: "input", center: { x: 100, y: 100 } },
        { nodeId: "target", kind: "input", center: { x: 140, y: 100 } },
      ],
      { x: 103, y: 100 },
      {
        excludeNodeId: "source",
        kind: "input",
        radius: 20,
      },
    );

    expect(handle).toBeNull();
  });
});
