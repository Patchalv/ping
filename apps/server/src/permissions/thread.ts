// Threads (permissions.md › Threads, Thread Responses and Attachments). Reading follows the
// Channel: anyone who can read it reads its Threads. Starting one takes membership.
import type { ChannelVisibility, ResolvePolicy } from '@ping/shared';
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

/** Who started the Thread: null for a System thread, which Ping started. */
export type ThreadAuthorship = { authorId: string | null };

/**
 * Its author, or a company Admin in a Channel they can read; never in an Archived
 * channel. A System thread has no author, so only Admins edit it.
 */
export function canEditThread(
  actor: Actor,
  channel: ThreadChannelAccess,
  thread: ThreadAuthorship,
): Decision {
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

/** What resolving needs beyond reading: the actor's role and the Channel's setting. */
export type ResolveAccess = ThreadChannelAccess & {
  isChannelAdmin: boolean;
  resolvePolicy: ResolvePolicy;
};

/**
 * Resolve, and reopen, by the Channel's "Who can resolve threads?" setting: any member, or
 * only the Thread's author and Channel admins. Company Admins get no exception, and nobody
 * does it in an Archived channel. A Deactivated author's Threads are like anyone else's.
 */
export function canResolveThread(
  actor: Actor,
  channel: ResolveAccess,
  thread: ThreadAuthorship,
): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (channel.isArchived) {
    return deny({
      kind: 'refused',
      message: 'This Channel is archived, so nobody can resolve or reopen its Threads.',
    });
  }
  if (!channel.isMember) {
    return deny({
      kind: 'refused',
      message: 'Join this Channel to resolve or reopen its Threads.',
    });
  }
  const isAuthor = thread.authorId !== null && thread.authorId === actor.staffId;
  if (
    channel.resolvePolicy === 'author_and_channel_admins' &&
    !isAuthor &&
    !channel.isChannelAdmin
  ) {
    return deny({
      kind: 'refused',
      message: 'Only the Thread’s author or a Channel admin can resolve or reopen it here.',
    });
  }
  return allow();
}

export function requireCanResolveThread(
  actor: Actor,
  channel: ResolveAccess,
  thread: ThreadAuthorship,
): void {
  requireAllowed(canResolveThread(actor, channel, thread));
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
