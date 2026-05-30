import { describe, expect, test } from "bun:test";

import { createAnimationFrameBatcher } from "./frame-batcher";

function createFrameDriver() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  return {
    cancel(id: number) {
      callbacks.delete(id);
    },
    flush(timestamp = 16) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(timestamp));
    },
    pendingCount() {
      return callbacks.size;
    },
    schedule(callback: FrameRequestCallback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
  };
}

describe("createAnimationFrameBatcher", () => {
  test("coalesces multiple updates into a single frame and keeps the latest payload", () => {
    const driver = createFrameDriver();
    const committed: Array<{ x: number }> = [];
    const batcher = createAnimationFrameBatcher(
      (value: { x: number }) => {
        committed.push(value);
      },
      driver.schedule,
      driver.cancel,
    );

    batcher.push({ x: 10 });
    batcher.push({ x: 24 });
    batcher.push({ x: 36 });

    expect(driver.pendingCount()).toBe(1);
    expect(committed).toEqual([]);

    driver.flush();

    expect(committed).toEqual([{ x: 36 }]);
  });

  test("flushes the latest pending update immediately", () => {
    const driver = createFrameDriver();
    const committed: Array<{ y: number }> = [];
    const batcher = createAnimationFrameBatcher(
      (value: { y: number }) => {
        committed.push(value);
      },
      driver.schedule,
      driver.cancel,
    );

    batcher.push({ y: 12 });
    batcher.push({ y: 42 });
    batcher.flush();

    expect(driver.pendingCount()).toBe(0);
    expect(committed).toEqual([{ y: 42 }]);
  });

  test("drops pending work when cancelled", () => {
    const driver = createFrameDriver();
    const committed: number[] = [];
    const batcher = createAnimationFrameBatcher(
      (value: number) => {
        committed.push(value);
      },
      driver.schedule,
      driver.cancel,
    );

    batcher.push(3);
    batcher.cancel();
    driver.flush();

    expect(committed).toEqual([]);
  });
});
