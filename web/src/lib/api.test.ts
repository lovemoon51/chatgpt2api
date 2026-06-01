import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const apiSource = readFileSync(join(import.meta.dir, "api.ts"), "utf-8");

describe("image description task api", () => {
  test("defines a description result shape for image-to-text responses", () => {
    expect(apiSource).toContain("export type ImageDescriptionResult");
    expect(apiSource).toContain("description?: string");
    expect(apiSource).toContain("tags?: string[]");
    expect(apiSource).toContain("prompt?: string");
    expect(apiSource).toContain("composition?: string");
  });

  test("creates image description tasks with FormData fields", () => {
    expect(apiSource).toContain("export async function createImageDescriptionTask");
    expect(apiSource).toContain('formData.append("image", file)');
    expect(apiSource).toContain('formData.append("client_task_id", clientTaskId)');
    expect(apiSource).toContain('formData.append("prompt", prompt)');
    expect(apiSource).toContain('formData.append("model", model)');
    expect(apiSource).toContain('httpRequest<ImageTask>("/api/image-tasks/descriptions"');
  });
});
