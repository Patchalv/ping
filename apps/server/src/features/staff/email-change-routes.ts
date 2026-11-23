// Confirming an email change (product.md › Profiles), mounted at /api/email-change. The
// link may be opened signed out, or on another device, so this route has no signedIn or
// withActorTx: the token says whose change it is. It sits on the route-coverage allowlist
// with its own tests (profile-routes.int.test.ts). The token travels in the body, never
// the URL, so it can't reach a log. Rate limited per client IP.
//
// Better Auth makes and checks the token (a signed JWT bound to the old address) and
// changes the email. Ping adds what the JWT alone can't: the link works once, a newer link
// replaces an older one, a Deactivated person's link does nothing, and an address taken
// since the link was sent is refused.
import { type EmailChangeConfirmed, emailChangeTokenBody } from '@ping/shared';
import { isAPIError } from 'better-auth/api';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { insertAuditEvent, isActiveStaff, takeEmailChangeToken } from '../../auth/queries';
import type { Database } from '../../db';
import { hashEmailChangeToken } from '../../lib/email-change';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { rateLimit } from '../../lib/rate-limit';
import { publish } from '../../lib/sse/publish';
import { isUniqueViolation } from '../../lib/unique-violation';
import { validate } from '../../lib/validate';

const deadLink = () =>
  new NotFoundError(
    'This link doesn’t work any more. Change your email again from your profile to get a new one.',
  );
const expiredLink = () =>
  new ConflictError(
    'This link has expired. Change your email again from your profile to get a new one.',
  );

export function emailChangeRoutes(options: { auth: Auth; database: Database }) {
  const { auth, database } = options;
  const confirmLimit = rateLimit({
    name: 'email-change-confirm',
    max: 20,
    windowMs: 10 * 60 * 1000,
  });

  return new Hono().post(
    '/confirm',
    confirmLimit,
    validate('json', emailChangeTokenBody),
    async (c) => {
      const { token } = c.req.valid('json');
      // Used up whatever happens next: a link that fails here never works later either.
      const link = await takeEmailChangeToken(database.authDb, hashEmailChangeToken(token));
      if (!link) throw deadLink();
      if (link.expiresAt <= new Date()) throw expiredLink();
      const { staffId } = link;
      if (!(await database.withStaffTx(staffId, (tx) => isActiveStaff(tx, staffId)))) {
        throw deadLink();
      }

      let email: string;
      try {
        // Better Auth refuses a token for someone else when another person is signed in on
        // this browser, so the cookie goes along.
        const result = await auth.api.verifyEmail({ query: { token }, headers: c.req.raw.headers });
        // A change answers with the updated user; anything else changed no email.
        if (!result || !('user' in result) || !result.user) throw deadLink();
        // Better Auth types the parsed user as `{}`; it's the user row, email included.
        email = (result.user as { email: string }).email;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            'Someone in Ping started using that email after your link was sent. Choose another.',
          );
        }
        if (isAPIError(error)) {
          throw error.body?.code === 'TOKEN_EXPIRED' ? expiredLink() : deadLink();
        }
        throw error;
      }

      await database.withStaffTx(staffId, (tx) =>
        insertAuditEvent(tx, { actorId: staffId, kind: 'email_changed', targetStaffId: staffId }),
      );
      publish({ kind: 'staff.changed', staffId });
      return c.json({ email } satisfies EmailChangeConfirmed);
    },
  );
}
