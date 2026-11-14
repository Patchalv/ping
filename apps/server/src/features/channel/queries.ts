// The Channel feature's queries. Each takes the request's transaction from withStaffTx, so
// row-level security applies to every one: a Private channel the actor isn't in reads as
// missing.
import type { ChannelView, SidebarChannel } from '@ping/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '../../db';

const { channel, channelMember, staffMember } = schema;

/**
 * A Channel as the actor sees it, or undefined when it's missing or hidden. The member
 * count leaves out Deactivated Staff members: "member" means an active member.
 */
export async function findChannel(
  tx: Tx,
  channelId: string,
  staffId: string,
): Promise<ChannelView | undefined> {
  const rows = await tx
    .select({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      visibility: channel.visibility,
      memberCount: sql<number>`(
        select count(*)::int from ${channelMember}
          join ${staffMember} on ${staffMember.id} = ${channelMember.staffId}
         where ${channelMember.channelId} = ${channel.id} and ${staffMember.deactivatedAt} is null)`,
      isChannelAdmin: channelMember.isChannelAdmin,
    })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, staffId)),
    )
    .where(eq(channel.id, channelId));
  const row = rows[0];
  if (!row) return undefined;
  const { isChannelAdmin, ...rest } = row;
  // The left join finds the actor's own channel_member row, or nothing.
  return { ...rest, isMember: isChannelAdmin !== null, isChannelAdmin: isChannelAdmin ?? false };
}

/**
 * The Channels the Staff member is a member of, by name. Filtered on their own
 * channel_member rows: row-level security alone would also return every Public channel.
 */
export function listMemberChannels(tx: Tx, staffId: string): Promise<SidebarChannel[]> {
  return tx
    .select({ id: channel.id, name: channel.name, visibility: channel.visibility })
    .from(channel)
    .innerJoin(channelMember, eq(channelMember.channelId, channel.id))
    .where(eq(channelMember.staffId, staffId))
    .orderBy(asc(channel.name), asc(channel.id));
}
