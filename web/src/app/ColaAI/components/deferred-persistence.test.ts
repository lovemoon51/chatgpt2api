import { describe, expect, test } from "bun:test";

import { createDeferredPersistence } from "./deferred-persistence";

function createTimerDriver() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();

  return {
    clear(id: number) {
      callbacks.delete(id);
    },
    flushAll() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
    pendingCount() {
      return callbacks.size;
    },
    schedule(callback: () => void) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
  };
}

describe("createDeferredPersistence", () => {
  test("persists only the latest state after a burst of updates", () => {
    const driver = createTimerDriver();
    const saved: string[] = [];
    const persistence = createDeferredPersistence(
      (value: string) => {
        saved.push(value);
      },
      driver.schedule,
      driver.clear,
      180,
    );

    persistence.schedule("first");
    persistence.schedule("second");
    persistence.schedule("latest");

    expect(driver.pendingCount()).toBe(1);
    expect(saved).toEqual([]);

    driver.flushAll();

    expect(saved).toEqual(["latest"]);
  });

  test("flushes pending state immediately", () => {
    const driver = createTimerDriver();
    const saved: number[] = [];
    const persistence = createDeferredPersistence(
      (value: number) => {
        saved.push(value);
      },
      driver.schedule,
      driver.clear,
      180,
    );

    persistence.schedule(1);
    persistence.schedule(4);
    persistence.flush();

    expect(driver.pendingCount()).toBe(0);
    expect(saved).toEqual([4]);
  });

  test("cancels pending state without persisting it", () => {
    const driver = createTimerDriver();
    const saved: number[] = [];
    const persistence = createDeferredPersistence(
      (value: number) => {
        saved.push(value);
      },
      driver.schedule,
      driver.clear,
      180,
    );

    persistence.schedule(9);
    persistence.cancel();
    driver.flushAll();

    expect(saved).toEqual([]);
  });
});
