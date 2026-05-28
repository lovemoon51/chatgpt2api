import { describe, expect, test, beforeEach } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasConnections } from "./canvas-connections";
import { CanvasConnectionMenu } from "./canvas-connection-menu";
import { CanvasContextMenu } from "./canvas-context-menu";
import { CanvasGenerationPanel } from "./canvas-generation-panel";
import { CanvasGuides } from "./canvas-guides";
import { CanvasNode } from "./canvas-node";
import { CanvasNodeInspector } from "./canvas-node-inspector";
import { CanvasToolbar } from "./canvas-toolbar";
import { resetCanvasViewport, setCanvasViewport } from "./canvas-viewport-store";
import { getCanvasLayerBounds } from "./canvas-visibility";
import { summarizeCanvasUpstream } from "./canvas-workflow";
import { CanvasWorkspace } from "./canvas-workspace";
import { CanvasZoomControls } from "./canvas-zoom-controls";
import { createInitialCanvasState } from "./use-canvas-store";

describe("ColaAI canvas components", () => {
  beforeEach(() => {
    resetCanvasViewport();
  });
  test("renders the four core node types with ColaAI light visual markers", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <div>
        {state.nodes.map((node) => (
          <CanvasNode
            key={node.id}
            node={node}
            selected={node.id === "seed-config"}
            onContentChange={() => undefined}
            onOpenGeneration={() => undefined}
            onPointerDown={() => undefined}
          />
        ))}
      </div>,
    );

    expect(markup).toContain('data-cola-canvas-node="text"');
    expect(markup).toContain('data-cola-canvas-node="image"');
    expect(markup).toContain('data-cola-canvas-node="config"');
    expect(markup).toContain('data-cola-canvas-node="generation"');
    expect(markup).toContain('data-cola-state="selected"');
    expect(markup).toContain("创意提示词");
    expect(markup).toContain("参考图片");
    expect(markup).toContain("生成配置");
    expect(markup).toContain("AI 生图结果");
  });

  test("renders nodes with drag-friendly styling instead of animated transforms", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={state.nodes[0]}
        selected={false}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain("transition-shadow");
    expect(markup).not.toContain("backdrop-blur-xl");
  });

  test("renders node connector handles for workflow linking", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={state.nodes[2]}
        selected={false}
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-canvas-handle="input"');
    expect(markup).toContain('data-cola-canvas-handle="output"');
  });

  test("renders connector handles as full circles centered on the node border", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={state.nodes[2]}
        selected={false}
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain("left-0");
    expect(markup).toContain("right-0");
    expect(markup).toContain("cursor-crosshair");
    expect(markup).toContain("-translate-x-1/2");
    expect(markup).toContain("translate-x-1/2");
  });

  test("does not paint-contain nodes so border handles are not clipped", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={state.nodes[2]}
        selected={false}
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain("contain:layout style");
    expect(markup).not.toContain("contain:layout paint style");
  });

  test("renders video placeholder nodes without enabling generation", () => {
    const state = createInitialCanvasState();
    const videoNode = {
      ...state.nodes[0],
      id: "video-1",
      type: "video" as const,
      title: "视频节点",
      metadata: { content: "视频节点未开发，请勿使用。" },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={videoNode}
        selected={false}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-canvas-node="video"');
    expect(markup).toContain("视频节点");
    expect(markup).toContain("未开发");
    expect(markup).not.toContain("基于节点继续生成");
  });

  test("renders generation node status and error feedback", () => {
    const state = createInitialCanvasState();
    const loadingNode = {
      ...state.nodes[3],
      metadata: {
        ...state.nodes[3].metadata,
        imageUrl: "",
        status: "loading" as const,
        errorDetails: "",
      },
    };
    const errorNode = {
      ...state.nodes[3],
      id: "generation-error",
      metadata: {
        ...state.nodes[3].metadata,
        imageUrl: "",
        status: "error" as const,
        errorDetails: "账号额度不足，请稍后重试。",
      },
    };
    const markup = renderToStaticMarkup(
      <div>
        <CanvasNode
          node={loadingNode}
          selected={false}
          onContentChange={() => undefined}
          onOpenGeneration={() => undefined}
          onPointerDown={() => undefined}
          onRetryGeneration={() => undefined}
        />
        <CanvasNode
          node={errorNode}
          selected={false}
          onContentChange={() => undefined}
          onOpenGeneration={() => undefined}
          onPointerDown={() => undefined}
          onRetryGeneration={() => undefined}
        />
      </div>,
    );

    expect(markup).toContain('data-cola-node-status="loading"');
    expect(markup).toContain("生成中");
    expect(markup).toContain('data-cola-node-status="error"');
    expect(markup).toContain("生成失败");
    expect(markup).toContain("账号额度不足，请稍后重试。");
    expect(markup).toContain('data-cola-action="retry-generation-node"');
    expect(markup).toContain("重试");
  });

  test("renders retrying generation nodes with a disabled retry action", () => {
    const state = createInitialCanvasState();
    const retryingNode = {
      ...state.nodes[3],
      metadata: {
        ...state.nodes[3].metadata,
        imageUrl: "",
        status: "error" as const,
        errorDetails: "账号额度不足，请稍后重试。",
        retrying: true,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={retryingNode}
        selected={false}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
        onRetryGeneration={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-action="retry-generation-node"');
    expect(markup).toContain('data-cola-retry-state="retrying"');
    expect(markup).toContain("重试中");
    expect(markup).toContain("disabled");
  });

  test("renders the connection drop menu with creatable node actions", () => {
    const markup = renderToStaticMarkup(
      <CanvasConnectionMenu
        position={{ x: 320, y: 220 }}
        onClose={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="canvas-connection-menu"');
    expect(markup).toContain('data-cola-action="create-connected-text-node"');
    expect(markup).toContain('data-cola-action="create-connected-image-node"');
    expect(markup).toContain('data-cola-action="create-connected-video-node"');
    expect(markup).toContain('data-cola-action="create-connected-config-node"');
    expect(markup).toContain("文本生成");
    expect(markup).toContain("视频生成");
  });

  test("renders node and connection context menu actions", () => {
    const nodeMarkup = renderToStaticMarkup(
      <CanvasContextMenu
        kind="node"
        position={{ x: 240, y: 180 }}
        canGenerate
        onClose={() => undefined}
        onDelete={() => undefined}
        onDisconnect={() => undefined}
        onDuplicate={() => undefined}
        onGenerate={() => undefined}
        onRename={() => undefined}
      />,
    );
    const connectionMarkup = renderToStaticMarkup(
      <CanvasContextMenu
        kind="connection"
        position={{ x: 260, y: 200 }}
        onClose={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(nodeMarkup).toContain('data-cola-panel="canvas-context-menu"');
    expect(nodeMarkup).toContain('data-cola-action="rename-node"');
    expect(nodeMarkup).toContain('data-cola-action="duplicate-node"');
    expect(nodeMarkup).toContain('data-cola-action="disconnect-node"');
    expect(nodeMarkup).toContain('data-cola-action="delete-node"');
    expect(nodeMarkup).toContain('data-cola-action="context-generate-node"');
    expect(connectionMarkup).toContain('data-cola-action="delete-connection"');
  });

  test("renders the selected node inspector with upstream context", () => {
    const state = createInitialCanvasState();
    const selectedNode = state.nodes.find((node) => node.id === "seed-config")!;
    const markup = renderToStaticMarkup(
      <CanvasNodeInspector
        node={selectedNode}
        upstreamSummary={summarizeCanvasUpstream(state, selectedNode.id)}
        onConfigChange={() => undefined}
        onContentChange={() => undefined}
        onImageChange={() => undefined}
        onOpenGeneration={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="canvas-node-inspector"');
    expect(markup).toContain("节点属性");
    expect(markup).toContain("生成配置");
    expect(markup).toContain("上游输入");
    expect(markup).toContain("文本 1");
    expect(markup).toContain("图片 1");
    expect(markup).toContain("配置 1");
  });

  test("renders image node upload and clear actions in the inspector", () => {
    const state = createInitialCanvasState();
    const selectedNode = state.nodes.find((node) => node.id === "seed-image")!;
    const markup = renderToStaticMarkup(
      <CanvasNodeInspector
        node={selectedNode}
        upstreamSummary={summarizeCanvasUpstream(state, selectedNode.id)}
        onConfigChange={() => undefined}
        onContentChange={() => undefined}
        onImageChange={() => undefined}
        onImageFileChange={() => undefined}
        onImageClear={() => undefined}
        onOpenGeneration={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-action="upload-canvas-image"');
    expect(markup).toContain('data-cola-action="clear-canvas-image"');
    expect(markup).toContain('accept="image/*"');
    expect(markup).toContain("上传图片");
  });

  test("renders generation task details in the inspector", () => {
    const state = createInitialCanvasState();
    const selectedNode = {
      ...state.nodes.find((node) => node.id === "seed-generation")!,
      metadata: {
        prompt: "霓虹城市猫咪",
        imageUrl: "",
        sourceTaskId: "task-1",
        status: "error" as const,
        errorDetails: "账号额度不足，请稍后重试。",
        model: "gpt-image-2",
        size: "16:9",
        attempt: 2,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNodeInspector
        node={selectedNode}
        upstreamSummary={summarizeCanvasUpstream(state, selectedNode.id)}
        onConfigChange={() => undefined}
        onContentChange={() => undefined}
        onImageChange={() => undefined}
        onOpenGeneration={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="canvas-task-details"');
    expect(markup).toContain("任务详情");
    expect(markup).toContain("task-1");
    expect(markup).toContain("生成失败");
    expect(markup).toContain("gpt-image-2");
    expect(markup).toContain("16:9");
    expect(markup).toContain("第 2 次");
    expect(markup).toContain("账号额度不足，请稍后重试。");
  });

  test("renders an action to locate a failed canvas generation task in the generate workspace", () => {
    const state = createInitialCanvasState();
    const selectedNode = {
      ...state.nodes.find((node) => node.id === "seed-generation")!,
      metadata: {
        prompt: "霓虹城市猫咪",
        imageUrl: "",
        sourceTaskId: "task-1",
        status: "error" as const,
        errorDetails: "账号额度不足，请稍后重试。",
        model: "gpt-image-2",
        size: "16:9",
        attempt: 2,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNodeInspector
        node={selectedNode}
        upstreamSummary={summarizeCanvasUpstream(state, selectedNode.id)}
        onConfigChange={() => undefined}
        onContentChange={() => undefined}
        onImageChange={() => undefined}
        onOpenGeneration={() => undefined}
        {...({ onOpenSourceTask: () => undefined } as { onOpenSourceTask: () => void })}
      />,
    );

    expect(markup).toContain('data-cola-action="open-source-generate-task"');
    expect(markup).toContain('data-cola-source-task-id="task-1"');
    expect(markup).toContain("查看生图任务");
  });

  test("renders connections, toolbar, zoom controls, and generation panel", () => {
    const state = createInitialCanvasState();
    const bounds = getCanvasLayerBounds(state.nodes);
    setCanvasViewport({ x: 0, y: 0, k: 0.91 });
    const markup = renderToStaticMarkup(
      <div>
        <CanvasConnections
          bounds={bounds}
          nodes={state.nodes}
          connections={state.connections}
          selectedConnectionId={state.connections[0].id}
          onSelectConnection={() => undefined}
        />
        <CanvasToolbar
          canDelete
          canGenerate
          canRedo
          canUndo
          onAddConfig={() => undefined}
          onAddImage={() => undefined}
          onAddText={() => undefined}
          onDelete={() => undefined}
          onOpenGeneration={() => undefined}
          onRedo={() => undefined}
          onUndo={() => undefined}
        />
        <CanvasZoomControls onFitView={() => undefined} onZoomIn={() => undefined} onZoomOut={() => undefined} />
        <CanvasGenerationPanel
          open
          selectedNode={state.nodes[2]}
          prompt="基于参考图继续生成"
          model="gpt-image-2"
          size="1:1"
          count={1}
          submitting={false}
          onChange={() => undefined}
          onClose={() => undefined}
          onSubmit={() => undefined}
        />
      </div>,
    );

    expect(markup).toContain('data-cola-canvas-layer="connections"');
    expect(markup).toContain('data-cola-state="selected-connection"');
    expect(markup).toContain("pointer-events:stroke");
    expect(markup).toContain('data-cola-panel="canvas-toolbar"');
    expect(markup).toContain('data-cola-action="undo-canvas"');
    expect(markup).toContain('data-cola-action="redo-canvas"');
    expect(markup).toContain('data-cola-action="add-config-node"');
    expect(markup).toContain('data-cola-panel="canvas-zoom-controls"');
    expect(markup).toContain('data-cola-panel="canvas-generation-panel"');
    expect(markup).toContain("继续生成");
    expect(markup).toContain("91%");
    expect(markup).toContain("基于参考图继续生成");
  });

  test("does not render the generation panel when closed", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <CanvasGenerationPanel
        open={false}
        selectedNode={state.nodes[2]}
        prompt="基于参考图继续生成"
        model="gpt-image-2"
        size="1:1"
        count={1}
        submitting={false}
        onChange={() => undefined}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(markup).toBe("");
  });

  test("renders interaction guides and marquee selection overlay", () => {
    const markup = renderToStaticMarkup(
      <CanvasGuides
        guides={[{ axis: "vertical", position: 240, start: 120, end: 420 }]}
        connectionPreview={{ from: { x: 100, y: 120 }, to: { x: 280, y: 190 } }}
        selectionRect={{ left: 80, top: 90, right: 360, bottom: 260 }}
      />,
    );

    expect(markup).toContain('data-cola-canvas-layer="interaction-guides"');
    expect(markup).toContain('data-cola-canvas-guide="vertical"');
    expect(markup).toContain('data-cola-canvas-connection-preview="true"');
    expect(markup).toContain('data-cola-canvas-selection="marquee"');
  });

  test("renders the immersive ColaAI canvas workspace shell", () => {
    const markup = renderToStaticMarkup(<CanvasWorkspace onBack={() => undefined} />);

    expect(markup).toContain('data-cola-panel="canvas-workspace"');
    expect(markup).toContain('data-cola-canvas="immersive-light"');
    expect(markup).toContain('data-cola-canvas-layer="surface"');
    expect(markup).toContain('data-cola-drop-target="canvas-image-file"');
    expect(markup).toContain('data-cola-panel="canvas-toolbar"');
    expect(markup).toContain('data-cola-panel="canvas-zoom-controls"');
    expect(markup).toContain('data-cola-action="canvas-ai-entry"');
    expect(markup).toContain("未命名画布");
    expect(markup).toContain("创意提示词");
    expect(markup).toContain("生成配置");
  });
});
