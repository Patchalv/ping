// Mentions, as both the Thread and the Thread Response features keep them (data-model.md ›
// On Threads and Thread Responses). Features don't share code, but both may use db/, like
// reaction-summary.ts. Every query runs in the request's transaction as ping_app, so
// row-level security applies: it refuses a Mention of someone who can't read the Thread.
import {
  type MentionChanges,
  type MentionNames,
  mentionChanges,
  mentionedStaffIds,
  type RichTextDoc,
  type StaffState,
} from '@ping/shared';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Tx } from './index';
import { channelMember, mention, staffMember, threadResponse, user } from './schema';

/** A Thread or a Thread Response: the post a Mention is in. */
export type MentionPost = { threadId: string } | { threadResponseId: string };

const onPost = (post: MentionPost) =>
  'threadId' in post
    ? eq(mention.threadId, post.threadId)
    : eq(mention.threadResponseId, post.threadResponseId);

/** Each newly Mentioned person, as the permissions module needs them, by Staff ID. */
type MentionedPeople = Map<string, { state: StaffState; isMember: boolean }>;

/** What a save will change, and who it newly Mentions, for the permissions module. */
export type MentionPlan = { changes: MentionChanges; people: MentionedPeople };

/**
 * Compares the body's Mention nodes with the post's Mention rows (none for a new post) and
 * looks up everyone it newly Mentions: their state and whether they're in the Channel. A
 * Staff ID with no Staff member behind it is left out of `people`.
 */
export async function planMentions(
  tx: Tx,
  channelId: string,
  post: MentionPost | undefined,
  body: RichTextDoc,
): Promise<MentionPlan> {
  const before = post
    ? (await tx.select({ staffId: mention.staffId }).from(mention).where(onPost(post))).map(
        (row) => row.staffId,
      )
    : [];
  const changes = mentionChanges(before, mentionedStaffIds(body));
  if (changes.added.length === 0) return { changes, people: new Map() };
  const rows = await tx
    .select({
      staffId: staffMember.id,
      state: sql<StaffState>`case
        when ${staffMember.deactivatedAt} is not null then 'deactivated'
        when ${staffMember.joinedAt} is null then 'invited'
        else 'active' end`,
      isMember: sql<boolean>`${channelMember.staffId} is not null`,
    })
    .from(staffMember)
    .leftJoin(
      channelMember,
      and(eq(channelMember.staffId, staffMember.id), eq(channelMember.channelId, channelId)),
    )
    .where(inArray(staffMember.id, changes.added));
  return { changes, people: new Map(rows.map(({ staffId, ...rest }) => [staffId, rest])) };
}

/**
 * Rebuilds a post's Mention rows from a save: adds the newly Mentioned and drops the rest,
 * leaving the others alone so only the added rows are new in this transaction. The fan-out
 * Pings exactly those.
 */
export async function saveMentions(
  tx: Tx,
  post: MentionPost,
  channelId: string,
  changes: MentionChanges,
): Promise<void> {
  if (changes.removed.length > 0) {
    await tx.delete(mention).where(and(onPost(post), inArray(mention.staffId, changes.removed)));
  }
  if (changes.added.length > 0) {
    await tx
      .insert(mention)
      .values(changes.added.map((staffId) => ({ ...post, channelId, staffId })));
  }
}

/** Removes every Mention in a post: deleting a Thread Response takes them with it. */
export async function removeMentions(tx: Tx, post: MentionPost): Promise<void> {
  await tx.delete(mention).where(onPost(post));
}

type MentionPostColumn = typeof mention.threadId | typeof mention.threadResponseId;

/** The current name of everyone Mentioned in the post whose ID is `id`, as JSON. */
export function mentionNamesSql(
  target: MentionPostColumn,
  id: SQL | AnyPgColumn,
): SQL<MentionNames> {
  return sql<MentionNames>`coalesce((
    select jsonb_object_agg(${mention.staffId}, ${user.name})
      from ${mention} join ${user} on ${user.id} = ${mention.staffId}
     where ${target} = ${id}), '{}'::jsonb)`;
}

/** "@You": whether the actor is Mentioned in the Thread or any of its Thread Responses. */
export function mentionsYouSql(threadId: SQL | AnyPgColumn, actorId: string): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from ${mention}
      left join ${threadResponse} on ${threadResponse.id} = ${mention.threadResponseId}
     where ${mention.staffId} = ${actorId}::uuid
       and (${mention.threadId} = ${threadId} or ${threadResponse.threadId} = ${threadId}))`;
}
