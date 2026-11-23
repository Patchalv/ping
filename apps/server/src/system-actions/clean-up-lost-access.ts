import { sql } from 'drizzle-orm';
import type { Tx } from '../db';

/**
 * Calls the clean_up_lost_access system function in the request's transaction, after a
 * membership row is deleted: it drops the Section placement of everyone no longer in the
 * Channel, and the Pings of everyone who can no longer read it (a Private channel, and not
 * a member). Leaving a Public channel keeps Pings. Works from the Channel's state, so it
 * can't touch anyone who still has access. Returns how many Pings it dropped.
 */
export async function cleanUpLostAccess(tx: Tx, channelId: string): Promise<number> {
  const result = await tx.execute<{ dropped: number }>(
    sql`select public.clean_up_lost_access(${channelId}) as dropped`,
  );
  return result.rows[0]?.dropped ?? 0;
}
