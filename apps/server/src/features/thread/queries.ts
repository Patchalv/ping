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
  toEditedMark,
} from '@ping/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import type { AuditEventKind } from '../../db/schema';
import { canDeleteThread, canEditThread, type ThreadChannelAccess } from '../../permissions/thread';
import { canSendThreadResponse } from '../../permissions/thread-response';

const { auditEvent, channel, channelMember, staffMember, thread, threadResponse, user } = schema;

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
  // Deleted ones count: their placeholders still show in the Thread.
  responseCount: sql<number>`(
    select count(*)::int from ${threadResponse} where ${threadResponse.threadId} = ${thread.id})`,
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
  responseCount: number;
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

const editor = alias(user, 'editor');

/**
 * One Thread in the Channel, with what the actor may do with it, or undefined when it's
 * missing, hidden or in another Channel.
 */
export async function findThread(
  { tx, actor }: ActorTx,
  access: ThreadChannelAccess,
  channelId: string,
  threadId: string,
): Promise<ThreadView | undefined> {
  const [row] = await tx
    .select({
      ...threadColumns,
      body: thread.body,
      editedAt: thread.editedAt,
      editedBy: thread.editedBy,
      editorName: editor.name,
    })
    .from(thread)
    .leftJoin(staffMember, eq(staffMember.id, thread.authorId))
    .leftJoin(user, eq(user.id, thread.authorId))
    .leftJoin(editor, eq(editor.id, thread.editedBy))
    .where(and(eq(thread.id, threadId), eq(thread.channelId, channelId)));
  if (!row) return undefined;
  const { body, editedAt, editedBy, editorName, ...rest } = row;
  const authorship = { authorId: rest.authorId, isSystem: rest.isSystem };
  return {
    ...toThread(rest),
    // Written only through the allowlist, so it reads back as one.
    body: body as RichTextDoc,
    edited: toEditedMark({ authorId: rest.authorId, editedAt, editedBy, editorName }),
    canRespond: canSendThreadResponse(actor, access).allow,
    canEdit: canEditThread(actor, access, authorship).allow,
    canDelete: canDeleteThread(actor, access, authorship).allow,
  };
}

/** Who started a Thread in this Channel, or undefined when it's missing or hidden. */
export async function findThreadAuthorship(
  { tx }: ActorTx,
  channelId: string,
  threadId: string,
): Promise<{ authorId: string | null; isSystem: boolean } | undefined> {
  const [row] = await tx
    .select({ authorId: thread.authorId, isSystem: thread.isSystem })
    .from(thread)
    .where(and(eq(thread.id, threadId), eq(thread.channelId, channelId)));
  return row;
}

/** Replaces a Thread's title and description, marking who edited it and when. */
export async function editThread(
  { tx, actor }: ActorTx,
  threadId: string,
  input: { title: string; body: RichTextDoc },
): Promise<void> {
  await tx
    .update(thread)
    .set({
      title: input.title,
      body: input.body,
      bodyText: extractBodyText(input.body),
      editedAt: sql`now()`,
      editedBy: actor.staffId,
    })
    .where(eq(thread.id, threadId));
}

/**
 * Deletes a Thread for real. Its Thread Responses (other people's included) go with it by
 * cascade; reactions, Mentions, Attachments, Pings and Saved entries will too, as their
 * slices add them.
 */
export async function deleteThread({ tx }: ActorTx, threadId: string): Promise<void> {
  await tx.delete(thread).where(eq(thread.id, threadId));
}

/**
 * Records a company Admin changing someone else's Thread (product.md › Audit log). Only
 * the author or an Admin gets this far, so a change by anyone else is an Admin's. A System
 * thread is nobody's content, so deleting one records nothing.
 */
export async function auditAdminChange(
  { tx, actor }: ActorTx,
  kind: Extract<AuditEventKind, 'admin_edited_thread' | 'admin_deleted_thread'>,
  where: { channelId: string; authorId: string | null },
): Promise<void> {
  if (where.authorId === null || where.authorId === actor.staffId) return;
  await tx.insert(auditEvent).values({
    actorId: actor.staffId,
    kind,
    channelId: where.channelId,
    targetStaffId: where.authorId,
  });
}
