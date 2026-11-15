// The real Hono app, in-process, against this worker's database. Used by the auth tests,
// the permission matrix and the route-coverage guard.
import { randomUUID } from 'node:crypto';
import { createApp, type InviteServices } from '../app';
import { type Auth, createAuth } from '../auth';
import { createDatabase, type Database } from '../db';
import { testUrls } from '../db/test-support';
import { createMailer, type Mailer, type OutgoingMail } from '../lib/email';
import { createSystemActions, type SystemActions } from '../system-actions';

const TEST_ORIGIN = 'http://localhost:5173';

/** A password the fake breach check reports as breached. */
export const BREACHED_PASSWORD = 'password1234-breached';

/**
 * Every email the app sent, through the real mailer and a fake transport. Nothing in tests
 * sends real mail. Set `failing` to make the next sends fail as SMTP would.
 */
export type Mailbox = { sent: OutgoingMail[]; failing: boolean };

export type TestApp = {
  app: ReturnType<typeof createApp>;
  auth: Auth;
  database: Database;
  systemActions: SystemActions;
  mailbox: Mailbox;
  /** Every error the app reported to Sentry. */
  reported: unknown[];
  close(): Promise<void>;
};

/** A mailer whose transport records instead of sending. */
export function fakeMailer(mailbox: Mailbox): Mailer {
  return createMailer({
    environment: 'production',
    allowlist: [],
    transport: {
      async send(mail) {
        if (mailbox.failing) throw new Error(`550 mailbox unavailable: ${mail.to}`);
        mailbox.sent.push(mail);
      },
    },
  });
}

export function createTestApp(): TestApp {
  const database = createDatabase(testUrls().app);
  const systemActions = createSystemActions(testUrls().system);
  const auth = createAuth(database, {
    secret: 'test-secret-for-integration-tests-only',
    baseUrl: TEST_ORIGIN,
    trustedOrigins: [TEST_ORIGIN],
  });
  const mailbox: Mailbox = { sent: [], failing: false };
  const reported: unknown[] = [];
  return {
    app: createApp({
      auth,
      database,
      trustedOrigins: [TEST_ORIGIN],
      captureError: (error) => reported.push(error),
      invites: {
        mailer: fakeMailer(mailbox),
        systemActions,
        appUrl: TEST_ORIGIN,
        isPasswordCompromised: async (password) => password === BREACHED_PASSWORD,
      },
    }),
    auth,
    database,
    systemActions,
    mailbox,
    reported,
    close: async () => {
      await Promise.all([database.close(), systemActions.close()]);
    },
  };
}

/** Invite services for an app that never reaches a database or sends mail (unit tests). */
export function offlineInviteServices(): InviteServices {
  return {
    mailer: fakeMailer({ sent: [], failing: false }),
    systemActions: createSystemActions('postgres://nobody@localhost:1/none'),
    appUrl: TEST_ORIGIN,
    isPasswordCompromised: async () => false,
  };
}

/** The token in the latest invite email sent to `email`. */
export function inviteTokenFor(mailbox: Mailbox, email: string): string {
  const mail = mailbox.sent.findLast((sent) => sent.to === email);
  const token = mail?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('No invite email was sent to that address');
  return token;
}

/** A fresh client IP per call, so Better Auth's rate limiter treats each test apart. */
function randomIp(): string {
  const bytes = randomUUID().replaceAll('-', '');
  return `10.${[0, 2, 4].map((i) => Number.parseInt(bytes.slice(i, i + 2), 16)).join('.')}`;
}

/** Headers a browser on the app's origin sends with a JSON request. */
export function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    origin: TEST_ORIGIN,
    'fly-client-ip': randomIp(),
    ...extra,
  };
}

/** Signs in through the real Better Auth route and returns the Cookie header to send. */
export async function signIn(
  testApp: TestApp,
  credentials: { email: string; password: string },
): Promise<string> {
  const res = await testApp.app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(credentials),
  });
  if (res.status !== 200) {
    throw new Error(`sign-in failed with ${res.status}: ${await res.text()}`);
  }
  return cookieHeader(res);
}

/** Turns a response's Set-Cookie headers into a Cookie request header. */
function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}
