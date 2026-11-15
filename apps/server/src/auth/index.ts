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
import { CLIENT_IP_HEADERS, clientIp } from './client-ip';
import { findStaffForSignIn, findUserIdByEmail, insertAuditEvent } from './queries';

const SEVEN_DAYS = 60 * 60 * 24 * 7;

const DEACTIVATED_CODE = 'STAFF_MEMBER_DEACTIVATED';

export function createAuth(database: Database, config: ServerConfig['auth']) {
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
    // The breached-password check runs on password set and change. Sign-in never calls it.
    plugins: [haveIBeenPwned()],
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
