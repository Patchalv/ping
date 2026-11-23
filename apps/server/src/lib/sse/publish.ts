// Live updates. Every change a route makes calls publish(), after its transaction has
// committed, so a rolled-back change never goes out. The one hub for this app instance
// fans it out to every open stream (GET /api/live, in ./routes.ts) that may receive it.
import type { LiveEvent } from '@ping/shared';
import { createLiveHub } from './hub';

let reportLiveError: (error: unknown) => void = () => undefined;

/** The app's one hub. Ping runs exactly one app instance, so every stream is in it. */
export const liveHub = createLiveHub({
  // createApp wires Sentry through setLiveErrorReporter.
  reportError: (error) => reportLiveError(error),
});

/** Where a failed live-update check or write is reported: Sentry, in production. */
export function setLiveErrorReporter(report: (error: unknown) => void): void {
  reportLiveError = report;
}

/**
 * Tells every open stream that may see it what changed: a kind and IDs, never content. A
 * client that hears it refetches through the API, where the permissions module and
 * row-level security decide what it may see.
 */
export function publish(event: LiveEvent): void {
  liveHub.publish(event);
}
