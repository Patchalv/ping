// The Staff member feature's queries. Each takes the request's ActorTx from withActorTx,
// so row-level security applies: only an Admin can see or write staff_invite, write
// staff_member, or delete an Invited person.
import type { CurrentStaffMember, StaffMemberView, StaffRole, StaffState } from '@ping/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';

const { auditEvent, staffInvite, staffMember, user } = schema;

const stateOf = (row: { joinedAt: Date | null; deactivatedAt: Date | null }): StaffState =>
  row.deactivatedAt ? 'deactivated' : row.joinedAt ? 'active' : 'invited';

/** Every Staff member, Invited ones included, by name. */
export async function listStaffMembers(
  { tx }: ActorTx,
  staffId?: string,
): Promise<StaffMemberView[]> {
  const rows = await tx
    .select({
      id: staffMember.id,
      name: user.name,
      email: user.email,
      role: staffMember.role,
      joinedAt: staffMember.joinedAt,
      deactivatedAt: staffMember.deactivatedAt,
      inviteExpired: sql<boolean | null>`${staffInvite.expiresAt} <= now()`,
      emailFailedAt: staffInvite.emailFailedAt,
    })
    .from(staffMember)
    .innerJoin(user, eq(user.id, staffMember.id))
    .leftJoin(staffInvite, eq(staffInvite.staffId, staffMember.id))
    .where(staffId ? eq(staffMember.id, staffId) : undefined)
    .orderBy(asc(user.name), asc(staffMember.id));
  return rows.map((row) => {
    const state = stateOf(row);
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      state,
      invite:
        state === 'invited'
          ? { expired: row.inviteExpired ?? true, emailFailed: row.emailFailedAt !== null }
          : null,
    };
  });
}

export async function findStaffMember(
  ctx: ActorTx,
  staffId: string,
): Promise<StaffMemberView | undefined> {
  return (await listStaffMembers(ctx, staffId))[0];
}

/** The actor's own Staff member row. */
export function currentStaffMember({ actor }: ActorTx): CurrentStaffMember {
  return { id: actor.staffId, role: actor.role };
}

/** The state of whoever already has this email, matched case-insensitively. */
export async function findEmailOwnerState(
  { tx }: ActorTx,
  email: string,
): Promise<StaffState | undefined> {
  const rows = await tx
    .select({
      staffId: staffMember.id,
      joinedAt: staffMember.joinedAt,
      deactivatedAt: staffMember.deactivatedAt,
    })
    .from(user)
    .leftJoin(staffMember, eq(staffMember.id, user.id))
    .where(sql`lower(${user.email}) = lower(${email})`);
  const row = rows[0];
  if (!row) return undefined;
  // A user with no Staff member can't be listed or Resent, so call it taken, not Invited.
  return row.staffId === null ? 'active' : stateOf(row);
}

/**
 * Creates the Invited person: Better Auth's user (with no password), their Staff member
 * and their invite, with an audit record. Returns their ID.
 */
export async function createInvite(
  { tx, actor }: ActorTx,
  input: { name: string; email: string; role: StaffRole; tokenHash: string; expiresAt: Date },
): Promise<string> {
  const [created] = await tx
    .insert(user)
    .values({ name: input.name, email: input.email, emailVerified: false })
    .returning({ id: user.id });
  if (!created) throw new Error('Inserting the invited user returned no row');
  await tx
    .insert(staffMember)
    .values({ id: created.id, role: input.role, invitedBy: actor.staffId });
  await tx.insert(staffInvite).values({
    staffId: created.id,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    createdBy: actor.staffId,
  });
  await tx
    .insert(auditEvent)
    .values({ actorId: actor.staffId, kind: 'staff_invited', targetStaffId: created.id });
  return created.id;
}

/**
 * Locks an Invited person's Staff member row for the rest of the transaction, and says
 * whether they are still Invited. Resend and Cancel take it before touching the invite,
 * the same order as accepting, so a Resend racing an accept waits and then sees them
 * joined, instead of leaving a live invite behind.
 */
async function lockInvited(tx: ActorTx['tx'], staffId: string): Promise<boolean> {
  const rows = await tx
    .select({ joinedAt: staffMember.joinedAt, deactivatedAt: staffMember.deactivatedAt })
    .from(staffMember)
    .where(eq(staffMember.id, staffId))
    .for('update');
  const row = rows[0];
  return row !== undefined && row.joinedAt === null && row.deactivatedAt === null;
}

/**
 * Replaces an Invited person's token (Resend): the old one stops working. Returns false,
 * changing nothing, when they are no longer Invited.
 */
export async function replaceInvite(
  { tx, actor }: ActorTx,
  input: { staffId: string; tokenHash: string; expiresAt: Date },
): Promise<boolean> {
  if (!(await lockInvited(tx, input.staffId))) return false;
  const fresh = {
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    createdBy: actor.staffId,
    createdAt: new Date(),
    emailFailedAt: null,
  };
  await tx
    .insert(staffInvite)
    .values({ staffId: input.staffId, ...fresh })
    .onConflictDoUpdate({ target: staffInvite.staffId, set: fresh });
  await tx
    .insert(auditEvent)
    .values({ actorId: actor.staffId, kind: 'staff_invite_resent', targetStaffId: input.staffId });
  return true;
}

/**
 * Changes the actor's own display name. Names live only on `user` and every screen reads
 * them at view time, so the new name shows everywhere at once.
 */
export async function changeOwnName({ tx, actor }: ActorTx, name: string): Promise<void> {
  await tx.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, actor.staffId));
}

/**
 * Who an email address belongs to, matched case-insensitively: `self`, `taken` (by anyone
 * else, Invited and Deactivated people included), or undefined when it's free.
 */
export async function findEmailOwner(
  { tx, actor }: ActorTx,
  email: string,
): Promise<'self' | 'taken' | undefined> {
  const rows = await tx
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${email})`);
  const row = rows[0];
  if (!row) return undefined;
  return row.id === actor.staffId ? 'self' : 'taken';
}

/** Records that the actor asked for an email-change link. Never the addresses. */
export async function recordEmailChangeRequested({ tx, actor }: ActorTx): Promise<void> {
  await tx.insert(auditEvent).values({
    actorId: actor.staffId,
    kind: 'email_change_requested',
    targetStaffId: actor.staffId,
  });
}

/** Records that the invite email didn't go, so the list shows "Email not sent, Resend". */
export async function markInviteEmailFailed({ tx }: ActorTx, staffId: string): Promise<void> {
  await tx
    .update(staffInvite)
    .set({ emailFailedAt: new Date() })
    .where(eq(staffInvite.staffId, staffId));
}

/**
 * Cancels an invite: deletes the invite, the Staff member and the user, in that order.
 * The staff_member delete goes through its policy, which allows only an Invited person;
 * deleting the user alone would cascade as the owner and skip that check. Returns false,
 * deleting nothing, when the person has joined.
 */
export async function cancelInvite({ tx, actor }: ActorTx, staffId: string): Promise<boolean> {
  if (!(await lockInvited(tx, staffId))) return false;
  await tx.delete(staffInvite).where(eq(staffInvite.staffId, staffId));
  const deleted = await tx
    .delete(staffMember)
    .where(and(eq(staffMember.id, staffId), isNull(staffMember.joinedAt)))
    .returning({ id: staffMember.id });
  if (deleted.length !== 1) return false;
  await tx.delete(user).where(eq(user.id, staffId));
  await tx
    .insert(auditEvent)
    .values({ actorId: actor.staffId, kind: 'staff_invite_cancelled', targetStaffId: staffId });
  return true;
}
