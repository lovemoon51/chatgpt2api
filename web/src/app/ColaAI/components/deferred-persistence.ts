export type DeferredPersistence<T> = {
  cancel: () => void;
  flush: () => void;
  schedule: (value: T) => void;
};

export function createDeferredPersistence<T>(
  persist: (value: T) => void,
  scheduleTimeout: (callback: () => void, delayMs: number) => number,
  clearTimeoutHandle: (id: number) => void,
  delayMs: number,
): DeferredPersistence<T> {
  let timeoutId: number | null = null;
  let hasPendingValue = false;
  let pendingValue!: T;

  const run = () => {
    timeoutId = null;
    if (!hasPendingValue) {
      return;
    }

    hasPendingValue = false;
    persist(pendingValue);
  };

  return {
    cancel() {
      if (timeoutId !== null) {
        clearTimeoutHandle(timeoutId);
        timeoutId = null;
      }
      hasPendingValue = false;
    },
    flush() {
      if (timeoutId !== null) {
        clearTimeoutHandle(timeoutId);
      }
      run();
    },
    schedule(value: T) {
      pendingValue = value;
      hasPendingValue = true;
      if (timeoutId !== null) {
        clearTimeoutHandle(timeoutId);
      }
      timeoutId = scheduleTimeout(() => {
        run();
      }, delayMs);
    },
  };
}
