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
});
