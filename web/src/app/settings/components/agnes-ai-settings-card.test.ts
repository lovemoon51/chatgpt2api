import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const componentSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "agnes-ai-settings-card.tsx"), "utf-8");
const pageSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../page.tsx"), "utf-8");

describe("Agnes AI settings card", () => {
  test("is mounted on the admin settings page", () => {
    expect(pageSource).toContain("AgnesAISettingsCard");
  });

  test("lets admins manage multiple Agnes API keys", () => {
    expect(componentSource).toContain("Agnes AI");
    expect(componentSource).toContain("agnes-image-2.1-flash");
    expect(componentSource).toContain("addAgnesAIKey");
    expect(componentSource).toContain("updateAgnesAIKey");
    expect(componentSource).toContain("deleteAgnesAIKey");
    expect(componentSource).toContain("testAgnesAIConnection");
    expect(componentSource).toContain("测活 Agnes");
    expect(componentSource).toContain("轮询");
  });
});
