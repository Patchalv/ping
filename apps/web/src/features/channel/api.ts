// The Channel feature's API: a query-key factory and hooks only. Components use these
// hooks and never call hc or read a response themselves. A mutation invalidates by key,
// so every screen showing that data refetches; live updates do the same.
import type {
  BrowseChannel,
  ChannelMembers,
  ChannelView,
  CreateChannelBody,
  MemberCandidate,
  UpdateChannelBody,
} from '@ping/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { call, callNoContent } from '../../lib/api-client';

const channels = api.api.channels;

/**
 * The query keys. Exported so other code can refetch "Channel X everywhere": live updates
 * invalidate by these keys.
 */
export const channelKeys = {
  all: ['channels'] as const,
  mine: () => [...channelKeys.all, 'mine'] as const,
  browse: () => [...channelKeys.all, 'browse'] as const,
  detail: (channelId: string) => [...channelKeys.all, 'detail', channelId] as const,
  members: (channelId: string) => [...channelKeys.detail(channelId), 'members'] as const,
  candidates: (channelId: string) => [...channelKeys.detail(channelId), 'candidates'] as const,
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
      await callNoContent(() =>
        channels[':channelId'].leave.$post({ param: { channelId: channel.id } }),
      );
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

/** A Channel's Members tab: its members, and which member controls to show. */
export function useChannelMembers(channelId: string) {
  return useQuery({
    queryKey: channelKeys.members(channelId),
    queryFn: (): Promise<ChannelMembers> =>
      call(() => channels[':channelId'].members.$get({ param: { channelId } })),
  });
}

/** The add-members picker: active Staff members who aren't in the Channel. */
export function useMemberCandidates(channelId: string) {
  return useQuery({
    queryKey: channelKeys.candidates(channelId),
    queryFn: (): Promise<MemberCandidate[]> =>
      call(() => channels[':channelId']['member-candidates'].$get({ param: { channelId } })),
  });
}

/**
 * After a membership change the Channel refetches, and with it (by key prefix) its
 * members, the picker and the member count. So do the sidebar and Browse channels, where
 * a company Admin who made themself Channel admin now shows as a member.
 */
function refetchAfterMembershipChange(
  queryClient: ReturnType<typeof useQueryClient>,
  channelId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: channelKeys.detail(channelId) }),
    queryClient.invalidateQueries({ queryKey: channelKeys.mine() }),
    queryClient.invalidateQueries({ queryKey: channelKeys.browse() }),
  ]);
}

/** Adds an active Staff member to the Channel as a plain member. */
export function useAddChannelMember(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (staffId: string): Promise<void> => {
      await callNoContent(() =>
        channels[':channelId'].members.$post({ param: { channelId }, json: { staffId } }),
      );
    },
    onSuccess: () => refetchAfterMembershipChange(queryClient, channelId),
  });
}

/** Removes someone from the Channel (Channel admins only). */
export function useRemoveChannelMember(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (staffId: string): Promise<void> => {
      await callNoContent(() =>
        channels[':channelId'].members[':staffId'].$delete({ param: { channelId, staffId } }),
      );
    },
    onSuccess: () => refetchAfterMembershipChange(queryClient, channelId),
  });
}

/** Appoints someone as Channel admin, or removes the role. */
export function useSetChannelAdmin(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { staffId: string; isChannelAdmin: boolean }): Promise<void> => {
      await callNoContent(() =>
        channels[':channelId'].members[':staffId'].$patch({
          param: { channelId, staffId: input.staffId },
          json: { isChannelAdmin: input.isChannelAdmin },
        }),
      );
    },
    onSuccess: () => refetchAfterMembershipChange(queryClient, channelId),
  });
}

/**
 * Mutes or unmutes a whole Channel the Staff member is in: new Thread Responses stop
 * Pinging them, and its sidebar count turns grey.
 */
export function useMuteChannel(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mute: boolean): Promise<void> => {
      const route = channels[':channelId'].mute;
      const param = { channelId };
      return callNoContent(() => (mute ? route.$put({ param }) : route.$delete({ param })));
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: channelKeys.detail(channelId) }),
        queryClient.invalidateQueries({ queryKey: channelKeys.mine() }),
      ]),
  });
}

/**
 * Changes a Channel's settings (Channel admins only), or turns a Public channel Private.
 * The answer is the Channel as it now is. Its name shows in the sidebar and Browse
 * channels too; a new System thread reaches the feed over live updates.
 */
export function useUpdateChannel(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateChannelBody): Promise<ChannelView> =>
      call(() => channels[':channelId'].$patch({ param: { channelId }, json: body })),
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
 * Archives or unarchives a Channel (Channel admins, and company Admins on a Public channel
 * or a Private one they're in). The answer is the Channel as it now is. Its Threads, and
 * archiving's System thread, refetch over live updates.
 */
export function useSetChannelArchived(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (archived: boolean): Promise<ChannelView> => {
      const route = channels[':channelId'].archived;
      const param = { channelId };
      return call(() => (archived ? route.$put({ param }) : route.$delete({ param })));
    },
    onSuccess: (channel) => {
      queryClient.setQueryData(channelKeys.detail(channel.id), channel);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: channelKeys.mine() }),
        queryClient.invalidateQueries({ queryKey: channelKeys.browse() }),
      ]);
    },
  });
}
