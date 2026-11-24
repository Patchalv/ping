// What a Home count shows (screens.md › Home), from its count's request. Pure, so it's
// unit-tested without React.

export type HomeCountState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; count: number };

/**
 * Loading until the count arrives; an error only when the request failed with nothing to
 * show, so a failed refetch keeps the number on screen; then empty at zero, or the count.
 */
export function homeCountState(count: {
  error: Error | null;
  data: number | undefined;
}): HomeCountState {
  if (count.data === undefined) {
    return count.error ? { status: 'error', message: count.error.message } : { status: 'loading' };
  }
  return count.data === 0 ? { status: 'empty' } : { status: 'ready', count: count.data };
}
