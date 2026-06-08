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

  test("preserves the Agnes image model when the canvas config selects it", async () => {
    const generationCalls: Array<{ model?: string }> = [];

    await createCanvasGenerationTasks(
      createSettings({
        count: 1,
        model: "agnes-image-2.1-flash",
      }),
      {
        createTaskId: () => "agnes-task-1",
        createGenerationTask: async (_id, _prompt, model) => {
          generationCalls.push({ model });
          return {
            id: "agnes-task-1",
            status: "queued",
            mode: "generate",
            created_at: "",
            updated_at: "",
          };
        },
        createEditTask: async () => {
          throw new Error("edit task should not be used");
        },
      },
    );

    expect(generationCalls).toEqual([{ model: "agnes-image-2.1-flash" }]);
  });

  test("defaults image mode to GPT Image 2 when config model is auto", async () => {
    const generationCalls: Array<{ model?: string }> = [];

    await createCanvasGenerationTasks(
      createSettings({
        count: 1,
        model: "auto",
      }),
      {
        createTaskId: () => "auto-image-task-1",
        createGenerationTask: async (_id, _prompt, model) => {
          generationCalls.push({ model });
          return {
            id: "auto-image-task-1",
            status: "queued",
            mode: "generate",
            created_at: "",
            updated_at: "",
          };
        },
        createEditTask: async () => {
          throw new Error("edit task should not be used");
        },
      },
    );

    expect(generationCalls).toEqual([{ model: "gpt-image-2" }]);
  });

  test("routes video mode to video task creation with reference URLs", async () => {
    const videoCalls: Array<{ id: string; prompt: string; model?: string; size?: string; referenceImageUrls: string[]; durationSeconds?: number; resolution?: string }> = [];

    const tasks = await createCanvasGenerationTasks(
      createSettings({
        count: 4,
        generationMode: "video",
        model: "agnes-video-v2.0",
        size: "16:9",
        videoDurationSeconds: 10,
        videoResolution: "720p",
        referenceImages: [
          {
            nodeId: "seed-image",
            title: "参考图片",
            imageUrl: "https://cdn.example.test/reference.png",
          },
        ],
      }),
      {
        createTaskId: () => "video-task-1",
        createGenerationTask: async () => {
          throw new Error("image generation task should not be used");
        },
        createEditTask: async () => {
          throw new Error("image edit task should not be used");
        },
        createVideoTask: async (id, prompt, model, size, referenceImageUrls = [], durationSeconds, resolution) => {
          videoCalls.push({ id, prompt, model, size, referenceImageUrls, durationSeconds, resolution });
          return {
            id,
            status: "queued",
            mode: "video",
            media_type: "video",
            created_at: "",
            updated_at: "",
          };
        },
      },
    );

    expect(tasks.map((task) => task.id)).toEqual(["video-task-1"]);
    expect(videoCalls).toEqual([
      {
        id: "video-task-1",
        prompt: "生成一张角色海报",
        model: "agnes-video-v2.0",
        size: "16:9",
        referenceImageUrls: ["https://cdn.example.test/reference.png"],
        durationSeconds: 10,
        resolution: "720p",
      },
    ]);
  });

  test("keeps canvas references for video tasks so the backend can prepare Agnes URLs", async () => {
    const videoCalls: Array<{ referenceImageUrls: string[] }> = [];

    await createCanvasGenerationTasks(
      createSettings({
        generationMode: "video",
        model: "agnes-video-v2.0",
        referenceImages: [
          { nodeId: "local-image", title: "本地图", imageUrl: "/images/reference.png" },
          { nodeId: "data-image", title: "内联图", imageUrl: "data:image/png;base64,aW1hZ2U=" },
          { nodeId: "public-image", title: "公网图", imageUrl: "https://cdn.example.test/reference.png" },
        ],
      }),
      {
        createTaskId: () => "video-task-1",
        createGenerationTask: async () => {
          throw new Error("image generation task should not be used");
        },
        createEditTask: async () => {
          throw new Error("image edit task should not be used");
        },
        createVideoTask: async (_id, _prompt, _model, _size, referenceImageUrls = []) => {
          videoCalls.push({ referenceImageUrls });
          return {
            id: "video-task-1",
            status: "queued",
            mode: "video",
            media_type: "video",
            created_at: "",
            updated_at: "",
          };
        },
      },
    );

    expect(videoCalls).toEqual([{
      referenceImageUrls: [
        "/images/reference.png",
        "data:image/png;base64,aW1hZ2U=",
        "https://cdn.example.test/reference.png",
      ],
    }]);
  });

  test("defaults video mode to the Agnes video model when config model is auto", async () => {
    const videoCalls: Array<{ model?: string }> = [];

    await createCanvasGenerationTasks(
      createSettings({
        generationMode: "video",
        model: "auto",
        count: 3,
      }),
      {
        createTaskId: () => "video-task-1",
        createGenerationTask: async () => {
          throw new Error("image generation task should not be used");
        },
        createEditTask: async () => {
          throw new Error("image edit task should not be used");
        },
        createVideoTask: async (_id, _prompt, model) => {
          videoCalls.push({ model });
          return {
            id: "video-task-1",
            status: "queued",
            mode: "video",
            media_type: "video",
            created_at: "",
            updated_at: "",
          };
        },
      },
    );

    expect(videoCalls).toEqual([{ model: "agnes-video-v2.0" }]);
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

  test("infers a 16:9 edit size from the prompt when canvas size is smart", async () => {
    const referenceFile = new File(["image"], "参考图片.png", { type: "image/png" });
    const editCalls: Array<{ size?: string }> = [];

    await createCanvasGenerationTasks(
      createSettings({
        count: 1,
        prompt: "基于参考图进行图片编辑扩展画布到 16:9",
        size: "智能",
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
        fetchReferenceFile: async () => referenceFile,
        createGenerationTask: async () => {
          throw new Error("generation task should not be used");
        },
        createEditTask: async (_id, _files, _prompt, _model, size) => {
          editCalls.push({ size });
          return {
            id: "edit-task-1",
            status: "queued",
            mode: "edit",
            created_at: "",
            updated_at: "",
          };
        },
      },
    );

    expect(editCalls).toEqual([{ size: "16:9" }]);
  });

  test("maps canvas 8k upscale edit requests to the highest backend-supported resolution", async () => {
    const referenceFile = new File(["image"], "参考图片.png", { type: "image/png" });
    const editCalls: Array<{ resolution?: string }> = [];

    await createCanvasGenerationTasks(
      createSettings({
        count: 1,
        resolution: "8k",
        referenceImages: [
          {
            nodeId: "seed-image",
            title: "参考图片.png",
            imageUrl: "data:image/png;base64,aW1hZ2U=",
          },
        ],
      }),
      {
        createTaskId: () => "edit-task-1",
        fetchReferenceFile: async () => referenceFile,
        createGenerationTask: async () => {
          throw new Error("generation task should not be used");
        },
        createEditTask: async (_id, _files, _prompt, _model, _size, _isPublic, resolution) => {
          editCalls.push({ resolution });
          return {
            id: "edit-task-1",
            status: "queued",
            mode: "edit",
            created_at: "",
            updated_at: "",
          };
        },
      },
    );

    expect(editCalls).toEqual([{ resolution: "4k" }]);
  });

  test("maps canvas 8k generation requests to the highest backend-supported resolution", async () => {
    const generationCalls: Array<{ resolution?: string }> = [];

    await createCanvasGenerationTasks(
      createSettings({
        count: 1,
        resolution: "8k",
      }),
      {
        createTaskId: () => "generation-task-1",
        createGenerationTask: async (_id, _prompt, _model, _size, _isPublic, resolution) => {
          generationCalls.push({ resolution });
          return {
            id: "generation-task-1",
            status: "queued",
            mode: "generate",
            created_at: "",
            updated_at: "",
          };
        },
        createEditTask: async () => {
          throw new Error("edit task should not be used");
        },
      },
    );

    expect(generationCalls).toEqual([{ resolution: "4k" }]);
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
