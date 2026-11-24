import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delay } from './delay';

describe('delay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves once the time has passed, not before', async () => {
    let done = false;
    const waiting = delay(250, new AbortController().signal).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
  });

  it('rejects at once when the signal aborts, so a superseded search never runs', async () => {
    const controller = new AbortController();
    const waiting = delay(250, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects when the signal has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(delay(250, controller.signal)).rejects.toThrow();
  });
});
