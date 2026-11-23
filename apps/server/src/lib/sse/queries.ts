// What the live-update check reads, in the receiving Staff member's own short transaction:
// row-level security applies, so a Private channel they aren't in reads as missing.
import { and, eq } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';

const { channel, channelMember } = schema;

/** The Channel's visibility and whether the actor is in it, or undefined when hidden. */
export async function findLiveChannelAccess(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<{ visibility: 'public' | 'private'; isMember: boolean } | undefined> {
  const rows = await tx
    .select({ visibility: channel.visibility, memberStaffId: channelMember.staffId })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(eq(channel.id, channelId));
  const row = rows[0];
  return row && { visibility: row.visibility, isMember: row.memberStaffId !== null };
}
