export type AnimationFrameBatcher<T> = {
  cancel: () => void;
  flush: () => void;
  push: (value: T) => void;
};

export function createAnimationFrameBatcher<T>(
  commit: (value: T) => void,
  scheduleFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (id: number) => void,
): AnimationFrameBatcher<T> {
  let frameId: number | null = null;
  let hasPendingValue = false;
  let pendingValue!: T;

  const run = () => {
    frameId = null;
    if (!hasPendingValue) {
      return;
    }

    hasPendingValue = false;
    commit(pendingValue);
  };

  return {
    cancel() {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      hasPendingValue = false;
    },
    flush() {
      if (frameId !== null) {
        cancelFrame(frameId);
      }
      run();
    },
    push(value: T) {
      pendingValue = value;
      hasPendingValue = true;
      if (frameId !== null) {
        return;
      }
      frameId = scheduleFrame(() => {
        run();
      });
    },
  };
}
