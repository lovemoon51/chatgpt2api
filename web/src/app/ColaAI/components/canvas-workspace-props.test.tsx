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

  test("forwards image resize and preview handlers to the canvas surface", () => {
    const workspaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-workspace.tsx"), "utf-8");
    const surfaceStart = workspaceSource.indexOf("<InfiniteCanvasSurface");
    const surfaceEnd = workspaceSource.indexOf("/>", surfaceStart);
    const surfaceProps = workspaceSource.slice(surfaceStart, surfaceEnd);

    expect(surfaceProps).toContain("onImageNaturalSize={updateNodeImageNaturalSize}");
    expect(surfaceProps).toContain("onOpenImagePreview={openCanvasImagePreview}");
  });

  test("reports accepted canvas image tasks for quota accounting", () => {
    const workspaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-workspace.tsx"), "utf-8");
    const workbenchSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cola-ai-workbench.tsx"), "utf-8");

    expect(workspaceSource).toContain("onAcceptedImageTasks?.(acceptedTaskCount)");
    expect(workbenchSource).toContain("onAcceptedImageTasks={handleCanvasAcceptedImageTasks}");
  });

  test("keeps canvas prompt optimization feedback delay short", () => {
    const nodeSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-node.tsx"), "utf-8");
    const match = nodeSource.match(/const textPromptLoadingMinimumMs = (\d+);/);

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeLessThanOrEqual(250);
  });
});
