// The columns of a Thread row, as the Channel feed and the Pings view both show it
// (screens.md › Pings and Saved views: "the same Thread rows"). Features don't share code,
// but both may use db/, like reaction-summary.ts. Row-level security applies to every
// subquery, so the viewer's own Ping is the only one it can count.
import type { ReactionSummary, ThreadAuthor } from '@ping/shared';
import { sql } from 'drizzle-orm';
import { mentionsYouSql } from './mention';
import { reactionSummarySql } from './reaction-summary';
import { ping, reaction, staffMember, thread, threadResponse, user } from './schema';

export const threadRowColumns = (actorId: string) => ({
  id: thread.id,
  channelId: thread.channelId,
  title: thread.title,
  isSystem: thread.isSystem,
  createdAt: thread.createdAt,
  latestActivityAt: thread.latestActivityAt,
  resolvedAt: thread.resolvedAt,
  authorId: thread.authorId,
  authorName: user.name,
  authorDeactivated: sql<boolean>`${staffMember.deactivatedAt} is not null`,
  // Deleted ones count: their placeholders still show in the Thread.
  responseCount: sql<number>`(
    select count(*)::int from ${threadResponse} where ${threadResponse.threadId} = ${thread.id})`,
  reactions: reactionSummarySql(reaction.threadId, thread.id, actorId),
  // The viewer's open Ping on the Thread: its count, 0 with none.
  pingCount: sql<number>`coalesce((
    select ${ping.count} from ${ping}
     where ${ping.threadId} = ${thread.id} and ${ping.staffId} = ${actorId}::uuid), 0)::int`,
  mentionsYou: mentionsYouSql(thread.id, actorId),
});

/** How much of the description a Thread row previews. */
const PREVIEW_LENGTH = 240;

/** The start of the description, as plain text. */
export const threadPreviewSql = sql<string>`left(regexp_replace(${thread.bodyText}, '\\s+', ' ', 'g'), ${PREVIEW_LENGTH})`;

export type ThreadRowColumns = {
  id: string;
  channelId: string;
  title: string;
  isSystem: boolean;
  createdAt: Date;
  latestActivityAt: Date;
  resolvedAt: Date | null;
  authorId: string | null;
  authorName: string | null;
  authorDeactivated: boolean;
  responseCount: number;
  reactions: ReactionSummary[];
  pingCount: number;
  mentionsYou: boolean;
};

/** The row as the API answers it: the author folded into one object, times as ISO strings. */
export function toThreadRow(
  { authorId, authorName, authorDeactivated, ...row }: ThreadRowColumns,
  canReactHere: boolean,
) {
  const author: ThreadAuthor | null =
    authorId === null
      ? null
      : { staffId: authorId, name: authorName ?? '', isDeactivated: authorDeactivated };
  return {
    ...row,
    author,
    canReact: canReactHere,
    createdAt: row.createdAt.toISOString(),
    latestActivityAt: row.latestActivityAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}
