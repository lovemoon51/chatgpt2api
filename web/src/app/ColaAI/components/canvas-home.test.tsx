import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CanvasHomeEntry } from "./canvas-home-state";
import { getCanvasTemplateCards } from "./canvas-home-state";
import { CanvasHome } from "./canvas-home";

const filledEntry: CanvasHomeEntry = {
  id: "canvas-brand",
  hasCanvas: true,
  title: "品牌探索画布",
  updatedAt: "2026-05-29T08:00:00.000Z",
  nodeCount: 7,
  hasGenerativeContent: true,
  previewTitles: ["品牌关键词", "材质参考", "品牌输出配置"],
  nodeTypeCounts: {
    text: 2,
    image: 1,
    config: 1,
    generation: 3,
  },
};

describe("CanvasHome", () => {
  test("renders the ColaAI canvas library with project and creation actions", () => {
    const markup = renderToStaticMarkup(
      <CanvasHome
        canvases={[filledEntry]}
        templates={getCanvasTemplateCards()}
        onOpenCanvas={() => undefined}
        onCreateBlank={() => undefined}
        onSelectTemplate={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="canvas-home"');
    expect(markup).toContain("fixed inset-0");
    expect(markup).toContain('data-cola-section="canvas-library"');
    expect(markup).toContain('data-cola-card="current-canvas"');
    expect(markup).toContain('data-cola-canvas-id="canvas-brand"');
    expect(markup).toContain('data-cola-section="canvas-templates"');
    expect(markup).toContain("画布库");
    expect(markup).toContain("我的画布");
    expect(markup).toContain("打开画布");
    expect(markup).toContain("新建空白画布");
    expect(markup).toContain("品牌情绪板");
    expect(markup).toContain("最近编辑");
    expect(markup).toContain("品牌探索画布");
    expect(markup).toContain("7 个节点");
    expect(markup).toContain("生成结果 3");
    expect(markup).toContain("品牌关键词");
    expect(markup).toContain("材质参考");
    expect(markup).toContain("输出目标");
  });

  test("renders the first-time empty-state copy when no canvas exists", () => {
    const markup = renderToStaticMarkup(
      <CanvasHome
        canvases={[]}
        templates={getCanvasTemplateCards()}
        onOpenCanvas={() => undefined}
        onCreateBlank={() => undefined}
        onSelectTemplate={() => undefined}
      />,
    );

    expect(markup).toContain("创建第一张画布");
    expect(markup).toContain("还没有画布");
    expect(markup).toContain("先创建一张画布");
    expect(markup).toContain("新建空白画布");
  });

  test("renders multiple canvas records instead of only the most recent one", () => {
    const markup = renderToStaticMarkup(
      <CanvasHome
        canvases={[
          filledEntry,
          {
            id: "canvas-blank",
            hasCanvas: true,
            title: "空白草稿",
            updatedAt: "2026-05-29T07:00:00.000Z",
            nodeCount: 0,
            hasGenerativeContent: false,
            previewTitles: [],
            nodeTypeCounts: {
              text: 0,
              image: 0,
              config: 0,
              generation: 0,
            },
          },
        ]}
        templates={getCanvasTemplateCards()}
        onOpenCanvas={() => undefined}
        onCreateBlank={() => undefined}
        onSelectTemplate={() => undefined}
      />,
    );

    expect(markup).toContain("2 个项目");
    expect(markup).toContain("品牌探索画布");
    expect(markup).toContain("空白草稿");
    expect(markup).toContain('data-cola-canvas-id="canvas-brand"');
    expect(markup).toContain('data-cola-canvas-id="canvas-blank"');
  });
});
