// Accepting an invite (product.md › Invites), as ping_system: nobody is signed in yet, so
// no Staff member can stand behind the work. The token arrives hashed; it is never stored
// or logged in the clear.
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '../db';
import type { SystemDb } from '../db/system-pool';

const { account, staffInvite, staffMember, user } = schema;

/** What a token finds: a live invite, an expired one, or nothing (unknown or used). */
export type InviteLookup =
  | { status: 'live'; staffId: string; name: string; email: string }
  | { status: 'expired' }
  | { status: 'unknown' };

type Reader = Pick<SystemDb, 'select'>;

/**
 * The invite a token belongs to. Only an Invited person's invite counts: a row left for
 * someone who has joined (or been Deactivated) reads as unknown, so it can never set a
 * second password.
 */
async function lookUp(db: Reader, tokenHash: string): Promise<InviteLookup> {
  const rows = await db
    .select({
      staffId: staffInvite.staffId,
      expiresAt: staffInvite.expiresAt,
      name: user.name,
      email: user.email,
    })
    .from(staffInvite)
    .innerJoin(user, eq(user.id, staffInvite.staffId))
    .innerJoin(staffMember, eq(staffMember.id, staffInvite.staffId))
    .where(
      and(
        eq(staffInvite.tokenHash, tokenHash),
        isNull(staffMember.joinedAt),
        isNull(staffMember.deactivatedAt),
      ),
    );
  const row = rows[0];
  if (!row) return { status: 'unknown' };
  if (row.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
  return { status: 'live', staffId: row.staffId, name: row.name, email: row.email };
}

/** The invite a token belongs to, for the set-password page. */
export function findInvite(db: SystemDb, tokenHash: string): Promise<InviteLookup> {
  return lookUp(db, tokenHash);
}

/**
 * Accepts the invite in one transaction: sets the password (Better Auth's credential
 * account), marks the email verified, sets joined_at and deletes the invite. Returns what
 * the token found; only a `live` result changed anything. Signing in comes after, once
 * this has committed.
 *
 * Locks the Staff member, then the invite: the same order as Resend and Cancel, so they
 * queue rather than deadlock. A second accept of the same token, or one racing a Resend,
 * waits on the Staff member's row and then finds the token no longer live.
 */
export function acceptInvite(
  db: SystemDb,
  input: { tokenHash: string; passwordHash: string },
): Promise<InviteLookup> {
  return db.transaction(async (tx) => {
    const seen = await lookUp(tx, input.tokenHash);
    if (seen.status !== 'live') return seen;
    await tx
      .select({ id: staffMember.id })
      .from(staffMember)
      .where(eq(staffMember.id, seen.staffId))
      .for('update');
    await tx
      .select({ id: staffInvite.staffId })
      .from(staffInvite)
      .where(eq(staffInvite.staffId, seen.staffId))
      .for('update');
    // Read again under the locks: whatever committed meanwhile is now visible.
    const found = await lookUp(tx, input.tokenHash);
    if (found.status !== 'live') return found;
    const { staffId } = found;
    // Better Auth's credential account: account_id is the user's ID.
    await tx.insert(account).values({
      accountId: staffId,
      providerId: 'credential',
      userId: staffId,
      password: input.passwordHash,
    });
    await tx.update(user).set({ emailVerified: true }).where(eq(user.id, staffId));
    await tx
      .update(staffMember)
      .set({ joinedAt: new Date() })
      .where(and(eq(staffMember.id, staffId), isNull(staffMember.joinedAt)));
    await tx.delete(staffInvite).where(eq(staffInvite.staffId, staffId));
    return found;
  });
}
