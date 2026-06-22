import { describe, expect, test } from "bun:test";

import type { ImageConversation } from "@/store/image-conversations";
import type { GenerateTask } from "./generate-task-submission";
import {
  imageConversationsToGenerateView,
  mergeGenerateTasksIntoImageConversations,
  upsertGenerateSubmissionIntoImageConversations,
} from "./cola-ai-generate-history";

const baseConversation: ImageConversation = {
  id: "conversation-1",
  title: "赛博城市",
  createdAt: "2026-05-27T10:00:00.000Z",
  updatedAt: "2026-05-27T10:00:00.000Z",
  turns: [
    {
      id: "turn-1",
      prompt: "生成赛博城市海报",
      model: "gpt-image-2",
      mode: "generate",
      referenceImages: [],
      count: 2,
      size: "1:1",
      createdAt: "2026-05-27T10:00:00.000Z",
      status: "generating",
      images: [
        {
          id: "image-1",
          taskId: "task-1",
          status: "loading",
          phase: "queued",
        },
        {
          id: "image-2",
          taskId: "task-2",
          status: "success",
          url: "/api/images/generated-2.png",
          revised_prompt: "成片提示词",
          finished_at: "2026-05-27T10:01:00.000Z",
        },
      ],
    },
  ],
};

describe("ColaAI generate history bridge", () => {
  test("converts stored image conversations into ColaAI generate sessions and tasks", () => {
    const view = imageConversationsToGenerateView([baseConversation]);

    expect(view.sessions).toEqual([
      {
        id: "conversation-1",
        title: "赛博城市",
        createdAt: "2026-05-27T10:00:00.000Z",
        updatedAt: "2026-05-27T10:00:00.000Z",
        taskIds: ["task-1", "task-2"],
      },
    ]);
    expect(view.tasks.map((task) => [task.id, task.status, task.submissionContext?.prompt])).toEqual([
      ["task-1", "queued", "生成赛博城市海报"],
      ["task-2", "success", "生成赛博城市海报"],
    ]);
    expect(view.tasks[1].data).toEqual([{ url: "/api/images/generated-2.png", revised_prompt: "成片提示词" }]);
  });

  test("creates or appends image conversation turns from newly submitted ColaAI tasks", () => {
    const now = "2026-05-27T11:00:00.000Z";
    const tasks: GenerateTask[] = [
      {
        id: "task-3",
        status: "queued",
        mode: "generate",
        model: "gpt-image-2",
        size: "16:9",
        created_at: now,
        updated_at: now,
        submissionContext: {
          prompt: "生成新的城市海报",
          count: 1,
          model: "gpt-image-2",
          size: "16:9",
          attempt: 1,
        },
      },
    ];

    const conversations = upsertGenerateSubmissionIntoImageConversations([], {
      sessionId: "conversation-2",
      prompt: "生成新的城市海报",
      count: 1,
      model: "gpt-image-2",
      size: "16:9",
      tasks,
      now,
    });

    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe("conversation-2");
    expect(conversations[0].title).toBe("生成新的城市海报");
    expect(conversations[0].turns[0].images[0]).toMatchObject({
      id: "task-3",
      taskId: "task-3",
      status: "loading",
      phase: "queued",
    });
  });

  test("merges polled task results back into stored image conversations", () => {
    const updated = mergeGenerateTasksIntoImageConversations([baseConversation], [
      {
        id: "task-1",
        status: "success",
        mode: "generate",
        model: "gpt-image-2",
        size: "1:1",
        created_at: "2026-05-27T10:00:00.000Z",
        updated_at: "2026-05-27T10:01:10.000Z",
        finished_at: "2026-05-27T10:01:10.000Z",
        data: [{ url: "/api/images/generated-1.png", revised_prompt: "第一张" }],
      },
    ]);

    const image = updated[0].turns[0].images[0];
    expect(image).toMatchObject({
      taskId: "task-1",
      status: "success",
      url: "/api/images/generated-1.png",
      revised_prompt: "第一张",
      finished_at: "2026-05-27T10:01:10.000Z",
    });
    expect(updated[0].turns[0].status).toBe("success");
  });
});
