// The Reaction feature's queries. Each takes the request's ActorTx from withActorTx, so
// row-level security applies to every one: a Private channel the actor isn't in, and its
// reactions, read as missing.
import type { ReactionSummary } from '@ping/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import { reactionSummarySql } from '../../db/reaction-summary';
import type { ThreadChannelAccess } from '../../permissions/thread';

const { channel, channelMember, ping, reaction, thread, threadResponse } = schema;

/**
 * The Thread's Channel, as the permissions module needs it, when the Thread is in that
 * Channel. Undefined when either is missing or hidden. (The Thread feature has its own;
 * features don't share code.)
 */
export async function findReactionChannel(
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

/** Whether a live (not deleted) Thread Response is in this Thread. */
export async function liveResponseExists(
  { tx }: ActorTx,
  threadId: string,
  threadResponseId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: threadResponse.id })
    .from(threadResponse)
    .where(
      and(
        eq(threadResponse.id, threadResponseId),
        eq(threadResponse.threadId, threadId),
        isNull(threadResponse.deletedAt),
      ),
    );
  return row !== undefined;
}

/** What a reaction is on: the Thread, or one of its Thread Responses. */
export type ReactionTarget =
  | { kind: 'thread'; channelId: string; threadId: string }
  | { kind: 'thread_response'; channelId: string; threadResponseId: string };

/**
 * Acknowledges the actor's Ping on the Thread by deleting it, if they have one. Row-level
 * security limits the delete to their own.
 */
export async function acknowledgePing({ tx, actor }: ActorTx, threadId: string): Promise<void> {
  await tx.delete(ping).where(and(eq(ping.threadId, threadId), eq(ping.staffId, actor.staffId)));
}

/** Adds the actor's reaction. Reacting again with the same emoji changes nothing. */
export async function addReaction(
  { tx, actor }: ActorTx,
  target: ReactionTarget,
  emoji: string,
): Promise<void> {
  await tx
    .insert(reaction)
    .values({
      channelId: target.channelId,
      threadId: target.kind === 'thread' ? target.threadId : null,
      threadResponseId: target.kind === 'thread_response' ? target.threadResponseId : null,
      staffId: actor.staffId,
      emoji,
    })
    .onConflictDoNothing();
}

/** Removes the actor's reaction. Removing one that isn't there changes nothing. */
export async function removeReaction(
  { tx, actor }: ActorTx,
  target: ReactionTarget,
  emoji: string,
): Promise<void> {
  await tx
    .delete(reaction)
    .where(
      and(
        target.kind === 'thread'
          ? eq(reaction.threadId, target.threadId)
          : eq(reaction.threadResponseId, target.threadResponseId),
        eq(reaction.staffId, actor.staffId),
        eq(reaction.emoji, emoji),
      ),
    );
}

/** The target's reactions now, by emoji, as the actor sees them. */
export async function reactionsOf(
  { tx, actor }: ActorTx,
  target: ReactionTarget,
): Promise<ReactionSummary[]> {
  const summary =
    target.kind === 'thread'
      ? reactionSummarySql(reaction.threadId, sql`${target.threadId}::uuid`, actor.staffId)
      : reactionSummarySql(
          reaction.threadResponseId,
          sql`${target.threadResponseId}::uuid`,
          actor.staffId,
        );
  const [row] = await tx.select({ reactions: summary }).from(sql`(select 1) as one`);
  return row?.reactions ?? [];
}
