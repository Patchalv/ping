// Saved and Mute (permissions.md › Personal). Everyone lists their own Saved Threads:
// row-level security means they only ever see, and remove, their own. Saving and muting a
// Thread take only being able to read it, so they follow `canReadThreads`: a Public
// channel's non-members may, and a Private channel they aren't in is hidden. Muting a
// whole Channel takes membership.
import type { Actor } from './actor';
import { type ChannelAccess, canReadChannel } from './channel';
import { allow, type Decision, deny, requireAllowed } from './decision';
import { canReadThreads, type ThreadChannelAccess } from './thread';

/** Anyone lists their own Saved Threads. */
export function canListOwnSaved(_actor: Actor): Decision {
  return allow();
}

export function requireCanListOwnSaved(actor: Actor): void {
  requireAllowed(canListOwnSaved(actor));
}

/** Save a Thread: anyone who can read it. */
export function canSaveThread(actor: Actor, channel: ThreadChannelAccess): Decision {
  return canReadThreads(actor, channel);
}

export function requireCanSaveThread(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canSaveThread(actor, channel));
}

/**
 * Remove a Thread from Saved: its owner. Row-level security makes every Saved row the
 * actor can touch their own, and the clean-up drops a Saved Thread once they can't read
 * it, so the owner of one is always someone who can read the Thread; a hidden one is 404.
 */
export function canRemoveSavedThread(actor: Actor, channel: ThreadChannelAccess): Decision {
  return canReadThreads(actor, channel);
}

export function requireCanRemoveSavedThread(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canRemoveSavedThread(actor, channel));
}

/** Mute or unmute a Thread: anyone who can read it. */
export function canMuteThread(actor: Actor, channel: ThreadChannelAccess): Decision {
  return canReadThreads(actor, channel);
}

export function requireCanMuteThread(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canMuteThread(actor, channel));
}

/** Mute or unmute a whole Channel: its members only, company Admins included. */
export function canMuteChannel(actor: Actor, channel: ChannelAccess): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (!channel.isMember) {
    return deny({ kind: 'refused', message: 'Join this Channel to mute it.' });
  }
  return allow();
}

export function requireCanMuteChannel(actor: Actor, channel: ChannelAccess): void {
  requireAllowed(canMuteChannel(actor, channel));
}
