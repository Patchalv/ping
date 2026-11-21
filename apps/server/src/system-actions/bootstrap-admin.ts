// bootstrap-admin (product.md › The first Admin): invites the first Admin, as ping_system,
// because no Staff member exists to do it. It sends the normal invite email and never sets
// a password. It refuses if any Admin exists, active or Invited; a Deactivated one doesn't
// count. The one exception: run again for the same, still Invited, Admin, it issues a
// fresh link. Run by Patrick through `fly console` (src/db/cli/bootstrap-admin.ts).
import { inviteStaffBody } from '@ping/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '../db';
import type { Mailer } from '../lib/email';
import { inviteEmail, inviteExpiry, inviteLink, newInviteToken } from '../lib/invite';
import type { SystemActions } from './index';

const { auditEvent, staffInvite, staffMember, user } = schema;

/** Serialises concurrent runs, so two can't both find no Admin. */
const BOOTSTRAP_LOCK = 0x70696e67; // "ping"

export class BootstrapRefusedError extends Error {
  constructor(
    message = 'An Admin already exists, active or Invited. Invite people from the app instead.',
  ) {
    super(message);
    this.name = 'BootstrapRefusedError';
  }
}

export async function bootstrapAdmin(
  deps: { systemActions: SystemActions; mailer: Mailer; appUrl: string },
  raw: { name: string; email: string },
): Promise<
  | { staffId: string; emailSent: true; reissued: boolean }
  | { staffId: string; emailSent: false; reissued: boolean; link: string; error: unknown }
> {
  const parsed = inviteStaffBody.safeParse({ ...raw, role: 'admin' });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(' '));
  const { name, email } = parsed.data;
  const { token, tokenHash } = newInviteToken();
  const { db } = deps.systemActions;

  const { staffId, reissued } = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`);
    const admins = await tx
      .select({ id: staffMember.id, joinedAt: staffMember.joinedAt, email: user.email })
      .from(staffMember)
      .innerJoin(user, eq(user.id, staffMember.id))
      .where(and(eq(staffMember.role, 'admin'), isNull(staffMember.deactivatedAt)));
    const [only] = admins;
    if (only && admins.length === 1 && only.joinedAt === null && only.email === email) {
      // The same person, still Invited: their email went missing or the link expired, and
      // no Admin can sign in to Resend. Replace the token, like Resend (ping_system may
      // insert and delete invites, not rewrite one).
      await tx.delete(staffInvite).where(eq(staffInvite.staffId, only.id));
      await tx
        .insert(staffInvite)
        .values({ staffId: only.id, tokenHash, expiresAt: inviteExpiry() });
      await tx.insert(auditEvent).values({ kind: 'staff_invite_resent', targetStaffId: only.id });
      return { staffId: only.id, reissued: true };
    }
    if (admins.length > 0) throw new BootstrapRefusedError();

    // Refused like the Admin's invite route: say who already has the email.
    const [owner] = await tx
      .select({ joinedAt: staffMember.joinedAt, deactivatedAt: staffMember.deactivatedAt })
      .from(user)
      .leftJoin(staffMember, eq(staffMember.id, user.id))
      .where(sql`lower(${user.email}) = lower(${email})`);
    if (owner) {
      const state = owner.deactivatedAt
        ? 'a Deactivated'
        : owner.joinedAt
          ? 'an active'
          : 'an Invited';
      throw new BootstrapRefusedError(`That email belongs to ${state} Staff member.`);
    }

    const [created] = await tx
      .insert(user)
      .values({ name, email, emailVerified: false })
      .returning({ id: user.id });
    if (!created) throw new Error('Inserting the bootstrap Admin returned no row');
    await tx.insert(staffMember).values({ id: created.id, role: 'admin' });
    await tx
      .insert(staffInvite)
      .values({ staffId: created.id, tokenHash, expiresAt: inviteExpiry() });
    await tx.insert(auditEvent).values({ kind: 'staff_invited', targetStaffId: created.id });
    return { staffId: created.id, reissued: false };
  });

  // After the commit, like the Admin's invite route.
  let error: unknown;
  try {
    const result = await deps.mailer.send(
      inviteEmail({ to: email, name, appUrl: deps.appUrl, token }),
    );
    if (result === 'sent') return { staffId, emailSent: true, reissued };
    // Held back by staging's allowlist: not an error, so nothing for Sentry.
  } catch (sendError) {
    error = sendError;
  }
  // Best effort: the link below matters more than the mark, so a failure here is dropped.
  await db
    .update(staffInvite)
    .set({ emailFailedAt: new Date() })
    .where(eq(staffInvite.staffId, staffId))
    .catch(() => undefined);
  // No Admin can sign in to Resend yet, so the operator gets the link instead. The CLI
  // reports `error` (the mailer's, which never holds the address) to Sentry.
  return { staffId, emailSent: false, reissued, link: inviteLink(deps.appUrl, token), error };
}
