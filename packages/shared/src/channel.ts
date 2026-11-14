// Channels: the request schemas both apps use, and the shape the server answers with.
import { z } from 'zod';

export const CHANNEL_NAME_MAX = 80;
export const CHANNEL_DESCRIPTION_MAX = 500;

export const channelVisibility = z.enum(['public', 'private']);
export type ChannelVisibility = z.infer<typeof channelVisibility>;

/** POST /api/channels. */
export const createChannelBody = z.object({
  name: z.string().trim().min(1, 'Give the Channel a name.').max(CHANNEL_NAME_MAX),
  description: z.string().trim().max(CHANNEL_DESCRIPTION_MAX).default(''),
  visibility: channelVisibility,
});
export type CreateChannelBody = z.input<typeof createChannelBody>;

/** Routes under /api/channels/:channelId. */
export const channelParams = z.object({ channelId: z.uuid() });

/** A Channel as the acting Staff member sees it. */
export type ChannelView = {
  id: string;
  name: string;
  description: string;
  visibility: ChannelVisibility;
  memberCount: number;
  isMember: boolean;
  isChannelAdmin: boolean;
};

/** A row in the sidebar's Channels section: a Channel the Staff member is a member of. */
export type SidebarChannel = Pick<ChannelView, 'id' | 'name' | 'visibility'>;
