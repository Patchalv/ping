// The reaction summary every Thread and Thread Response read carries: one entry per emoji
// with how many reacted and whether the viewer did, in the order each emoji first
// appeared. A correlated subquery, so each feature's own query reads it with its rows
// (features don't share code, but both may use db/).
import type { ReactionSummary } from '@ping/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { reaction } from './schema';

type ReactionTarget = typeof reaction.threadId | typeof reaction.threadResponseId;

/** The JSON array of ReactionSummary for the target whose ID is `id`, as the actor sees it. */
export function reactionSummarySql(
  targetColumn: ReactionTarget,
  id: SQL | AnyPgColumn,
  actorId: string,
): SQL<ReactionSummary[]> {
  return sql<ReactionSummary[]>`coalesce((
    select jsonb_agg(
      jsonb_build_object('emoji', r.emoji, 'count', r.total, 'reacted', r.mine)
      order by r.first_at, r.emoji)
    from (
      select ${reaction.emoji} as emoji,
             count(*)::int as total,
             bool_or(${reaction.staffId} = ${actorId}::uuid) as mine,
             min(${reaction.createdAt}) as first_at
        from ${reaction}
       where ${targetColumn} = ${id}
       group by ${reaction.emoji}) r), '[]'::jsonb)`;
}
