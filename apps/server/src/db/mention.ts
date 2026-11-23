// Mentions, as both the Thread and the Thread Response features keep them (data-model.md ›
// On Threads and Thread Responses). Features don't share code, but both may use db/, like
// reaction-summary.ts. Every query runs in the request's transaction as ping_app, so
// row-level security applies: it refuses a Mention of someone who can't read the Thread.
import type { MentionChanges, MentionNames, StaffState } from '@ping/shared';
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

/** Who is Mentioned in a post now, before a save rebuilds its rows. */
export async function findMentionedStaffIds(tx: Tx, post: MentionPost): Promise<string[]> {
  const rows = await tx.select({ staffId: mention.staffId }).from(mention).where(onPost(post));
  return rows.map((row) => row.staffId);
}

/** Who a body Mentions, as the permissions module needs each one, by Staff ID. */
export type MentionTargets = Map<string, { state: StaffState; isMember: boolean }>;

/**
 * The state of each Staff member in `staffIds` and whether they're in the Channel. Someone
 * who isn't a Staff member is left out.
 */
export async function findMentionTargets(
  tx: Tx,
  channelId: string,
  staffIds: readonly string[],
): Promise<MentionTargets> {
  if (staffIds.length === 0) return new Map();
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
    .where(inArray(staffMember.id, [...staffIds]));
  return new Map(rows.map(({ staffId, ...rest }) => [staffId, rest]));
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

type MentionTarget = typeof mention.threadId | typeof mention.threadResponseId;

/** The current name of everyone Mentioned in the target whose ID is `id`, as JSON. */
export function mentionNamesSql(target: MentionTarget, id: SQL | AnyPgColumn): SQL<MentionNames> {
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
