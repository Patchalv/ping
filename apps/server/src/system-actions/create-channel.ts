import type { ChannelVisibility } from '@ping/shared';
import { sql } from 'drizzle-orm';
import type { Tx } from '../db';

/**
 * Calls the create_channel system function in the request's transaction: it inserts the
 * Channel and its first Channel admin (the Staff member in app.staff_id) together. The
 * server has already authorised the request. Returns the new Channel's ID.
 */
export async function createChannel(
  tx: Tx,
  input: { name: string; description: string; visibility: ChannelVisibility },
): Promise<string> {
  const result = await tx.execute<{ id: string | null }>(
    sql`select public.create_channel(${input.name}, ${input.description}, ${input.visibility}::public.channel_visibility) as id`,
  );
  const id = result.rows[0]?.id;
  // Only when the transaction has no active Staff member, which withStaffTx rules out.
  if (!id)
    throw new Error('create_channel inserted nothing: app.staff_id is not an active Staff member');
  return id;
}
