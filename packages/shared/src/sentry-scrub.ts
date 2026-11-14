// Sentry's beforeSend for the server and the SPA. Ping never sends request bodies,
// cookies, credentials or email addresses to Sentry (platform.md › Monitoring).
// Typed structurally so the shared package doesn't depend on a Sentry SDK.

/**
 * Sentry's `dataCollection` option for the server and the SPA. Sentry 11 replaced
 * `sendDefaultPii: false` with this; every category of personal or request data is off.
 * `beforeSend: scrubSentryEvent` still runs as the second line.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
  queues: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
};

type ScrubbableEvent = {
  message?: string;
  request?: {
    data?: unknown;
    cookies?: unknown;
    query_string?: unknown;
    headers?: Record<string, string>;
  };
  user?: { id?: string | number };
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: { message?: string }[];
};

const EMAIL = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[a-z]{2,}/gi;
const CREDENTIAL_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
]);

/** Drizzle's failed-query errors end with the bound values, which can be message bodies. */
const QUERY_PARAMS = /\nparams: [\s\S]*$/;

/**
 * Removes email addresses and failed-query parameters from text bound for Sentry or the
 * logs, which must never hold message bodies or email addresses.
 */
export function redactSensitiveText(text: string): string {
  return text.replace(QUERY_PARAMS, '\nparams: [redacted]').replace(EMAIL, '[email]');
}

export function scrubSentryEvent<E extends ScrubbableEvent>(event: E): E {
  const scrubbed: E = { ...event };

  if (event.request) {
    const { data: _data, cookies: _cookies, query_string: _query, ...request } = event.request;
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(
          ([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase()),
        ),
      );
    }
    scrubbed.request = request;
  }

  if (event.user) {
    scrubbed.user = event.user.id === undefined ? {} : { id: event.user.id };
  }

  if (event.message !== undefined) {
    scrubbed.message = redactSensitiveText(event.message);
  }

  if (event.exception?.values) {
    scrubbed.exception = {
      ...event.exception,
      values: event.exception.values.map((value) =>
        value.value === undefined ? value : { ...value, value: redactSensitiveText(value.value) },
      ),
    };
  }

  if (event.breadcrumbs) {
    scrubbed.breadcrumbs = event.breadcrumbs.map((crumb) =>
      crumb.message === undefined
        ? crumb
        : { ...crumb, message: redactSensitiveText(crumb.message) },
    );
  }

  return scrubbed;
}
