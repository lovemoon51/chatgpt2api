import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf-8");

describe("UsersPage", () => {
  test("renders user management as a dedicated admin-only page", () => {
    expect(source).toContain('useAuthGuard(["admin"])');
    expect(source).toContain("<UserKeysCard");
    expect(source).toContain("用户管理");
  });
});
