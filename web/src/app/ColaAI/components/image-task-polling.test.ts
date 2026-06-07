import { describe, expect, test } from "bun:test";

import type { ImageTask } from "@/lib/api";
import { getImageTaskPollingDelayMs } from "./image-task-polling";

const now = Date.parse("2026-06-07T12:00:00Z");

function task(overrides: Partial<ImageTask>): ImageTask {
  return {
    id: "task-1",
    status: "running",
    phase: "generating",
    created_at: "2026-06-07T11:59:45Z",
    updated_at: "2026-06-07T11:59:45Z",
    mode: "generate",
    model: "gpt-image-2",
    size: "1:1",
    data: [],
    ...overrides,
  };
}

describe("image task polling", () => {
  test("polls fresh active tasks quickly", () => {
    expect(
      getImageTaskPollingDelayMs({
        activeTaskIds: ["task-1"],
        tasks: [task({ id: "task-1" })],
        nowMs: now,
      }),
    ).toBe(1800);
  });

  test("backs off older active tasks", () => {
    expect(
      getImageTaskPollingDelayMs({
        activeTaskIds: ["task-1"],
        tasks: [task({ id: "task-1", created_at: "2026-06-07T11:48:00Z", updated_at: "2026-06-07T11:48:00Z" })],
        nowMs: now,
      }),
    ).toBe(6000);
  });

  test("adds delay when many tasks are active", () => {
    expect(
      getImageTaskPollingDelayMs({
        activeTaskIds: ["a", "b", "c", "d", "e"],
        tasks: [
          task({ id: "a" }),
          task({ id: "b" }),
          task({ id: "c" }),
          task({ id: "d" }),
          task({ id: "e" }),
        ],
        nowMs: now,
      }),
    ).toBe(2600);
  });

  test("ignores terminal tasks when selecting the delay", () => {
    expect(
      getImageTaskPollingDelayMs({
        activeTaskIds: ["done", "active"],
        tasks: [
          task({ id: "done", status: "success", created_at: "2026-06-07T11:40:00Z" }),
          task({ id: "active", status: "queued", created_at: "2026-06-07T11:59:58Z" }),
        ],
        nowMs: now,
      }),
    ).toBe(1800);
  });
});
