// Threads (permissions.md › Threads, Thread Responses and Attachments). Reading follows the
// Channel: anyone who can read it reads its Threads. Starting one takes membership.
import type { ChannelVisibility } from '@ping/shared';
import type { Actor } from './actor';
import { canReadChannel } from './channel';
import { canDeleteContent, canEditContent } from './content';
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

/** Who started the Thread, as the edit and delete decisions need it. */
export type ThreadAuthorship = { authorId: string | null; isSystem: boolean };

/**
 * Its author, or a company Admin in a Channel they can read; never in an Archived
 * channel. Nobody edits a System thread: Ping wrote it.
 */
export function canEditThread(
  actor: Actor,
  channel: ThreadChannelAccess,
  thread: ThreadAuthorship,
): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (thread.isSystem) {
    return deny({ kind: 'refused', message: 'Ping started this Thread, so nobody can edit it.' });
  }
  return canEditContent(actor, channel, thread.authorId, 'Thread');
}

/**
 * Its author, or a company Admin in a Channel they can read. In an Archived channel, and
 * for a System thread, only Admins.
 */
export function canDeleteThread(
  actor: Actor,
  channel: ThreadChannelAccess,
  thread: ThreadAuthorship,
): Decision {
  return canDeleteContent(actor, channel, thread.authorId, 'Thread');
}

export function requireCanEditThread(
  actor: Actor,
  channel: ThreadChannelAccess,
  thread: ThreadAuthorship,
): void {
  requireAllowed(canEditThread(actor, channel, thread));
}

export function requireCanDeleteThread(
  actor: Actor,
  channel: ThreadChannelAccess,
  thread: ThreadAuthorship,
): void {
  requireAllowed(canDeleteThread(actor, channel, thread));
}

export function requireCanReadThreads(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canReadThreads(actor, channel));
}

export function requireCanStartThread(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canStartThread(actor, channel));
}
