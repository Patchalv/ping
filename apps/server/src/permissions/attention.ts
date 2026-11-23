// Saved and Mute (permissions.md › Personal). Everyone lists their own Saved Threads:
// row-level security means they only ever see their own. Saving, removing from Saved and
// muting a Thread take only being able to read it, so they follow `canReadThreads`: a
// Public channel's non-members may, and a Private channel they aren't in is hidden. Muting
// a whole Channel takes membership.
import type { Actor } from './actor';
import { canReadChannel } from './channel';
import { allow, type Decision, deny, requireAllowed } from './decision';
import { canReadThreads, type ThreadChannelAccess } from './thread';

/** Anyone lists their own Saved Threads. */
export function canListOwnSaved(_actor: Actor): Decision {
  return allow();
}

export function requireCanListOwnSaved(actor: Actor): void {
  requireAllowed(canListOwnSaved(actor));
}

/** Save a Thread, or remove it from Saved: anyone who can read it. */
export function canSaveThread(actor: Actor, channel: ThreadChannelAccess): Decision {
  return canReadThreads(actor, channel);
}

export function requireCanSaveThread(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canSaveThread(actor, channel));
}

/** Mute or unmute a Thread: anyone who can read it. */
export function canMuteThread(actor: Actor, channel: ThreadChannelAccess): Decision {
  return canReadThreads(actor, channel);
}

export function requireCanMuteThread(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canMuteThread(actor, channel));
}

/** Mute or unmute a whole Channel: its members only, company Admins included. */
export function canMuteChannel(actor: Actor, channel: ThreadChannelAccess): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (!channel.isMember) {
    return deny({ kind: 'refused', message: 'Join this Channel to mute it.' });
  }
  return allow();
}

export function requireCanMuteChannel(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canMuteChannel(actor, channel));
}
