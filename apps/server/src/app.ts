import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { HealthzResponse } from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from './auth';
import { securityHeaders } from './security-headers';

/** The SPA's Sentry settings, read at runtime so one image serves staging and prod. */
type BrowserSentry = { dsn: string; environment: string };

type AppOptions = {
  auth: Auth;
  /** The built SPA (apps/web/dist). When set, the server serves it, with index.html as the fallback for client-side routes. */
  webDistDir?: string;
  /** When set, the SPA reports to Sentry, and the CSP allows Sentry's ingest origin. */
  sentry?: BrowserSentry;
  /** Called with every unhandled error (Sentry, in production). */
  captureError?: (error: unknown, request: { method: string; path: string }) => void;
};

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** index.html with the SPA's Sentry settings as meta tags. An inline script would break the CSP. */
function withSentryMeta(indexHtml: string, sentry: BrowserSentry | undefined): string {
  if (!sentry) return indexHtml;
  const meta =
    `<meta name="sentry-dsn" content="${escapeAttribute(sentry.dsn)}">` +
    `<meta name="sentry-environment" content="${escapeAttribute(sentry.environment)}">`;
  return indexHtml.replace('</head>', `${meta}</head>`);
}

export function createApp(options: AppOptions) {
  // Routes are chained so Hono RPC can infer AppType.
  // /healthz never touches the database, so uptime checks let Neon sleep.
  const app = new Hono()
    .use('/*', securityHeaders(options.sentry?.dsn))
    .get('/healthz', (c) => c.json({ status: 'ok' } satisfies HealthzResponse));

  // The log line leaves out the error's message, which can hold email addresses or a
  // failed query's parameters. Sentry gets the scrubbed error.
  app.onError((error, c) => {
    const request = { method: c.req.method, path: c.req.path };
    options.captureError?.(error, request);
    console.error(`Unhandled ${error.name} on ${request.method} ${request.path}`);
    return c.text('Internal Server Error', 500);
  });

  // Better Auth's routes. Registered without chaining: the web app reaches them through
  // Better Auth's own client, not the typed hc client.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => options.auth.handler(c.req.raw));

  if (options.webDistDir) {
    // Registered without chaining, so the SPA routes stay out of AppType.
    const indexHtml = withSentryMeta(
      readFileSync(join(options.webDistDir, 'index.html'), 'utf8'),
      options.sentry,
    );
    // index.html always goes out with the Sentry settings, never as the raw file.
    app.use('/*', async (c, next) =>
      c.req.method === 'GET' && (c.req.path === '/' || c.req.path === '/index.html')
        ? c.html(indexHtml)
        : next(),
    );
    app.use('/*', serveStatic({ root: options.webDistDir }));
    app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(indexHtml)));
  }

  return app;
}

export type AppType = ReturnType<typeof createApp>;
