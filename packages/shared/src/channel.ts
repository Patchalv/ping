// Channels: the request schemas both apps use, and the shape the server answers with.
import { z } from 'zod';

export const CHANNEL_NAME_MAX = 80;
export const CHANNEL_DESCRIPTION_MAX = 500;

// Every rule a Staff member can trip has a plain-English message: the UI shows it as is.

const channelVisibility = z.enum(['public', 'private'], { error: 'Choose Public or Private.' });
export type ChannelVisibility = z.infer<typeof channelVisibility>;

/** POST /api/channels. */
export const createChannelBody = z.object({
  name: z
    .string({ error: 'Give the Channel a name.' })
    .trim()
    .min(1, 'Give the Channel a name.')
    .max(CHANNEL_NAME_MAX, `Keep the name to ${CHANNEL_NAME_MAX} characters or fewer.`),
  description: z
    .string({ error: 'The description must be text.' })
    .trim()
    .max(
      CHANNEL_DESCRIPTION_MAX,
      `Keep the description to ${CHANNEL_DESCRIPTION_MAX} characters or fewer.`,
    )
    .default(''),
  visibility: channelVisibility,
});
export type CreateChannelBody = z.input<typeof createChannelBody>;

/** Routes under /api/channels/:channelId, and the SPA's Channel route. */
export const channelParams = z.object({
  channelId: z.uuid({ error: 'That isn’t a Channel link.' }),
});

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
