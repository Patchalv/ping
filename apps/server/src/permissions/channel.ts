// Channels (permissions.md › Channels). "Can read a Channel" means the Channel is Public,
// or the actor is a member of it. This is the same for everyone, Admins included.
import type { ChannelMembers, ChannelVisibility } from '@ping/shared';
import type { Actor } from './actor';
import { allow, type Decision, deny, requireAllowed } from './decision';

/** What the decisions need to know about a Channel and the actor's place in it. */
export type ChannelAccess = { visibility: ChannelVisibility; isMember: boolean };

/** Joining also needs to know whether the Channel is Archived. */
type JoinAccess = ChannelAccess & { isArchived: boolean };

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
export function canJoinChannel(actor: Actor, channel: JoinAccess): Decision {
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
export const LAST_CHANNEL_ADMIN_MESSAGE =
  'You’re the last Channel admin here. Make another member Channel admin before you leave.';

/** Why the last active Channel admin can't leave when they're the only member. */
export const ONLY_MEMBER_MESSAGE =
  'You’re the only member of this Channel. Archive it instead, or add someone, make them Channel admin, then leave.';

/** The same, in an Archived channel, which is already as archived as it gets. */
export const ONLY_MEMBER_ARCHIVED_MESSAGE =
  'You’re the only member of this Channel. Add someone and make them Channel admin, then leave.';

/**
 * What leaving needs to know: the actor's place in the Channel, and who else is there.
 * "Other" counts leave out the actor and Deactivated Staff members.
 */
type LeaveAccess = ChannelAccess & {
  isArchived: boolean;
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
    return deny({
      kind: 'refused',
      message: 'You’re not a member of this Channel, so there’s nothing to leave.',
    });
  }
  if (channel.isChannelAdmin && channel.otherActiveChannelAdmins === 0) {
    return deny({
      kind: 'refused',
      message:
        channel.otherActiveMembers > 0
          ? LAST_CHANNEL_ADMIN_MESSAGE
          : channel.isArchived
            ? ONLY_MEMBER_ARCHIVED_MESSAGE
            : ONLY_MEMBER_MESSAGE,
    });
  }
  return allow();
}

// Members and Channel admins (product.md › Members and Channel admins, › What company
// Admins can do to a Channel). From "Channel members and Channel admins" (#37).

/** The actor's place in a Channel, for changing its members. */
type MembershipAccess = ChannelAccess & { isArchived: boolean; isChannelAdmin: boolean };

const ARCHIVED_MEMBERS_MESSAGE =
  'This Channel is archived, so its members can’t change. Unarchive it first.';
const NOT_A_MEMBER_MESSAGE = 'They’re not a member of this Channel.';

/** Can read it, and it isn't Archived: what every membership change needs first. */
function canChangeMembers(actor: Actor, channel: MembershipAccess): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (channel.isArchived) return deny({ kind: 'refused', message: ARCHIVED_MEMBERS_MESSAGE });
  return allow();
}

/**
 * Any member adds people to a Public channel; only Channel admins add them to a Private
 * one. Company Admins get no exception. Also gates the add-members picker.
 */
function canAddMembers(actor: Actor, channel: MembershipAccess): Decision {
  const base = canChangeMembers(actor, channel);
  if (!base.allow) return base;
  if (channel.visibility === 'private' && !channel.isChannelAdmin) {
    return deny({
      kind: 'refused',
      message: 'Only Channel admins add people to a Private channel.',
    });
  }
  if (!channel.isMember) {
    return deny({ kind: 'refused', message: 'Join this Channel before you add people to it.' });
  }
  return allow();
}

/** Adding one person: as canAddMembers, and only active Staff members can be added. */
export function canAddChannelMember(
  actor: Actor,
  channel: MembershipAccess,
  target: { isActiveStaff: boolean },
): Decision {
  const base = canAddMembers(actor, channel);
  if (!base.allow) return base;
  if (!target.isActiveStaff) {
    return deny({
      kind: 'refused',
      message: 'Only active Staff members can be added. Invited and Deactivated people can’t.',
    });
  }
  return allow();
}

/**
 * Only Channel admins remove members, company Admins included. Removing yourself is
 * leaving, which has its own rule about the last Channel admin, so it goes through Leave.
 * The remover stays, so the Channel keeps an active Channel admin.
 */
export function canRemoveChannelMember(
  actor: Actor,
  channel: MembershipAccess,
  target: { staffId: string; isMember: boolean },
): Decision {
  const base = canRemoveMembers(actor, channel);
  if (!base.allow) return base;
  if (target.staffId === actor.staffId) {
    return deny({ kind: 'refused', message: 'To leave this Channel yourself, use Leave.' });
  }
  if (!target.isMember) return deny({ kind: 'refused', message: NOT_A_MEMBER_MESSAGE });
  return allow();
}

/** Only Channel admins remove members, company Admins included. */
function canRemoveMembers(actor: Actor, channel: MembershipAccess): Decision {
  const base = canChangeMembers(actor, channel);
  if (!base.allow) return base;
  if (!channel.isChannelAdmin) {
    return deny({ kind: 'refused', message: 'Only Channel admins remove members.' });
  }
  return allow();
}

/** Who a Channel admin change is about. `otherActiveChannelAdmins` leaves them out. */
export type ChannelAdminTarget = {
  staffId: string;
  isActiveStaff: boolean;
  isMember: boolean;
  isChannelAdmin: boolean;
  otherActiveChannelAdmins: number;
};

/** A company Admin's one power over a Public channel: its Channel admins. */
function actsAsCompanyAdmin(actor: Actor, channel: ChannelAccess): boolean {
  return actor.role === 'admin' && channel.visibility === 'public';
}

/** Channel admins of the Channel, and company Admins on a Public one. */
function canSetChannelAdmins(actor: Actor, channel: MembershipAccess): Decision {
  const base = canChangeMembers(actor, channel);
  if (!base.allow) return base;
  if (!channel.isChannelAdmin && !actsAsCompanyAdmin(actor, channel)) {
    return deny({
      kind: 'refused',
      message: 'Only Channel admins appoint or remove Channel admins.',
    });
  }
  return allow();
}

/**
 * For an allowed Channel admin change: whether it takes a company Admin's power, which
 * only the admin_set_channel_admin system function has. A Channel admin changing a
 * member's row uses the ordinary policy; anything else allowed is the company Admin's.
 */
export function needsCompanyAdminPower(
  channel: MembershipAccess,
  target: Pick<ChannelAdminTarget, 'isMember'>,
): boolean {
  return !(channel.isChannelAdmin && target.isMember);
}

/**
 * Channel admins appoint members as Channel admins and remove the role. A company Admin
 * does both on a Public channel, for anyone including themself, member or not. A Channel
 * always keeps an active Channel admin.
 */
export function canSetChannelAdmin(
  actor: Actor,
  channel: MembershipAccess,
  target: ChannelAdminTarget,
  makeChannelAdmin: boolean,
): Decision {
  const base = canSetChannelAdmins(actor, channel);
  if (!base.allow) return base;
  const asCompanyAdmin = actsAsCompanyAdmin(actor, channel);
  if (makeChannelAdmin) {
    if (!target.isActiveStaff) {
      return deny({ kind: 'refused', message: 'Only active Staff members can be Channel admins.' });
    }
    if (!target.isMember && !asCompanyAdmin) {
      return deny({
        kind: 'refused',
        message: 'Add them to the Channel before you make them Channel admin.',
      });
    }
    return allow();
  }
  if (!target.isMember) return deny({ kind: 'refused', message: NOT_A_MEMBER_MESSAGE });
  if (target.isChannelAdmin && target.isActiveStaff && target.otherActiveChannelAdmins === 0) {
    return deny({
      kind: 'refused',
      message: 'A Channel needs an active Channel admin. Make someone else Channel admin first.',
    });
  }
  return allow();
}

/**
 * Which member controls the Members tab shows, so the SPA hides the ones the server would
 * refuse. The server still decides each change, about its target.
 */
export function channelMemberActions(
  actor: Actor,
  channel: MembershipAccess,
): ChannelMembers['can'] {
  return {
    add: canAddMembers(actor, channel).allow,
    remove: canRemoveMembers(actor, channel).allow,
    setChannelAdmin: canSetChannelAdmins(actor, channel).allow,
  };
}

export function requireCanAddMembers(actor: Actor, channel: MembershipAccess): void {
  requireAllowed(canAddMembers(actor, channel));
}

export function requireCanAddChannelMember(
  actor: Actor,
  channel: MembershipAccess,
  target: { isActiveStaff: boolean },
): void {
  requireAllowed(canAddChannelMember(actor, channel, target));
}

export function requireCanRemoveChannelMember(
  actor: Actor,
  channel: MembershipAccess,
  target: { staffId: string; isMember: boolean },
): void {
  requireAllowed(canRemoveChannelMember(actor, channel, target));
}

export function requireCanSetChannelAdmin(
  actor: Actor,
  channel: MembershipAccess,
  target: ChannelAdminTarget,
  makeChannelAdmin: boolean,
): void {
  requireAllowed(canSetChannelAdmin(actor, channel, target, makeChannelAdmin));
}

export function requireCanBrowseChannels(actor: Actor): void {
  requireAllowed(canBrowseChannels(actor));
}

export function requireCanJoinChannel(actor: Actor, channel: JoinAccess): void {
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
