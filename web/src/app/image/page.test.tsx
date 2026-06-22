import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const pageSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf-8");

describe("ImagePage auth boundary", () => {
  test("keeps the legacy image tool behind the admin guard", () => {
    expect(pageSource).toContain('useAuthGuard(["admin"])');
    expect(pageSource).not.toContain("useAuthGuard()");
  });
});
