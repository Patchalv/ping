// Live updates (product.md › Live updates). An event goes only to Staff members who can
// read what it is about: a Channel's events to those who can read the Channel, decided
// at the moment it's sent, so losing access stops them at once.
import type { LiveEvent } from '@ping/shared';
import type { Actor } from './actor';
import { canReadChannel } from './channel';
import { allow, type Decision, deny, requireAllowed } from './decision';

/** What the decision needs to know about the event's Channel and the actor's place in it. */
type ChannelAccess = Parameters<typeof canReadChannel>[1];

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
  // Every signed-in Staff member can read the Staff members list.
  if (event.kind === 'staff.changed') return allow();
  // Someone whose membership changed hears it, even once they've lost access, so their
  // sidebar drops the Channel. It carries IDs they already had.
  if (event.kind === 'channel.changed' && event.staffId === actor.staffId) return allow();
  if (!channel) return deny({ kind: 'hidden' });
  return canReadChannel(actor, channel);
}
