// The Channel feature's API: a query-key factory and hooks only. Components use these
// hooks and never call hc or read a response themselves. A mutation invalidates by key,
// so every screen showing that data refetches; live updates (#47) will do the same.
import type { BrowseChannel, ChannelView, CreateChannelBody } from '@ping/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { call } from '../../lib/api-client';

const channels = api.api.channels;

/**
 * The query keys. Exported so other code can refetch "Channel X everywhere": live updates
 * (#47) invalidate by these keys.
 * @public
 */
export const channelKeys = {
  all: ['channels'] as const,
  mine: () => [...channelKeys.all, 'mine'] as const,
  browse: () => [...channelKeys.all, 'browse'] as const,
  detail: (channelId: string) => [...channelKeys.all, 'detail', channelId] as const,
};

/** The Channels the signed-in Staff member is a member of, for the sidebar. */
export function useMyChannels() {
  return useQuery({ queryKey: channelKeys.mine(), queryFn: () => call(() => channels.$get()) });
}

/** One Channel. A Private channel the Staff member isn't in fails with a 404. */
export function useChannel(channelId: string) {
  return useQuery({
    queryKey: channelKeys.detail(channelId),
    queryFn: () => call(() => channels[':channelId'].$get({ param: { channelId } })),
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChannelBody) => call(() => channels.$post({ json: body })),
    onSuccess: (channel: ChannelView) => {
      queryClient.setQueryData(channelKeys.detail(channel.id), channel);
      return queryClient.invalidateQueries({ queryKey: channelKeys.mine() });
    },
  });
}

/** Browse channels: every Public channel, and whether the Staff member is in it. */
export function useBrowseChannels() {
  return useQuery({
    queryKey: channelKeys.browse(),
    queryFn: (): Promise<BrowseChannel[]> => call(() => channels.browse.$get()),
  });
}

/** Joins a Public channel. It then shows in the sidebar's default Channels section. */
export function useJoinChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string): Promise<ChannelView> =>
      call(() => channels[':channelId'].join.$post({ param: { channelId } })),
    onSuccess: (channel) => {
      queryClient.setQueryData(channelKeys.detail(channel.id), channel);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: channelKeys.mine() }),
        queryClient.invalidateQueries({ queryKey: channelKeys.browse() }),
      ]);
    },
  });
}

/**
 * Leaves a Channel. A Public one stays readable, so its view refetches. A Private one is
 * gone at once: `onLeft` runs first, so the screen can move off it, then its cached view
 * is dropped rather than refetched into a 404.
 */
export function useLeaveChannel({ onLeft }: { onLeft(): void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (channel: Pick<ChannelView, 'id' | 'visibility'>): Promise<void> => {
      await call(async () => {
        const res = await channels[':channelId'].leave.$post({ param: { channelId: channel.id } });
        // 204: no body to read.
        return {
          ok: res.ok,
          status: res.status,
          json: () => (res.ok ? Promise.resolve() : res.json()),
        };
      });
    },
    onSuccess: (_nothing, channel) => {
      onLeft();
      const detail = channelKeys.detail(channel.id);
      if (channel.visibility === 'private') queryClient.removeQueries({ queryKey: detail });
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: channelKeys.mine() }),
        queryClient.invalidateQueries({ queryKey: channelKeys.browse() }),
        channel.visibility === 'private'
          ? undefined
          : queryClient.invalidateQueries({ queryKey: detail }),
      ]);
    },
  });
}
