// Server-side Sentry (platform.md › Monitoring): EU region, no PII, request bodies and
// email addresses scrubbed. No tracing and no OpenTelemetry: prod runs in 256 MB, and
// Ping only wants errors.
import { redactSensitiveText, SENTRY_DATA_COLLECTION, scrubSentryEvent } from '@ping/shared';
import * as Sentry from '@sentry/node';
import type { ServerConfig } from './config';

export function initSentry(config: ServerConfig['sentry']): void {
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
    beforeBreadcrumb: (breadcrumb) =>
      breadcrumb.message === undefined
        ? breadcrumb
        : { ...breadcrumb, message: redactSensitiveText(breadcrumb.message) },
  });
}

/** Sends an error the app caught to Sentry, with the route but no request data. */
export function captureError(error: unknown, request: { method: string; path: string }): void {
  Sentry.captureException(error, { contexts: { route: request } });
}

/** Sends anything queued before the process exits. */
export function flushSentry(): Promise<boolean> {
  return Sentry.close(2000);
}
