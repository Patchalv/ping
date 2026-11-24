// Waiting inside a query function. TanStack Query aborts a query's signal once nothing
// shows it any more (the key moved on), so a wait at the start of a query debounces it:
// each keystroke's query waits, and only the one still wanted reaches the server.

/** Resolves after `ms`, or rejects as soon as `signal` aborts, clearing its timer. */
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
