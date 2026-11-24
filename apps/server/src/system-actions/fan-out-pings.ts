import { sql } from 'drizzle-orm';
import type { Tx } from '../db';

/**
 * Calls the fan_out_pings system function in the request's transaction, after the post and
 * its Mention rows are saved. For a new post (the acting Staff member's own, written in
 * this very transaction) it creates or bumps a Ping for every other active member of the
 * Channel and everyone newly Mentioned; for an edit (made by the actor in this transaction)
 * it Pings only the newly Mentioned. The server has already authorised the save. Pass
 * `threadResponseId` for a Thread Response, none for a Thread. Returns how many Pings it
 * created or bumped. Nothing here can tell it who to Ping.
 *
 * If it fails, the transaction rolls back with it, post included.
 */
export async function fanOutPings(
  tx: Tx,
  input: { threadId: string; threadResponseId?: string },
): Promise<number> {
  const result = await tx.execute<{ pinged: number }>(
    sql`select public.fan_out_pings(${input.threadId}, ${input.threadResponseId ?? null}) as pinged`,
  );
  return result.rows[0]?.pinged ?? 0;
}
