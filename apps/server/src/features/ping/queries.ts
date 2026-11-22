// The Ping feature's queries. Each takes the request's ActorTx from withActorTx, so
// row-level security applies to every one: the actor reads only their own Pings, in
// Channels they can read.
import { type PingPage, type PingSummary, THREAD_PAGE_SIZE } from '@ping/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import { threadPreviewSql, threadRowColumns, toThreadRow } from '../../db/thread-row';
import { canReact } from '../../permissions/reaction';
import type { ThreadChannelAccess } from '../../permissions/thread';

const { channel, channelMember, ping, staffMember, thread, user } = schema;

/**
 * The Thread's Channel, as the permissions module needs it, when the Thread is in that
 * Channel. Undefined when either is missing or hidden. (Other features have their own;
 * features don't share code.)
 */
export async function findPingChannel(
  { tx, actor }: ActorTx,
  channelId: string,
  threadId: string,
): Promise<ThreadChannelAccess | undefined> {
  const [row] = await tx
    .select({
      visibility: channel.visibility,
      isMember: sql<boolean>`${channelMember.staffId} is not null`,
      isArchived: sql<boolean>`${channel.archivedAt} is not null`,
    })
    .from(thread)
    .innerJoin(channel, eq(channel.id, thread.channelId))
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(and(eq(thread.id, threadId), eq(thread.channelId, channelId)));
  return row;
}

/** Marks a Thread read for the actor: deletes their Ping on it, if any. */
export async function markRead({ tx, actor }: ActorTx, threadId: string): Promise<void> {
  await tx.delete(ping).where(and(eq(ping.threadId, threadId), eq(ping.staffId, actor.staffId)));
}

/**
 * A page of the actor's Threads with a Ping, by the Ping's latest activity, newest first
 * (ties by Thread ID). `after` is the last Thread of the page before.
 */
export async function listPings(
  { tx, actor }: ActorTx,
  after: string | undefined,
): Promise<PingPage> {
  const below = after
    ? sql`(${ping.lastAt}, ${ping.threadId}) < (
        select p.last_at, p.thread_id from ${ping} p
         where p.thread_id = ${after} and p.staff_id = ${actor.staffId}::uuid)`
    : undefined;
  const rows = await tx
    .select({
      ...threadRowColumns(actor.staffId),
      preview: threadPreviewSql,
      channelName: channel.name,
      visibility: channel.visibility,
      isMember: sql<boolean>`${channelMember.staffId} is not null`,
      isArchived: sql<boolean>`${channel.archivedAt} is not null`,
    })
    .from(ping)
    .innerJoin(thread, and(eq(thread.id, ping.threadId), eq(thread.channelId, ping.channelId)))
    .innerJoin(channel, eq(channel.id, thread.channelId))
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .leftJoin(staffMember, eq(staffMember.id, thread.authorId))
    .leftJoin(user, eq(user.id, thread.authorId))
    .where(and(eq(ping.staffId, actor.staffId), below))
    .orderBy(desc(ping.lastAt), desc(ping.threadId))
    .limit(THREAD_PAGE_SIZE + 1);
  const page = rows.slice(0, THREAD_PAGE_SIZE);
  return {
    threads: page.map(({ preview, channelName, visibility, isMember, isArchived, ...row }) => ({
      ...toThreadRow(row, canReact(actor, { visibility, isMember, isArchived }).allow),
      preview,
      channelName,
    })),
    nextCursor: rows.length > THREAD_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
  };
}

/** How many Threads have a Ping for the actor: in all, and in each Channel. */
export async function summarisePings({ tx, actor }: ActorTx): Promise<PingSummary> {
  const rows = await tx
    .select({ channelId: ping.channelId, count: sql<number>`count(*)::int` })
    .from(ping)
    .where(eq(ping.staffId, actor.staffId))
    .groupBy(ping.channelId);
  return {
    threadCount: rows.reduce((total, row) => total + row.count, 0),
    channels: rows,
  };
}
