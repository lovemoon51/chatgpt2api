import { describe, expect, test } from "bun:test";

import { computeCanvasConnectionPath } from "./canvas-connection-paths";

describe("computeCanvasConnectionPath", () => {
  test("draws a Bezier path from the right edge of `from` to the left edge of `to`", () => {
    const path = computeCanvasConnectionPath(
      { position: { x: 0, y: 0 }, width: 100, height: 80 },
      { position: { x: 300, y: 100 }, width: 120, height: 60 },
    );
    expect(path.startsWith("M 100 40 C ")).toBe(true);
    expect(path.endsWith(" 300 130")).toBe(true);
  });

  test("uses a minimum curvature of 68", () => {
    const path = computeCanvasConnectionPath(
      { position: { x: 0, y: 0 }, width: 100, height: 80 },
      { position: { x: 110, y: 0 }, width: 50, height: 80 },
    );
    expect(path).toContain("168 40");
  });
});
