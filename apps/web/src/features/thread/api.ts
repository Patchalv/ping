// The Thread feature's API: a query-key factory and hooks only. Components use these
// hooks and never call hc or read a response themselves.
import type {
  AttachmentView,
  EditThreadBody,
  MentionCandidateList,
  PingPage,
  PingSummary,
  ReactionList,
  SavedPage,
  StartThreadBody,
  ThreadListView,
  ThreadPage,
  ThreadResponseBody,
  ThreadResponseList,
  ThreadResponseView,
  ThreadView,
} from '@ping/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { call, callNoContent, sendFormWithProgress } from '../../lib/api-client';

const threads = api.api.channels[':channelId'].threads;
const pings = api.api.pings;
const saved = api.api.saved;
const responses = threads[':threadId'].responses;
const mentionCandidates = api.api.channels[':channelId']['mention-candidates'];
const attachments = api.api.attachments;

/**
 * The query keys. Exported so live updates can refetch a Channel's Threads.
 */
export const threadKeys = {
  all: ['threads'] as const,
  /** Every view of a Channel's Thread list: invalidating this refetches them all. */
  list: (channelId: string) => [...threadKeys.all, 'list', channelId] as const,
  listView: (channelId: string, view: ThreadListView) =>
    [...threadKeys.list(channelId), view] as const,
  detail: (channelId: string, threadId: string) =>
    [...threadKeys.all, 'detail', channelId, threadId] as const,
  responses: (channelId: string, threadId: string) =>
    [...threadKeys.all, 'responses', channelId, threadId] as const,
  /** Who the @ picker offers in a Channel. */
  mentionCandidates: (channelId: string) =>
    [...threadKeys.all, 'mention-candidates', channelId] as const,
};

/**
 * Adds a file while writing in the Channel, with upload progress: it's pending until the
 * Thread or Thread Response is saved with its ID. It goes through XMLHttpRequest, because
 * fetch can't report upload progress; it's a mutation, so a 401 still returns to sign-in.
 */
export function useAddAttachment(channelId: string) {
  const mutation = useMutation({
    mutationFn: ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress: (fraction: number) => void;
    }): Promise<AttachmentView> => {
      const form = new FormData();
      form.set('file', file);
      return sendFormWithProgress(
        `/api/channels/${encodeURIComponent(channelId)}/attachments`,
        form,
        onProgress,
      );
    },
  });
  return (file: File, onProgress: (fraction: number) => void) =>
    mutation.mutateAsync({ file, onProgress });
}

/**
 * Who can be Mentioned in a Channel's Threads: the @ picker's list. It changes only as
 * people join, leave or are Deactivated, so a minute's staleness is fine.
 */
export function useMentionCandidates(channelId: string) {
  return useQuery({
    queryKey: threadKeys.mentionCandidates(channelId),
    queryFn: (): Promise<MentionCandidateList> =>
      call(() => mentionCandidates.$get({ param: { channelId } })),
    staleTime: 60_000,
    select: (list) => list.candidates,
  });
}

/**
 * The query keys for Pings. Everything that Acknowledges or Pings invalidates `all`, so the
 * Pings view, its badge and the sidebar counts refetch together. Live updates do too.
 */
export const pingKeys = {
  all: ['pings'] as const,
  list: () => [...pingKeys.all, 'list'] as const,
  summary: () => [...pingKeys.all, 'summary'] as const,
};

/**
 * The query keys for the Saved view. Saving and removing invalidate `all`; live updates do
 * too.
 */
export const savedKeys = {
  all: ['saved'] as const,
  list: () => [...savedKeys.all, 'list'] as const,
};

/** The Saved view: the Staff member's Saved Threads, newest saved first, 50 at a time. */
export function useSaved() {
  return useInfiniteQuery({
    queryKey: savedKeys.list(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }): Promise<SavedPage> =>
      call(() => saved.$get({ query: pageParam ? { after: pageParam } : {} })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Saves a Thread (which Acknowledges its Ping) or removes it from Saved. Refetches what
 * shows it: the Saved view, the Thread, its row, and the Pings.
 */
export function useSaveThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      channelId,
      threadId,
      save,
    }: {
      channelId: string;
      threadId: string;
      save: boolean;
    }): Promise<void> => {
      const route = threads[':threadId'].saved;
      const param = { channelId, threadId };
      return callNoContent(() => (save ? route.$put({ param }) : route.$delete({ param })));
    },
    onSuccess: (_data, { channelId, threadId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: savedKeys.all }),
        queryClient.invalidateQueries({ queryKey: pingKeys.all }),
        queryClient.invalidateQueries({ queryKey: threadKeys.list(channelId) }),
        queryClient.invalidateQueries({ queryKey: threadKeys.detail(channelId, threadId) }),
      ]),
  });
}

/** Mutes or unmutes one Thread: new Thread Responses in it stop Pinging the Staff member. */
export function useMuteThread(channelId: string, threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mute: boolean): Promise<void> => {
      const route = threads[':threadId'].mute;
      const param = { channelId, threadId };
      return callNoContent(() => (mute ? route.$put({ param }) : route.$delete({ param })));
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: threadKeys.detail(channelId, threadId) }),
  });
}

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

/**
 * One view of a Channel's Thread list, as the Thread list controls choose, 50 at a time
 * with Load more.
 */
export function useThreads(channelId: string, view: ThreadListView) {
  return useInfiniteQuery({
    queryKey: threadKeys.listView(channelId, view),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }): Promise<ThreadPage> =>
      call(() =>
        threads.$get({
          param: { channelId },
          query: pageParam ? { ...view, after: pageParam } : view,
        }),
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

/**
 * Resolves a Thread, or reopens it. It then shows in, or leaves, its Channel's views of
 * Open and Resolved threads.
 */
export function useSetResolved(channelId: string, threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (resolved: boolean): Promise<ThreadView> => {
      const route = threads[':threadId'].resolved;
      const param = { channelId, threadId };
      return call(() => (resolved ? route.$put({ param }) : route.$delete({ param })));
    },
    onSuccess: (thread) => {
      queryClient.setQueryData(threadKeys.detail(channelId, threadId), thread);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: threadKeys.list(channelId) }),
        // The Pings and Saved views show Resolved threads too, marked.
        queryClient.invalidateQueries({ queryKey: pingKeys.list() }),
        queryClient.invalidateQueries({ queryKey: savedKeys.list() }),
      ]);
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

/**
 * Removes an Attachment from the Thread or one of its Thread Responses, leaving its
 * placeholder. Refetches what shows it: the Thread, its Thread Responses and its row.
 */
export function useRemoveAttachment(channelId: string, threadId: string) {
  const refresh = useRefreshResponses(channelId, threadId);
  return useMutation({
    mutationFn: (attachmentId: string): Promise<void> =>
      callNoContent(() => attachments[':attachmentId'].$delete({ param: { attachmentId } })),
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
