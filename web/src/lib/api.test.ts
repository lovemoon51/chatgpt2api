import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const testDir = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(testDir, "api.ts"), "utf-8");

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

describe("managed image public visibility api", () => {
  test("posts filtered gallery visibility updates to the backend", () => {
    expect(apiSource).toContain("export async function updateManagedImagesPublicVisibility");
    expect(apiSource).toContain('"/api/images/public-visibility"');
    expect(apiSource).toContain("public: isPublic");
    expect(apiSource).toContain("start_date: filters.start_date");
    expect(apiSource).toContain("end_date: filters.end_date");
    expect(apiSource).toContain("q: filters.q || filters.search");
    expect(apiSource).toContain("tags: filters.tags");
  });
});

describe("ordinary user access code api", () => {
  test("supports bulk user key creation and check-in quota refresh", () => {
    expect(apiSource).toContain("export type UserKeyCreateResult");
    expect(apiSource).toContain("keys: UserKeyCreateResult[]");
    expect(apiSource).toContain("export async function checkInUser");
    expect(apiSource).toContain('"/api/auth/checkin"');
    expect(apiSource).toContain("images_total?: number | null");
    expect(apiSource).toContain("images_remaining?: number | null");
    expect(apiSource).toContain("last_login_ip?: string | null");
    expect(apiSource).toContain("email?: string");
    expect(apiSource).toContain("email?: string; name?: string; key?: string; limits?: UserKeyLimits");
    expect(apiSource).toContain("count?: number");
  });

  test("supports password login and one-time access code activation", () => {
    expect(apiSource).toContain("email?: string");
    expect(apiSource).toContain("export async function loginWithPassword(email: string, password: string)");
    expect(apiSource).toContain('body: { email: normalizedEmail, password }');
    expect(apiSource).toContain("export async function activateUser");
    expect(apiSource).toContain("accessCode: string");
    expect(apiSource).toContain('"/auth/activate"');
    expect(apiSource).toContain("access_code: accessCode");
  });
});

describe("public image task api", () => {
  test("sends public visibility when creating generation and edit tasks", () => {
    expect(apiSource).toContain("isPublic = false");
    expect(apiSource).toContain("public: isPublic");
    expect(apiSource).toContain('formData.append("public", String(isPublic))');
  });

  test("sends explicit image resolution when creating generation and edit tasks", () => {
    expect(apiSource).toContain('export type ImageResolution = "1k" | "2k" | "4k"');
    expect(apiSource).toContain("resolution?: ImageResolution | string");
    expect(apiSource).toContain("resolution?: ImageResolution | string,");
    expect(apiSource).toContain("...(resolution ? { resolution } : {})");
    expect(apiSource).toContain('formData.append("resolution", resolution)');
  });
});
