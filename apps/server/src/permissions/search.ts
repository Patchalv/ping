// Search (product.md › Search). Anyone may search: row-level security limits what they find
// to Public channels and the Private channels they're in, the same for everyone, Admins
// included. The In chip names one Channel, so it takes being able to read that Channel; a
// Private channel they aren't in is hidden (404).
import type { Actor } from './actor';
import { type ChannelAccess, canReadChannel } from './channel';
import { allow, type Decision, requireAllowed } from './decision';

/** Search, and list the people the From chip offers: anyone. */
export function canSearch(_actor: Actor): Decision {
  return allow();
}

export function requireCanSearch(actor: Actor): void {
  requireAllowed(canSearch(actor));
}

/** Search In: one Channel: anyone who can read it. */
export function canSearchInChannel(actor: Actor, channel: ChannelAccess): Decision {
  return canReadChannel(actor, channel);
}

export function requireCanSearchInChannel(actor: Actor, channel: ChannelAccess): void {
  requireAllowed(canSearchInChannel(actor, channel));
}
