// The Thread feature's queries. Each takes the request's ActorTx from withActorTx, so
// row-level security applies to every one: a Private channel the actor isn't in, and its
// Threads, read as missing.
import {
  extractBodyText,
  type RichTextDoc,
  THREAD_PAGE_SIZE,
  type ThreadListView,
  type ThreadPage,
  type ThreadView,
  toEditedMark,
} from '@ping/shared';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import { type MentionPlan, mentionNamesSql, planMentions, saveMentions } from '../../db/mention';
import type { AuditEventKind } from '../../db/schema';
import { threadPreviewSql, threadRowColumns, toThreadRow } from '../../db/thread-row';
import { canReact } from '../../permissions/reaction';
import {
  canDeleteThread,
  canEditThread,
  canResolveThread,
  type ResolveAccess,
  type ThreadAuthorship,
} from '../../permissions/thread';
import { canSendThreadResponse } from '../../permissions/thread-response';

const { auditEvent, channel, channelMember, mention, ping, staffMember, thread, user } = schema;

/**
 * The Thread's Channel, as the permissions module needs it, or undefined when it's
 * missing or hidden. (The Channel feature has its own view; features don't share code.)
 */
export async function findThreadChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<ResolveAccess | undefined> {
  const [row] = await tx
    .select({
      visibility: channel.visibility,
      isMember: sql<boolean>`${channelMember.staffId} is not null`,
      isChannelAdmin: sql<boolean>`coalesce(${channelMember.isChannelAdmin}, false)`,
      isArchived: sql<boolean>`${channel.archivedAt} is not null`,
      resolvePolicy: channel.resolvePolicy,
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

/**
 * Who saving this description newly Mentions, checked against the Thread's Mention rows
 * (none while it's being started).
 */
export function planThreadMentions(
  { tx }: ActorTx,
  channelId: string,
  threadId: string | undefined,
  body: RichTextDoc,
): Promise<MentionPlan> {
  return planMentions(tx, channelId, threadId === undefined ? undefined : { threadId }, body);
}

/** Rebuilds the Thread's Mention rows from a save, after the Thread itself is written. */
export function saveThreadMentions(
  { tx }: ActorTx,
  channelId: string,
  threadId: string,
  plan: MentionPlan,
): Promise<void> {
  return saveMentions(tx, { threadId }, channelId, plan.changes);
}

/** The column each sort orders by, with its name for the cursor's subquery. */
const SORT = {
  latest_activity: { column: thread.latestActivityAt, name: sql.raw('latest_activity_at') },
  date_started: { column: thread.createdAt, name: sql.raw('created_at') },
} as const;

/** Which Threads each Status shows. */
const STATUS = {
  open: isNull(thread.resolvedAt),
  resolved: isNotNull(thread.resolvedAt),
  all: undefined,
} as const;

/**
 * A page of one view of the Channel's Threads (product.md › A Channel's Thread list): by
 * Status, with or without the viewer's Pings, by Latest activity or Date started, newest
 * or oldest first, ties by ID. `after` is the last Thread of the page before; the next
 * page starts beyond it, wherever it is now (it may have been resolved since). The Open
 * view also counts the Resolved threads it hides.
 */
export async function listThreads(
  { tx, actor }: ActorTx,
  access: ResolveAccess,
  channelId: string,
  view: ThreadListView & { after?: string | undefined },
): Promise<ThreadPage> {
  const { column, name } = SORT[view.sort];
  const order = view.direction === 'asc' ? asc : desc;
  const beyond = view.after
    ? sql`(${column}, ${thread.id}) ${view.direction === 'asc' ? sql`>` : sql`<`} (
        select t.${name}, t.id from ${thread} t
         where t.id = ${view.after} and t.channel_id = ${channelId})`
    : undefined;
  // Row-level security leaves only the viewer's own Pings to find.
  const withPings =
    view.pings === 'with'
      ? sql`exists (select 1 from ${ping} where ${ping.threadId} = ${thread.id})`
      : undefined;
  const inChannel = eq(thread.channelId, channelId);
  const [rows, resolvedHidden] = await Promise.all([
    tx
      .select({ ...threadRowColumns(actor.staffId), preview: threadPreviewSql })
      .from(thread)
      .leftJoin(staffMember, eq(staffMember.id, thread.authorId))
      .leftJoin(user, eq(user.id, thread.authorId))
      .where(and(inChannel, STATUS[view.status], withPings, beyond))
      .orderBy(order(column), order(thread.id))
      .limit(THREAD_PAGE_SIZE + 1),
    view.status === 'open' ? countResolved(tx, and(inChannel, withPings)) : 0,
  ]);
  const page = rows.slice(0, THREAD_PAGE_SIZE);
  const mayReact = canReact(actor, access).allow;
  return {
    threads: page.map(({ preview, ...row }) => ({
      ...toThreadRow(row, mayReact),
      preview,
    })),
    nextCursor: rows.length > THREAD_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    resolvedHidden,
  };
}

async function countResolved(tx: ActorTx['tx'], where: ReturnType<typeof and>) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(thread)
    .where(and(where, STATUS.resolved));
  return row?.count ?? 0;
}

const editor = alias(user, 'editor');

/**
 * One Thread in the Channel, with what the actor may do with it, or undefined when it's
 * missing, hidden or in another Channel.
 */
export async function findThread(
  { tx, actor }: ActorTx,
  access: ResolveAccess,
  channelId: string,
  threadId: string,
): Promise<ThreadView | undefined> {
  const [row] = await tx
    .select({
      ...threadRowColumns(actor.staffId),
      body: thread.body,
      mentionNames: mentionNamesSql(mention.threadId, thread.id),
      editedAt: thread.editedAt,
      editedBy: thread.editedBy,
      editorName: editor.name,
      pingFirstAt: sql<Date | null>`(
        select ${ping.firstAt} from ${ping}
         where ${ping.threadId} = ${thread.id} and ${ping.staffId} = ${actor.staffId}::uuid)`,
    })
    .from(thread)
    .leftJoin(staffMember, eq(staffMember.id, thread.authorId))
    .leftJoin(user, eq(user.id, thread.authorId))
    .leftJoin(editor, eq(editor.id, thread.editedBy))
    .where(and(eq(thread.id, threadId), eq(thread.channelId, channelId)));
  if (!row) return undefined;
  const { body, mentionNames, editedAt, editedBy, editorName, pingFirstAt, ...rest } = row;
  const authorship = { authorId: rest.authorId };
  return {
    ...toThreadRow(rest, canReact(actor, access).allow),
    // Written only through the allowlist, so it reads back as one.
    body: body as RichTextDoc,
    mentionNames,
    edited: toEditedMark({ authorId: rest.authorId, editedAt, editedBy, editorName }),
    canRespond: canSendThreadResponse(actor, access).allow,
    ping:
      rest.pingCount > 0 && pingFirstAt
        ? { count: rest.pingCount, firstAt: new Date(pingFirstAt).toISOString() }
        : null,
    canResolve: canResolveThread(actor, access, authorship).allow,
    canEdit: canEditThread(actor, access, authorship).allow,
    canDelete: canDeleteThread(actor, access, authorship).allow,
  };
}

/** Who started a Thread in this Channel, or undefined when it's missing or hidden. */
export async function findThreadAuthorship(
  { tx }: ActorTx,
  channelId: string,
  threadId: string,
): Promise<ThreadAuthorship | undefined> {
  const [row] = await tx
    .select({ authorId: thread.authorId })
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
 * Resolves an open Thread, marking who resolved it and when, or reopens a Resolved one.
 * Latest activity doesn't move. Resolving a Resolved thread again keeps its first
 * resolver; reopening an open one changes nothing.
 */
export async function setThreadResolved(
  { tx, actor }: ActorTx,
  channelId: string,
  threadId: string,
  resolved: boolean,
): Promise<void> {
  const target = and(eq(thread.id, threadId), eq(thread.channelId, channelId));
  if (resolved) {
    await tx
      .update(thread)
      .set({ resolvedAt: sql`now()`, resolvedBy: actor.staffId })
      .where(and(target, isNull(thread.resolvedAt)));
  } else {
    await tx
      .update(thread)
      .set({ resolvedAt: null, resolvedBy: null })
      .where(and(target, isNotNull(thread.resolvedAt)));
  }
}

/**
 * Deletes a Thread for real. Its Thread Responses (other people's included) go with it by
 * cascade, and so do all their reactions and Mentions (and the Thread's own); Pings go too
 * (the foreign key cascades); Attachments and Saved entries will, as their slices add them.
 */
export async function deleteThread({ tx }: ActorTx, threadId: string): Promise<void> {
  await tx.delete(thread).where(eq(thread.id, threadId));
}

/**
 * Records a company Admin changing someone else's Thread (product.md › Audit log). Only
 * the author or an Admin gets this far, so a change by anyone else is an Admin's. A System
 * thread is nobody's content, so editing or deleting one records nothing.
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
