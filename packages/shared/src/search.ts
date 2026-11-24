// Search: the queries the search routes take, the SPA's search route, and the shapes the
// server answers with (product.md › Search, screens.md › Search).
import { z } from 'zod';
import type { ChannelVisibility } from './channel';
import type { ThreadAuthor } from './thread';

export const SEARCH_TEXT_MAX = 200;

const searchText = z
  .string({ error: 'Type something to search for.' })
  .trim()
  .min(1, 'Type something to search for.')
  .max(SEARCH_TEXT_MAX, `Keep the search to ${SEARCH_TEXT_MAX} characters or fewer.`);

/** The Status chip: Resolved threads are included by default. */
const searchStatus = z.enum(['all', 'open', 'resolved'], {
  error: 'Choose All, Open or Resolved.',
});
export type SearchStatus = z.infer<typeof searchStatus>;

const channelId = z.uuid({ error: 'That isn’t a Channel.' });
const staffId = z.uuid({ error: 'That isn’t a Staff member.' });

/** GET /api/search/channels: Channels whose name or description match. */
export const searchChannelsQuery = z.object({ q: searchText });

/**
 * GET /api/search/threads: Threads whose title, description or a Thread Response match,
 * narrowed by the chips. `after` is the last Thread of the page before, for Load more.
 */
export const searchThreadsQuery = z.object({
  q: searchText,
  in: channelId.optional(),
  from: staffId.optional(),
  status: searchStatus.default('all'),
  after: z.uuid({ error: 'That isn’t a Thread.' }).optional(),
});

export type SearchThreadsQuery = z.infer<typeof searchThreadsQuery>;

const searchTab = z.enum(['all', 'channels', 'threads']);
export type SearchTab = z.infer<typeof searchTab>;

/**
 * The SPA's /search route. A shared link may be garbled, so each part falls back to its
 * default. `near` is the Channel search was opened from: In is only suggested for it,
 * never applied.
 */
export const searchRouteSearch = z.object({
  q: z.string().catch(''),
  tab: searchTab.catch('all'),
  in: channelId.optional().catch(undefined),
  from: staffId.optional().catch(undefined),
  status: searchStatus.catch('all'),
  near: channelId.optional().catch(undefined),
});
export type SearchRouteSearch = z.infer<typeof searchRouteSearch>;

/** A Channel that matched. Times are ISO strings. */
export type ChannelSearchResult = {
  id: string;
  name: string;
  description: string;
  visibility: ChannelVisibility;
  isArchived: boolean;
  isMember: boolean;
  /** The latest activity of any of its Threads, or when it was created. */
  latestActivityAt: string;
};

export type ChannelSearchResults = { channels: ChannelSearchResult[] };

/** Part of a snippet: matched words are marked, never sent as HTML. */
export type SnippetPart = { text: string; match: boolean };

/** One Thread that matched, once, however many of its Thread Responses matched. */
export type ThreadSearchResult = {
  id: string;
  channelId: string;
  channelName: string;
  channelIsArchived: boolean;
  title: string;
  author: ThreadAuthor | null;
  createdAt: string;
  latestActivityAt: string;
  resolvedAt: string | null;
  /**
   * The Thread Response that matched, when the Thread's own title and description didn't:
   * the snippet is from it, and opening the result scrolls to it.
   */
  response: { id: string; author: ThreadAuthor; createdAt: string } | null;
  snippet: SnippetPart[];
};

/** A page of Thread results, by latest activity, newest first. */
export type ThreadSearchPage = {
  threads: ThreadSearchResult[];
  /** Pass as `after` to load the next page; null when this is the last. */
  nextCursor: string | null;
};

/** Someone the From chip can pick: every Staff member who has joined, Deactivated included. */
export type SearchPerson = { staffId: string; name: string; isDeactivated: boolean };

export type SearchPeople = { people: SearchPerson[] };
