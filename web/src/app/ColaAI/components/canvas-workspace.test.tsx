import { describe, expect, test, beforeEach } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasConnections } from "./canvas-connections";
import { CanvasConnectionMenu } from "./canvas-connection-menu";
import { CanvasContextMenu } from "./canvas-context-menu";
import { CanvasGenerationPanel } from "./canvas-generation-panel";
import { CanvasGuides } from "./canvas-guides";
import { createBlankCanvasState } from "./canvas-home-state";
import { CANVAS_SHORTCUTS, CanvasMinimapPanel } from "./canvas-minimap-panel";
import { CanvasNode } from "./canvas-node";
import { CanvasNodeInfoDialog } from "./canvas-node-info-dialog";
import { CanvasNodeInspector } from "./canvas-node-inspector";
import { CanvasToolbar } from "./canvas-toolbar";
import { getCanvasSurfaceCursor, getCanvasSurfacePointerIntent, setCanvasDragCursor, shouldHandleCanvasWheel } from "./infinite-canvas-surface";
import { resetCanvasViewport, setCanvasViewport } from "./canvas-viewport-store";
import { getCanvasLayerBounds } from "./canvas-visibility";
import { collectCanvasContinuationSettings, getCanvasContinuationInputCounts, summarizeCanvasUpstream } from "./canvas-workflow";
import { CanvasWorkspace, findOpenCanvasNodePosition, formatImageTextResultContent, getCanvasContinuationPanelPrompt, getCanvasGenerationLaunchIntent, getCanvasGenerationPanelConfigTargetId, getCanvasTaskMediaPayload, getGridSplitDimensions } from "./canvas-workspace";
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
    expect(markup).toContain('data-cola-node-layout="inline-generation-config"');
    expect(markup).toContain("生图");
    expect(markup).toContain("文本");
    expect(markup).toContain("视频");
    expect(markup).toContain("提示词 1 个");
    expect(markup).toContain("参考图 0 张");
    expect(markup).toContain("预览");
    expect(markup).toContain("自动 · 1张");
    expect(markup).toContain('data-cola-action="canvas-config-model"');
    expect(markup).toContain('data-cola-action="canvas-config-settings"');
    expect(markup).toContain("开始生成");
  });

  test("renders canvas config node choices from the ColaAI generate controls", () => {
    const state = createInitialCanvasState();
    const configNode = {
      ...state.nodes.find((node) => node.id === "seed-config")!,
      metadata: {
        prompt: "生成一组视觉方向。",
        model: "codex-gpt-image-2",
        size: "16:9",
        count: 3,
        status: "idle" as const,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={configNode}
        selected
        onConfigChange={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain("codex-gpt-image-2");
    expect(markup).toContain("16:9 · 3张");
    expect(markup).toContain('data-cola-action="canvas-config-model"');
    expect(markup).toContain('data-cola-action="canvas-config-settings"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('data-cola-panel="canvas-config-model-options"');
    expect(markup).not.toContain('data-cola-panel="canvas-config-generation-settings"');
  });

  test("renders config node input counters from actual upstream canvas links", () => {
    const state = createInitialCanvasState();
    const emptyReferenceMarkup = renderToStaticMarkup(
      <CanvasWorkspace onBack={() => undefined} initialState={state} />,
    );

    expect(emptyReferenceMarkup).toContain("提示词 1 个");
    expect(emptyReferenceMarkup).toContain("参考图 0 张");

    const stateWithReferenceImage = {
      ...state,
      nodes: state.nodes.map((node) =>
        node.id === "seed-image"
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                imageUrl: "data:image/png;base64,iVBORw0KGgo=",
                status: "success" as const,
              },
            }
          : node,
      ),
    };
    const linkedMarkup = renderToStaticMarkup(
      <CanvasWorkspace onBack={() => undefined} initialState={stateWithReferenceImage} />,
    );

    expect(linkedMarkup).toContain("提示词 1 个");
    expect(linkedMarkup).toContain("参考图 1 张");
    expect(linkedMarkup).not.toContain("参考图 0 张");

    const configNode = state.nodes.find((node) => node.id === "seed-config")!;
    const isolatedMarkup = renderToStaticMarkup(
      <CanvasWorkspace
        onBack={() => undefined}
        initialState={{
          ...state,
          nodes: [{ ...configNode, id: "isolated-config", position: { x: 260, y: 180 } }],
          connections: [],
        }}
      />,
    );

    expect(isolatedMarkup).toContain("提示词 0 个");
    expect(isolatedMarkup).toContain("参考图 0 张");
  });

  test("formats image-to-text results as editable Chinese content", () => {
    expect(formatImageTextResultContent({
      description: "画面是一只猫坐在窗台前。",
      tags: ["猫", "窗台", "夜景"],
      prompt: "一只猫坐在窗台前，窗外是霓虹夜景。",
      analysis: {
        subject: "猫",
        scene: "窗台与城市夜景",
        lighting: "霓虹反射光",
        style: "电影感写实",
        composition: "主体居中，窗景作为背景",
      },
    })).toBe([
      "【图片描述】",
      "画面是一只猫坐在窗台前。",
      "",
      "【结构化分析】",
      "主体：猫",
      "场景：窗台与城市夜景",
      "光影：霓虹反射光",
      "风格：电影感写实",
      "构图：主体居中，窗景作为背景",
      "",
      "【标签】",
      "猫、窗台、夜景",
      "",
      "【可复用提示词】",
      "一只猫坐在窗台前，窗外是霓虹夜景。",
    ].join("\n"));
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

    expect(markup).toContain('data-cola-node-surface="studio-card"');
    expect(markup).toContain('data-cola-node-title-badge="true"');
    expect(markup).toContain('data-cola-node-icon-tone="text"');
    expect(markup).toContain("transition-shadow");
    expect(markup).not.toContain("backdrop-blur-xl");
  });

  test("renders node titles as floating badges above the top-left corner", () => {
    const state = createInitialCanvasState();
    const textNode = {
      ...state.nodes[0],
      title: "文本节点",
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={textNode}
        selected={false}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-node-title-badge="true"');
    expect(markup).toContain("-translate-y-[calc(100%+8px)]");
    expect(markup).toContain("文本节点");
    expect(markup).not.toContain('data-cola-node-header="true"');
  });

  test("uses text node title and instructional placeholder for new text nodes", () => {
    const state = createInitialCanvasState();
    const textNode = {
      ...state.nodes[0],
      title: "文本节点",
      metadata: { content: "" },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={textNode}
        selected={false}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain("文本节点");
    expect(markup).toContain("双击编辑创意提示词。");
    expect(markup).not.toContain("双击编辑文字");
  });

  test("shows a prompt dialog below a selected text node", () => {
    const state = createInitialCanvasState();
    const textNode = {
      ...state.nodes[0],
      title: "文本节点",
      metadata: { content: "生成一张芙莉莲" },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={textNode}
        selected
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="canvas-text-prompt-dialog"');
    expect(markup).toContain('data-cola-theme="light"');
    expect(markup).toContain('data-cola-action="canvas-text-model"');
    expect(markup).toContain('data-cola-action="canvas-text-translate"');
    expect(markup).toContain('data-cola-action="canvas-text-send"');
    expect(markup).toContain("bg-white/96");
    expect(markup).toContain("bg-slate-50/82");
    expect(markup).toContain("Agnes-2.0-Flash");
    expect(markup).toContain('data-cola-text-model-option="agnes-2.0-flash"');
    expect(markup).toContain("gpt-5.5");
    expect(markup).toContain("gpt-5.4");
    expect(markup).toContain('aria-label="翻译"');
    expect(markup).not.toContain(">翻译<");
    expect(markup).toContain("发送");
    expect(markup).toContain("top-[calc(100%+14px)]");
    expect(markup).toContain("left-1/2");
    expect(markup).toContain("-translate-x-1/2");
    expect(markup).toContain("h-[180px]");
    expect(markup).toContain("flex-1");
    expect(markup).toContain("h-[36px]");
    expect(markup).toContain("h-8");
    expect(markup).toContain("size-9");
    expect(markup).toContain("data-cola-local-loading");
    expect(markup).not.toContain("size-10 place-items-center rounded-[14px]");
  });

  test("renders prompt architect optimization state in the text prompt dialog", () => {
    const state = createInitialCanvasState();
    const textNode = {
      ...state.nodes[0],
      title: "文本节点",
      metadata: { content: "生成一张芙莉莲" },
    };
    const optimizingMarkup = renderToStaticMarkup(
      <CanvasNode
        node={textNode}
        selected
        optimizingTextPrompt
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onOptimizeTextPrompt={async () => "优化后的提示词"}
        onPointerDown={() => undefined}
      />,
    );
    const errorMarkup = renderToStaticMarkup(
      <CanvasNode
        node={textNode}
        selected
        textPromptError="优化失败，请稍后重试。"
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onOptimizeTextPrompt={async () => "优化后的提示词"}
        onPointerDown={() => undefined}
      />,
    );

    expect(optimizingMarkup).toContain('data-cola-state="optimizing"');
    expect(optimizingMarkup).toContain("正在优化");
    expect(optimizingMarkup).toContain("disabled");
    expect(errorMarkup).toContain("优化失败，请稍后重试。");
  });

  test("renders image reverse prompt references inside the selected text prompt dialog", () => {
    const state = createInitialCanvasState();
    const textNode = {
      ...state.nodes[0],
      title: "文本节点",
      metadata: {
        content: "根据图片生成结构化中文提示词，包括主体描述、环境、光影、镜头语言、风格关键词。",
        promptMode: "imageReverse" as const,
        referenceImageNodeIds: ["reference-1", "reference-2"],
      },
    };
    const referenceImages = [
      { nodeId: "reference-1", title: "反推参考图 1", imageUrl: "/images/a.png" },
      { nodeId: "reference-2", title: "反推参考图 2", imageUrl: "" },
    ];
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={textNode}
        selected
        referenceImages={referenceImages}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-mode="imageReverse"');
    expect(markup).toContain('data-cola-panel="canvas-text-reference-images"');
    expect(markup).toContain('data-cola-reference-image-node-id="reference-1"');
    expect(markup).toContain('data-cola-reference-image-node-id="reference-2"');
    expect(markup).toContain("反推参考图 1");
    expect(markup).toContain("等待图片");
  });

  test("centers English text node content while keeping Chinese text left aligned", () => {
    const state = createInitialCanvasState();
    const englishNode = {
      ...state.nodes[0],
      metadata: { content: "A quiet elf standing in a morning forest" },
    };
    const chineseNode = {
      ...state.nodes[0],
      metadata: { content: "生成一张芙莉莲" },
    };
    const englishMarkup = renderToStaticMarkup(
      <CanvasNode
        node={englishNode}
        selected={false}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );
    const chineseMarkup = renderToStaticMarkup(
      <CanvasNode
        node={chineseNode}
        selected={false}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(englishMarkup).toContain('data-cola-text-align="center"');
    expect(englishMarkup).toContain("items-center");
    expect(englishMarkup).toContain("justify-center");
    expect(englishMarkup).toContain("text-center");
    expect(chineseMarkup).toContain('data-cola-text-align="start"');
    expect(chineseMarkup).not.toContain('data-cola-text-align="start" class="flex h-full items-center');
  });

  test("clips long text node content inside the node bounds", () => {
    const state = createInitialCanvasState();
    const textNode = {
      ...state.nodes[0],
      metadata: { content: "芙莉莲".repeat(80) },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={textNode}
        selected
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-node-content="text-preview"');
    expect(markup).toContain("max-h-full");
    expect(markup).toContain("overflow-hidden");
    expect(markup).toContain("break-words");
    expect(markup).toContain("[overflow-wrap:anywhere]");
  });

  test("ignores wheel events from editable canvas targets so text editing can scroll locally", () => {
    const textarea = { closest: () => ({ tagName: "TEXTAREA" }) } as unknown as EventTarget;
    const input = { closest: () => ({ tagName: "INPUT" }) } as unknown as EventTarget;
    const canvasArea = { closest: () => null } as unknown as EventTarget;

    expect(shouldHandleCanvasWheel(textarea)).toBe(false);
    expect(shouldHandleCanvasWheel(input)).toBe(false);
    expect(shouldHandleCanvasWheel(canvasArea)).toBe(true);
  });

  test("keeps node properties hidden until the node info action is used", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.id === "seed-config")!;
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={configNode}
        selected
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-node-layout="inline-generation-config"');
    expect(markup).toContain('data-cola-action="inline-config-start-generation"');
    expect(markup).not.toContain('data-cola-panel="canvas-node-property-popover"');
    expect(markup).not.toContain('data-cola-panel="canvas-node-inline-config"');
  });

  test("renders a hover info action for text nodes without default properties", () => {
    const state = createInitialCanvasState();
    const textNode = state.nodes.find((node) => node.id === "seed-text")!;
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={textNode}
        selected={false}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-node-toolbar="true"');
    expect(markup).toContain('data-cola-action="show-node-info"');
    expect(markup).toContain("group");
    expect(markup).not.toContain('data-cola-panel="canvas-node-property-popover"');
    expect(markup).not.toContain('data-cola-panel="canvas-node-inline-config"');
  });

  test("stacks floating node actions above the title badge row", () => {
    const state = createInitialCanvasState();
    const textNode = state.nodes.find((node) => node.id === "seed-text")!;
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={textNode}
        selected={false}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-node-title-badge="true"');
    expect(markup).toContain('data-cola-node-toolbar="true"');
    expect(markup).toContain('data-cola-node-toolbar-placement="above-title"');
    expect(markup).toContain("-translate-y-[calc(100%+48px)]");
    expect(markup).not.toContain("-translate-y-[calc(100%+10px)]");
  });

  test("renders node info as a centered dialog with outside-click close support", () => {
    const state = createInitialCanvasState();
    const textNode = state.nodes.find((node) => node.id === "seed-text")!;
    const markup = renderToStaticMarkup(
      <CanvasNodeInfoDialog
        node={textNode}
        upstreamSummary={summarizeCanvasUpstream(state, textNode.id)}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="canvas-node-property-popover"');
    expect(markup).toContain('data-cola-backdrop="node-info"');
    expect(markup).toContain('data-cola-wheel-local="true"');
    expect(markup).toContain('data-cola-action="node-info-tab"');
    expect(markup).toContain('data-cola-action="node-json-tab"');
    expect(markup).toContain('data-cola-action="close-node-info"');
    expect(markup).toContain("fixed inset-0");
    expect(markup).toContain("items-center justify-center");
    expect(markup).toContain("overscroll-contain");
    expect(markup).toContain("节点信息");
    expect(markup).toContain("ID");
    expect(markup).toContain("text");
    expect(markup).toContain("280 x 170");
    expect(markup).toContain("160, 170");
    expect(markup).toContain("提示词");
    expect(markup).not.toContain("提示词内容");
  });

  test("renders the canvas controls with the minimap hidden by default", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <CanvasMinimapPanel
        nodes={state.nodes}
        selectedNodeIds={["seed-config"]}
        onFitView={() => undefined}
        onViewportChange={() => undefined}
        onZoomIn={() => undefined}
        onZoomOut={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="canvas-minimap"');
    expect(markup).toContain('data-cola-control-surface="studio-map"');
    expect(markup).not.toContain('data-cola-minimap-card="true"');
    expect(markup).toContain('data-cola-zoom-controls="true"');
    expect(markup).toContain('data-cola-action="toggle-minimap"');
    expect(markup).toContain('data-cola-action="show-shortcuts"');
    expect(markup).not.toContain('data-cola-shortcuts-dialog="true"');
    expect(markup).not.toContain('data-cola-canvas-status="true"');
    expect(markup).toContain("w-[248px]");
    expect(markup).toContain("min-w-[48px]");
    expect(markup).toContain("w-[248px]");
    expect(markup).toContain("bg-white/92");
    expect(markup).toContain("显示小地图");
    expect(markup).toContain("快捷键");
    expect(markup).not.toContain('data-cola-minimap-selected="true"');
    expect(markup).not.toContain("bg-[#11161d]/92");
  });

  test("renders video config nodes with the seedance display name while keeping the Agnes backend model", () => {
    const state = createInitialCanvasState();
    const configNode = {
      ...state.nodes.find((node) => node.id === "seed-config")!,
      metadata: {
        prompt: "镜头推进产品展示。",
        model: "agnes-video-v2.0",
        size: "16:9",
        count: 1,
        generationMode: "video" as const,
        videoDurationSeconds: 10,
        videoResolution: "720p",
        status: "idle" as const,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={configNode}
        selected
        onConfigChange={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-config-mode="video"');
    expect(markup).toContain('data-cola-config-mode-option="video"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("seedance-1.5");
    expect(markup).toContain("16:9 · 10s · 720p");
    expect(markup).toContain('data-cola-action="canvas-config-settings"');
  });

  test("uses the actual canvas interactions in the shortcut help", () => {
    expect(CANVAS_SHORTCUTS).toEqual([
      { key: "指针工具 + 拖拽", description: "框选节点" },
      { key: "手型工具 + 拖拽", description: "移动画布" },
      { key: "滚轮", description: "缩放视图" },
      { key: "Shift + 拖拽", description: "框选节点" },
      { key: "Delete / Backspace", description: "删除选中" },
      { key: "Ctrl / Cmd + Z", description: "撤销" },
      { key: "Ctrl / Cmd + Shift + Z", description: "重做" },
      { key: "Ctrl / Cmd + A", description: "全选节点" },
      { key: "Ctrl / Cmd + D", description: "复制选中" },
      { key: "方向键", description: "微移选中" },
      { key: "Shift + 方向键", description: "快速微移" },
      { key: "Esc", description: "取消操作" },
    ]);
  });

  test("keeps a far-panned viewport visible inside the minimap bounds", () => {
    const state = createInitialCanvasState();
    setCanvasViewport({ x: -2600, y: -2200, k: 1 });
    const markup = renderToStaticMarkup(
      <CanvasMinimapPanel
        nodes={state.nodes}
        selectedNodeIds={[]}
        initialOpen
        onFitView={() => undefined}
        onViewportChange={() => undefined}
        onZoomIn={() => undefined}
        onZoomOut={() => undefined}
      />,
    );

    const viewportRect = markup.match(/data-cola-minimap-viewport="true"[^>]*data-cola-minimap-x="([^"]+)"[^>]*data-cola-minimap-y="([^"]+)"/);
    expect(viewportRect).not.toBeNull();
    const [, x, y] = viewportRect ?? ["", "999", "999"];
    expect(Number(x)).toBeLessThanOrEqual(224);
    expect(Number(y)).toBeLessThanOrEqual(128);
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

  test("isolates image content with strict contain to prevent paint propagation", () => {
    const state = createInitialCanvasState();
    const imageNode = {
      ...state.nodes[1],
      metadata: {
        ...state.nodes[1].metadata,
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={imageNode}
        selected={false}
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );
    expect(markup).toContain('data-cola-image-container="true"');
    expect(markup).toContain("contain:strict");
  });

  test("renders generation node images with an adaptive contain fit instead of cropping", () => {
    const state = createInitialCanvasState();
    const generationNode = {
      ...state.nodes.find((node) => node.id === "seed-generation")!,
      metadata: {
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        status: "success" as const,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={generationNode}
        selected={false}
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-image-fit="adaptive-contain"');
    expect(markup).toContain("object-contain");
    expect(markup).not.toContain("object-cover");
  });

  test("renders generated image nodes as pointer drag surfaces instead of zoom buttons", () => {
    const state = createInitialCanvasState();
    const generationNode = {
      ...state.nodes.find((node) => node.id === "seed-generation")!,
      metadata: {
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        status: "success" as const,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={generationNode}
        selected={false}
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onOpenImagePreview={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-image-frame="flush"');
    expect(markup).toContain('data-cola-image-preview-mode="pointer-drag"');
    expect(markup).toContain("cursor-grab");
    expect(markup).toContain("active:cursor-grabbing");
    expect(markup).not.toContain('data-cola-action="open-canvas-image-preview"');
    expect(markup).not.toContain("cursor-zoom-in");
    expect(markup).not.toContain(" p-4 ");
  });

  test("keeps generated image nodes draggable in hand mode instead of exposing preview", () => {
    const state = createInitialCanvasState();
    const generationNode = {
      ...state.nodes.find((node) => node.id === "seed-generation")!,
      metadata: {
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        status: "success" as const,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        interactionMode="hand"
        node={generationNode}
        selected={false}
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onOpenImagePreview={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-image-preview-mode="drag"');
    expect(markup).not.toContain('data-cola-action="open-canvas-image-preview"');
    expect(markup).not.toContain("cursor-zoom-in");
  });

  test("renders image node images with a full-height contain fit so portrait references stay fully visible", () => {
    const state = createInitialCanvasState();
    const imageNode = {
      ...state.nodes.find((node) => node.id === "seed-image")!,
      metadata: {
        ...state.nodes.find((node) => node.id === "seed-image")!.metadata,
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        status: "success" as const,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={imageNode}
        selected={false}
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-image-fit="adaptive-contain"');
    expect(markup).toContain("h-full w-full object-contain");
    expect(markup).not.toContain("h-auto w-full object-contain");
  });

  test("uses the default image node label instead of imported file names", () => {
    const state = createInitialCanvasState();
    const imageNode = {
      ...state.nodes.find((node) => node.id === "seed-image")!,
      title: "7a2c7268bbf91c3cfae748a05de28c2a.jpg",
      metadata: {
        ...state.nodes.find((node) => node.id === "seed-image")!.metadata,
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        status: "success" as const,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={imageNode}
        selected={false}
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain(">图片节点</span>");
    expect(markup).not.toContain("7a2c7268bbf91c3cfae748a05de28c2a.jpg");
  });

  test("does not render the standalone hover info bubble for image nodes", () => {
    const state = createInitialCanvasState();
    const imageNode = {
      ...state.nodes.find((node) => node.id === "seed-image")!,
      metadata: {
        ...state.nodes.find((node) => node.id === "seed-image")!.metadata,
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        status: "success" as const,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={imageNode}
        selected={false}
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).not.toContain('data-cola-node-toolbar="true"');
    expect(markup).not.toContain('data-cola-node-toolbar-placement="above-title"');
    expect(markup).not.toContain('data-cola-action="show-node-info"');
  });

  test("uses double click upload for image nodes instead of the corner generation button", () => {
    const state = createInitialCanvasState();
    const imageNode = state.nodes.find((node) => node.id === "seed-image")!;
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={imageNode}
        selected
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onImageFileChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-action="double-click-upload-image"');
    expect(markup).toContain('data-cola-image-upload-surface="true"');
    expect(markup).toContain('data-cola-image-upload-icon="true"');
    expect(markup).toContain('data-cola-node-hint="double-click-upload"');
    expect(markup).toContain('aria-label="双击上传图片"');
    expect(markup).toContain("双击上传图片");
    expect(markup).toContain("参考图会跟随画布链路进入继续生成");
    expect(markup).not.toContain("空图片节点");
    expect(markup).toContain('accept="image/*"');
    expect(markup).not.toContain('aria-label="基于节点继续生成"');
    expect(markup).not.toContain('title="继续生成"');
  });

  test("renders selected image node generation option toolbar above the node", () => {
    const state = createInitialCanvasState();
    const imageNode = {
      ...state.nodes.find((node) => node.id === "seed-image")!,
      metadata: {
        ...state.nodes.find((node) => node.id === "seed-image")!.metadata,
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        imageOptions: ["upscale"],
      } as NonNullable<(typeof state.nodes)[number]["metadata"]>,
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={imageNode}
        selected
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onImageFileChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-image-option-toolbar="true"');
    expect(markup).not.toContain("全景");
    expect(markup).not.toContain("NEW");
    expect(markup).not.toContain("多角度");
    expect(markup).not.toContain("打光");
    expect(markup).not.toContain("九宫格");
    expect(markup).toContain("裁剪");
    expect(markup).not.toContain("扩图、裁剪");
    expect(markup).not.toContain("扩图");
    expect(markup).not.toContain("待开发");
    expect(markup).toContain("高清");
    expect(markup).toContain("宫格切分");
    expect(markup).toContain('data-cola-image-option="crop"');
    expect(markup).toContain('data-cola-image-option-state="idle"');
    expect(markup).not.toContain('aria-disabled="true"');
    expect(markup).not.toContain("disabled");
    expect(markup).toContain('data-cola-image-option="upscale"');
    expect(markup).toContain('data-cola-image-option-state="active"');
    expect(markup).toContain('data-cola-image-option="slice"');
    expect(markup).toContain('data-cola-image-option-state="idle"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('data-cola-image-toolbar-actions="true"');
    expect(markup).toContain('data-cola-image-toolbar-separator="true"');
    expect(markup).toContain('data-cola-action="show-node-info"');
    expect(markup).toContain('data-cola-action="download-canvas-image-node"');
    expect(markup).toContain('aria-label="下载图片节点图片"');
    expect(markup).toContain('data-cola-action="preview-canvas-image-node"');
    expect(markup).toContain('aria-label="预览图片节点图片"');
    expect(markup.indexOf('data-cola-action="download-canvas-image-node"')).toBeLessThan(
      markup.indexOf('data-cola-action="preview-canvas-image-node"'),
    );
    expect(markup).not.toContain('data-cola-node-toolbar-placement="above-title"');
    expect(markup).toContain('data-cola-action="double-click-upload-image"');
  });

  test("renders the same image option toolbar for selected AI image result nodes", () => {
    const state = createInitialCanvasState();
    const resultNode = {
      ...state.nodes.find((node) => node.id === "seed-generation")!,
      metadata: {
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        status: "success" as const,
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={resultNode}
        selected
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onImageFileChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-image-option-toolbar="true"');
    expect(markup).toContain("高清");
    expect(markup).toContain("宫格切分");
    expect(markup).toContain('data-cola-image-option="upscale"');
    expect(markup).toContain('data-cola-image-option="slice"');
    expect(markup).toContain('data-cola-action="download-canvas-image-node"');
    expect(markup).toContain('data-cola-action="preview-canvas-image-node"');
    expect(markup).not.toContain('data-cola-action="double-click-upload-image"');
  });

  test("renders GPT upscale config nodes with 1K 2K 4K controls", () => {
    const state = createInitialCanvasState();
    const upscaleNode = {
      ...state.nodes.find((node) => node.id === "seed-config")!,
      id: "upscale-config",
      title: "高清",
      metadata: {
        derivativeType: "upscale" as const,
        model: "gpt-image-2",
        upscaleResolution: "4k" as const,
        sourceImageNodeId: "seed-image",
        prompt: "配置参数生成高清图像。",
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={upscaleNode}
        selected
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-node-layout="upscale-config"');
    expect(markup).toContain('data-cola-panel="canvas-upscale-config"');
    expect(markup).toContain("配置参数生成高清图像");
    expect(markup).toContain("GPT Image 2");
    expect(markup).toContain('data-cola-upscale-resolution-option="1k"');
    expect(markup).toContain('data-cola-upscale-resolution-option="2k"');
    expect(markup).toContain('data-cola-upscale-resolution-option="4k"');
    expect(markup).not.toContain('data-cola-upscale-resolution-option="8k"');
    expect(markup).toContain("1K");
    expect(markup).toContain("2K");
    expect(markup).toContain("4K");
    expect(markup).not.toContain("8K");
  });

  test("renders grid split config nodes with liblib-style mode controls", () => {
    const state = createInitialCanvasState();
    const splitNode = {
      ...state.nodes.find((node) => node.id === "seed-config")!,
      id: "grid-split-config",
      title: "宫格切分",
      metadata: {
        derivativeType: "slice" as const,
        gridSplitMode: "3x3" as const,
        sourceImageNodeId: "seed-image",
        prompt: "将源图片按宫格切分成独立图片节点。",
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={splitNode}
        selected
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-node-layout="grid-split-config"');
    expect(markup).toContain('data-cola-panel="canvas-grid-split-config"');
    expect(markup).toContain("宫格切分");
    expect(markup).toContain("border-dashed border-violet-200/80");
    expect(markup).toContain("bg-[linear-gradient(135deg,rgba(124,58,237,0.08),rgba(14,165,233,0.06)_45%,rgba(255,255,255,0.86))]");
    expect(markup).toContain("text-slate-700");
    expect(markup).toContain('data-cola-action="canvas-grid-split-mode-menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("9宫格 (3×3)");
    expect(markup).not.toContain('data-cola-group="canvas-grid-split-mode-options"');
    expect(markup).toContain('data-cola-action="inline-grid-split-start"');
    expect(markup).toContain("bg-slate-950");
    expect(markup).toContain("开始切分");
    expect(markup).not.toContain("bg-[#262626]");
    expect(markup).not.toContain("bg-[#202020]");
    expect(markup).not.toContain("text-white/42");
  });

  test("renders custom grid split mode as a real selectable state", () => {
    const state = createInitialCanvasState();
    const splitNode = {
      ...state.nodes.find((node) => node.id === "seed-config")!,
      id: "grid-split-custom-config",
      title: "宫格切分",
      metadata: {
        derivativeType: "slice" as const,
        gridSplitMode: "4x3",
        sourceImageNodeId: "seed-image",
        prompt: "将源图片按宫格切分成独立图片节点。",
      },
    };
    const markup = renderToStaticMarkup(
      <CanvasNode
        node={splitNode}
        selected
        onConnectionStart={() => undefined}
        onContentChange={() => undefined}
        onOpenGeneration={() => undefined}
        onPointerDown={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-action="canvas-grid-split-mode-menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("自定义 · 4 × 3");
    expect(markup).not.toContain("bg-[#2f2f2f]");
  });

  test("parses custom grid split dimensions for real slicing", () => {
    expect(getGridSplitDimensions("4x3")).toEqual({ cols: 4, rows: 3, mode: "4x3" });
    expect(getGridSplitDimensions("5x5")).toEqual({ cols: 5, rows: 5, mode: "5x5" });
    expect(getGridSplitDimensions("8x1")).toEqual({ cols: 3, rows: 3, mode: "3x3" });
  });

  test("renders connection layer with GPU compositing hint", () => {
    const state = createInitialCanvasState();
    const bounds = getCanvasLayerBounds(state.nodes);
    const markup = renderToStaticMarkup(
      <CanvasConnections
        bounds={bounds}
        nodes={state.nodes}
        connections={state.connections}
        selectedConnectionId={null}
        onSelectConnection={() => undefined}
      />,
    );
    expect(markup).toContain("translateZ(0)");
    expect(markup).not.toContain("stroke-dasharray");
    expect(markup).not.toContain("strokeDasharray");
  });

  test("renders playable video result nodes", () => {
    const state = createInitialCanvasState();
    const videoNode = {
      ...state.nodes[0],
      id: "video-1",
      type: "video" as const,
      title: "AI 视频结果",
      metadata: {
        content: "镜头推进产品展示",
        videoUrl: "https://cdn.example.test/result.mp4",
        mediaType: "video",
        generationMode: "video" as const,
        status: "success" as const,
      },
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
    expect(markup).toContain("AI 视频结果");
    expect(markup).toContain('data-cola-video-container="true"');
    expect(markup).toContain("<video");
    expect(markup).toContain("controls");
    expect(markup).toContain('src="https://cdn.example.test/result.mp4"');
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
    const stateWithReferenceImage = {
      ...state,
      nodes: state.nodes.map((node) =>
        node.id === "seed-image"
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                imageUrl: "data:image/png;base64,iVBORw0KGgo=",
                status: "success" as const,
              },
            }
          : node,
      ),
    };
    const selectedNode = stateWithReferenceImage.nodes.find((node) => node.id === "seed-config")!;
    const markup = renderToStaticMarkup(
      <CanvasNodeInspector
        node={selectedNode}
        upstreamSummary={summarizeCanvasUpstream(stateWithReferenceImage, selectedNode.id)}
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
          interactionMode="pointer"
          canOrganize
          canRedo
          canUndo
          onAddConfig={() => undefined}
          onAddImage={() => undefined}
          onAddText={() => undefined}
          onDelete={() => undefined}
          onInteractionModeChange={() => undefined}
          onOpenGeneration={() => undefined}
          onOrganize={() => undefined}
          onRedo={() => undefined}
          onUndo={() => undefined}
        />
        <CanvasZoomControls onFitView={() => undefined} onZoomIn={() => undefined} onZoomOut={() => undefined} />
      </div>,
    );

    expect(markup).toContain('data-cola-canvas-layer="connections"');
    expect(markup).toContain('data-cola-state="selected-connection"');
    expect(markup).toContain("pointer-events:stroke");
    expect(markup).toContain('data-cola-panel="canvas-toolbar"');
    expect(markup).toContain('data-cola-toolbar-style="studio-dock"');
    expect(markup).toContain('data-cola-toolbar-group="navigation"');
    expect(markup).toContain('data-cola-toolbar-group="create"');
    expect(markup).toContain('data-cola-toolbar-group="actions"');
    expect(markup).toContain('data-cola-action="canvas-tool-pointer"');
    expect(markup).toContain('data-cola-action="canvas-tool-hand"');
    expect(markup).toContain('data-cola-action="undo-canvas"');
    expect(markup).toContain('data-cola-action="redo-canvas"');
    expect(markup).toContain('data-cola-action="add-config-node"');
    expect(markup).toContain('data-cola-panel="canvas-zoom-controls"');
    expect(markup).not.toContain('data-cola-panel="canvas-generation-panel"');
    expect(markup).toContain("91%");
  });

  test("renders the right-side generation panel with ColaAI generate choices", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <CanvasGenerationPanel
        open
        selectedNode={state.nodes[2]}
        prompt="基于参考图继续生成"
        model="auto"
        size="16:9"
        count={3}
        submitting={false}
        onChange={() => undefined}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="canvas-generation-panel"');
    expect(markup).toContain('data-cola-panel-style="studio-inspector"');
    expect(markup).toContain('data-cola-generation-section="summary"');
    expect(markup).toContain('data-cola-generation-section="prompt"');
    expect(markup).toContain('data-cola-generation-section="parameters"');
    expect(markup).toContain('data-cola-generation-section="footer"');
    expect(markup).toContain("生成配置");
    expect(markup).toContain("Auto");
    expect(markup).toContain("gpt-image-2");
    expect(markup).toContain("codex-gpt-image-2");
    expect(markup).toContain("9:16");
    expect(markup).toContain("2:3");
    expect(markup).toContain("1:1");
    expect(markup).toContain("3:2");
    expect(markup).toContain("16:9");
    expect(markup).toContain("3张");
    expect(markup).toContain("16:9 · 3张");
    expect(markup).toContain('data-cola-action="canvas-generation-model-trigger"');
    expect(markup).toContain('data-cola-generation-model-menu="true"');
    expect(markup).toContain('data-cola-generation-model-option="gpt-image-2"');
    expect(markup).toContain("开始生成");
    expect(markup).toContain("bg-white/96");
    expect(markup).toContain("sticky bottom-0");
    expect(markup).toContain("grid-cols-3");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("延续 ColaAI 当前主题，只重组生图配置结构。");
    expect(markup).not.toContain("rounded-[28px]");
    expect(markup).not.toContain("bg-white/90");
    expect(markup).not.toContain("bg-slate-950 p-1");
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
        connectionPreview={{ from: { x: 100, y: 120 }, to: { x: 280, y: 190 } }}
        selectionRect={{ left: 80, top: 90, right: 360, bottom: 260 }}
      />,
    );

    expect(markup).toContain('data-cola-canvas-layer="interaction-guides"');
    expect(markup).toContain('data-cola-guides-container="true"');
    expect(markup).toContain('data-cola-canvas-connection-preview="true"');
    expect(markup).toContain('data-cola-canvas-selection="marquee"');
  });

  test("renders the immersive ColaAI canvas workspace shell", () => {
    const markup = renderToStaticMarkup(<CanvasWorkspace onBack={() => undefined} />);

    expect(markup).toContain('data-cola-panel="canvas-workspace"');
    expect(markup).toContain('data-cola-canvas="floating-studio-light"');
    expect(markup).toContain('data-cola-canvas-bg="studio-grid"');
    expect(markup).toContain('data-cola-panel="canvas-topbar"');
    expect(markup).not.toContain('data-cola-action="canvas-primary-generate"');
    expect(markup).toContain('data-cola-canvas-layer="surface"');
    expect(markup).toContain('data-cola-canvas-mode="pointer"');
    expect(markup).toContain('data-cola-drop-target="canvas-image-file"');
    expect(markup).toContain('data-cola-panel="canvas-toolbar"');
    expect(markup).toContain('data-cola-panel="canvas-minimap"');
    expect(markup).not.toContain('data-cola-panel="canvas-node-inspector"');
    expect(markup).not.toContain('data-cola-action="canvas-ai-entry"');
    expect(markup).toContain("未命名画布");
    expect(markup).toContain("创意提示词");
    expect(markup).toContain("生成配置");
  });

  test("renders a guided starter state when the canvas is blank", () => {
    const markup = renderToStaticMarkup(
      <CanvasWorkspace onBack={() => undefined} initialState={createBlankCanvasState()} />,
    );

    expect(markup).toContain('data-cola-panel="canvas-empty-state"');
    expect(markup).toContain("从第一个节点开始");
    expect(markup).toContain('data-cola-action="canvas-empty-add-text"');
    expect(markup).toContain('data-cola-action="canvas-empty-add-image"');
    expect(markup).toContain('data-cola-action="canvas-empty-add-config"');
    expect(markup).toContain('data-cola-action="canvas-empty-back-home"');
    expect(markup).not.toContain("创意提示词");
  });

  test("uses pointer mode by default and routes blank-area drags into marquee selection", () => {
    expect(getCanvasSurfacePointerIntent({ button: 0, interactionMode: "pointer", shiftKey: false })).toBe("selection");
    expect(getCanvasSurfacePointerIntent({ button: 0, interactionMode: "hand", shiftKey: false })).toBe("canvas");
    expect(getCanvasSurfacePointerIntent({ button: 0, interactionMode: "pointer", shiftKey: true })).toBe("selection");
    expect(getCanvasSurfacePointerIntent({ button: 1, interactionMode: "pointer", shiftKey: false })).toBe("canvas");
    expect(getCanvasSurfacePointerIntent({ button: 1, interactionMode: "hand", shiftKey: true })).toBe("canvas");
    expect(getCanvasSurfacePointerIntent({ button: 2, interactionMode: "hand", shiftKey: false })).toBe("ignore");
  });

  test("maps canvas cursor styling to the active interaction mode", () => {
    expect(getCanvasSurfaceCursor("pointer")).toBe("cursor-default");
    expect(getCanvasSurfaceCursor("hand")).toBe("cursor-grab");
  });

  test("applies the grabbing cursor to the active drag target and page chrome", () => {
    const target = { style: { cursor: "" } } as HTMLElement;
    const rootDocument = {
      documentElement: { style: { cursor: "" } },
      body: { style: { cursor: "" } },
    } as Document;

    setCanvasDragCursor(target, "grabbing", rootDocument);

    expect(target.style.cursor).toBe("grabbing");
    expect(rootDocument.documentElement.style.cursor).toBe("grabbing");
    expect(rootDocument.body.style.cursor).toBe("grabbing");

    setCanvasDragCursor(target, "default", rootDocument);

    expect(target.style.cursor).toBe("default");
    expect(rootDocument.documentElement.style.cursor).toBe("default");
    expect(rootDocument.body.style.cursor).toBe("default");
  });

  test("finds an open position for newly created canvas nodes instead of stacking them", () => {
    const viewport = { x: 0, y: 0, k: 1 };
    const surfaceSize = { width: 1200, height: 800 };
    const firstPosition = findOpenCanvasNodePosition([], viewport, surfaceSize, { width: 280, height: 170 });
    const secondPosition = findOpenCanvasNodePosition(
      [
        {
          id: "first-new-text",
          type: "text",
          title: "文本节点",
          position: firstPosition,
          width: 280,
          height: 170,
        },
      ],
      viewport,
      surfaceSize,
      { width: 280, height: 170 },
    );

    expect(secondPosition).not.toEqual(firstPosition);
    expect(secondPosition.x).toBeGreaterThanOrEqual(firstPosition.x + 280);
  });

  test("clears the continuation prompt when continuing from an existing generation image", () => {
    const state = createInitialCanvasState();
    const generationNode = {
      ...state.nodes.find((node) => node.id === "seed-generation")!,
      metadata: {
        prompt: "旧提示词",
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        status: "success" as const,
      },
    };

    expect(getCanvasContinuationPanelPrompt(generationNode, "旧提示词", "备用提示词")).toBe("");
  });

  test("routes config generation directly while generation results open the continuation panel", () => {
    const state = createInitialCanvasState();
    const configNode = state.nodes.find((node) => node.id === "seed-config")!;
    const generationNode = {
      ...state.nodes.find((node) => node.id === "seed-generation")!,
      metadata: {
        prompt: "旧提示词",
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        status: "success" as const,
      },
    };

    expect(getCanvasGenerationLaunchIntent(configNode)).toBe("submit");
    expect(getCanvasGenerationLaunchIntent(generationNode)).toBe("panel");
  });

  test("renders the right-side generation panel in video mode with the seedance display name", () => {
    const state = createInitialCanvasState();
    const markup = renderToStaticMarkup(
      <CanvasGenerationPanel
        open
        selectedNode={state.nodes[2]}
        prompt="镜头推进产品展示"
        model="agnes-video-v2.0"
        size="16:9"
        count={1}
        generationMode="video"
        videoDurationSeconds={12}
        videoResolution="480p"
        submitting={false}
        onChange={() => undefined}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('data-cola-generation-mode="video"');
    expect(markup).toContain('data-cola-generation-model-option="agnes-video-v2.0"');
    expect(markup).toContain("seedance-1.5");
    expect(markup).toContain("16:9 · 12s · 480p");
    expect(markup).toContain('data-cola-generation-video-duration-option="6"');
    expect(markup).toContain('data-cola-generation-video-resolution-option="custom"');
    expect(markup).not.toContain("最多 4 张");
  });

  test("maps image task data into video canvas payloads", () => {
    expect(getCanvasTaskMediaPayload({
      id: "video-task-1",
      status: "success",
      mode: "video",
      media_type: "video",
      model: "agnes-video-v2.0",
      created_at: "",
      updated_at: "",
      data: [{ video_url: "https://cdn.example.test/result.mp4" }],
    })).toEqual({
      imageUrl: "",
      videoUrl: "https://cdn.example.test/result.mp4",
      mediaType: "video",
    });
  });

  test("keeps grid split config nodes out of the AI generation launch path", () => {
    const state = createInitialCanvasState();
    const splitNode = {
      ...state.nodes.find((node) => node.id === "seed-config")!,
      metadata: {
        derivativeType: "slice" as const,
        gridSplitMode: "3x3" as const,
        sourceImageNodeId: "seed-image",
      },
    };

    expect(getCanvasGenerationLaunchIntent(splitNode)).toBe("ignore");
  });

  test("counts continuation inputs from the current generated image and newly linked prompts", () => {
    const state = createInitialCanvasState();
    const generationNode = {
      ...state.nodes.find((node) => node.id === "seed-generation")!,
      metadata: {
        prompt: "旧提示词",
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        status: "success" as const,
      },
    };
    const nextPromptNode = {
      ...state.nodes.find((node) => node.id === "seed-text")!,
      id: "next-prompt",
      title: "续写提示词",
      metadata: {
        content: "保留主体，换成晨光玻璃质感。",
      },
    };
    const continuationState = {
      ...state,
      nodes: [
        ...state.nodes.filter((node) => node.id !== "seed-generation"),
        generationNode,
        nextPromptNode,
      ],
      connections: [
        ...state.connections,
        { id: "next-prompt-to-generation", fromNodeId: nextPromptNode.id, toNodeId: generationNode.id },
      ],
    };

    expect(getCanvasContinuationInputCounts(continuationState, generationNode.id, "")).toEqual({
      promptCount: 1,
      referenceCount: 1,
    });
    expect(collectCanvasContinuationSettings(continuationState, generationNode.id, "", {
      prompt: "",
      model: "gpt-image-2",
      size: "1:1",
      count: 1,
    })).toMatchObject({
      prompt: "保留主体，换成晨光玻璃质感。",
      referenceImages: [{ nodeId: generationNode.id, title: generationNode.title, imageUrl: generationNode.metadata.imageUrl }],
    });
  });

  test("syncs right-side generation panel changes only back to config nodes", () => {
    const state = createInitialCanvasState();

    expect(getCanvasGenerationPanelConfigTargetId(state.nodes, "seed-config")).toBe("seed-config");
    expect(getCanvasGenerationPanelConfigTargetId(state.nodes, "seed-image")).toBeNull();
    expect(getCanvasGenerationPanelConfigTargetId(state.nodes, null)).toBeNull();
  });
});
