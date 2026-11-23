import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { HealthzResponse } from '@ping/shared';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import type { Auth } from './auth';
import type { PingEnvironment, SentrySettings } from './config';
import type { Database } from './db';
import { channelRoutes } from './features/channel/routes';
import { markReadRoutes, pingRoutes } from './features/ping/routes';
import { reactionRoutes } from './features/reaction/routes';
import { acceptInviteRoutes } from './features/staff/accept-routes';
import { emailChangeRoutes } from './features/staff/email-change-routes';
import { staffRoutes } from './features/staff/routes';
import { threadRoutes } from './features/thread/routes';
import { threadResponseRoutes } from './features/thread-response/routes';
import type { Mailer } from './lib/email';
import { errorResponse } from './lib/errors';
import { setLiveErrorReporter } from './lib/sse/publish';
import { liveRoutes } from './lib/sse/routes';
import { noStoreOnApi, securityHeaders } from './security-headers';
import type { SystemActions } from './system-actions';

/** The request an unhandled error came from: its route, never its data. */
export type ErrorRoute = { method: string; path: string };

/** What inviting and accepting an invite need beyond the database. */
export type InviteServices = {
  mailer: Mailer;
  /** The ping_system work: accepting an invite. */
  systemActions: SystemActions;
  /** The URL people open, for invite links. Staging links to staging. */
  appUrl: string;
  /** The breached-password check (Have I Been Pwned). Tests pass a fake. */
  isPasswordCompromised(password: string): Promise<boolean>;
};

type AppOptions = {
  auth: Auth;
  invites: InviteServices;
  /** The ping_app database. Routes reach it only through withActorTx(). */
  database: Database;
  /** Origins a form-style request may come from: Hono's csrf() refuses any other. */
  trustedOrigins: string[];
  /** The built SPA (apps/web/dist). When set, the server serves it, with index.html as the fallback for client-side routes. */
  webDistDir?: string;
  /** Which deployment this is. On staging the SPA's title and top bar say so. */
  environment?: PingEnvironment;
  /** When set, the SPA reports to Sentry, and the CSP allows Sentry's ingest origin. */
  sentry?: SentrySettings;
  /** Called with every unhandled error (Sentry, in production). */
  captureError?: (error: unknown, route: ErrorRoute) => void;
};

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * index.html with what it learns at runtime, so one image serves staging and prod: the
 * Sentry settings as meta tags (an inline script would break the CSP), and on staging a
 * "(Staging)" title and a ping-environment meta tag the SPA reads for its label.
 */
function withRuntimeHead(
  indexHtml: string,
  { sentry, environment }: Pick<AppOptions, 'sentry' | 'environment'>,
): string {
  let html = indexHtml;
  let meta = '';
  if (sentry) {
    meta +=
      `<meta name="sentry-dsn" content="${escapeAttribute(sentry.dsn)}">` +
      `<meta name="sentry-environment" content="${escapeAttribute(sentry.environment)}">`;
  }
  if (environment === 'staging') {
    html = html.replace(/<title>([^<]*)<\/title>/, '<title>$1 (Staging)</title>');
    meta += '<meta name="ping-environment" content="staging">';
  }
  return meta ? html.replace('</head>', `${meta}</head>`) : html;
}

export function createApp(options: AppOptions) {
  // A live-update check or write that failed goes to Sentry like any unhandled error.
  setLiveErrorReporter((error) =>
    options.captureError?.(error, { method: 'GET', path: '/api/live' }),
  );

  // Routes are chained so Hono RPC can infer AppType.
  // /healthz never touches the database, so uptime checks let Neon sleep.
  //
  // On every path: the security headers, the Origin check and no-store on /api. All three
  // sit in this one `use`, so the route-coverage allowlist's `ALL /*` covers them. csrf()
  // refuses a form-encoded, multipart or text/plain request from an untrusted origin; a
  // JSON request can't be sent cross-origin without a CORS preflight, which Ping never
  // answers.
  const app = new Hono()
    .use(
      '/*',
      securityHeaders(options.sentry?.dsn),
      csrf({ origin: options.trustedOrigins }),
      noStoreOnApi,
    )
    .get('/healthz', (c) => c.json({ status: 'ok' } satisfies HealthzResponse))
    // Feature routes, chained here so they come before the SPA's catch-all.
    .route('/api/channels', channelRoutes(options))
    .route('/api/channels/:channelId/threads', threadRoutes(options))
    .route('/api/channels/:channelId/threads/:threadId/responses', threadResponseRoutes(options))
    .route('/api/channels/:channelId/threads/:threadId', reactionRoutes(options))
    .route('/api/channels/:channelId/threads/:threadId/ping', markReadRoutes(options))
    .route('/api/pings', pingRoutes(options))
    .route('/api/live', liveRoutes(options))
    .route(
      '/api/staff',
      staffRoutes({
        auth: options.auth,
        database: options.database,
        mailer: options.invites.mailer,
        appUrl: options.invites.appUrl,
        reportError: (error, c) =>
          options.captureError?.(error, { method: c.req.method, path: c.req.routePath }),
      }),
    )
    .route('/api/invites', acceptInviteRoutes({ auth: options.auth, ...options.invites }))
    .route(
      '/api/email-change',
      emailChangeRoutes({ auth: options.auth, database: options.database }),
    );

  // Typed errors and Hono's own (a malformed JSON body, the Origin check) become their
  // status and one envelope the UI can show, and aren't reported. Anything else is a bug: a
  // bare 500, reported. The log line leaves out the error's message, which can hold email
  // addresses or a failed query's parameters. Sentry gets the scrubbed error.
  app.onError((error, c) => {
    const known = errorResponse(error);
    if (known) return c.json(known.body, known.status);
    const route: ErrorRoute = { method: c.req.method, path: c.req.path };
    options.captureError?.(error, route);
    console.error(`Unhandled ${error.name} on ${route.method} ${route.path}`);
    return c.text('Internal Server Error', 500);
  });

  // An unknown /api path answers in the same envelope. Others get Hono's plain 404.
  app.notFound((c) =>
    c.req.path.startsWith('/api/')
      ? c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404)
      : c.text('404 Not Found', 404),
  );

  // Better Auth's routes. Registered without chaining: the web app reaches them through
  // Better Auth's own client, not the typed hc client.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => options.auth.handler(c.req.raw));

  if (options.webDistDir) {
    // Registered without chaining, so the SPA routes stay out of AppType.
    const indexHtml = withRuntimeHead(
      readFileSync(join(options.webDistDir, 'index.html'), 'utf8'),
      options,
    );
    // index.html always goes out with its runtime head, never as the raw file.
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
