// Accepting an invite, mounted at /api/invites. Nobody is signed in yet, so these routes
// have no signedIn or withActorTx: they run through system-actions as ping_system, and sit
// on the route-coverage allowlist with their own tests. The token travels in the body,
// never the URL, so it can't reach a log. Both routes are rate limited per client IP.
import {
  acceptInviteBody,
  type InviteView,
  inviteTokenBody,
  PASSWORD_MESSAGES,
} from '@ping/shared';
import { hashPassword } from 'better-auth/crypto';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../lib/errors';
import { hashInviteToken } from '../../lib/invite';
import { rateLimit } from '../../lib/rate-limit';
import { publish } from '../../lib/sse/publish';
import { validate } from '../../lib/validate';
import type { SystemActions } from '../../system-actions';
import { acceptInvite, findInvite, type InviteLookup } from '../../system-actions/accept-invite';

/** The live invite, or the error an expired, used or unknown token answers with. */
function requireLive(found: InviteLookup): Extract<InviteLookup, { status: 'live' }> {
  switch (found.status) {
    case 'live':
      return found;
    case 'expired':
      throw new ConflictError('This invite has expired. Ask a Ping Admin to resend it.');
    case 'unknown':
      throw new NotFoundError(
        'This invite link doesn’t work any more. Ask a Ping Admin to send a new one.',
      );
  }
}

export function acceptInviteRoutes(options: {
  auth: Auth;
  systemActions: SystemActions;
  isPasswordCompromised(password: string): Promise<boolean>;
}) {
  const { auth, systemActions } = options;
  const lookupLimit = rateLimit({ name: 'invite-lookup', max: 60, windowMs: 10 * 60 * 1000 });
  const acceptLimit = rateLimit({ name: 'invite-accept', max: 20, windowMs: 10 * 60 * 1000 });

  return (
    new Hono()
      // The set-password page: the invited person's name and email.
      .post('/lookup', lookupLimit, validate('json', inviteTokenBody), async (c) => {
        const { token } = c.req.valid('json');
        const invite = requireLive(await findInvite(systemActions.db, hashInviteToken(token)));
        return c.json({ name: invite.name, email: invite.email } satisfies InviteView);
      })

      // Set the password, join, and sign in.
      .post('/accept', acceptLimit, validate('json', acceptInviteBody), async (c) => {
        const { token, password } = c.req.valid('json');
        const tokenHash = hashInviteToken(token);
        // Check the token before the slow work, so a dead link answers at once.
        requireLive(await findInvite(systemActions.db, tokenHash));
        // Better Auth checks breached passwords only on its own routes, so Ping does here.
        // When the check can't run, refuse rather than accept an unchecked password.
        const compromised = await options.isPasswordCompromised(password).catch(() => {
          throw new ServiceUnavailableError(
            'We couldn’t check your password just now. Try again in a minute.',
          );
        });
        if (compromised) {
          const message = PASSWORD_MESSAGES.breached;
          throw new ValidationError(message, [{ path: 'password', message }]);
        }
        const accepted = requireLive(
          await acceptInvite(systemActions.db, {
            tokenHash,
            passwordHash: await hashPassword(password),
          }),
        );
        publish({ kind: 'staff.changed', staffId: accepted.staffId });

        // Signs in through Better Auth, after the commit, so its session hook sees the
        // person as joined. Its after hook records the sign-in.
        const { headers } = await auth.api.signInEmail({
          body: { email: accepted.email, password },
          headers: c.req.raw.headers,
          returnHeaders: true,
        });
        for (const cookie of headers.getSetCookie()) {
          c.header('set-cookie', cookie, { append: true });
        }
        return c.json({ ok: true as const });
      })
  );
}
