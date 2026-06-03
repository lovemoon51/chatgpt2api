import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const pageSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf-8");

describe("HomePage routing", () => {
  test("sends unauthenticated visitors to ColaAI instead of the shared login page", () => {
    expect(pageSource).toContain('router.replace(session ? getDefaultRouteForRole(session.role) : "/ColaAI")');
    expect(pageSource).not.toContain(': "/login"');
  });
});
