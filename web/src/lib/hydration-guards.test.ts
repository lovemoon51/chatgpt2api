import { describe, expect, test } from "bun:test";

import { stripInjectedTextShadowScript } from "./hydration-guards";

describe("hydration guards", () => {
  test("strips extension-injected inline text-shadow before hydration", () => {
    expect(stripInjectedTextShadowScript).toContain("removeProperty(\"text-shadow\")");
    expect(stripInjectedTextShadowScript).toContain("MutationObserver");
    expect(stripInjectedTextShadowScript).toContain("attributeFilter: [\"style\"]");
  });

  test("does not target unrelated inline styles or class attributes", () => {
    expect(stripInjectedTextShadowScript).not.toContain("removeAttribute(\"class\")");
    expect(stripInjectedTextShadowScript).not.toContain("removeProperty(\"transform\")");
    expect(stripInjectedTextShadowScript).not.toContain("removeProperty(\"opacity\")");
  });
});
