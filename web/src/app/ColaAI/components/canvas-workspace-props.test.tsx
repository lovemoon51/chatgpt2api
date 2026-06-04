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

  test("forwards canvas image preview handlers to nodes", () => {
    const surfaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "infinite-canvas-surface.tsx"), "utf-8");
    const nodeStart = surfaceSource.indexOf("<CanvasNode");
    const nodeEnd = surfaceSource.indexOf("/>", nodeStart);
    const nodeProps = surfaceSource.slice(nodeStart, nodeEnd);

    expect(nodeProps).toContain("onOpenImagePreview={onOpenImagePreview}");
  });

  test("forwards the active interaction mode to canvas nodes", () => {
    const surfaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "infinite-canvas-surface.tsx"), "utf-8");
    const nodeStart = surfaceSource.indexOf("<CanvasNode");
    const nodeEnd = surfaceSource.indexOf("/>", nodeStart);
    const nodeProps = surfaceSource.slice(nodeStart, nodeEnd);

    expect(nodeProps).toContain("interactionMode={interactionMode}");
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

  test("keeps pointer-mode image surfaces available for node dragging", () => {
    const nodeSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-node.tsx"), "utf-8");
    const imageSurfaceStart = nodeSource.indexOf('data-cola-image-preview-mode="pointer-drag"');
    const imageSurfaceEnd = nodeSource.indexOf("</div>", imageSurfaceStart);
    const imageSurfaceSource = nodeSource.slice(imageSurfaceStart, imageSurfaceEnd);

    expect(imageSurfaceStart).toBeGreaterThanOrEqual(0);
    expect(imageSurfaceSource).toContain("cursor-grab");
    expect(imageSurfaceSource).toContain("active:cursor-grabbing");
    expect(imageSurfaceSource).not.toContain("onPointerDown={(event) => event.stopPropagation()}");
    expect(nodeSource).not.toContain('data-cola-action="open-canvas-image-preview"');
    expect(nodeSource).not.toContain("cursor-zoom-in");
  });

  test("displays the seedance label and badge while preserving the Agnes video model value", () => {
    const nodeSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-node.tsx"), "utf-8");

    expect(nodeSource).toContain('{ value: "agnes-video-v2.0", title: "seedance-1.5", description: "通过 Agnes AI API 调用的视频生成模型。", badge: "seedance" }');
  });

  test("closes canvas node dropdowns when clicking outside the node", () => {
    const nodeSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-node.tsx"), "utf-8");

    expect(nodeSource).toContain("nodeElementRef");
    expect(nodeSource).toContain('document.addEventListener("pointerdown", handleOutsidePointerDown, true)');
    expect(nodeSource).toContain("setConfigPopover(null)");
    expect(nodeSource).toContain("setTextPromptModelOpen(false)");
  });

  test("closes the generation panel model dropdown when clicking outside the panel", () => {
    const panelSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-generation-panel.tsx"), "utf-8");

    expect(panelSource).toContain("panelElementRef");
    expect(panelSource).toContain('document.addEventListener("pointerdown", handleOutsidePointerDown, true)');
    expect(panelSource).toContain("setModelMenuOpen(false)");
  });

  test("forwards canvas image download handlers to nodes", () => {
    const workspaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-workspace.tsx"), "utf-8");
    const surfaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "infinite-canvas-surface.tsx"), "utf-8");
    const surfaceStart = workspaceSource.indexOf("<InfiniteCanvasSurface");
    const surfaceEnd = workspaceSource.indexOf("/>", surfaceStart);
    const surfaceProps = workspaceSource.slice(surfaceStart, surfaceEnd);
    const nodeStart = surfaceSource.indexOf("<CanvasNode");
    const nodeEnd = surfaceSource.indexOf("/>", nodeStart);
    const nodeProps = surfaceSource.slice(nodeStart, nodeEnd);

    expect(workspaceSource).toContain("downloadCanvasImageNode");
    expect(surfaceProps).toContain("onDownloadImage={downloadCanvasImageNode}");
    expect(nodeProps).toContain("onDownloadImage={onDownloadImage}");
  });

  test("forwards grid split execution handlers to nodes", () => {
    const workspaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-workspace.tsx"), "utf-8");
    const surfaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "infinite-canvas-surface.tsx"), "utf-8");
    const surfaceStart = workspaceSource.indexOf("<InfiniteCanvasSurface");
    const surfaceEnd = workspaceSource.indexOf("/>", surfaceStart);
    const surfaceProps = workspaceSource.slice(surfaceStart, surfaceEnd);
    const nodeStart = surfaceSource.indexOf("<CanvasNode");
    const nodeEnd = surfaceSource.indexOf("/>", nodeStart);
    const nodeProps = surfaceSource.slice(nodeStart, nodeEnd);

    expect(workspaceSource).toContain("runGridSplitNode");
    expect(surfaceProps).toContain("onRunGridSplit={runGridSplitNode}");
    expect(nodeProps).toContain("onRunGridSplit={onRunGridSplit}");
  });

  test("uses a grid split dropdown menu with hover-preview custom grid cells", () => {
    const nodeSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-node.tsx"), "utf-8");

    expect(nodeSource).toContain('data-cola-panel="canvas-grid-split-mode-menu"');
    expect(nodeSource).toContain('data-cola-panel="canvas-grid-split-custom-preview"');
    expect(nodeSource).toContain("hoveredGridSplitMode");
    expect(nodeSource).toContain('data-cola-grid-split-custom-cell');
    expect(nodeSource).toContain('data-cola-grid-split-custom-cell-state');
    expect(nodeSource).toContain('data-cola-grid-split-mode-option={option.value}');
    expect(nodeSource).toContain('value: "5x5"');
    expect(nodeSource).toContain("25宫格 (5×5)");
    expect(nodeSource).toContain("自定义宫格");
    expect(nodeSource).toContain("onPointerEnter");
    expect(nodeSource).toContain("onPointerMove");
    expect(nodeSource).toContain("onMouseMove");
    expect(nodeSource).toContain("setHoveredGridSplitMode(customMode)");
    expect(nodeSource).toContain("setHoveredGridSplitMode(null)");
  });

  test("does not rename existing image nodes when replacing their image file", () => {
    const workspaceSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "canvas-workspace.tsx"), "utf-8");
    const dropStart = workspaceSource.indexOf("const handleCanvasImageFileDrop");
    const dropEnd = workspaceSource.indexOf("const openCanvasImagePreview", dropStart);
    const dropSource = workspaceSource.slice(dropStart, dropEnd);

    expect(dropSource).not.toContain("renameNode(targetNodeId");
  });
});
