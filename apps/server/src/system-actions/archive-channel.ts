import { sql } from 'drizzle-orm';
import type { Tx } from '../db';

/**
 * Calls the archive_channel system function in the request's transaction: it archives the
 * Channel, starts its System thread and Pings every other active member for it, mutes
 * ignored. The server has already authorised the request. Returns the System thread's ID,
 * or null when nothing changed (the Channel was already Archived).
 */
export async function archiveChannel(tx: Tx, channelId: string): Promise<string | null> {
  const result = await tx.execute<{ threadId: string | null }>(
    sql`select public.archive_channel(${channelId}) as "threadId"`,
  );
  return result.rows[0]?.threadId ?? null;
}

/**
 * Calls the unarchive_channel system function in the request's transaction: it clears
 * archived_at/by. The server has already authorised the request. Returns whether it changed
 * anything.
 */
export async function unarchiveChannel(tx: Tx, channelId: string): Promise<boolean> {
  const result = await tx.execute<{ changed: boolean }>(
    sql`select public.unarchive_channel(${channelId}) as "changed"`,
  );
  return result.rows[0]?.changed ?? false;
}
