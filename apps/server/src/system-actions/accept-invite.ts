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

async function lookUp(db: Reader, tokenHash: string, lock: boolean): Promise<InviteLookup> {
  const query = db
    .select({
      staffId: staffInvite.staffId,
      expiresAt: staffInvite.expiresAt,
      name: user.name,
      email: user.email,
    })
    .from(staffInvite)
    .innerJoin(user, eq(user.id, staffInvite.staffId))
    .where(eq(staffInvite.tokenHash, tokenHash));
  // A second accept of the same token waits here, then finds the row gone: "used".
  const rows = lock ? await query.for('update', { of: staffInvite }) : await query;
  const row = rows[0];
  if (!row) return { status: 'unknown' };
  if (row.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
  return { status: 'live', staffId: row.staffId, name: row.name, email: row.email };
}

/** The invite a token belongs to, for the set-password page. */
export function findInvite(db: SystemDb, tokenHash: string): Promise<InviteLookup> {
  return lookUp(db, tokenHash, false);
}

/**
 * Accepts the invite in one transaction: sets the password (Better Auth's credential
 * account), marks the email verified, sets joined_at and deletes the invite. Returns what
 * the token found; only a `live` result changed anything. Signing in comes after, once
 * this has committed.
 */
export function acceptInvite(
  db: SystemDb,
  input: { tokenHash: string; passwordHash: string },
): Promise<InviteLookup> {
  return db.transaction(async (tx) => {
    const found = await lookUp(tx, input.tokenHash, true);
    if (found.status !== 'live') return found;
    const { staffId } = found;
    // Better Auth's credential account: account_id is the user's ID.
    await tx
      .insert(account)
      .values({
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
