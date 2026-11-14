// The SPA's Sentry. The server puts the DSN and environment in index.html as meta tags at
// runtime, so one build serves staging and prod. No meta tags (local dev, tests): no Sentry.
import { redactSensitiveText, SENTRY_DATA_COLLECTION, scrubSentryEvent } from '@ping/shared';
import * as Sentry from '@sentry/browser';

function meta(name: string): string | undefined {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;
}

export function initSentry(): void {
  const dsn = meta('sentry-dsn');
  const environment = meta('sentry-environment');
  if (!dsn || !environment) return;
  Sentry.init({
    dsn,
    environment,
    dataCollection: SENTRY_DATA_COLLECTION,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) =>
      breadcrumb.message === undefined
        ? breadcrumb
        : { ...breadcrumb, message: redactSensitiveText(breadcrumb.message) },
  });
}
