import { sql } from 'drizzle-orm';
import type { Tx } from '../db';

/**
 * Calls the make_channel_private system function in the request's transaction: it turns a
 * Public channel Private, starts its System thread and Pings every other active member for
 * it, mutes ignored. The server has already authorised the request. Returns the System
 * thread's ID, or null when nothing changed (the Channel was already Private). Call
 * cleanUpLostAccess after it, in the same transaction, so non-members lose their Pings,
 * Saved Threads and mutes.
 */
export async function makeChannelPrivate(tx: Tx, channelId: string): Promise<string | null> {
  const result = await tx.execute<{ threadId: string | null }>(
    sql`select public.make_channel_private(${channelId}) as "threadId"`,
  );
  return result.rows[0]?.threadId ?? null;
}
