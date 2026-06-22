import { describe, expect, test } from "bun:test";

import {
  buildPromptTemplateApplyPayload,
  getPromptTemplateStatusLabel,
  parsePromptTemplateTags,
  type PromptTemplateSeed,
} from "./prompt-market-utils";
import type { PromptTemplate } from "@/lib/api";

const template: PromptTemplate = {
  id: "template-1",
  title: "电影感人像",
  description: "适合头像和半身照",
  prompt: "cinematic portrait, soft rim light",
  model: "gpt-image-2",
  size: "1:1",
  count: 2,
  tags: ["人像"],
  preview_image: { url: "/images/portrait.png" },
  owner_id: "alice",
  owner_name: "Alice",
  visibility: "public",
  review_status: "approved",
  review_reason: "",
  reviewed_by: "admin",
  reviewed_at: "2026-05-26T00:00:00+00:00",
  created_at: "2026-05-26T00:00:00+00:00",
  updated_at: "2026-05-26T00:00:00+00:00",
  is_favorited: false,
};

describe("prompt market utils", () => {
  test("parses comma and whitespace separated tags", () => {
    expect(parsePromptTemplateTags("写实, 人像  电影感，光影")).toEqual(["写实", "人像", "电影感", "光影"]);
  });

  test("returns Chinese review status labels", () => {
    expect(getPromptTemplateStatusLabel("pending")).toBe("待审核");
    expect(getPromptTemplateStatusLabel("approved")).toBe("已公开");
    expect(getPromptTemplateStatusLabel("rejected")).toBe("已驳回");
  });

  test("builds apply payload without reference image data", () => {
    expect(buildPromptTemplateApplyPayload(template)).toEqual({
      prompt: template.prompt,
      model: template.model,
      size: template.size,
      count: template.count,
    });
  });

  test("normalizes seed into editable template form values", () => {
    const seed: PromptTemplateSeed = {
      title: "",
      description: "",
      prompt: "macro product photo",
      model: "codex-gpt-image-2",
      size: "16:9",
      count: 3,
      previewImage: { url: "data:image/png;base64,AAAA", source_image_id: "image-1" },
    };

    expect(seed.prompt).toBe("macro product photo");
    expect(seed.previewImage.url).toContain("data:image/png");
  });
});
