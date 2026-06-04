import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const pageSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf-8");

describe("LogsPage video logs", () => {
  test("adds a dedicated video log type with video preview rendering", () => {
    expect(pageSource).toContain('Video: "video"');
    expect(pageSource).toContain("视频调用日志");
    expect(pageSource).toContain("showVideos");
    expect(pageSource).toContain("<video");
    expect(pageSource).not.toContain('const showImages = isCallLog;');
  });
});
