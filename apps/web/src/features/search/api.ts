// The search feature's API: a query-key factory and hooks only. Components use these hooks
// and never call hc or read a response themselves.
import type {
  ChannelSearchResults,
  ChannelView,
  SearchPeople,
  SearchThreadsQuery,
  ThreadSearchPage,
} from '@ping/shared';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { call } from '../../lib/api-client';
import { delay } from '../../lib/delay';

const search = api.api.search;

/**
 * How long a search waits for typing to pause. The text is in the URL on every key, so each
 * key starts a query; a query whose text has since changed is aborted during this wait and
 * never reaches the server.
 */
const TYPING_PAUSE_MS = 250;

/** The search dialog's shorter wait: its few results are quick to show. */
const QUICK_PAUSE_MS = 150;

/** What the Threads tab searches for: the text and the chips. */
type ThreadSearch = Omit<SearchThreadsQuery, 'after' | 'limit'>;

const searchKeys = {
  all: ['search'] as const,
  channels: (q: string) => [...searchKeys.all, 'channels', q] as const,
  threads: (search: ThreadSearch) => [...searchKeys.all, 'threads', search] as const,
  /** The dialog's few Threads: kept apart from the screen's pages of 50. */
  quickThreads: (q: string, channelId: string | undefined, limit: number) =>
    [...searchKeys.all, 'quick-threads', { q, channelId, limit }] as const,
  people: () => [...searchKeys.all, 'people'] as const,
  /** The name a chip shows for a Channel. */
  channel: (channelId: string) => [...searchKeys.all, 'channel', channelId] as const,
};

/**
 * Channels whose name or description match. Waits until something is typed, then for
 * typing to pause: the search dialog waits less.
 */
export function useChannelSearch(q: string, pauseMs = TYPING_PAUSE_MS) {
  return useQuery({
    queryKey: searchKeys.channels(q),
    queryFn: async ({ signal }): Promise<ChannelSearchResults> => {
      await delay(pauseMs, signal);
      return call(() => search.channels.$get({ query: { q } }));
    },
    enabled: q.trim() !== '',
    // Typing changes the text on every key: keep the last results until the next arrive.
    placeholderData: keepPreviousData,
  });
}

/** Threads that match, 50 at a time, newest activity first. Waits until something is typed. */
export function useThreadSearch(threadSearch: ThreadSearch) {
  return useInfiniteQuery({
    queryKey: searchKeys.threads(threadSearch),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<ThreadSearchPage> => {
      // Load more is a click, not typing: it doesn't wait.
      if (!pageParam) await delay(TYPING_PAUSE_MS, signal);
      return call(() =>
        search.threads.$get({
          query: {
            q: threadSearch.q,
            status: threadSearch.status,
            ...(threadSearch.in ? { in: threadSearch.in } : {}),
            ...(threadSearch.from ? { from: threadSearch.from } : {}),
            ...(pageParam ? { after: pageParam } : {}),
          },
        }),
      );
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: threadSearch.q.trim() !== '',
    placeholderData: keepPreviousData,
  });
}

/**
 * The search dialog's first few Threads, from every Channel or only `channelId`'s. Waits
 * until something is typed, then for typing to pause.
 */
export function useQuickThreadSearch(q: string, channelId: string | undefined, limit: number) {
  return useQuery({
    queryKey: searchKeys.quickThreads(q, channelId, limit),
    queryFn: async ({ signal }): Promise<ThreadSearchPage> => {
      await delay(QUICK_PAUSE_MS, signal);
      return call(() =>
        search.threads.$get({
          query: { q, limit: String(limit), ...(channelId ? { in: channelId } : {}) },
        }),
      );
    },
    enabled: q.trim() !== '',
    placeholderData: keepPreviousData,
  });
}

/** The search dialog's first few Channels. */
export function useQuickChannelSearch(q: string) {
  return useChannelSearch(q, QUICK_PAUSE_MS);
}

/** Everyone the From chip offers, Deactivated included. */
export function useSearchPeople() {
  return useQuery({
    queryKey: searchKeys.people(),
    queryFn: (): Promise<SearchPeople> => call(() => search.people.$get()),
  });
}

/** A Channel's name, for the In chip and its suggestion. */
export function useChipChannel(channelId: string | undefined) {
  return useQuery({
    queryKey: searchKeys.channel(channelId ?? ''),
    queryFn: (): Promise<ChannelView> =>
      call(() => api.api.channels[':channelId'].$get({ param: { channelId: channelId ?? '' } })),
    enabled: channelId !== undefined,
  });
}
