import type { ImageConversation, ImageTurn, ImageTurnStatus, StoredImage } from "@/store/image-conversations";
import type { ImageModel, ImageTask } from "@/lib/api";
import type { GenerateSubmissionInput, GenerateTask } from "./generate-task-submission";
import type { GenerateSession } from "./cola-ai-workbench";

export type GenerateHistoryView = {
  sessions: GenerateSession[];
  tasks: GenerateTask[];
};

type GenerateSubmissionUpsertInput = GenerateSubmissionInput & {
  sessionId: string;
  tasks: GenerateTask[];
  now?: string;
};

function taskIdFromStoredImage(image: StoredImage) {
  return image.taskId || image.id;
}

function titleFromPrompt(prompt: string) {
  const title = prompt.trim().replace(/\s+/g, " ");
  if (!title) {
    return "空对话";
  }
  return title.length > 18 ? `${title.slice(0, 18)}…` : title;
}

function statusFromStoredImage(image: StoredImage, turn: ImageTurn): ImageTask["status"] {
  if (image.status === "success") {
    return "success";
  }
  if (image.status === "error") {
    return "error";
  }
  if (image.phase === "submitting") {
    return "submitting";
  }
  if (image.phase === "downloading") {
    return "downloading";
  }
  if (image.phase === "saving") {
    return "saving";
  }
  if (image.phase === "queued") {
    return "queued";
  }
  return turn.status === "queued" ? "queued" : "running";
}

function deriveTurnStatus(images: StoredImage[]): ImageTurnStatus {
  if (images.some((image) => image.status === "loading")) {
    return "generating";
  }
  if (images.some((image) => image.status === "error")) {
    return "error";
  }
  return "success";
}

function storedImageFromTask(task: GenerateTask): StoredImage {
  const first = task.data?.[0];
  const base: StoredImage = {
    id: task.id,
    taskId: task.id,
    phase: task.phase || (task.status === "running" ? "generating" : task.status),
    phase_label: task.phase_label,
    phase_updated_at: task.phase_updated_at || task.updated_at,
    timings: task.timings,
    timing_ms: task.timing_ms,
    queued_at: task.queued_at,
    submitted_at: task.submitted_at,
    started_at: task.started_at,
    downloading_at: task.downloading_at,
    saving_at: task.saving_at,
    finished_at: task.finished_at,
    duration_ms: task.duration_ms,
    queue_duration_ms: task.queue_duration_ms,
    total_duration_ms: task.total_duration_ms,
  };

  if (task.status === "success") {
    return {
      ...base,
      status: first?.b64_json || first?.url ? "success" : "error",
      b64_json: first?.b64_json,
      url: first?.url,
      revised_prompt: first?.revised_prompt,
      error: first?.b64_json || first?.url ? undefined : "未返回图片数据",
    };
  }

  if (task.status === "error" || task.status === "cancelled") {
    return {
      ...base,
      status: "error",
      error: task.error || (task.status === "cancelled" ? "任务已取消" : "生成失败"),
    };
  }

  return {
    ...base,
    status: "loading",
  };
}

function storedImageToGenerateTask(turn: ImageTurn, image: StoredImage): GenerateTask {
  const status = statusFromStoredImage(image, turn);
  return {
    id: taskIdFromStoredImage(image),
    status,
    phase: image.phase,
    phase_label: image.phase_label,
    phase_updated_at: image.phase_updated_at,
    timings: image.timings,
    timing_ms: image.timing_ms,
    mode: turn.mode,
    model: turn.model,
    size: turn.size || undefined,
    created_at: image.queued_at || turn.createdAt,
    updated_at: image.phase_updated_at || image.finished_at || turn.createdAt,
    queued_at: image.queued_at,
    submitted_at: image.submitted_at,
    started_at: image.started_at,
    downloading_at: image.downloading_at,
    saving_at: image.saving_at,
    finished_at: image.finished_at,
    duration_ms: image.duration_ms,
    queue_duration_ms: image.queue_duration_ms,
    total_duration_ms: image.total_duration_ms,
    data:
      image.b64_json || image.url
        ? [{ b64_json: image.b64_json, url: image.url, revised_prompt: image.revised_prompt }]
        : undefined,
    error: image.error,
    submissionContext: {
      prompt: turn.prompt,
      count: Math.max(1, turn.count || turn.images.length || 1),
      model: turn.model,
      size: turn.size || undefined,
      attempt: 1,
      turnId: turn.id,
    },
  };
}

export function imageConversationsToGenerateView(conversations: ImageConversation[]): GenerateHistoryView {
  const sessions = conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title || conversation.turns.at(-1)?.prompt || "空对话",
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    taskIds: conversation.turns.flatMap((turn) => turn.images.map(taskIdFromStoredImage)),
  }));
  const tasks = conversations.flatMap((conversation) =>
    conversation.turns.flatMap((turn) => turn.images.map((image) => storedImageToGenerateTask(turn, image))),
  );
  return { sessions, tasks };
}

export function upsertGenerateSubmissionIntoImageConversations(
  conversations: ImageConversation[],
  input: GenerateSubmissionUpsertInput,
): ImageConversation[] {
  const now = input.now || new Date().toISOString();
  const existingConversation = conversations.find((conversation) => conversation.id === input.sessionId);
  const turn: ImageTurn = {
    id: `turn-${input.tasks[0]?.id || now}`,
    prompt: input.prompt.trim(),
    model: input.model,
    mode: "generate",
    referenceImages: [],
    count: Math.max(1, Math.min(8, input.count)),
    size: input.size || "",
    images: input.tasks.map(storedImageFromTask),
    createdAt: now,
    status: deriveTurnStatus(input.tasks.map(storedImageFromTask)),
  };
  const conversation: ImageConversation = existingConversation
    ? {
        ...existingConversation,
        title: existingConversation.title || titleFromPrompt(input.prompt),
        updatedAt: now,
        turns: [...existingConversation.turns, turn],
      }
    : {
        id: input.sessionId,
        title: titleFromPrompt(input.prompt),
        createdAt: now,
        updatedAt: now,
        turns: [turn],
      };

  return [conversation, ...conversations.filter((item) => item.id !== input.sessionId)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function mergeGenerateTasksIntoImageConversations(
  conversations: ImageConversation[],
  tasks: GenerateTask[],
): ImageConversation[] {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  let changed = false;

  const nextConversations = conversations.map((conversation) => {
    let conversationChanged = false;
    const turns = conversation.turns.map((turn) => {
      let turnChanged = false;
      const images = turn.images.map((image) => {
        const task = taskMap.get(taskIdFromStoredImage(image));
        if (!task) {
          return image;
        }
        const nextImage = {
          ...image,
          ...storedImageFromTask(task),
          id: image.id,
          taskId: task.id,
        };
        if (JSON.stringify(nextImage) !== JSON.stringify(image)) {
          turnChanged = true;
        }
        return nextImage;
      });
      if (!turnChanged) {
        return turn;
      }
      conversationChanged = true;
      return {
        ...turn,
        images,
        status: deriveTurnStatus(images),
        error: images.filter((image) => image.status === "error").length
          ? `失败 ${images.filter((image) => image.status === "error").length} 张`
          : undefined,
      };
    });

    if (!conversationChanged) {
      return conversation;
    }

    changed = true;
    const latestTaskUpdate = tasks
      .map((task) => task.updated_at || task.finished_at || task.created_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    return {
      ...conversation,
      turns,
      updatedAt: latestTaskUpdate || new Date().toISOString(),
    };
  });

  return changed ? nextConversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : conversations;
}
