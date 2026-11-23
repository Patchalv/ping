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

const staffId = z.uuid({ error: 'That isn’t a Staff member.' });

/** Routes under /api/channels/:channelId/members/:staffId. */
export const channelMemberParams = channelParams.extend({ staffId });

/** POST /api/channels/:channelId/members: add someone. */
export const addChannelMemberBody = z.object({
  staffId: z.uuid({ error: 'Choose a Staff member to add.' }),
});

/** PATCH /api/channels/:channelId/members/:staffId: appoint a Channel admin or remove the role. */
export const setChannelAdminBody = z.object({
  isChannelAdmin: z.boolean({ error: 'Say whether they should be Channel admin.' }),
});

/** A row in a Channel's Members tab. Deactivated members stay listed, greyed. */
export type ChannelMemberView = {
  staffId: string;
  name: string;
  isChannelAdmin: boolean;
  isDeactivated: boolean;
};

/**
 * A Channel's Members tab: its members, and which controls the acting Staff member gets.
 * The server still decides every change.
 */
export type ChannelMembers = {
  members: ChannelMemberView[];
  /** Who is asking, so the tab can mark them and target "Make me Channel admin". */
  actorStaffId: string;
  can: { add: boolean; remove: boolean; setChannelAdmin: boolean };
};

/** Someone the add-members picker offers: an active Staff member who isn't in the Channel. */
export type MemberCandidate = { staffId: string; name: string };

/** A Channel as the acting Staff member sees it. */
export type ChannelView = {
  id: string;
  name: string;
  description: string;
  visibility: ChannelVisibility;
  memberCount: number;
  isMember: boolean;
  isChannelAdmin: boolean;
  isArchived: boolean;
  /** Whether the viewer muted the whole Channel. Only members can. */
  isMuted: boolean;
};

/** A row in the sidebar's Channels section: a Channel the Staff member is a member of. */
export type SidebarChannel = Pick<ChannelView, 'id' | 'name' | 'visibility' | 'isMuted'>;

/** A row in Browse channels: a Public channel, and whether the Staff member is in it. */
export type BrowseChannel = Pick<
  ChannelView,
  'id' | 'name' | 'description' | 'memberCount' | 'isMember'
>;
