import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import ColaAIPage from "./page";

describe("ColaAIPage", () => {
  test("renders the public Rova-style workbench before auth validation finishes", () => {
    const markup = renderToStaticMarkup(<ColaAIPage />);

    expect(markup).toContain('data-cola-layout="rova-like"');
    expect(markup).toContain("ColaAI");
    expect(markup).not.toContain("animate-spin");
  });

  test("uses the ColaAI auth session instead of the shared project auth validator", () => {
    const pageSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf-8");

    expect(pageSource).toContain("@/store/cola-auth");
    expect(pageSource).not.toContain("@/lib/auth-session");
    expect(pageSource).not.toContain("getValidatedAuthSession");
  });
});
