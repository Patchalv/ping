// Sidebar Sections (permissions.md: "Sections: their owner only"). Everyone creates,
// renames, reorders, collapses and deletes their own Sections; row-level security keeps
// them to their own, so another Staff member's Section reads as missing (404).
//
// Placing a Channel in a Section takes membership: the sidebar lists only the Channels
// you're in. A non-member of a Public channel must join first; a Private channel they
// aren't in is hidden.
import type { ChannelVisibility } from '@ping/shared';
import type { Actor } from './actor';
import { canReadChannel } from './channel';
import { allow, type Decision, deny, requireAllowed } from './decision';

/** Anyone manages their own Sections. */
export function canManageOwnSections(_actor: Actor): Decision {
  return allow();
}

export function requireCanManageOwnSections(actor: Actor): void {
  requireAllowed(canManageOwnSections(actor));
}

/** What placing needs to know about the Channel and the actor's place in it. */
export type PlacementAccess = { visibility: ChannelVisibility; isMember: boolean };

/** A member of the Channel, Public or Private, Archived or not. */
export function canPlaceChannel(actor: Actor, channel: PlacementAccess): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (!channel.isMember) {
    return deny({
      kind: 'refused',
      message: 'Join this Channel to put it in one of your Sections.',
    });
  }
  return allow();
}

export function requireCanPlaceChannel(actor: Actor, channel: PlacementAccess): void {
  requireAllowed(canPlaceChannel(actor, channel));
}
