import { createImageEditTask, createImageGenerationTask, createVideoGenerationTask, type ImageModel, type ImageResolution, type ImageTask } from "@/lib/api";
import { fetchImageFile } from "@/lib/image-fetch";
import type { CanvasGenerationSettings, CanvasReferenceImage } from "./canvas-workflow";

type CanvasGenerationTaskDeps = {
  createTaskId: (index: number) => string;
  createGenerationTask?: typeof createImageGenerationTask;
  createEditTask?: typeof createImageEditTask;
  createVideoTask?: typeof createVideoGenerationTask;
  fetchReferenceFile?: (imageUrl: string, fileName: string) => Promise<File>;
};

function normalizeImageModel(model: string): ImageModel | undefined {
  if (model === "gpt-image-2" || model === "codex-gpt-image-2" || model === "agnes-image-2.1-flash") {
    return model;
  }
  return "gpt-image-2";
}

function normalizeVideoModel(model: string) {
  return model === "agnes-video-v2.0" ? model : "agnes-video-v2.0";
}

function normalizeImageSize(size: string) {
  return size === "智能" ? undefined : size;
}

function inferImageSizeFromPrompt(prompt: string) {
  const normalized = prompt.replace(/[：]/g, ":").replace(/\s+/g, "");
  const match = normalized.match(/(?:16:9|9:16|4:3|3:4|1:1)/);
  return match?.[0];
}

function resolveImageSize(size: string, prompt: string) {
  return normalizeImageSize(size) ?? inferImageSizeFromPrompt(prompt);
}

function normalizeCanvasTaskResolution(resolution?: string): ImageResolution | undefined {
  if (resolution === "8k") {
    return "4k";
  }
  if (resolution === "1k" || resolution === "2k" || resolution === "4k") {
    return resolution;
  }
  return undefined;
}

function getReferenceFileName(referenceImage: CanvasReferenceImage, index: number) {
  const title = referenceImage.title.trim() || `参考图-${index + 1}`;
  return /\.[a-z0-9]{2,5}$/i.test(title) ? title : `${title}.png`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "提交生成任务失败，请稍后重试。";
}

async function createTaskOrFailure(
  id: string,
  mode: ImageTask["mode"],
  createTask: () => Promise<ImageTask>,
): Promise<ImageTask> {
  try {
    return await createTask();
  } catch (error) {
    return {
      id,
      status: "error",
      mode,
      created_at: "",
      updated_at: "",
      error: getErrorMessage(error),
    };
  }
}

export async function createCanvasGenerationTasks(
  settings: CanvasGenerationSettings,
  deps: CanvasGenerationTaskDeps,
): Promise<ImageTask[]> {
  const prompt = settings.prompt.trim();
  const count = Math.max(1, Math.min(4, settings.count));
  const model = normalizeImageModel(settings.model);
  const size = resolveImageSize(settings.size, prompt);
  const resolution = normalizeCanvasTaskResolution(settings.resolution);
  const createGeneration = deps.createGenerationTask ?? createImageGenerationTask;
  const createEdit = deps.createEditTask ?? createImageEditTask;
  const createVideo = deps.createVideoTask ?? createVideoGenerationTask;
  const fetchReference = deps.fetchReferenceFile ?? fetchImageFile;

  if (settings.generationMode === "video") {
    const id = deps.createTaskId(0);
    const referenceImageUrls = settings.referenceImages
      .map((referenceImage) => referenceImage.imageUrl)
      .filter((imageUrl) => imageUrl.trim());
    return [
      await createTaskOrFailure(id, "video", () =>
        createVideo(
          id,
          prompt,
          normalizeVideoModel(settings.model),
          size,
          referenceImageUrls,
          settings.videoDurationSeconds,
          settings.videoResolution,
          settings.videoCustomWidth,
          settings.videoCustomHeight,
        ),
      ),
    ];
  }

  if (settings.referenceImages.length > 0) {
    const referenceFiles = await Promise.all(
      settings.referenceImages.map((referenceImage, index) =>
        fetchReference(referenceImage.imageUrl, getReferenceFileName(referenceImage, index)),
      ),
    );

    return Promise.all(
      Array.from({ length: count }, (_, index) => {
        const id = deps.createTaskId(index);
        return createTaskOrFailure(id, "edit", () => createEdit(id, referenceFiles, prompt, model, size, false, resolution));
      }),
    );
  }

  return Promise.all(
    Array.from({ length: count }, (_, index) => {
      const id = deps.createTaskId(index);
      return createTaskOrFailure(id, "generate", () => createGeneration(id, prompt, model, size, false, resolution));
    }),
  );
}
