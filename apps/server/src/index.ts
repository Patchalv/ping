import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { isPasswordCompromised } from 'better-auth/plugins';
import { createApp } from './app';
import { createAuth } from './auth';
import { loadEnvLocal, readConfig } from './config';
import { createDatabase } from './db';
import { createMailerFromConfig } from './lib/email';
import { captureError, flushSentry, initSentry } from './sentry';
import { createSystemActions } from './system-actions';

loadEnvLocal();
const config = readConfig();
initSentry(config.sentry);
const port = Number(process.env.PORT ?? '3000');
const webDistDir =
  process.env.WEB_DIST_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));

const database = createDatabase(config.databaseUrl);
const systemActions = createSystemActions(config.systemDatabaseUrl);
const auth = createAuth(database, config.auth);

const app = createApp({
  auth,
  database,
  invites: {
    mailer: createMailerFromConfig(config.email),
    systemActions,
    appUrl: config.auth.baseUrl,
    isPasswordCompromised,
  },
  trustedOrigins: config.auth.trustedOrigins,
  // In development Vite serves the SPA; the server only serves a build that exists.
  ...(existsSync(webDistDir) && { webDistDir }),
  ...(config.sentry && { sentry: config.sentry, captureError }),
});

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Ping server listening on http://localhost:${info.port}`);
});

// Fly stops a Machine with SIGINT (then SIGKILL), and Docker with SIGTERM. Node as PID 1
// ignores both unless handled.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void Promise.allSettled([database.close(), systemActions.close(), flushSentry()]).then(() =>
      process.exit(0),
    );
  });
}
