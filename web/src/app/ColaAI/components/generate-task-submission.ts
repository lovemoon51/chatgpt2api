import { createImageEditTask, createImageGenerationTask, type ImageModel, type ImageResolution, type ImageTask } from "@/lib/api";

export type GenerateSubmissionContext = {
  prompt: string;
  count: number;
  model: ImageModel;
  size?: string;
  resolution?: ImageResolution | string;
  publicMode?: boolean;
  attempt: number;
  retryOfTaskId?: string;
  turnId?: string;
  retrying?: boolean;
  referenceImageNames?: string[];
};

export type GenerateTask = ImageTask & {
  submissionContext?: GenerateSubmissionContext;
};

export type GenerateSubmissionInput = {
  prompt: string;
  count: number;
  model: ImageModel;
  size?: string;
  resolution?: ImageResolution | string;
  referenceFiles?: File[];
  publicMode?: boolean;
  attempt?: number;
  retryOfTaskId?: string;
};

type GenerateSubmissionDeps = {
  createTaskId: (index: number) => string;
  createEditTask?: typeof createImageEditTask;
  createGenerationTask?: typeof createImageGenerationTask;
  now?: () => string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "提交生成任务失败，请稍后重试。";
}

async function createTaskOrFailure(
  id: string,
  input: GenerateSubmissionInput,
  context: GenerateSubmissionContext,
  createTask: () => Promise<ImageTask>,
  now: () => string,
): Promise<GenerateTask> {
  try {
    const task = await createTask();
    return {
      ...task,
      submissionContext: context,
    };
  } catch (error) {
    const timestamp = now();
    return {
      id,
      status: "error",
      mode: "generate",
      model: input.model,
      size: input.size,
      resolution: input.resolution,
      created_at: timestamp,
      updated_at: timestamp,
      error: getErrorMessage(error),
      submissionContext: context,
    };
  }
}

export async function createGenerateSubmissionTasks(
  input: GenerateSubmissionInput,
  deps: GenerateSubmissionDeps,
) {
  const prompt = input.prompt.trim();
  const count = Math.max(1, Math.min(8, input.count));
  const createEdit = deps.createEditTask ?? createImageEditTask;
  const createGeneration = deps.createGenerationTask ?? createImageGenerationTask;
  const now = deps.now ?? (() => new Date().toISOString());
  const context: GenerateSubmissionContext = {
    prompt,
    count,
    model: input.model,
    size: input.size,
    resolution: input.resolution,
    ...(input.publicMode ? { publicMode: true } : {}),
    attempt: Math.max(1, input.attempt ?? 1),
    retryOfTaskId: input.retryOfTaskId,
    referenceImageNames: input.referenceFiles?.map((file) => file.name),
  };

  return Promise.all(
    Array.from({ length: count }, (_, index) => {
      const id = deps.createTaskId(index);
      return createTaskOrFailure(
        id,
        input,
        context,
        () =>
          input.referenceFiles?.length
            ? createEdit(id, input.referenceFiles, prompt, input.model, input.size, Boolean(input.publicMode), input.resolution)
            : createGeneration(id, prompt, input.model, input.size, Boolean(input.publicMode), input.resolution),
        now,
      );
    }),
  );
}

export function buildGenerateRetrySubmissionInput(task: GenerateTask): GenerateSubmissionInput | null {
  const context = task.submissionContext;
  if (!context?.prompt.trim()) {
    return null;
  }

  return {
    prompt: context.prompt,
    count: 1,
    model: context.model,
    size: context.size,
    resolution: context.resolution,
    publicMode: context.publicMode,
    attempt: context.attempt + 1,
    retryOfTaskId: task.id,
  };
}

export function mergeGenerateTasks(previous: GenerateTask[], next: ImageTask[] | GenerateTask[]) {
  const byId = new Map(previous.map((task) => [task.id, task]));
  next.forEach((task) => {
    const previousTask = byId.get(task.id);
    const nextTask = task as GenerateTask;
    byId.set(task.id, {
      ...previousTask,
      ...nextTask,
      submissionContext: nextTask.submissionContext ?? previousTask?.submissionContext,
    });
  });
  return Array.from(byId.values());
}

export function setGenerateTaskRetrying(tasks: GenerateTask[], taskId: string, retrying: boolean) {
  return tasks.map((task) => {
    if (task.id !== taskId || !task.submissionContext) {
      return task;
    }
    return {
      ...task,
      submissionContext: {
        ...task.submissionContext,
        retrying,
      },
    };
  });
}
