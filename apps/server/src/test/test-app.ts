// The real Hono app, in-process, against this worker's database. Used by the auth tests,
// the permission matrix and the route-coverage guard.
import { randomUUID } from 'node:crypto';
import { createApp, type InviteServices } from '../app';
import { type Auth, type AuthEmailServices, createAuth } from '../auth';
import type { PingEnvironment } from '../config';
import { createDatabase, type Database } from '../db';
import { testUrls } from '../db/test-support';
import { createMailer, type Mailer, type OutgoingMail } from '../lib/email';
import { createSystemActions, type SystemActions } from '../system-actions';

const TEST_ORIGIN = 'http://localhost:5173';

/** A password the fake breach check reports as breached. */
export const BREACHED_PASSWORD = 'password1234-breached';
/** A password the fake breach check can't check, as when Have I Been Pwned is down. */
export const UNCHECKABLE_PASSWORD = 'password1234-unreachable';

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

/** How the fake mailer behaves: production by default, or staging with an allowlist. */
type MailSettings = { environment: PingEnvironment; allowlist: string[] };

/** A mailer whose transport records instead of sending. */
export function fakeMailer(
  mailbox: Mailbox,
  settings: MailSettings = { environment: 'production', allowlist: [] },
): Mailer {
  return createMailer({
    ...settings,
    log: () => undefined,
    transport: {
      async send(mail) {
        if (mailbox.failing) throw new Error(`550 mailbox unavailable: ${mail.to}`);
        mailbox.sent.push(mail);
      },
    },
  });
}

/** The fake breach check: BREACHED_PASSWORD is breached, UNCHECKABLE_PASSWORD can't be checked. */
async function fakeIsPasswordCompromised(password: string): Promise<boolean> {
  if (password === UNCHECKABLE_PASSWORD) throw new Error('Failed to check password');
  return password === BREACHED_PASSWORD;
}

export function createTestApp(options: { mail?: MailSettings } = {}): TestApp {
  const database = createDatabase(testUrls().app);
  const systemActions = createSystemActions(testUrls().system);
  const mailbox: Mailbox = { sent: [], failing: false };
  const reported: unknown[] = [];
  const mailer = fakeMailer(mailbox, options.mail);
  const auth = createAuth(
    database,
    {
      secret: 'test-secret-for-integration-tests-only',
      baseUrl: TEST_ORIGIN,
      trustedOrigins: [TEST_ORIGIN],
    },
    {
      mailer,
      appUrl: TEST_ORIGIN,
      isPasswordCompromised: fakeIsPasswordCompromised,
      reportError: (error) => reported.push(error),
    },
  );
  return {
    app: createApp({
      auth,
      database,
      trustedOrigins: [TEST_ORIGIN],
      captureError: (error) => reported.push(error),
      invites: {
        mailer,
        systemActions,
        appUrl: TEST_ORIGIN,
        isPasswordCompromised: fakeIsPasswordCompromised,
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

/** Auth email services (reset, email change) for an auth instance that never sends mail (unit tests). */
export function offlineAuthEmailServices(): AuthEmailServices {
  return {
    mailer: fakeMailer({ sent: [], failing: false }),
    appUrl: TEST_ORIGIN,
    isPasswordCompromised: async () => false,
    reportError: () => undefined,
  };
}

/** The token in the latest email sent to `email` whose link opens `path`. */
function linkTokenFor(mailbox: Mailbox, email: string, path: string): string {
  const mail = mailbox.sent.findLast((sent) => sent.to === email && sent.text.includes(path));
  // Email-change tokens are JWTs, so dots count too.
  const token = mail?.text.match(/#token=([A-Za-z0-9_.-]+)/)?.[1];
  if (!token) throw new Error(`No ${path} email was sent to that address`);
  return token;
}

/** The token in the latest invite email sent to `email`. */
export function inviteTokenFor(mailbox: Mailbox, email: string): string {
  return linkTokenFor(mailbox, email, '/accept-invite#');
}

/** The token in the latest password-reset email sent to `email`. */
export function resetTokenFor(mailbox: Mailbox, email: string): string {
  return linkTokenFor(mailbox, email, '/reset-password#');
}

/** The token in the latest email-change email sent to `email` (the new address). */
export function emailChangeTokenFor(mailbox: Mailbox, email: string): string {
  return linkTokenFor(mailbox, email, '/confirm-email#');
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
