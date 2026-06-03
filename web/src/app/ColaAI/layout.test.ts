import { describe, expect, test } from "bun:test";

import { metadata } from "./layout";

describe("ColaAILayout metadata", () => {
  test("sets a ColaAI-specific browser title", () => {
    expect(metadata.title).toBe("ColaAI");
  });
});
