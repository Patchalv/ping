// The Channel feature's queries. Each takes the request's ActorTx from withActorTx, so
// row-level security applies to every one and the actor always matches app.staff_id: a
// Private channel the actor isn't in reads as missing.
import type { BrowseChannel, ChannelView, SidebarChannel } from '@ping/shared';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';

const { channel, channelMember, staffMember } = schema;

/** A Channel's active members: "member" means an active member, so Deactivated ones don't count. */
const memberCount = sql<number>`(
  select count(*)::int from ${channelMember}
    join ${staffMember} on ${staffMember.id} = ${channelMember.staffId}
   where ${channelMember.channelId} = ${channel.id} and ${staffMember.deactivatedAt} is null)`;

/** A Channel as the actor sees it, or undefined when it's missing or hidden. */
export async function findChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<ChannelView | undefined> {
  const rows = await tx
    .select({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      visibility: channel.visibility,
      memberCount,
      isChannelAdmin: channelMember.isChannelAdmin,
      isArchived: sql<boolean>`${channel.archivedAt} is not null`,
    })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(eq(channel.id, channelId));
  const row = rows[0];
  if (!row) return undefined;
  const { isChannelAdmin, ...rest } = row;
  // The left join finds the actor's own channel_member row, or nothing.
  return { ...rest, isMember: isChannelAdmin !== null, isChannelAdmin: isChannelAdmin ?? false };
}

/**
 * The Channels the actor is a member of, by name. Filtered on their own channel_member
 * rows: row-level security alone would also return every Public channel.
 */
export function listMemberChannels({ tx, actor }: ActorTx): Promise<SidebarChannel[]> {
  return tx
    .select({ id: channel.id, name: channel.name, visibility: channel.visibility })
    .from(channel)
    .innerJoin(channelMember, eq(channelMember.channelId, channel.id))
    .where(eq(channelMember.staffId, actor.staffId))
    .orderBy(asc(channel.name), asc(channel.id));
}

/**
 * Browse channels: every Public channel that isn't Archived (nobody can join those), by
 * name. Filtered on visibility: row-level security alone would also return the actor's
 * Private channels.
 */
export async function listPublicChannels({ tx, actor }: ActorTx): Promise<BrowseChannel[]> {
  const rows = await tx
    .select({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      memberCount,
      actorRow: channelMember.staffId,
    })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(and(eq(channel.visibility, 'public'), isNull(channel.archivedAt)))
    .orderBy(asc(channel.name), asc(channel.id));
  return rows.map(({ actorRow, ...rest }) => ({ ...rest, isMember: actorRow !== null }));
}

/**
 * Adds the actor to a Channel as a plain member. joined_at is left to its default, the
 * transaction's time, which row-level security insists on. Someone already in it is left
 * as they were, joined_at included: it decides who is auto-promoted on a Deactivation.
 */
export async function joinChannel({ tx, actor }: ActorTx, channelId: string): Promise<void> {
  await tx
    .insert(channelMember)
    .values({ channelId, staffId: actor.staffId })
    .onConflictDoNothing();
}

/**
 * Takes the Channel's membership lock for the rest of the transaction. Every change that
 * could leave a Channel without an active Channel admin (leaving now; removing members
 * and Channel admin roles later) takes it before reading who is Channel admin, so two such
 * changes at once can't both see the other's Channel admin still there.
 */
export async function lockChannelMembership({ tx }: ActorTx, channelId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('ping.channel_membership'), hashtext(${channelId}))`,
  );
}

/** Who else is in the Channel: its other active members and active Channel admins. */
export async function countOthersInChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<{ otherActiveMembers: number; otherActiveChannelAdmins: number }> {
  const rows = await tx
    .select({
      otherActiveMembers: sql<number>`count(*)::int`,
      otherActiveChannelAdmins: sql<number>`(count(*) filter (where ${channelMember.isChannelAdmin}))::int`,
    })
    .from(channelMember)
    .innerJoin(staffMember, eq(staffMember.id, channelMember.staffId))
    .where(
      and(
        eq(channelMember.channelId, channelId),
        ne(channelMember.staffId, actor.staffId),
        isNull(staffMember.deactivatedAt),
      ),
    );
  return rows[0] ?? { otherActiveMembers: 0, otherActiveChannelAdmins: 0 };
}

/** Deletes the actor's own membership. */
export async function leaveChannel({ tx, actor }: ActorTx, channelId: string): Promise<void> {
  await tx
    .delete(channelMember)
    .where(and(eq(channelMember.channelId, channelId), eq(channelMember.staffId, actor.staffId)));
}
