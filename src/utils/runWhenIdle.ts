type IdleScheduler = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function runWhenIdle(callback: () => void) {
  const scheduler = globalThis as typeof globalThis & IdleScheduler;
  let canceled = false;
  const runUnlessCanceled = () => {
    if (!canceled) callback();
  };

  if (typeof scheduler.requestIdleCallback === 'function') {
    const handle = scheduler.requestIdleCallback(runUnlessCanceled, { timeout: 1000 });
    return {
      cancel: () => {
        canceled = true;
        scheduler.cancelIdleCallback?.(handle);
      },
    };
  }

  const handle = setTimeout(runUnlessCanceled, 0);
  return {
    cancel: () => {
      canceled = true;
      clearTimeout(handle);
    },
  };
}
