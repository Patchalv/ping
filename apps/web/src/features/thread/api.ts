// The Thread feature's API: a query-key factory and hooks only. Components use these
// hooks and never call hc or read a response themselves.
import type { StartThreadBody, ThreadPage, ThreadView } from '@ping/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { call } from '../../lib/api-client';

const threads = api.api.channels[':channelId'].threads;

/**
 * The query keys. Exported so live updates (#47) can refetch a Channel's Threads.
 * @public
 */
export const threadKeys = {
  all: ['threads'] as const,
  list: (channelId: string) => [...threadKeys.all, 'list', channelId] as const,
  detail: (channelId: string, threadId: string) =>
    [...threadKeys.all, 'detail', channelId, threadId] as const,
};

/** A Channel's Thread list, by Latest activity, 50 at a time with Load more. */
export function useThreads(channelId: string) {
  return useInfiniteQuery({
    queryKey: threadKeys.list(channelId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }): Promise<ThreadPage> =>
      call(() =>
        threads.$get({ param: { channelId }, query: pageParam ? { after: pageParam } : {} }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One Thread. A missing one, or one in a hidden Channel, fails with a 404. */
export function useThread(channelId: string, threadId: string) {
  return useQuery({
    queryKey: threadKeys.detail(channelId, threadId),
    queryFn: (): Promise<ThreadView> =>
      call(() => threads[':threadId'].$get({ param: { channelId, threadId } })),
  });
}

/** Starts a Thread. It then heads its Channel's list, and opens without a refetch. */
export function useStartThread(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StartThreadBody): Promise<ThreadView> =>
      call(() => threads.$post({ param: { channelId }, json: body })),
    onSuccess: (thread) => {
      queryClient.setQueryData(threadKeys.detail(channelId, thread.id), thread);
      return queryClient.invalidateQueries({ queryKey: threadKeys.list(channelId) });
    },
  });
}
