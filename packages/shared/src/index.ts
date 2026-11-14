// zod schemas and types shared by apps/server and apps/web. Never imports server code.

export type HealthzResponse = {
  status: 'ok';
};

export {
  redactSensitiveText,
  SENTRY_DATA_COLLECTION,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from './sentry-scrub';
