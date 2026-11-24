// Live updates (product.md › Live updates). An event goes only to Staff members who can
// read what it is about: a Channel's events to those who can read the Channel, decided
// at the moment it's sent, so losing access stops them at once.
import type { LiveEvent } from '@ping/shared';
import type { Actor } from './actor';
import { type ChannelAccess, canReadChannel } from './channel';
import { allow, type Decision, deny, requireAllowed } from './decision';

/** Every active Staff member can open the stream; what reaches it is decided per event. */
export function canOpenLiveStream(_actor: Actor): Decision {
  return allow();
}

export function requireCanOpenLiveStream(actor: Actor): void {
  requireAllowed(canOpenLiveStream(actor));
}

/**
 * Whether `actor` may receive `event`. `channel` is the event's Channel as the actor's own
 * transaction sees it, or undefined when row-level security hid it.
 */
export function canReceiveLiveEvent(
  actor: Actor,
  event: LiveEvent,
  channel: ChannelAccess | undefined,
): Decision {
  // Every signed-in Staff member can read the Staff members list, and could read a Channel
  // that just turned Private: they must hear it to drop it.
  if (event.kind === 'staff.changed' || event.kind === 'channel.made_private') return allow();
  // Only the Staff member it's about: their memberships (naming no Channel), their own
  // Sidebar Sections, or their own Saved list and mutes.
  if (
    event.kind === 'membership.changed' ||
    event.kind === 'section.changed' ||
    event.kind === 'attention.changed'
  ) {
    return event.staffId === actor.staffId ? allow() : deny({ kind: 'hidden' });
  }
  if (!channel) return deny({ kind: 'hidden' });
  return canReadChannel(actor, channel);
}
