import { describe, expect, test } from "bun:test";

import { formatDateTime, parseBackendDateTime } from "./datetime";

describe("backend datetime parsing", () => {
  test("treats plain backend datetimes as UTC instants", () => {
    expect(parseBackendDateTime("2026-01-01 00:00:00")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parseBackendDateTime("2026-01-01T00:00:00")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  test("keeps explicit timezone offsets intact", () => {
    expect(parseBackendDateTime("2026-01-01T08:00:00+08:00")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parseBackendDateTime("2026-01-01T00:00:00Z")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  test("formats backend datetimes in China local time by default", () => {
    expect(formatDateTime("2026-01-01 00:00:00", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })).toBe("2026/01/01 08:00");
  });
});
