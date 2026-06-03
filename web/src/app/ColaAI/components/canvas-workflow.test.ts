import { describe, expect, test } from "bun:test";

import type { CanvasState } from "./canvas-types";
import { collectCanvasContinuationSettings, collectCanvasGenerationSettings, summarizeCanvasUpstream } from "./canvas-workflow";
import { createInitialCanvasState } from "./use-canvas-store";

function withCustomWorkflow(): CanvasState {
  const state = createInitialCanvasState();
  return {
    ...state,
    nodes: state.nodes.map((node) => {
      if (node.id === "seed-text") {
        return {
          ...node,
          metadata: {
            ...node.metadata,
            content: "上游文本提示词",
          },
        };
      }
      if (node.id === "seed-image") {
        return {
          ...node,
          metadata: {
            ...node.metadata,
            imageUrl: "/images/reference.png",
          },
        };
      }
      if (node.id === "seed-config") {
        return {
          ...node,
          metadata: {
            ...node.metadata,
            prompt: "配置节点补充描述",
            model: "codex-gpt-image-2",
            size: "16:9",
            count: 3,
          },
        };
      }
      return node;
    }),
  };
}

describe("canvas workflow helpers", () => {
  test("collects upstream text, reference images, and config settings for generation", () => {
    const settings = collectCanvasGenerationSettings(withCustomWorkflow(), "seed-config", {
      prompt: "默认提示词",
      model: "gpt-image-2",
      size: "1:1",
      count: 1,
    });

    expect(settings.prompt).toBe("上游文本提示词\n\n配置节点补充描述");
    expect(settings.model).toBe("codex-gpt-image-2");
    expect(settings.size).toBe("16:9");
    expect(settings.count).toBe(3);
    expect(settings.referenceImages).toEqual([
      {
        nodeId: "seed-image",
        title: "参考图片",
        imageUrl: "/images/reference.png",
      },
    ]);
    expect(settings.sourceNodeIds).toEqual(["seed-text", "seed-image", "seed-config"]);
  });

  test("walks transitive upstream nodes when selected node is a generated result", () => {
    const settings = collectCanvasGenerationSettings(withCustomWorkflow(), "seed-generation", {
      prompt: "默认提示词",
      model: "gpt-image-2",
      size: "1:1",
      count: 1,
    });

    expect(settings.prompt).toBe("上游文本提示词\n\n配置节点补充描述\n\n生成结果会回到画布，并保留创作链路。");
    expect(settings.referenceImages.map((image) => image.nodeId)).toEqual(["seed-image"]);
    expect(settings.sourceNodeIds).toEqual(["seed-text", "seed-image", "seed-config", "seed-generation"]);
  });

  test("resets prompt and uses only the current image when continuing from a generated result", () => {
    const state = {
      ...withCustomWorkflow(),
      nodes: withCustomWorkflow().nodes.map((node) => (
        node.id === "seed-generation"
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                imageUrl: "/images/generated-cat.png",
                prompt: "之前的原始生成提示词",
              },
            }
          : node
      )),
    };
    const settings = collectCanvasContinuationSettings(state, "seed-generation", "改成雨夜霓虹风格", {
      prompt: "默认提示词",
      model: "gpt-image-2",
      size: "1:1",
      count: 1,
    });

    expect(settings.prompt).toBe("改成雨夜霓虹风格");
    expect(settings.prompt).not.toContain("之前的原始生成提示词");
    expect(settings.referenceImages).toEqual([
      {
        nodeId: "seed-generation",
        title: "AI 生图结果",
        imageUrl: "/images/generated-cat.png",
      },
    ]);
    expect(settings.sourceNodeIds).toEqual(["seed-generation"]);
  });

  test("falls back to current settings when no upstream prompt exists", () => {
    const state = createInitialCanvasState();
    const settings = collectCanvasGenerationSettings(
      {
        ...state,
        nodes: state.nodes.map((node) => ({
          ...node,
          metadata: node.metadata ? { ...node.metadata, content: "", prompt: "" } : node.metadata,
        })),
        connections: [],
      },
      "seed-image",
      {
        prompt: "默认提示词",
        model: "gpt-image-2",
        size: "1:1",
        count: 1,
      },
    );

    expect(settings.prompt).toBe("默认提示词");
    expect(settings.referenceImages).toEqual([]);
  });

  test("summarizes upstream nodes for the node inspector", () => {
    const summary = summarizeCanvasUpstream(withCustomWorkflow(), "seed-config");

    expect(summary.textCount).toBe(1);
    expect(summary.imageCount).toBe(1);
    expect(summary.configCount).toBe(1);
    expect(summary.nodes.map((node) => [node.id, node.type, node.title])).toEqual([
      ["seed-text", "text", "创意提示词"],
      ["seed-image", "image", "参考图片"],
      ["seed-config", "config", "生成配置"],
    ]);
    expect(summary.promptPreview).toContain("上游文本提示词");
    expect(summary.promptPreview).toContain("配置节点补充描述");
  });
});
