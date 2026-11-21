// The auth module's queries. Each takes a transaction from withStaffTx or
// withAnonymousTx, except the user lookup, which reads Better Auth's own table.
import { eq, sql } from 'drizzle-orm';
import { type Database, schema, type Tx } from '../db';
import type { Actor } from '../permissions/actor';

const { auditEvent, staffMember, user } = schema;

/**
 * The acting Staff member's role, read through the staff_member policy, which shows a
 * Deactivated (or unknown) Staff member nothing. Undefined means they act for nobody.
 */
export async function findActiveStaffRole(
  tx: Tx,
  staffId: string,
): Promise<Actor['role'] | undefined> {
  const rows = await tx
    .select({ role: staffMember.role })
    .from(staffMember)
    .where(eq(staffMember.id, staffId));
  return rows[0]?.role;
}

/** The staff_member row behind a sign-in, or undefined when there is none. */
export async function findStaffForSignIn(
  tx: Tx,
  staffId: string,
): Promise<{ deactivatedAt: Date | null } | undefined> {
  const rows = await tx
    .select({ deactivatedAt: staffMember.deactivatedAt })
    .from(staffMember)
    .where(eq(staffMember.id, staffId));
  return rows[0];
}

/**
 * Whether the Staff member has joined and isn't Deactivated: only they can reset a
 * password. A row the policy hides counts as not active.
 */
export async function isActiveStaff(tx: Tx, staffId: string): Promise<boolean> {
  const rows = await tx
    .select({ joinedAt: staffMember.joinedAt, deactivatedAt: staffMember.deactivatedAt })
    .from(staffMember)
    .where(eq(staffMember.id, staffId));
  const row = rows[0];
  return Boolean(row?.joinedAt && !row.deactivatedAt);
}

export async function insertAuditEvent(
  tx: Tx,
  event: typeof auditEvent.$inferInsert,
): Promise<void> {
  await tx.insert(auditEvent).values(event);
}

/** The user an email belongs to, matched case-insensitively. Never logged. */
export async function findUserIdByEmail(
  authDb: Database['authDb'],
  email: string,
): Promise<string | undefined> {
  const rows = await authDb
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${email})`);
  return rows[0]?.id;
}
