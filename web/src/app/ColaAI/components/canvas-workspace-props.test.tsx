import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

describe("CanvasWorkspace prop wiring", () => {
  test("forwards text prompt handlers to the canvas surface", () => {
    const workspaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-workspace.tsx"), "utf-8");
    const surfaceStart = workspaceSource.indexOf("<InfiniteCanvasSurface");
    const surfaceEnd = workspaceSource.indexOf("/>", surfaceStart);
    const surfaceProps = workspaceSource.slice(surfaceStart, surfaceEnd);

    expect(surfaceProps).toContain("onOptimizeTextPrompt={onOptimizeTextPrompt}");
    expect(surfaceProps).toContain("onReverseImagePrompt={onReverseImagePrompt}");
    expect(surfaceProps).toContain("onStartImageReversePrompt={startImageReversePrompt}");
  });
});
