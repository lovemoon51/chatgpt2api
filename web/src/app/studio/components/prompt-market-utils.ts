import type {
  PromptTemplate,
  PromptTemplateApplyPayload,
  PromptTemplatePreviewImage,
  PromptTemplateReviewStatus,
} from "@/lib/api";

export type PromptTemplateSeed = {
  title?: string;
  description?: string;
  prompt: string;
  model: string;
  size: string;
  count: number;
  tags?: string[];
  previewImage: PromptTemplatePreviewImage;
};

export type PromptTemplateFormValues = {
  title: string;
  description: string;
  prompt: string;
  model: string;
  size: string;
  count: number;
  tags: string[];
  previewImage: PromptTemplatePreviewImage;
  visibility: "private" | "public";
};

export function parsePromptTemplateTags(value: string) {
  const seen = new Set<string>();
  return value
    .replace(/，/g, ",")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
}

export function formatPromptTemplateTags(tags: string[]) {
  return tags.filter(Boolean).join(", ");
}

export function getPromptTemplateStatusLabel(status: PromptTemplateReviewStatus | string) {
  if (status === "pending") return "待审核";
  if (status === "approved") return "已公开";
  if (status === "rejected") return "已驳回";
  return "私有草稿";
}

export function buildPromptTemplateApplyPayload(template: PromptTemplate): PromptTemplateApplyPayload {
  return {
    prompt: template.prompt,
    model: template.model,
    size: template.size,
    count: template.count,
  };
}

export function getPromptTemplatePreviewUrl(template: PromptTemplate) {
  return template.preview_image.thumbnail_url || template.preview_image.url || "";
}

export function createEmptyPromptTemplateValues(seed?: PromptTemplateSeed | null): PromptTemplateFormValues {
  return {
    title: seed?.title || "",
    description: seed?.description || "",
    prompt: seed?.prompt || "",
    model: seed?.model || "gpt-image-2",
    size: seed?.size || "1:1",
    count: Math.max(1, Math.min(8, Number(seed?.count || 1))),
    tags: seed?.tags || [],
    previewImage: seed?.previewImage || { url: "" },
    visibility: "private",
  };
}
