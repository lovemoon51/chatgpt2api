import { describe, expect, test } from "bun:test";

import {
  buildGenerateRetrySubmissionInput,
  createGenerateSubmissionTasks,
  mergeGenerateTasks,
  setGenerateTaskRetrying,
  type GenerateTask,
} from "./generate-task-submission";

describe("generate task submission", () => {
  test("returns local failed tasks when image task creation fails", async () => {
    const tasks = await createGenerateSubmissionTasks(
      {
        prompt: "生成一张芙莉莲",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
      },
      {
        createTaskId: () => "failed-task-1",
        createGenerationTask: async () => {
          throw new Error("账号额度不足，请稍后重试。");
        },
        now: () => "2026-05-27T00:00:00.000Z",
      },
    );

    expect(tasks).toEqual([
      {
        id: "failed-task-1",
        status: "error",
        mode: "generate",
        model: "gpt-image-2",
        size: "1:1",
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:00:00.000Z",
        error: "账号额度不足，请稍后重试。",
        submissionContext: {
          prompt: "生成一张芙莉莲",
          count: 1,
          model: "gpt-image-2",
          size: "1:1",
          attempt: 1,
        },
      },
    ]);
  });

  test("builds a one-task retry input from the failed task submission context", () => {
    const task: GenerateTask = {
      id: "failed-task-1",
      status: "error",
      mode: "generate",
      model: "codex-gpt-image-2",
      size: "16:9",
      created_at: "2026-05-27T00:00:00.000Z",
      updated_at: "2026-05-27T00:00:00.000Z",
      error: "提交失败",
      submissionContext: {
        prompt: "失败时的原始提示词",
        count: 4,
        model: "codex-gpt-image-2",
        size: "16:9",
        attempt: 2,
      },
    };

    expect(buildGenerateRetrySubmissionInput(task)).toEqual({
      prompt: "失败时的原始提示词",
      count: 1,
      model: "codex-gpt-image-2",
      size: "16:9",
      attempt: 3,
      retryOfTaskId: "failed-task-1",
    });
  });

  test("uses image edit task creation when reference files are present", async () => {
    const referenceFile = new File(["image"], "reference.png", { type: "image/png" });
    const calls: Array<{ id: string; files: File[]; prompt: string; model?: string; size?: string }> = [];

    const tasks = await createGenerateSubmissionTasks(
      {
        prompt: "换成夜景氛围",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
        referenceFiles: [referenceFile],
      },
      {
        createTaskId: () => "edit-task-1",
        createEditTask: async (id, files, prompt, model, size) => {
          calls.push({ id, files: Array.isArray(files) ? files : [files], prompt, model, size });
          return {
            id,
            status: "queued",
            mode: "edit",
            model,
            size,
            created_at: "2026-05-27T00:00:00.000Z",
            updated_at: "2026-05-27T00:00:00.000Z",
          };
        },
        createGenerationTask: async () => {
          throw new Error("generation path should not be used");
        },
        now: () => "2026-05-27T00:00:00.000Z",
      },
    );

    expect(calls).toEqual([
      {
        id: "edit-task-1",
        files: [referenceFile],
        prompt: "换成夜景氛围",
        model: "gpt-image-2",
        size: "1:1",
      },
    ]);
    expect(tasks[0]).toMatchObject({
      id: "edit-task-1",
      mode: "edit",
      submissionContext: {
        prompt: "换成夜景氛围",
        referenceImageNames: ["reference.png"],
      },
    });
  });

  test("passes image resolution through generation task creation and retry input", async () => {
    const calls: Array<{ id: string; prompt: string; model?: string; size?: string; isPublic?: boolean; resolution?: string }> = [];

    const tasks = await createGenerateSubmissionTasks(
      {
        prompt: "生成 2K 海报",
        count: 1,
        model: "gpt-image-2",
        size: "16:9",
        resolution: "2k",
        publicMode: true,
      },
      {
        createTaskId: () => "generation-task-2k",
        createGenerationTask: async (id, prompt, model, size, isPublic, resolution) => {
          calls.push({ id, prompt, model, size, isPublic, resolution });
          return {
            id,
            status: "queued",
            mode: "generate",
            model,
            size,
            resolution,
            created_at: "2026-05-27T00:00:00.000Z",
            updated_at: "2026-05-27T00:00:00.000Z",
          };
        },
      },
    );

    expect(calls).toEqual([
      {
        id: "generation-task-2k",
        prompt: "生成 2K 海报",
        model: "gpt-image-2",
        size: "16:9",
        isPublic: true,
        resolution: "2k",
      },
    ]);
    expect(tasks[0].submissionContext).toMatchObject({
      prompt: "生成 2K 海报",
      resolution: "2k",
    });
    expect(buildGenerateRetrySubmissionInput(tasks[0])).toEqual({
      prompt: "生成 2K 海报",
      count: 1,
      model: "gpt-image-2",
      size: "16:9",
      resolution: "2k",
      publicMode: true,
      attempt: 2,
      retryOfTaskId: "generation-task-2k",
    });
  });

  test("passes public mode into generation and edit task creation", async () => {
    const referenceFile = new File(["image"], "reference.png", { type: "image/png" });
    const generationCalls: Array<{ id: string; prompt: string; model?: string; size?: string; isPublic?: boolean }> = [];
    const editCalls: Array<{ id: string; files: File[]; prompt: string; model?: string; size?: string; isPublic?: boolean }> = [];

    await createGenerateSubmissionTasks(
      {
        prompt: "公开生成",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
        publicMode: true,
      },
      {
        createTaskId: () => "generation-task-1",
        createGenerationTask: async (id, prompt, model, size, isPublic) => {
          generationCalls.push({ id, prompt, model, size, isPublic });
          return {
            id,
            status: "queued",
            mode: "generate",
            model,
            size,
            created_at: "2026-05-27T00:00:00.000Z",
            updated_at: "2026-05-27T00:00:00.000Z",
          };
        },
      },
    );

    await createGenerateSubmissionTasks(
      {
        prompt: "公开编辑",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
        referenceFiles: [referenceFile],
        publicMode: true,
      },
      {
        createTaskId: () => "edit-task-1",
        createEditTask: async (id, files, prompt, model, size, isPublic) => {
          editCalls.push({ id, files: Array.isArray(files) ? files : [files], prompt, model, size, isPublic });
          return {
            id,
            status: "queued",
            mode: "edit",
            model,
            size,
            created_at: "2026-05-27T00:00:00.000Z",
            updated_at: "2026-05-27T00:00:00.000Z",
          };
        },
      },
    );

    expect(generationCalls).toEqual([
      {
        id: "generation-task-1",
        prompt: "公开生成",
        model: "gpt-image-2",
        size: "1:1",
        isPublic: true,
      },
    ]);
    expect(editCalls).toEqual([
      {
        id: "edit-task-1",
        files: [referenceFile],
        prompt: "公开编辑",
        model: "gpt-image-2",
        size: "1:1",
        isPublic: true,
      },
    ]);
  });

  test("preserves submission context when polling updates a task", () => {
    const previous: GenerateTask = {
      id: "failed-task-1",
      status: "queued",
      mode: "generate",
      model: "gpt-image-2",
      size: "1:1",
      created_at: "2026-05-27T00:00:00.000Z",
      updated_at: "2026-05-27T00:00:00.000Z",
      submissionContext: {
        prompt: "生成一张芙莉莲",
        count: 1,
        model: "gpt-image-2",
        size: "1:1",
        attempt: 1,
      },
    };

    const merged = mergeGenerateTasks([previous], [
      {
        id: "failed-task-1",
        status: "error",
        mode: "generate",
        model: "gpt-image-2",
        size: "1:1",
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:00:02.000Z",
        error: "轮询返回失败",
      },
    ]);

    expect(merged[0]).toMatchObject({
      id: "failed-task-1",
      status: "error",
      error: "轮询返回失败",
      submissionContext: previous.submissionContext,
    });
  });

  test("marks a failed task as retrying without changing its terminal status", () => {
    const failedTask: GenerateTask = {
      id: "failed-task-1",
      status: "error",
      mode: "generate",
      model: "gpt-image-2",
      created_at: "2026-05-27T00:00:00.000Z",
      updated_at: "2026-05-27T00:00:00.000Z",
      error: "提交失败",
      submissionContext: {
        prompt: "生成一张芙莉莲",
        count: 1,
        model: "gpt-image-2",
        attempt: 1,
      },
    };

    expect(setGenerateTaskRetrying([failedTask], "failed-task-1", true)[0]).toMatchObject({
      id: "failed-task-1",
      status: "error",
      error: "提交失败",
      submissionContext: {
        prompt: "生成一张芙莉莲",
        count: 1,
        model: "gpt-image-2",
        attempt: 1,
        retrying: true,
      },
    });
  });
});
