// Threads (permissions.md › Threads, Thread Responses and Attachments). Reading follows the
// Channel: anyone who can read it reads its Threads. Starting one takes membership.
import type { ChannelVisibility } from '@ping/shared';
import type { Actor } from './actor';
import { canReadChannel } from './channel';
import { allow, type Decision, deny, requireAllowed } from './decision';

/** What the decisions need to know about the Thread's Channel and the actor's place in it. */
export type ThreadChannelAccess = {
  visibility: ChannelVisibility;
  isMember: boolean;
  isArchived: boolean;
};

/** Anyone who can read the Channel reads its Threads, Archived or not. */
export function canReadThreads(actor: Actor, channel: ThreadChannelAccess): Decision {
  return canReadChannel(actor, channel);
}

/**
 * Only Channel members start Threads, company Admins included; a Staff member reading a
 * Public channel must join first. Nobody starts one in an Archived channel.
 */
export function canStartThread(actor: Actor, channel: ThreadChannelAccess): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (channel.isArchived) {
    return deny({
      kind: 'refused',
      message: 'This Channel is archived, so nobody can start Threads in it.',
    });
  }
  if (!channel.isMember) {
    return deny({ kind: 'refused', message: 'Join this Channel to start a Thread in it.' });
  }
  return allow();
}

export function requireCanReadThreads(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canReadThreads(actor, channel));
}

export function requireCanStartThread(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canStartThread(actor, channel));
}
