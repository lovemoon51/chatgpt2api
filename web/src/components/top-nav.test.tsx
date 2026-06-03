import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "top-nav.tsx"), "utf-8");

describe("TopNav ordinary user routing", () => {
  test("exposes user management as a top-level admin navigation entry", () => {
    expect(source).toContain('{ href: "/users", label: "用户管理" }');
    expect(source.indexOf('{ href: "/accounts", label: "号池管理" }')).toBeLessThan(
      source.indexOf('{ href: "/users", label: "用户管理" }'),
    );
  });

  test("only exposes ColaAI as the ordinary user workspace entry", () => {
    expect(source).toContain('const userNavItems = [\n  { href: "/ColaAI", label: "ColaAI" },\n];');
    expect(source).toContain('href={session.role === "admin" ? "/dashboard" : "/ColaAI"}');
  });

  test("logs ordinary users out to the ColaAI login page", () => {
    expect(source).toContain("clearStoredColaAuthSession");
    expect(source).toContain('router.replace(session?.role === "admin" ? "/login" : "/ColaAI/login")');
  });
});
