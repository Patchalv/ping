// Live updates (product.md › Live updates): one Server-Sent Events stream per signed-in
// browser, GET /api/live. It only pushes: every action stays an ordinary request. Each
// event names what changed, and the screens on show refetch it through the API.
//
// The stream is the one call outside the hc client (docs/conventions.md › Validation and
// the API contract): the browser's EventSource opens it, and resumes it after a dropped
// connection with Last-Event-ID, which hc can't do.
import { LIVE_CHANGE, LIVE_RESYNC, liveEvent } from '@ping/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { liveInvalidations } from './live-invalidations';

const LIVE_PATH = '/api/live';

/** How long to wait before opening a new stream after the server refused or dropped one. */
const RETRY_MS = 5000;

export function useLiveUpdates(queryClient: QueryClient, onUnauthenticated: () => void): void {
  // eslint-disable-next-line no-restricted-syntax -- syncs with the server's event stream, outside React: opened on sign-in, closed on sign-out.
  useEffect(() => {
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let opens = 0;

    function open() {
      const current = new EventSource(LIVE_PATH);
      source = current;
      // A new stream can't resume the last one, so whatever was missed meanwhile is
      // refetched. (The browser resumes within one stream itself, with Last-Event-ID.)
      const isReopen = opens > 0;
      opens += 1;
      current.addEventListener('open', () => {
        if (isReopen) void queryClient.invalidateQueries();
      });
      current.addEventListener(LIVE_CHANGE, (message) => {
        const parsed = liveEvent.safeParse(JSON.parse((message as MessageEvent<string>).data));
        if (!parsed.success) return;
        for (const queryKey of liveInvalidations(parsed.data)) {
          void queryClient.invalidateQueries({ queryKey });
        }
      });
      // Fell too far behind, or the server restarted: refetch everything on show.
      current.addEventListener(LIVE_RESYNC, () => void queryClient.invalidateQueries());
      current.addEventListener('error', () => {
        // The browser retries a dropped stream itself. It gives up only when the server
        // answers with an error (signed out, Deactivated, or down for a deploy).
        if (current.readyState !== EventSource.CLOSED) return;
        // A lost session returns to sign-in, which closes this stream for good.
        onUnauthenticated();
        retry = setTimeout(open, RETRY_MS);
      });
    }

    open();
    return () => {
      clearTimeout(retry);
      source?.close();
    };
  }, [queryClient, onUnauthenticated]);
}
