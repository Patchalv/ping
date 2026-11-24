// The Saved feature's queries. Each takes the request's ActorTx from withActorTx, so
// row-level security applies to every one: the actor reads and writes only their own Saved
// Threads, in Channels they can read.
import { type SavedPage, type SavedSummary, THREAD_PAGE_SIZE } from '@ping/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import { threadPreviewSql, threadRowColumns, toThreadRow } from '../../db/thread-row';
import { canReact } from '../../permissions/reaction';
import type { ThreadChannelAccess } from '../../permissions/thread';

const { channel, channelMember, ping, savedThread, staffMember, thread, user } = schema;

/**
 * The Thread's Channel, as the permissions module needs it, when the Thread is in that
 * Channel. Undefined when either is missing or hidden. (Other features have their own;
 * features don't share code.)
 */
export async function findSavedChannel(
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

/**
 * Saves a Thread for the actor, which Acknowledges their Ping on it. Saving one already
 * Saved keeps its place in the list and still Acknowledges.
 */
export async function saveThread(
  { tx, actor }: ActorTx,
  channelId: string,
  threadId: string,
): Promise<void> {
  await tx
    .insert(savedThread)
    .values({ staffId: actor.staffId, channelId, threadId })
    .onConflictDoNothing();
  await tx.delete(ping).where(and(eq(ping.threadId, threadId), eq(ping.staffId, actor.staffId)));
}

/** Removes a Thread from the actor's Saved list. Any Ping on it stays. */
export async function removeSavedThread({ tx, actor }: ActorTx, threadId: string): Promise<void> {
  await tx
    .delete(savedThread)
    .where(and(eq(savedThread.threadId, threadId), eq(savedThread.staffId, actor.staffId)));
}

/**
 * A page of the actor's Saved Threads, by when each was saved, newest first (ties by
 * Thread ID). `after` is the last Thread of the page before.
 */
export async function listSaved(
  { tx, actor }: ActorTx,
  after: string | undefined,
): Promise<SavedPage> {
  const below = after
    ? sql`(${savedThread.savedAt}, ${savedThread.threadId}) < (
        select s.saved_at, s.thread_id from ${savedThread} s
         where s.thread_id = ${after} and s.staff_id = ${actor.staffId}::uuid)`
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
    .from(savedThread)
    .innerJoin(
      thread,
      and(eq(thread.id, savedThread.threadId), eq(thread.channelId, savedThread.channelId)),
    )
    .innerJoin(channel, eq(channel.id, thread.channelId))
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .leftJoin(staffMember, eq(staffMember.id, thread.authorId))
    .leftJoin(user, eq(user.id, thread.authorId))
    .where(and(eq(savedThread.staffId, actor.staffId), below))
    .orderBy(desc(savedThread.savedAt), desc(savedThread.threadId))
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

/**
 * How many Threads the actor has Saved. It joins what the Saved list joins, so the count
 * always matches what the list shows when paged to its end.
 */
export async function summariseSaved({ tx, actor }: ActorTx): Promise<SavedSummary> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(savedThread)
    .innerJoin(
      thread,
      and(eq(thread.id, savedThread.threadId), eq(thread.channelId, savedThread.channelId)),
    )
    .innerJoin(channel, eq(channel.id, thread.channelId))
    .where(eq(savedThread.staffId, actor.staffId));
  return { count: row?.count ?? 0 };
}
