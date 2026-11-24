// The search feature's queries (product.md › Search). Each takes the request's ActorTx from
// withActorTx, so row-level security applies to every one, and is the only thing deciding
// reach: Public channels and the Private channels the actor is in, Admins included. Matching
// uses the generated `search` vectors and their GIN indexes, which leave out Mentions, so a
// person's name never matches; deleted Thread Responses are left out by hand, and deleted
// Threads are gone.
import type {
  ChannelSearchResult,
  SearchPerson,
  SearchStatus,
  SearchThreadsQuery,
  ThreadAuthor,
  ThreadSearchPage,
} from '@ping/shared';
import { and, asc, desc, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import { threadRowColumns, toThreadRow } from '../../db/thread-row';
import type { ChannelAccess } from '../../permissions/channel';
import type { SearchTerms } from './search-terms';
import { MATCH_START, MATCH_STOP, toSnippet } from './snippet';

const { channel, channelMember, staffMember, thread, threadResponse, user } = schema;

/** How many Channels a search answers with: Spark has far fewer that match. */
const CHANNEL_RESULTS_MAX = 50;

/**
 * ts_headline's settings: a passage around the match, marked for toSnippet. A short text
 * shows whole; the row clamps a long one to three lines.
 */
const HEADLINE_OPTIONS = `MaxWords=35, MinWords=25, ShortWord=2, StartSel=${MATCH_START}, StopSel=${MATCH_STOP}`;

/**
 * The tsquery for the typed terms: every word stemmed, and the last as a prefix, stemmed
 * or as typed ('simple' keeps stop words and doesn't stem). An empty part drops out.
 */
const tsquery = ({ words, last }: SearchTerms) =>
  sql`(to_tsquery('english', ${words}) && (to_tsquery('english', ${last}) || to_tsquery('simple', ${last})))`;

/** A ts_headline of `text`, with the marker characters taken out of the text first. */
const headlineSql = (text: SQL | typeof thread.bodyText, query: SearchTerms) =>
  sql<string>`ts_headline('english', translate(${text}, ${MATCH_START + MATCH_STOP}, ''), ${tsquery(query)}, ${HEADLINE_OPTIONS})`;

/**
 * The Channel In names, as the permissions module needs it. Undefined when it's missing or
 * hidden.
 */
export async function findSearchChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<ChannelAccess | undefined> {
  const [row] = await tx
    .select({
      visibility: channel.visibility,
      isMember: sql<boolean>`${channelMember.staffId} is not null`,
    })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(eq(channel.id, channelId));
  return row;
}

/** Channels whose name or description match, by Latest activity, newest first. */
export async function searchChannels(
  { tx, actor }: ActorTx,
  query: SearchTerms,
): Promise<ChannelSearchResult[]> {
  const latestActivityAt = sql<Date>`coalesce((
    select max(${thread.latestActivityAt}) from ${thread} where ${thread.channelId} = ${channel.id}),
    ${channel.createdAt})`;
  const rows = await tx
    .select({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      visibility: channel.visibility,
      isArchived: sql<boolean>`${channel.archivedAt} is not null`,
      isMember: sql<boolean>`${channelMember.staffId} is not null`,
      latestActivityAt: latestActivityAt.mapWith(channel.createdAt),
    })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(sql`${channel.search} @@ ${tsquery(query)}`)
    .orderBy(desc(latestActivityAt), desc(channel.id))
    .limit(CHANNEL_RESULTS_MAX);
  return rows.map((row) => ({ ...row, latestActivityAt: row.latestActivityAt.toISOString() }));
}

const STATUS: Record<SearchStatus, SQL | undefined> = {
  all: undefined,
  open: isNull(thread.resolvedAt),
  resolved: isNotNull(thread.resolvedAt),
};

/** The chips and page, as the route validated them, with the typed text from toSearchTerms. */
type ThreadSearch = Omit<SearchThreadsQuery, 'q'> & { query: SearchTerms };

/** The matched Thread Response, as the query reads it. */
type ResponseHit = {
  id: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorDeactivated: boolean;
  headline: string;
};

/**
 * A page of Threads whose title and description, or one of whose Thread Responses, match,
 * one result each, by Latest activity, newest first (ties by Thread ID). From narrows the
 * match to what that person wrote. A Thread's own match comes first; otherwise the result
 * carries its latest matching Thread Response. `after` is the last Thread of the page
 * before, and `limit` the page's size.
 */
export async function searchThreads(
  { tx, actor }: ActorTx,
  search: ThreadSearch,
): Promise<ThreadSearchPage> {
  const q = tsquery(search.query);
  const threadMatches = and(
    sql`${thread.search} @@ ${q}`,
    search.from ? eq(thread.authorId, search.from) : undefined,
  );
  // Correlated on the outer Thread; r and its joins are this subquery's own.
  const responseMatches = sql`r.thread_id = ${thread.id} and r.deleted_at is null
    and r.search @@ ${q} ${search.from ? sql`and r.author_id = ${search.from}::uuid` : sql``}`;
  const responseHit = sql<ResponseHit | null>`case when ${threadMatches} then null else (
    select json_build_object(
             'id', r.id,
             'createdAt', r.created_at,
             'authorId', r.author_id,
             'authorName', u.name,
             'authorDeactivated', s.deactivated_at is not null,
             'headline', ${headlineSql(sql`r.body_text`, search.query)})
      from ${threadResponse} r
      join ${user} u on u.id = r.author_id
      join ${staffMember} s on s.id = r.author_id
     where ${responseMatches}
     order by r.created_at desc, r.id desc
     limit 1) end`;
  const beyond = search.after
    ? sql`(${thread.latestActivityAt}, ${thread.id}) < (
        select t.latest_activity_at, t.id from ${thread} t where t.id = ${search.after})`
    : undefined;
  const rows = await tx
    .select({
      ...threadRowColumns(actor.staffId),
      channelName: channel.name,
      channelIsArchived: sql<boolean>`${channel.archivedAt} is not null`,
      response: responseHit,
      headline: headlineSql(thread.bodyText, search.query),
    })
    .from(thread)
    .innerJoin(channel, eq(channel.id, thread.channelId))
    .leftJoin(staffMember, eq(staffMember.id, thread.authorId))
    .leftJoin(user, eq(user.id, thread.authorId))
    .where(
      and(
        sql`(${threadMatches} or exists (select 1 from ${threadResponse} r where ${responseMatches}))`,
        search.in ? eq(thread.channelId, search.in) : undefined,
        STATUS[search.status],
        beyond,
      ),
    )
    .orderBy(desc(thread.latestActivityAt), desc(thread.id))
    .limit(search.limit + 1);
  const page = rows.slice(0, search.limit);
  return {
    threads: page.map(({ channelName, channelIsArchived, response, headline, ...columns }) => {
      // toThreadRow writes a System thread's title and folds the author as every Thread
      // list does. Reactions aren't shown on a search result, so whether the actor may react
      // is moot.
      const row = toThreadRow(columns, false);
      return {
        id: row.id,
        channelId: row.channelId,
        channelName,
        channelIsArchived,
        title: row.title,
        author: row.author,
        createdAt: row.createdAt,
        latestActivityAt: row.latestActivityAt,
        resolvedAt: row.resolvedAt,
        response: response
          ? {
              id: response.id,
              author: toAuthor(response),
              createdAt: new Date(response.createdAt).toISOString(),
            }
          : null,
        snippet: toSnippet(response ? response.headline : headline),
      };
    }),
    nextCursor: rows.length > search.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

function toAuthor(hit: ResponseHit): ThreadAuthor {
  return { staffId: hit.authorId, name: hit.authorName, isDeactivated: hit.authorDeactivated };
}

/** Everyone the From chip offers: every Staff member who has joined, Deactivated included. */
export async function listSearchPeople({ tx }: ActorTx): Promise<SearchPerson[]> {
  return tx
    .select({
      staffId: staffMember.id,
      name: user.name,
      isDeactivated: sql<boolean>`${staffMember.deactivatedAt} is not null`,
    })
    .from(staffMember)
    .innerJoin(user, eq(user.id, staffMember.id))
    .where(isNotNull(staffMember.joinedAt))
    .orderBy(asc(user.name), asc(staffMember.id));
}
