// bootstrap-admin (product.md › The first Admin): invites the first Admin, as ping_system,
// because no Staff member exists to do it. It sends the normal invite email and never sets
// a password. It refuses if any Admin exists, active or Invited; a Deactivated one doesn't
// count. Run once, by Patrick, through `fly ssh console` (src/db/cli/bootstrap-admin.ts).
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
  constructor() {
    super('An Admin already exists, active or Invited. Invite people from the app instead.');
    this.name = 'BootstrapRefusedError';
  }
}

export async function bootstrapAdmin(
  deps: { systemActions: SystemActions; mailer: Mailer; appUrl: string },
  raw: { name: string; email: string },
): Promise<
  { staffId: string; emailSent: true } | { staffId: string; emailSent: false; link: string }
> {
  const parsed = inviteStaffBody.safeParse({ ...raw, role: 'admin' });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(' '));
  const { name, email } = parsed.data;
  const { token, tokenHash } = newInviteToken();
  const { db } = deps.systemActions;

  const staffId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`);
    const admins = await tx
      .select({ id: staffMember.id })
      .from(staffMember)
      .where(and(eq(staffMember.role, 'admin'), isNull(staffMember.deactivatedAt)))
      .limit(1);
    if (admins.length > 0) throw new BootstrapRefusedError();

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
    return created.id;
  });

  // After the commit, like the Admin's invite route.
  try {
    await deps.mailer.send(inviteEmail({ to: email, name, appUrl: deps.appUrl, token }));
    return { staffId, emailSent: true };
  } catch {
    await db
      .update(staffInvite)
      .set({ emailFailedAt: new Date() })
      .where(eq(staffInvite.staffId, staffId));
    // No Admin can sign in to Resend yet, so the operator gets the link instead.
    return { staffId, emailSent: false, link: inviteLink(deps.appUrl, token) };
  }
}
