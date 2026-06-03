import { describe, expect, test } from "bun:test";

import { createCanvasGenerationTasks } from "./canvas-generation-tasks";
import type { CanvasGenerationSettings } from "./canvas-workflow";

function createSettings(patch: Partial<CanvasGenerationSettings> = {}): CanvasGenerationSettings {
  return {
    prompt: "生成一张角色海报",
    model: "gpt-image-2",
    size: "1:1",
    count: 2,
    referenceImages: [],
    sourceNodeIds: ["seed-text"],
    ...patch,
  };
}

describe("canvas generation task routing", () => {
  test("creates generation tasks when the canvas workflow has no reference images", async () => {
    const generationCalls: Array<{ id: string; prompt: string; model?: string; size?: string }> = [];

    const tasks = await createCanvasGenerationTasks(createSettings(), {
      createTaskId: (index) => `task-${index + 1}`,
      createGenerationTask: async (id, prompt, model, size) => {
        generationCalls.push({ id, prompt, model, size });
        return {
          id,
          status: "queued",
          mode: "generate",
          created_at: "",
          updated_at: "",
        };
      },
      createEditTask: async () => {
        throw new Error("edit task should not be used");
      },
    });

    expect(tasks.map((task) => task.id)).toEqual(["task-1", "task-2"]);
    expect(generationCalls).toEqual([
      { id: "task-1", prompt: "生成一张角色海报", model: "gpt-image-2", size: "1:1" },
      { id: "task-2", prompt: "生成一张角色海报", model: "gpt-image-2", size: "1:1" },
    ]);
  });

  test("returns an error task when the generation task create request fails", async () => {
    const tasks = await createCanvasGenerationTasks(
      createSettings({
        count: 1,
      }),
      {
        createTaskId: () => "failed-task-1",
        createGenerationTask: async () => {
          throw new Error("账号额度不足，请稍后重试。");
        },
        createEditTask: async () => {
          throw new Error("edit task should not be used");
        },
      },
    );

    expect(tasks).toEqual([
      {
        id: "failed-task-1",
        status: "error",
        mode: "generate",
        created_at: "",
        updated_at: "",
        error: "账号额度不足，请稍后重试。",
      },
    ]);
  });

  test("creates edit tasks with upstream reference image files", async () => {
    const referenceFile = new File(["image"], "参考图片.png", { type: "image/png" });
    const editCalls: Array<{ id: string; files: File[]; prompt: string; model?: string; size?: string }> = [];

    const tasks = await createCanvasGenerationTasks(
      createSettings({
        count: 1,
        referenceImages: [
          {
            nodeId: "seed-image",
            title: "参考图片",
            imageUrl: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      }),
      {
        createTaskId: () => "edit-task-1",
        fetchReferenceFile: async (imageUrl, fileName) => {
          expect(imageUrl).toBe("data:image/png;base64,aW1hZ2U=");
          expect(fileName).toBe("参考图片.png");
          return referenceFile;
        },
        createGenerationTask: async () => {
          throw new Error("generation task should not be used");
        },
        createEditTask: async (id, files, prompt, model, size) => {
          editCalls.push({ id, files: Array.isArray(files) ? files : [files], prompt, model, size });
          return {
            id,
            status: "queued",
            mode: "edit",
            created_at: "",
            updated_at: "",
          };
        },
      },
    );

    expect(tasks.map((task) => task.id)).toEqual(["edit-task-1"]);
    expect(editCalls).toEqual([
      {
        id: "edit-task-1",
        files: [referenceFile],
        prompt: "生成一张角色海报",
        model: "gpt-image-2",
        size: "1:1",
      },
    ]);
  });

  test("returns an error task when the edit task create request fails", async () => {
    const referenceFile = new File(["image"], "参考图片.png", { type: "image/png" });

    const tasks = await createCanvasGenerationTasks(
      createSettings({
        count: 1,
        referenceImages: [
          {
            nodeId: "seed-image",
            title: "参考图片.png",
            imageUrl: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      }),
      {
        createTaskId: () => "failed-edit-task-1",
        fetchReferenceFile: async () => referenceFile,
        createGenerationTask: async () => {
          throw new Error("generation task should not be used");
        },
        createEditTask: async () => {
          throw new Error("图片编辑任务提交失败");
        },
      },
    );

    expect(tasks).toEqual([
      {
        id: "failed-edit-task-1",
        status: "error",
        mode: "edit",
        created_at: "",
        updated_at: "",
        error: "图片编辑任务提交失败",
      },
    ]);
  });
});
