// The Channel feature's API: a query-key factory and hooks only. Components use these
// hooks and never call hc or read a response themselves. A mutation invalidates by key,
// so every screen showing that data refetches; live updates (#47) will do the same.
import type { ChannelView, CreateChannelBody } from '@ping/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { call } from '../../lib/api-client';

const channels = api.api.channels;

export const channelKeys = {
  all: ['channels'] as const,
  mine: () => [...channelKeys.all, 'mine'] as const,
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
