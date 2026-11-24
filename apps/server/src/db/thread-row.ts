// The columns of a Thread row, as the Channel feed and the Pings view both show it
// (screens.md › Pings and Saved views: "the same Thread rows"). Features don't share code,
// but both may use db/, like reaction-summary.ts. Row-level security applies to every
// subquery, so the viewer's own Ping and Saved row are the only ones it can see.
import {
  type ReactionSummary,
  type SystemThreadEvent,
  systemThreadTitle,
  type ThreadAuthor,
} from '@ping/shared';
import { sql } from 'drizzle-orm';
import { mentionsYouSql } from './mention';
import { reactionSummarySql } from './reaction-summary';
import { ping, reaction, savedThread, staffMember, thread, threadResponse, user } from './schema';

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
  // A System thread stores the Staff member involved by ID; their name is read now, so it
  // stays current.
  systemKind: thread.systemKind,
  systemStaffId: sql<string | null>`${thread.systemPayload}->>'staffId'`,
  systemStaffName: sql<string | null>`(
    select ${user.name} from ${user} where ${user.id} = (${thread.systemPayload}->>'staffId')::uuid)`,
  // Deleted ones count: their placeholders still show in the Thread.
  responseCount: sql<number>`(
    select count(*)::int from ${threadResponse} where ${threadResponse.threadId} = ${thread.id})`,
  reactions: reactionSummarySql(reaction.threadId, thread.id, actorId),
  // The viewer's open Ping on the Thread: its count, 0 with none.
  pingCount: sql<number>`coalesce((
    select ${ping.count} from ${ping}
     where ${ping.threadId} = ${thread.id} and ${ping.staffId} = ${actorId}::uuid), 0)::int`,
  mentionsYou: mentionsYouSql(thread.id, actorId),
  // Whether the Thread is on the viewer's Saved list.
  isSaved: sql<boolean>`exists (
    select 1 from ${savedThread}
     where ${savedThread.threadId} = ${thread.id} and ${savedThread.staffId} = ${actorId}::uuid)`,
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
  systemKind: (typeof thread.systemKind.enumValues)[number] | null;
  systemStaffId: string | null;
  systemStaffName: string | null;
  responseCount: number;
  reactions: ReactionSummary[];
  pingCount: number;
  mentionsYou: boolean;
  isSaved: boolean;
};

/** The row as the API answers it: the author folded into one object, times as ISO strings. */
export function toThreadRow(
  {
    authorId,
    authorName,
    authorDeactivated,
    systemKind,
    systemStaffId,
    systemStaffName,
    ...row
  }: ThreadRowColumns,
  canReactHere: boolean,
) {
  const author: ThreadAuthor | null =
    authorId === null
      ? null
      : { staffId: authorId, name: authorName ?? '', isDeactivated: authorDeactivated };
  const system = toSystemThreadEvent(systemKind, systemStaffId, systemStaffName);
  return {
    ...row,
    title: system ? systemThreadTitle(system) : row.title,
    author,
    system,
    canReact: canReactHere,
    createdAt: row.createdAt.toISOString(),
    latestActivityAt: row.latestActivityAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * What a System thread announces, from its kind and its payload's Staff member. Archiving
 * and replacing a Deactivated sole Channel admin aren't written yet, so their rows show
 * as stored, with no event.
 */
function toSystemThreadEvent(
  kind: ThreadRowColumns['systemKind'],
  staffId: string | null,
  name: string | null,
): SystemThreadEvent | null {
  if (kind !== 'channel_made_private') return null;
  return { kind, staff: staffId && name !== null ? { staffId, name } : null };
}
