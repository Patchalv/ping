// The Channel feature's calls, through the typed hc client only.
import type { ChannelView, CreateChannelBody, SidebarChannel } from '@ping/shared';
import { api } from '../../lib/api';
import { apiErrorMessage, type Resource, toResource } from '../../lib/api-error';
import { useResource } from '../../lib/use-resource';

const channels = api.api.channels;

/** The Channels the signed-in Staff member is a member of, for the sidebar. */
export function useMyChannels(): [Resource<SidebarChannel[]>, () => void] {
  return useResource('mine', async () => toResource(await channels.$get()));
}

/** One Channel. A Private channel the Staff member isn't in reads as not found. */
export function useChannel(channelId: string): Resource<ChannelView> {
  const [channel] = useResource(channelId, async () =>
    toResource(await channels[':channelId'].$get({ param: { channelId } })),
  );
  return channel;
}

export async function createChannel(
  body: CreateChannelBody,
): Promise<{ ok: true; channel: ChannelView } | { ok: false; message: string }> {
  const res = await channels.$post({ json: body });
  if (res.ok) return { ok: true, channel: await res.json() };
  return { ok: false, message: await apiErrorMessage(res) };
}
