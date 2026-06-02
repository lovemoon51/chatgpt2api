import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ColaAILoginPage from "./page";

const testDir = dirname(fileURLToPath(import.meta.url));

describe("ColaAILoginPage", () => {
  test("renders a standalone ColaAI login page", () => {
    const markup = renderToStaticMarkup(<ColaAILoginPage />);

    expect(markup).toContain('data-cola-panel="standalone-auth"');
    expect(markup).toContain('data-cola-auth-mode="login"');
    expect(markup).toContain("登录 ColaAI");
    expect(markup).toContain('href="/ColaAI/register"');
    expect(markup).toContain('href="/ColaAI"');
    expect(markup).not.toContain('href="/login"');
    expect(markup).not.toContain('href="/register"');
    expect(markup).not.toContain("ChatGPT注册机");
  });

  test("does not import the shared project login implementation", () => {
    const source = readFileSync(join(testDir, "page.tsx"), "utf-8");

    expect(source).toContain("@/store/cola-auth");
    expect(source).not.toContain("@/store/auth");
    expect(source).not.toContain("@/lib/auth-session");
    expect(source).not.toContain("@/lib/api");
  });

  test("reads submitted values from the form element to avoid hydration-time state races", () => {
    const source = readFileSync(join(testDir, "page.tsx"), "utf-8");

    expect(source).toContain("new FormData(event.currentTarget)");
    expect(source).toContain('name="name"');
    expect(source).toContain('name="email"');
  });
});
