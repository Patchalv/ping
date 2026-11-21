// The Staff member routes, mounted at /api/staff: the Admins' Staff members screen, and
// inviting, Resend and Cancel (product.md › Invites). Each route runs signedIn, then
// validate(), then does its work in withActorTx with a require… helper, like the Channel
// exemplar. Invite emails go out after the transaction commits, so a rolled-back invite
// never sends a link; a failed send marks the invite and is reported to Sentry.
import { inviteStaffBody, type StaffMemberView, type StaffState, staffParams } from '@ping/shared';
import { type Context, Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import type { Mailer, SendResult } from '../../lib/email';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { inviteEmail, inviteExpiry, newInviteToken } from '../../lib/invite';
import { rateLimit } from '../../lib/rate-limit';
import { publish } from '../../lib/sse';
import { validate } from '../../lib/validate';
import {
  requireCanListStaffMembers,
  requireCanManageInvites,
  requireCanReadOwnStaffMember,
} from '../../permissions/staff';
import {
  cancelInvite,
  createInvite,
  currentStaffMember,
  findEmailOwnerState,
  findStaffMember,
  listStaffMembers,
  markInviteEmailFailed,
  replaceInvite,
} from './queries';

const EMAIL_IN_USE: Record<StaffState, string> = {
  active: 'Someone with that email is already in Ping.',
  invited: 'That person has already been invited. Resend their invite from the list.',
  // Reactivate arrives with "Staff management and Deactivation" (#35).
  deactivated: 'That email belongs to a Deactivated Staff member.',
};

/** An Invited person as the list shows them, with a fresh invite just sent (or not). */
function invitedView(
  person: Pick<StaffMemberView, 'id' | 'name' | 'email' | 'role'>,
  emailSent: boolean,
): StaffMemberView {
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    state: 'invited',
    invite: { expired: false, emailFailed: !emailSent },
  };
}

/** Postgres's unique_violation: two Admins inviting the same email at once. */
function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}

export function staffRoutes(options: {
  auth: Auth;
  database: Database;
  mailer: Mailer;
  /** The URL people open, for invite links. */
  appUrl: string;
  /** Reports an error the route recovered from (Sentry, in production). */
  reportError(error: unknown, c: Context): void;
}) {
  const { auth, database, mailer, appUrl } = options;
  const withActorTx = createWithActorTx(database);
  // Invite, Resend and Cancel are limited per client IP; the first two send email.
  const inviteLimit = rateLimit({ name: 'staff-invite', max: 30, windowMs: 10 * 60 * 1000 });

  /**
   * Sends the invite email, after the invite's transaction has committed, so a rolled-back
   * invite never sends a link and SMTP never holds a pooled connection open. On failure the
   * invite stays, marked in a second transaction so the list shows "Email not sent,
   * Resend", and the error goes to Sentry. Returns whether it was sent. This is the one
   * deliberate exception to "one withActorTx per route".
   */
  async function sendInvite(
    c: Context<{ Variables: { session: { staffId: string } } }>,
    person: { staffId: string; name: string; email: string; token: string },
  ): Promise<boolean> {
    let result: SendResult;
    try {
      result = await mailer.send(
        inviteEmail({ to: person.email, name: person.name, appUrl, token: person.token }),
      );
    } catch (error) {
      options.reportError(error, c);
      result = 'held';
    }
    if (result === 'sent') return true;
    // Failed, or held back by staging's allowlist (working as configured, so not reported).
    // The invite exists either way: failing to mark it is reported, not a 500.
    await withActorTx(c, (ctx) => markInviteEmailFailed(ctx, person.staffId)).catch(
      (markError: unknown) => options.reportError(markError, c),
    );
    return false;
  }

  return (
    new Hono()
      // The Admins' Staff members screen: everyone, Invited people included.
      .get('/', signedIn(auth), async (c) => {
        const staff = await withActorTx(c, (ctx) => {
          requireCanListStaffMembers(ctx.actor);
          return listStaffMembers(ctx);
        });
        return c.json(staff);
      })

      // The signed-in Staff member's role, so the SPA shows Admin-only controls.
      .get('/me', signedIn(auth), async (c) => {
        const me = await withActorTx(c, async (ctx) => {
          requireCanReadOwnStaffMember(ctx.actor);
          return currentStaffMember(ctx);
        });
        return c.json(me);
      })

      // Invite someone by name, email and role.
      .post(
        '/invites',
        signedIn(auth),
        inviteLimit,
        validate('json', inviteStaffBody),
        async (c) => {
          // Parsed: the email is already lowercased.
          const input = c.req.valid('json');
          const { token, tokenHash } = newInviteToken();
          const staffId = await withActorTx(c, async (ctx) => {
            requireCanManageInvites(ctx.actor);
            const owner = await findEmailOwnerState(ctx, input.email);
            if (owner) throw new ConflictError(EMAIL_IN_USE[owner]);
            return createInvite(ctx, {
              name: input.name,
              email: input.email,
              role: input.role,
              tokenHash,
              expiresAt: inviteExpiry(),
            });
          }).catch((error: unknown) => {
            if (isUniqueViolation(error)) throw new ConflictError(EMAIL_IN_USE.invited);
            throw error;
          });
          publish({ kind: 'staff.changed', staffId });

          const sent = await sendInvite(c, {
            staffId,
            name: input.name,
            email: input.email,
            token,
          });
          return c.json(
            invitedView(
              { id: staffId, name: input.name, email: input.email, role: input.role },
              sent,
            ),
            201,
          );
        },
      )

      // Resend: a new token, which invalidates the old one, and a new email.
      .post(
        '/:staffId/invite/resend',
        signedIn(auth),
        inviteLimit,
        validate('param', staffParams),
        async (c) => {
          const { staffId } = c.req.valid('param');
          const { token, tokenHash } = newInviteToken();
          const person = await withActorTx(c, async (ctx) => {
            requireCanManageInvites(ctx.actor);
            const found = await findStaffMember(ctx, staffId);
            if (!found) throw new NotFoundError();
            if (found.state !== 'invited') throw new ConflictError('They’ve already joined Ping.');
            // Checked again under the row lock: they may have joined since `found` was read.
            if (!(await replaceInvite(ctx, { staffId, tokenHash, expiresAt: inviteExpiry() }))) {
              throw new ConflictError('They’ve already joined Ping.');
            }
            return found;
          });
          publish({ kind: 'staff.changed', staffId });

          const sent = await sendInvite(c, {
            staffId,
            name: person.name,
            email: person.email,
            token,
          });
          return c.json(invitedView(person, sent));
        },
      )

      // Cancel: hard-deletes the Invited person, who has written nothing.
      .delete(
        '/:staffId/invite',
        signedIn(auth),
        inviteLimit,
        validate('param', staffParams),
        async (c) => {
          const { staffId } = c.req.valid('param');
          await withActorTx(c, async (ctx) => {
            requireCanManageInvites(ctx.actor);
            const found = await findStaffMember(ctx, staffId);
            if (!found) throw new NotFoundError();
            if (!(await cancelInvite(ctx, staffId))) {
              throw new ConflictError('They’ve already joined Ping. Deactivate them instead.');
            }
          });
          publish({ kind: 'staff.changed', staffId });
          return c.body(null, 204);
        },
      )
  );
}
