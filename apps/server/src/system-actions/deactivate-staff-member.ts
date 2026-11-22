import { sql } from 'drizzle-orm';
import type { Tx } from '../db';

/** A Channel the Deactivation changed: who was promoted to Channel admin, and archiving. */
export type DeactivationChange = {
  channelId: string;
  promotedStaffId: string | null;
  archived: boolean;
};

/**
 * Calls the deactivate_staff_member system function in the request's transaction, after
 * the request has set the Staff member's deactivated_at = now() and deactivated_by. It
 * promotes replacement sole Channel admins and archives Channels left with no active
 * members, in every Channel. The function raises, rolling the request back, unless the
 * acting Admin Deactivated `staffId` in this transaction.
 */
export async function deactivateStaffMember(
  tx: Tx,
  staffId: string,
): Promise<DeactivationChange[]> {
  const result = await tx.execute<{
    channel_id: string;
    promoted_staff_id: string | null;
    archived: boolean;
  }>(
    sql`select channel_id, promoted_staff_id, archived from public.deactivate_staff_member(${staffId})`,
  );
  return result.rows.map((row) => ({
    channelId: row.channel_id,
    promotedStaffId: row.promoted_staff_id,
    archived: row.archived,
  }));
}
