// The Thread Response feature's queries. Each takes the request's ActorTx from
// withActorTx, so row-level security applies to every one: a Private channel the actor
// isn't in, and everything in it, read as missing.
import {
  extractBodyText,
  type RichTextDoc,
  type ThreadResponseView,
  toEditedMark,
} from '@ping/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import {
  type MentionPlan,
  mentionNamesSql,
  planMentions,
  removeMentions,
  saveMentions,
} from '../../db/mention';
import { reactionSummarySql } from '../../db/reaction-summary';
import type { AuditEventKind } from '../../db/schema';
import { canReact } from '../../permissions/reaction';
import type { ThreadChannelAccess } from '../../permissions/thread';
import { canDeleteThreadResponse, canEditThreadResponse } from '../../permissions/thread-response';

const {
  auditEvent,
  channel,
  channelMember,
  mention,
  ping,
  reaction,
  staffMember,
  thread,
  threadResponse,
  user,
} = schema;

/**
 * The Thread's Channel, as the permissions module needs it, when the Thread is in that
 * Channel. Undefined when either is missing or hidden. (The Thread feature has its own;
 * features don't share code.)
 */
export async function findResponseChannel(
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

/** Who sent a Thread Response in this Thread, or undefined when it's missing or deleted. */
export async function findLiveResponseAuthor(
  { tx }: ActorTx,
  threadId: string,
  threadResponseId: string,
): Promise<{ authorId: string } | undefined> {
  const [row] = await tx
    .select({ authorId: threadResponse.authorId })
    .from(threadResponse)
    .where(
      and(
        eq(threadResponse.id, threadResponseId),
        eq(threadResponse.threadId, threadId),
        isNull(threadResponse.deletedAt),
      ),
    );
  return row;
}

/**
 * Sends a Thread Response by the actor, and moves its Thread's Latest activity forward to
 * it, never back. Returns the new Thread Response's ID.
 */
export async function sendThreadResponse(
  { tx, actor }: ActorTx,
  where: { channelId: string; threadId: string },
  body: RichTextDoc,
): Promise<string> {
  const [row] = await tx
    .insert(threadResponse)
    .values({
      threadId: where.threadId,
      channelId: where.channelId,
      authorId: actor.staffId,
      body,
      bodyText: extractBodyText(body),
    })
    .returning({ id: threadResponse.id, createdAt: threadResponse.createdAt });
  if (!row) throw new Error('A sent Thread Response did not insert');
  await tx
    .update(thread)
    .set({ latestActivityAt: sql`greatest(${thread.latestActivityAt}, ${row.createdAt})` })
    .where(eq(thread.id, where.threadId));
  return row.id;
}

/**
 * Who saving this body newly Mentions, checked against the Thread Response's Mention rows
 * (none while it's being sent).
 */
export function planResponseMentions(
  { tx }: ActorTx,
  channelId: string,
  threadResponseId: string | undefined,
  body: RichTextDoc,
): Promise<MentionPlan> {
  const post = threadResponseId === undefined ? undefined : { threadResponseId };
  return planMentions(tx, channelId, post, body);
}

/** Rebuilds the Thread Response's Mention rows from a save, after it's written. */
export function saveResponseMentions(
  { tx }: ActorTx,
  channelId: string,
  threadResponseId: string,
  plan: MentionPlan,
): Promise<void> {
  return saveMentions(tx, { threadResponseId }, channelId, plan.changes);
}

/**
 * Acknowledges the actor's Ping on the Thread by deleting it, if they have one. Row-level
 * security limits the delete to their own.
 */
export async function acknowledgePing({ tx, actor }: ActorTx, threadId: string): Promise<void> {
  await tx.delete(ping).where(and(eq(ping.threadId, threadId), eq(ping.staffId, actor.staffId)));
}

/** Replaces a Thread Response's body, marking who edited it and when. */
export async function editThreadResponse(
  { tx, actor }: ActorTx,
  threadResponseId: string,
  body: RichTextDoc,
): Promise<void> {
  await tx
    .update(threadResponse)
    .set({
      body,
      bodyText: extractBodyText(body),
      editedAt: sql`now()`,
      editedBy: actor.staffId,
    })
    .where(eq(threadResponse.id, threadResponseId));
}

/**
 * Deletes a Thread Response's content for real, keeping the row as the "Thread Response
 * deleted" placeholder. Its reactions and Mentions go with it; Attachments will, as their
 * slice adds them.
 */
export async function deleteThreadResponse(
  { tx, actor }: ActorTx,
  threadResponseId: string,
): Promise<void> {
  await tx
    .update(threadResponse)
    .set({ body: null, bodyText: null, deletedAt: sql`now()`, deletedBy: actor.staffId })
    .where(eq(threadResponse.id, threadResponseId));
  // The row-level security policy lets this remove other people's reactions only once
  // the Thread Response is marked deleted, which the update above has just done.
  await tx.delete(reaction).where(eq(reaction.threadResponseId, threadResponseId));
  await removeMentions(tx, { threadResponseId });
}

/**
 * Records a company Admin changing someone else's Thread Response (product.md › Audit
 * log). Only the author or an Admin gets this far, so a change by anyone else is an
 * Admin's. Never holds the body.
 */
export async function auditAdminChange(
  { tx, actor }: ActorTx,
  kind: Extract<AuditEventKind, 'admin_edited_thread_response' | 'admin_deleted_thread_response'>,
  where: { channelId: string; authorId: string },
): Promise<void> {
  if (where.authorId === actor.staffId) return;
  await tx.insert(auditEvent).values({
    actorId: actor.staffId,
    kind,
    channelId: where.channelId,
    targetStaffId: where.authorId,
  });
}

const editor = alias(user, 'editor');

/**
 * The Thread's Thread Responses as the Thread view shows them, oldest first, with what the
 * actor may do with each; or just one, when `threadResponseId` is given.
 */
export async function listThreadResponses(
  { tx, actor }: ActorTx,
  access: ThreadChannelAccess,
  threadId: string,
  threadResponseId?: string,
): Promise<ThreadResponseView[]> {
  const rows = await tx
    .select({
      id: threadResponse.id,
      threadId: threadResponse.threadId,
      authorId: threadResponse.authorId,
      authorName: user.name,
      authorDeactivated: sql<boolean>`${staffMember.deactivatedAt} is not null`,
      createdAt: threadResponse.createdAt,
      editedAt: threadResponse.editedAt,
      editedBy: threadResponse.editedBy,
      editorName: editor.name,
      body: threadResponse.body,
      deletedAt: threadResponse.deletedAt,
      reactions: reactionSummarySql(reaction.threadResponseId, threadResponse.id, actor.staffId),
      mentionNames: mentionNamesSql(mention.threadResponseId, threadResponse.id),
    })
    .from(threadResponse)
    .innerJoin(staffMember, eq(staffMember.id, threadResponse.authorId))
    .innerJoin(user, eq(user.id, threadResponse.authorId))
    .leftJoin(editor, eq(editor.id, threadResponse.editedBy))
    .where(
      and(
        eq(threadResponse.threadId, threadId),
        threadResponseId ? eq(threadResponse.id, threadResponseId) : undefined,
      ),
    )
    .orderBy(asc(threadResponse.createdAt), asc(threadResponse.id));
  return rows.map((row) => {
    const isDeleted = row.deletedAt !== null;
    const response = { authorId: row.authorId };
    return {
      id: row.id,
      threadId: row.threadId,
      author: { staffId: row.authorId, name: row.authorName, isDeactivated: row.authorDeactivated },
      createdAt: row.createdAt.toISOString(),
      edited: isDeleted ? null : toEditedMark(row),
      // Written only through the allowlist, so it reads back as one.
      body: isDeleted ? null : (row.body as RichTextDoc),
      mentionNames: isDeleted ? {} : row.mentionNames,
      isDeleted,
      reactions: isDeleted ? [] : row.reactions,
      canReact: !isDeleted && canReact(actor, access).allow,
      canEdit: !isDeleted && canEditThreadResponse(actor, access, response).allow,
      canDelete: !isDeleted && canDeleteThreadResponse(actor, access, response).allow,
    };
  });
}
