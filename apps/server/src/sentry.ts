// Server-side Sentry (platform.md › Monitoring): EU region, no PII, request bodies and
// email addresses scrubbed. No tracing and no OpenTelemetry: prod runs in 256 MB, and
// Ping only wants errors.
import { SENTRY_DATA_COLLECTION, scrubSentryBreadcrumb, scrubSentryEvent } from '@ping/shared';
import * as Sentry from '@sentry/node';
import type { ErrorRoute } from './app';
import type { SentrySettings } from './config';

export function initSentry(config: SentrySettings | undefined): void {
  if (!config) return;
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    dataCollection: SENTRY_DATA_COLLECTION,
    enableOpenTelemetrySetup: false,
    enableRuntimeChannelInjection: false,
    // Only error capture: the default set adds HTTP, console and OpenTelemetry
    // instrumentation that Ping doesn't use.
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.nodeContextIntegration(),
    ],
    beforeSend: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: scrubSentryBreadcrumb,
  });
}

/** Sends an error the app caught to Sentry, with the route but no request data. */
export function captureError(error: unknown, route: ErrorRoute): void {
  Sentry.captureException(error, { contexts: { route } });
}

/** Sends anything queued before the process exits. */
export function flushSentry(): Promise<boolean> {
  return Sentry.close(2000);
}
