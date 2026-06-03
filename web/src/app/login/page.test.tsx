import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const pageSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf-8");

describe("LoginPage management boundary", () => {
  test("keeps the shared login page as an admin-only entry", () => {
    expect(pageSource).toContain('if (data.role !== "admin")');
    expect(pageSource).toContain('router.replace("/ColaAI/login")');
    expect(pageSource).not.toContain("用户密钥或访问码");
    expect(pageSource).not.toContain("进入创作台");
  });
});
