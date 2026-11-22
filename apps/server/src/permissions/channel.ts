// Channels (permissions.md › Channels). "Can read a Channel" means the Channel is Public,
// or the actor is a member of it. This is the same for everyone, Admins included.
import type { ChannelVisibility } from '@ping/shared';
import type { Actor } from './actor';
import { allow, type Decision, deny, requireAllowed } from './decision';

/** What the decisions need to know about a Channel and the actor's place in it. */
type ChannelAccess = { visibility: ChannelVisibility; isMember: boolean };

/** Anyone can create a Channel, and becomes its Channel admin. */
export function canCreateChannel(_actor: Actor): Decision {
  return allow();
}

/** Anyone can list the Channels they are a member of (the sidebar). */
export function canListOwnChannels(_actor: Actor): Decision {
  return allow();
}

/** Public, or a member. A Private channel is hidden from everyone else, company Admins included. */
export function canReadChannel(_actor: Actor, channel: ChannelAccess): Decision {
  if (channel.visibility === 'public' || channel.isMember) return allow();
  return deny({ kind: 'hidden' });
}

/** Anyone can browse the Public channels. */
export function canBrowseChannels(_actor: Actor): Decision {
  return allow();
}

/**
 * Anyone can join a Public channel; joining one they're already in changes nothing. Only
 * Channel admins add people to a Private channel, and nobody joins an Archived channel.
 */
export function canJoinChannel(
  actor: Actor,
  channel: ChannelAccess & { isArchived: boolean },
): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (channel.visibility === 'private') {
    return deny({
      kind: 'refused',
      message: 'Only Public channels can be joined. A Channel admin adds people to this one.',
    });
  }
  if (channel.isArchived) {
    return deny({ kind: 'refused', message: 'This Channel is archived, so nobody can join it.' });
  }
  return allow();
}

/** Why the last active Channel admin can't leave, while other members stay. */
export const LAST_CHANNEL_ADMIN =
  'You’re the last Channel admin here. Make another member Channel admin before you leave.';

/** Why the last active Channel admin can't leave when they're the only member. */
export const ONLY_MEMBER =
  'You’re the only member of this Channel. Archive it instead, or add someone, make them Channel admin, then leave.';

/**
 * What leaving needs to know: the actor's place in the Channel, and who else is there.
 * "Other" counts leave out the actor and Deactivated Staff members.
 */
type LeaveAccess = ChannelAccess & {
  isChannelAdmin: boolean;
  otherActiveChannelAdmins: number;
  otherActiveMembers: number;
};

/**
 * Any member can leave, except the last active Channel admin: a Channel always has one
 * (product.md › Members and Channel admins). Leaving an Archived channel is allowed.
 */
export function canLeaveChannel(actor: Actor, channel: LeaveAccess): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (!channel.isMember) {
    return deny({ kind: 'refused', message: 'You’re not a member of this Channel.' });
  }
  if (channel.isChannelAdmin && channel.otherActiveChannelAdmins === 0) {
    return deny({
      kind: 'refused',
      message: channel.otherActiveMembers === 0 ? ONLY_MEMBER : LAST_CHANNEL_ADMIN,
    });
  }
  return allow();
}

export function requireCanBrowseChannels(actor: Actor): void {
  requireAllowed(canBrowseChannels(actor));
}

export function requireCanJoinChannel(
  actor: Actor,
  channel: ChannelAccess & { isArchived: boolean },
): void {
  requireAllowed(canJoinChannel(actor, channel));
}

export function requireCanLeaveChannel(actor: Actor, channel: LeaveAccess): void {
  requireAllowed(canLeaveChannel(actor, channel));
}

export function requireCanCreateChannel(actor: Actor): void {
  requireAllowed(canCreateChannel(actor));
}

export function requireCanListOwnChannels(actor: Actor): void {
  requireAllowed(canListOwnChannels(actor));
}

export function requireCanReadChannel(actor: Actor, channel: ChannelAccess): void {
  requireAllowed(canReadChannel(actor, channel));
}
