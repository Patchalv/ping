// The Thread feature's queries. Each takes the request's ActorTx from withActorTx, so
// row-level security applies to every one: a Private channel the actor isn't in, and its
// Threads, read as missing.
import {
  extractBodyText,
  type RichTextDoc,
  THREAD_PAGE_SIZE,
  type ThreadAuthor,
  type ThreadPage,
  type ThreadView,
} from '@ping/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import type { ThreadChannelAccess } from '../../permissions/thread';

const { channel, channelMember, staffMember, thread, user } = schema;

/** How much of the description a Thread row previews. */
const PREVIEW_LENGTH = 240;

/**
 * The Thread's Channel, as the permissions module needs it, or undefined when it's
 * missing or hidden. (The Channel feature has its own view; features don't share code.)
 */
export async function findThreadChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<ThreadChannelAccess | undefined> {
  const [row] = await tx
    .select({
      visibility: channel.visibility,
      isMember: sql<boolean>`${channelMember.staffId} is not null`,
      isArchived: sql<boolean>`${channel.archivedAt} is not null`,
    })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(eq(channel.id, channelId));
  return row;
}

/**
 * Starts an ordinary Thread by the actor. The body has passed the allowlist; its plain
 * text is extracted here, on every save, for search and previews (ADR 0003). Returns the
 * new Thread's ID.
 */
export async function startThread(
  { tx, actor }: ActorTx,
  channelId: string,
  input: { title: string; body: RichTextDoc },
): Promise<string> {
  const [row] = await tx
    .insert(thread)
    .values({
      channelId,
      authorId: actor.staffId,
      title: input.title,
      body: input.body,
      bodyText: extractBodyText(input.body),
    })
    .returning({ id: thread.id });
  if (!row) throw new Error('A started Thread did not insert');
  return row.id;
}

const threadColumns = {
  id: thread.id,
  channelId: thread.channelId,
  title: thread.title,
  isSystem: thread.isSystem,
  createdAt: thread.createdAt,
  latestActivityAt: thread.latestActivityAt,
  authorId: thread.authorId,
  authorName: user.name,
  authorDeactivated: sql<boolean>`${staffMember.deactivatedAt} is not null`,
};

type ThreadColumns = {
  id: string;
  channelId: string;
  title: string;
  isSystem: boolean;
  createdAt: Date;
  latestActivityAt: Date;
  authorId: string | null;
  authorName: string | null;
  authorDeactivated: boolean;
};

function toThread({ authorId, authorName, authorDeactivated, ...row }: ThreadColumns) {
  const author: ThreadAuthor | null =
    authorId === null
      ? null
      : { staffId: authorId, name: authorName ?? '', isDeactivated: authorDeactivated };
  return {
    ...row,
    author,
    createdAt: row.createdAt.toISOString(),
    latestActivityAt: row.latestActivityAt.toISOString(),
  };
}

/**
 * A page of the Channel's Threads by Latest activity, newest first (ties by ID). `after`
 * is the last Thread of the page before; the next page starts below it.
 */
export async function listThreads(
  { tx }: ActorTx,
  channelId: string,
  after: string | undefined,
): Promise<ThreadPage> {
  const below = after
    ? sql`(${thread.latestActivityAt}, ${thread.id}) < (
        select t.latest_activity_at, t.id from ${thread} t
         where t.id = ${after} and t.channel_id = ${channelId})`
    : undefined;
  const rows = await tx
    .select({
      ...threadColumns,
      preview: sql<string>`left(regexp_replace(${thread.bodyText}, '\\s+', ' ', 'g'), ${PREVIEW_LENGTH})`,
    })
    .from(thread)
    .leftJoin(staffMember, eq(staffMember.id, thread.authorId))
    .leftJoin(user, eq(user.id, thread.authorId))
    .where(and(eq(thread.channelId, channelId), below))
    .orderBy(desc(thread.latestActivityAt), desc(thread.id))
    .limit(THREAD_PAGE_SIZE + 1);
  const page = rows.slice(0, THREAD_PAGE_SIZE);
  return {
    threads: page.map(({ preview, ...row }) => ({ ...toThread(row), preview })),
    nextCursor: rows.length > THREAD_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
  };
}

/** One Thread in the Channel, or undefined when it's missing, hidden or in another Channel. */
export async function findThread(
  { tx }: ActorTx,
  channelId: string,
  threadId: string,
): Promise<ThreadView | undefined> {
  const [row] = await tx
    .select({ ...threadColumns, body: thread.body })
    .from(thread)
    .leftJoin(staffMember, eq(staffMember.id, thread.authorId))
    .leftJoin(user, eq(user.id, thread.authorId))
    .where(and(eq(thread.id, threadId), eq(thread.channelId, channelId)));
  if (!row) return undefined;
  const { body, ...rest } = row;
  // Written only through the allowlist, so it reads back as one.
  return { ...toThread(rest), body: body as RichTextDoc };
}
