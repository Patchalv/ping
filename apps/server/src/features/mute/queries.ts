// The Mute feature's queries. Each takes the request's ActorTx from withActorTx, so
// row-level security applies to every one: the actor reads and writes only their own
// mutes, in Channels they can read.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import type { ThreadChannelAccess } from '../../permissions/thread';

const { channel, channelMember, mute, thread } = schema;

const accessColumns = {
  visibility: channel.visibility,
  isMember: sql<boolean>`${channelMember.staffId} is not null`,
  isArchived: sql<boolean>`${channel.archivedAt} is not null`,
};

/** The Channel, as the permissions module needs it, or undefined when missing or hidden. */
export async function findMuteChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<ThreadChannelAccess | undefined> {
  const [row] = await tx
    .select(accessColumns)
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(eq(channel.id, channelId));
  return row;
}

/**
 * The Thread's Channel, when the Thread is in that Channel; undefined when either is
 * missing or hidden.
 */
export async function findMuteThreadChannel(
  { tx, actor }: ActorTx,
  channelId: string,
  threadId: string,
): Promise<ThreadChannelAccess | undefined> {
  const [row] = await tx
    .select(accessColumns)
    .from(thread)
    .innerJoin(channel, eq(channel.id, thread.channelId))
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(and(eq(thread.id, threadId), eq(thread.channelId, channelId)));
  return row;
}

/**
 * Mutes the Channel for the actor, or one Thread in it when `threadId` is given. Muting
 * twice changes nothing.
 */
export async function addMute(
  { tx, actor }: ActorTx,
  channelId: string,
  threadId: string | null,
): Promise<void> {
  // No conflict target: the unique constraint treats nulls as equal, which arbiter
  // inference wouldn't pick up.
  await tx
    .insert(mute)
    .values({ staffId: actor.staffId, channelId, threadId })
    .onConflictDoNothing();
}

/** Unmutes the Channel for the actor, or one Thread in it when `threadId` is given. */
export async function removeMute(
  { tx, actor }: ActorTx,
  channelId: string,
  threadId: string | null,
): Promise<void> {
  await tx
    .delete(mute)
    .where(
      and(
        eq(mute.staffId, actor.staffId),
        eq(mute.channelId, channelId),
        threadId === null ? isNull(mute.threadId) : eq(mute.threadId, threadId),
      ),
    );
}
