import { sql } from 'drizzle-orm';
import type { Tx } from '../db';

/**
 * Calls the admin_set_channel_admin system function in the request's transaction: the
 * company Admin in app.staff_id appoints anyone, themself included, as Channel admin of a
 * Public channel (adding them if they aren't a member), or removes the role. The server
 * has already authorised the request. Returns whether a row changed.
 */
export async function adminSetChannelAdmin(
  tx: Tx,
  input: { channelId: string; staffId: string; makeChannelAdmin: boolean },
): Promise<boolean> {
  const result = await tx.execute<{ changed: boolean }>(
    sql`select public.admin_set_channel_admin(${input.channelId}, ${input.staffId}, ${input.makeChannelAdmin}) as changed`,
  );
  return result.rows[0]?.changed ?? false;
}
