import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ColaAIRegisterPage from "./page";

const testDir = dirname(fileURLToPath(import.meta.url));

describe("ColaAIRegisterPage", () => {
  test("renders a standalone ColaAI registration page", () => {
    const markup = renderToStaticMarkup(<ColaAIRegisterPage />);

    expect(markup).toContain('data-cola-panel="standalone-auth"');
    expect(markup).toContain('data-cola-auth-mode="register"');
    expect(markup).toContain("注册 ColaAI");
    expect(markup).toContain('href="/ColaAI/login"');
    expect(markup).toContain('href="/ColaAI"');
    expect(markup).not.toContain('href="/login"');
    expect(markup).not.toContain('href="/register"');
    expect(markup).not.toContain("ChatGPT注册机");
  });

  test("does not import the admin register machine implementation", () => {
    const source = readFileSync(join(testDir, "page.tsx"), "utf-8");

    expect(source).toContain("@/store/cola-auth");
    expect(source).toContain("@/store/auth");
    expect(source).toContain("@/lib/api");
    expect(source).not.toContain("@/app/register");
    expect(source).not.toContain("@/lib/auth-session");
    expect(source).not.toContain("createColaAuthProfile(");
  });

  test("activates a backend ordinary user token with email password and one-time access code", () => {
    const source = readFileSync(join(testDir, "page.tsx"), "utf-8");

    expect(source).toContain("await activateUser({");
    expect(source).toContain("email: submittedEmail");
    expect(source).toContain("password: submittedPassword");
    expect(source).toContain("accessCode: submittedAccessCode");
    expect(source).toContain('if (data.role !== "user")');
    expect(source).toContain("await setStoredAuthSession(sharedSession)");
    expect(source).toContain("await setStoredColaAuthSession(createColaAuthSessionFromSharedSession(sharedSession))");
    expect(source).toContain("new FormData(event.currentTarget)");
    expect(source).toContain('name="email"');
    expect(source).toContain('name="password"');
    expect(source).toContain('name="name"');
    expect(source).toContain('name="accessCode"');
    expect(source).not.toContain("await login(submittedAccessCode)");
  });
});
