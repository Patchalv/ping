// Channels (permissions.md › Channels). "Can read a Channel" means the Channel is Public,
// or the actor is a member of it. This is the same for everyone, Admins included.
import type { ChannelVisibility } from '@ping/shared';
import type { Actor } from './actor';
import { allow, type Decision, deny, requireAllowed } from './decision';

/** What the decisions need to know about a Channel and the actor's place in it. */
export type ChannelAccess = {
  visibility: ChannelVisibility;
  /** The actor's own channel_member row, or null when they aren't a member. */
  membership: { isChannelAdmin: boolean } | null;
};

/** Anyone can create a Channel, and becomes its Channel admin. */
export function canCreateChannel(_actor: Actor): Decision {
  return allow();
}

/** Public, or a member. A Private channel is hidden from everyone else, company Admins included. */
export function canReadChannel(_actor: Actor, channel: ChannelAccess): Decision {
  if (channel.visibility === 'public' || channel.membership) return allow();
  return deny({ kind: 'hidden' });
}

export function requireCanCreateChannel(actor: Actor): void {
  requireAllowed(canCreateChannel(actor));
}

export function requireCanReadChannel(actor: Actor, channel: ChannelAccess): void {
  requireAllowed(canReadChannel(actor, channel));
}
