import { describe, expect, test, beforeEach } from "bun:test";

import {
  getCanvasViewport,
  resetCanvasViewport,
  setCanvasViewport,
  subscribeCanvasViewport,
} from "./canvas-viewport-store";

describe("canvas viewport store", () => {
  beforeEach(() => {
    resetCanvasViewport();
  });

  test("returns the default viewport before any updates", () => {
    expect(getCanvasViewport()).toEqual({ x: 0, y: 0, k: 1 });
  });

  test("setCanvasViewport replaces the current viewport", () => {
    setCanvasViewport({ x: 120, y: -40, k: 1.5 });
    expect(getCanvasViewport()).toEqual({ x: 120, y: -40, k: 1.5 });
  });

  test("subscribers are notified after each update", () => {
    let notifications = 0;
    const unsubscribe = subscribeCanvasViewport(() => {
      notifications += 1;
    });

    setCanvasViewport({ x: 10, y: 20, k: 1 });
    setCanvasViewport({ x: 30, y: 40, k: 1 });

    expect(notifications).toBe(2);
    unsubscribe();
  });

  test("unsubscribed listeners stop receiving updates", () => {
    let notifications = 0;
    const unsubscribe = subscribeCanvasViewport(() => {
      notifications += 1;
    });
    unsubscribe();

    setCanvasViewport({ x: 50, y: 60, k: 1 });

    expect(notifications).toBe(0);
  });

  test("returns the same reference if viewport values are unchanged", () => {
    setCanvasViewport({ x: 10, y: 20, k: 1 });
    const before = getCanvasViewport();
    setCanvasViewport({ x: 10, y: 20, k: 1 });
    expect(getCanvasViewport()).toBe(before);
  });

  test("clamps zoom to [0.12, 4]", () => {
    setCanvasViewport({ x: 0, y: 0, k: 0.05 });
    expect(getCanvasViewport().k).toBe(0.12);
    setCanvasViewport({ x: 0, y: 0, k: 6 });
    expect(getCanvasViewport().k).toBe(4);
  });
});
