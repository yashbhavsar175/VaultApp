import { runWhenIdle } from './runWhenIdle';

type IdleGlobals = typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const idleGlobals = globalThis as IdleGlobals;

describe('runWhenIdle', () => {
  afterEach(() => {
    delete idleGlobals.requestIdleCallback;
    delete idleGlobals.cancelIdleCallback;
    jest.useRealTimers();
  });

  it('cancels the timer fallback before the callback runs', () => {
    jest.useFakeTimers();
    const callback = jest.fn();

    const task = runWhenIdle(callback);
    task.cancel();
    jest.runAllTimers();

    expect(callback).not.toHaveBeenCalled();
  });

  it('suppresses a scheduled idle callback when host cancellation is unavailable', () => {
    let scheduledCallback: (() => void) | undefined;
    idleGlobals.requestIdleCallback = jest.fn(callback => {
      scheduledCallback = callback;
      return 17;
    });
    const callback = jest.fn();

    const task = runWhenIdle(callback);
    task.cancel();
    scheduledCallback?.();

    expect(callback).not.toHaveBeenCalled();
  });

  it('uses host idle cancellation when available', () => {
    idleGlobals.requestIdleCallback = jest.fn(() => 23);
    idleGlobals.cancelIdleCallback = jest.fn();

    const task = runWhenIdle(jest.fn());
    task.cancel();

    expect(idleGlobals.cancelIdleCallback).toHaveBeenCalledWith(23);
  });
});
