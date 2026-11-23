// The Thread feature's API: a query-key factory and hooks only. Components use these
// hooks and never call hc or read a response themselves.
import type {
  EditThreadBody,
  PingPage,
  PingSummary,
  ReactionList,
  StartThreadBody,
  ThreadPage,
  ThreadResponseBody,
  ThreadResponseList,
  ThreadResponseView,
  ThreadView,
} from '@ping/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { call, callNoContent } from '../../lib/api-client';

const threads = api.api.channels[':channelId'].threads;
const pings = api.api.pings;
const responses = threads[':threadId'].responses;

/**
 * The query keys. Exported so live updates (#47) can refetch a Channel's Threads.
 * @public
 */
export const threadKeys = {
  all: ['threads'] as const,
  list: (channelId: string) => [...threadKeys.all, 'list', channelId] as const,
  detail: (channelId: string, threadId: string) =>
    [...threadKeys.all, 'detail', channelId, threadId] as const,
  responses: (channelId: string, threadId: string) =>
    [...threadKeys.all, 'responses', channelId, threadId] as const,
};

/**
 * The query keys for Pings. Everything that Acknowledges or Pings invalidates `all`, so the
 * Pings view, its badge and the sidebar counts refetch together.
 */
const pingKeys = {
  all: ['pings'] as const,
  list: () => [...pingKeys.all, 'list'] as const,
  summary: () => [...pingKeys.all, 'summary'] as const,
};

/** The Pings view: Threads with a Ping, by latest activity, 50 at a time. */
export function usePings() {
  return useInfiniteQuery({
    queryKey: pingKeys.list(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }): Promise<PingPage> =>
      call(() => pings.$get({ query: pageParam ? { after: pageParam } : {} })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** How many Threads have a Ping: the badge, and each Channel's count. */
export function usePingSummary() {
  return useQuery({
    queryKey: pingKeys.summary(),
    queryFn: (): Promise<PingSummary> => call(() => pings.summary.$get()),
  });
}

/** Marks a Thread read, which Acknowledges its Ping. */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, threadId }: { channelId: string; threadId: string }): Promise<void> =>
      callNoContent(() => threads[':threadId'].ping.$delete({ param: { channelId, threadId } })),
    onSuccess: (_data, { channelId, threadId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: pingKeys.all }),
        queryClient.invalidateQueries({ queryKey: threadKeys.list(channelId) }),
        queryClient.invalidateQueries({ queryKey: threadKeys.detail(channelId, threadId) }),
      ]),
  });
}

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

/** All of a Thread's Thread Responses, oldest first, placeholders included. */
export function useThreadResponses(channelId: string, threadId: string) {
  return useQuery({
    queryKey: threadKeys.responses(channelId, threadId),
    queryFn: (): Promise<ThreadResponseList> =>
      call(() => responses.$get({ param: { channelId, threadId } })),
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

/** Edits a Thread's title and description. Its row shows the new title. */
export function useEditThread(channelId: string, threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EditThreadBody): Promise<ThreadView> =>
      call(() => threads[':threadId'].$patch({ param: { channelId, threadId }, json: body })),
    onSuccess: (thread) => {
      queryClient.setQueryData(threadKeys.detail(channelId, threadId), thread);
      return queryClient.invalidateQueries({ queryKey: threadKeys.list(channelId) });
    },
  });
}

/** Deletes a Thread and its Thread Responses. `onDeleted` moves off it first. */
export function useDeleteThread(
  channelId: string,
  threadId: string,
  { onDeleted }: { onDeleted(): void },
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<void> =>
      callNoContent(() => threads[':threadId'].$delete({ param: { channelId, threadId } })),
    onSuccess: () => {
      onDeleted();
      queryClient.removeQueries({ queryKey: threadKeys.detail(channelId, threadId) });
      queryClient.removeQueries({ queryKey: threadKeys.responses(channelId, threadId) });
      void queryClient.invalidateQueries({ queryKey: pingKeys.all });
      return queryClient.invalidateQueries({ queryKey: threadKeys.list(channelId) });
    },
  });
}

/**
 * Refetches what a Thread Response change touches: the Thread's Thread Responses, and its
 * row (count and Latest activity).
 */
function useRefreshResponses(channelId: string, threadId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: threadKeys.responses(channelId, threadId) }),
      queryClient.invalidateQueries({ queryKey: threadKeys.list(channelId) }),
      queryClient.invalidateQueries({ queryKey: threadKeys.detail(channelId, threadId) }),
      queryClient.invalidateQueries({ queryKey: pingKeys.all }),
    ]);
}

/** Sends a Thread Response. */
export function useSendThreadResponse(channelId: string, threadId: string) {
  const refresh = useRefreshResponses(channelId, threadId);
  return useMutation({
    mutationFn: (body: ThreadResponseBody): Promise<ThreadResponseView> =>
      call(() => responses.$post({ param: { channelId, threadId }, json: body })),
    onSuccess: refresh,
  });
}

/** Edits a Thread Response's body. */
export function useEditThreadResponse(
  channelId: string,
  threadId: string,
  threadResponseId: string,
) {
  const refresh = useRefreshResponses(channelId, threadId);
  return useMutation({
    mutationFn: (body: ThreadResponseBody): Promise<ThreadResponseView> =>
      call(() =>
        responses[':threadResponseId'].$patch({
          param: { channelId, threadId, threadResponseId },
          json: body,
        }),
      ),
    onSuccess: refresh,
  });
}

/** Deletes a Thread Response, leaving its placeholder. */
export function useDeleteThreadResponse(
  channelId: string,
  threadId: string,
  threadResponseId: string,
) {
  const refresh = useRefreshResponses(channelId, threadId);
  return useMutation({
    mutationFn: (): Promise<void> =>
      callNoContent(() =>
        responses[':threadResponseId'].$delete({
          param: { channelId, threadId, threadResponseId },
        }),
      ),
    onSuccess: refresh,
  });
}

/** What a reaction is on: the Thread itself, or one of its Thread Responses. */
export type ReactionTarget = { threadResponseId?: string };

/**
 * Adds or takes back the viewer's reaction to a Thread, or to a Thread Response when
 * `target` names one. Refetches what shows reactions: the Thread, its Thread Responses and
 * its row in the list.
 */
export function useReact(channelId: string, threadId: string, target: ReactionTarget = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ emoji, add }: { emoji: string; add: boolean }): Promise<ReactionList> => {
      const { threadResponseId } = target;
      if (threadResponseId) {
        const param = { channelId, threadId, threadResponseId, emoji };
        const route = responses[':threadResponseId'].reactions[':emoji'];
        return call(() => (add ? route.$put({ param }) : route.$delete({ param })));
      }
      const param = { channelId, threadId, emoji };
      const route = threads[':threadId'].reactions[':emoji'];
      return call(() => (add ? route.$put({ param }) : route.$delete({ param })));
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: threadKeys.detail(channelId, threadId) }),
        queryClient.invalidateQueries({ queryKey: threadKeys.responses(channelId, threadId) }),
        queryClient.invalidateQueries({ queryKey: threadKeys.list(channelId) }),
        queryClient.invalidateQueries({ queryKey: pingKeys.all }),
      ]),
  });
}
