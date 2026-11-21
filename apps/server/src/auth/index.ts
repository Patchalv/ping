// Better Auth: email and password only, public sign-up off, no admin plugin (ADR 0004).
// Better Auth reaches its own four tables through the database's auth handle. Everything
// that touches Ping's tables goes through withStaffTx() or withAnonymousTx().
import { redactSensitiveText } from '@ping/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { haveIBeenPwned } from 'better-auth/plugins';
import type { ServerConfig } from '../config';
import { type Database, schema } from '../db';
import type { Mailer } from '../lib/email';
import { perEmailLimit, RESET_LIFETIME_SECONDS, resetEmail } from '../lib/password-reset';
import { CLIENT_IP_HEADERS, clientIp } from './client-ip';
import { findStaffForSignIn, findUserIdByEmail, insertAuditEvent, isActiveStaff } from './queries';

const SEVEN_DAYS = 60 * 60 * 24 * 7;

const DEACTIVATED_CODE = 'STAFF_MEMBER_DEACTIVATED';

const BREACHED = 'That password has appeared in a data breach. Choose a different one.';

/** What password reset needs beyond the database. */
export type PasswordResetServices = {
  mailer: Mailer;
  /** The URL people open, for reset links. Staging links to staging. */
  appUrl: string;
  /** The breached-password check (Have I Been Pwned). Tests pass a fake. */
  isPasswordCompromised(password: string): Promise<boolean>;
  /** Sentry, for a reset email that couldn't be sent. */
  reportError(error: unknown): void;
};

/** Better Auth's answer to a dead reset link, used too for one Ping refuses. */
function invalidToken() {
  return new APIError('BAD_REQUEST', { code: 'INVALID_TOKEN', message: 'Invalid token' });
}

export function createAuth(
  database: Database,
  config: ServerConfig['auth'],
  reset: PasswordResetServices,
) {
  // product.md › Password reset: 3 links per email per hour, on top of Better Auth's
  // per-IP limiter (3 a minute on /request-password-reset).
  const resetLimit = perEmailLimit({ max: 3, windowMs: RESET_LIFETIME_SECONDS * 1000 });

  /**
   * Emails a reset link, called by Better Auth only for an email it found. Sends nothing
   * to an Invited or Deactivated person, or past the per-email limit. A failed send is
   * reported, never thrown: the person always gets the same answer.
   */
  async function sendResetLink(user: { id: string; email: string; name: string }, token: string) {
    try {
      const active = await database.withStaffTx(user.id, (tx) => isActiveStaff(tx, user.id));
      if (!active || !resetLimit.take(user.email)) return;
      // `held` (staging, not on the allowlist) is working as configured: not reported.
      await reset.mailer.send(
        resetEmail({ to: user.email, name: user.name, appUrl: reset.appUrl, token }),
      );
    } catch (error) {
      reset.reportError(error);
      console.error(
        `Password reset email not sent (${error instanceof Error ? error.name : 'unknown error'})`,
      );
    }
  }

  return betterAuth({
    appName: 'Ping',
    baseURL: config.baseUrl,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(database.authDb, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      // Better Auth's token, in its verification table: one use, 1 hour. Ping sends its own
      // link (see lib/password-reset.ts), never Better Auth's `url`.
      resetPasswordTokenExpiresIn: RESET_LIFETIME_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, token }) => sendResetLink(user, token),
    },
    session: { expiresIn: SEVEN_DAYS },
    // Better Auth turns it off outside production by default; Ping wants it everywhere.
    rateLimit: { enabled: true, storage: 'memory' },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: true,
      defaultCookieAttributes: { sameSite: 'lax', secure: true, httpOnly: true },
      ipAddress: { ipAddressHeaders: CLIENT_IP_HEADERS },
    },
    telemetry: { enabled: false },
    // Better Auth's own log lines, minus their extra arguments (which can hold request
    // data) and with email addresses removed: logs never contain them.
    logger: {
      log: (level, message) => {
        console[level](`[better-auth] ${redactSensitiveText(message)}`);
      },
    },
    // The breached-password check runs on password change. Sign-in never calls it. Reset
    // runs Ping's own check in the before hook, as invite accept does, so tests can fake it.
    plugins: [haveIBeenPwned({ paths: ['/change-password'] })],
    databaseHooks: {
      session: {
        create: {
          // Refuses sign-in to Deactivated Staff members, and to a user with no
          // staff_member row. Runs after the password has been checked, as that Staff
          // member, so the read goes through the staff_member policy.
          before: async (session) => {
            const staff = await database.withStaffTx(session.userId, (tx) =>
              findStaffForSignIn(tx, session.userId),
            );
            if (!staff || staff.deactivatedAt) {
              throw new APIError('FORBIDDEN', {
                code: DEACTIVATED_CODE,
                message: 'You’ve been Deactivated in Ping. Ask a Ping Admin.',
              });
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/reset-password') return;
        const token: unknown = ctx.body?.token ?? ctx.query?.token;
        const newPassword: unknown = ctx.body?.newPassword;
        if (typeof token !== 'string' || typeof newPassword !== 'string') return;
        // Only an active Staff member's link sets a password. Better Auth would otherwise
        // create one for an Invited person, who joins through their invite instead.
        const found = await ctx.context.internalAdapter.findVerificationValue(
          `reset-password:${token}`,
        );
        if (!found || found.expiresAt < new Date()) throw invalidToken();
        const active = await database.withStaffTx(found.value, (tx) =>
          isActiveStaff(tx, found.value),
        );
        if (!active) throw invalidToken();
        // When the breach check can't run, refuse rather than accept an unchecked password.
        const compromised = await reset.isPasswordCompromised(newPassword).catch(() => {
          throw new APIError('SERVICE_UNAVAILABLE', {
            message: 'We couldn’t check your password just now. Try again in a minute.',
          });
        });
        if (compromised) {
          throw new APIError('BAD_REQUEST', { code: 'PASSWORD_COMPROMISED', message: BREACHED });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const ip = clientIp(ctx.request?.headers ?? ctx.headers);
        const newSession = ctx.context.newSession;

        // An audit insert that fails makes the sign-in fail loudly too, even though the
        // session row exists: a sign-in with no audit record is worse than a retry.
        if (newSession && !isAPIError(ctx.context.returned)) {
          const staffId = newSession.user.id;
          await database.withStaffTx(staffId, (tx) =>
            insertAuditEvent(tx, {
              actorId: staffId,
              kind: 'sign_in_succeeded',
              targetStaffId: staffId,
              ipAddress: ip,
            }),
          );
          return;
        }

        // Failed: record the matched Staff member's ID when there is one. Never the email.
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email : '';
        const matchedId = email ? await findUserIdByEmail(database.authDb, email) : undefined;
        await database.withAnonymousTx((tx) =>
          insertAuditEvent(tx, {
            kind: 'sign_in_failed',
            targetStaffId: matchedId ?? null,
            ipAddress: ip,
          }),
        );
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
