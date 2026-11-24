// The search feature's API: a query-key factory and hooks only. Components use these hooks
// and never call hc or read a response themselves.
import type {
  ChannelSearchResults,
  ChannelView,
  SearchPeople,
  SearchStatus,
  ThreadSearchPage,
} from '@ping/shared';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { call } from '../../lib/api-client';

const search = api.api.search;

/** What the Threads tab searches for: the text and the chips. */
export type ThreadSearch = {
  q: string;
  in?: string | undefined;
  from?: string | undefined;
  status: SearchStatus;
};

const searchKeys = {
  all: ['search'] as const,
  channels: (q: string) => [...searchKeys.all, 'channels', q] as const,
  threads: (search: ThreadSearch) => [...searchKeys.all, 'threads', search] as const,
  people: () => [...searchKeys.all, 'people'] as const,
  /** The name a chip shows for a Channel. */
  channel: (channelId: string) => [...searchKeys.all, 'channel', channelId] as const,
};

/** Channels whose name or description match. Waits until something is typed. */
export function useChannelSearch(q: string) {
  return useQuery({
    queryKey: searchKeys.channels(q),
    queryFn: (): Promise<ChannelSearchResults> =>
      call(() => search.channels.$get({ query: { q } })),
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
    queryFn: ({ pageParam }): Promise<ThreadSearchPage> =>
      call(() =>
        search.threads.$get({
          query: {
            q: threadSearch.q,
            status: threadSearch.status,
            ...(threadSearch.in ? { in: threadSearch.in } : {}),
            ...(threadSearch.from ? { from: threadSearch.from } : {}),
            ...(pageParam ? { after: pageParam } : {}),
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: threadSearch.q.trim() !== '',
    placeholderData: keepPreviousData,
  });
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
