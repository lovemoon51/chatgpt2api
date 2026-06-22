import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "use-auth-guard.ts"), "utf-8");

describe("useAuthGuard role boundaries", () => {
  test("does not expose a disallowed ordinary user session while redirecting", () => {
    const mismatchBlock = source.slice(source.indexOf("if (roleList.length > 0"), source.indexOf("setSession(storedSession);", source.indexOf("if (roleList.length > 0")));

    expect(mismatchBlock).toContain("setSession(null)");
    expect(mismatchBlock).toContain("router.replace(getDefaultRouteForRole(storedSession.role))");
    expect(mismatchBlock).not.toContain("setSession(storedSession)");
  });
});
