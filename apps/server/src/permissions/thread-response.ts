// Thread Responses (permissions.md › Threads, Thread Responses and Attachments). Reading
// follows the Thread's Channel. Sending takes membership, outside an Archived channel.
// Editing and deleting follow the content rules in content.ts.
import type { Actor } from './actor';
import { canReadChannel } from './channel';
import { canDeleteContent, canEditContent } from './content';
import { allow, type Decision, deny, requireAllowed } from './decision';
import type { ThreadChannelAccess } from './thread';

/** Who sent the Thread Response. */
export type ThreadResponseAuthorship = { authorId: string };

/**
 * Only Channel members send Thread Responses, company Admins included; a Staff member
 * reading a Public channel must join first. Nobody sends one in an Archived channel.
 */
export function canSendThreadResponse(actor: Actor, channel: ThreadChannelAccess): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (channel.isArchived) {
    return deny({
      kind: 'refused',
      message: 'This Channel is archived, so nobody can send Thread Responses in it.',
    });
  }
  if (!channel.isMember) {
    return deny({ kind: 'refused', message: 'Join this Channel to send a Thread Response.' });
  }
  return allow();
}

export function canEditThreadResponse(
  actor: Actor,
  channel: ThreadChannelAccess,
  response: ThreadResponseAuthorship,
): Decision {
  return canEditContent(actor, channel, response.authorId, 'Thread Response');
}

export function canDeleteThreadResponse(
  actor: Actor,
  channel: ThreadChannelAccess,
  response: ThreadResponseAuthorship,
): Decision {
  return canDeleteContent(actor, channel, response.authorId, 'Thread Response');
}

export function requireCanSendThreadResponse(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canSendThreadResponse(actor, channel));
}

export function requireCanEditThreadResponse(
  actor: Actor,
  channel: ThreadChannelAccess,
  response: ThreadResponseAuthorship,
): void {
  requireAllowed(canEditThreadResponse(actor, channel, response));
}

export function requireCanDeleteThreadResponse(
  actor: Actor,
  channel: ThreadChannelAccess,
  response: ThreadResponseAuthorship,
): void {
  requireAllowed(canDeleteThreadResponse(actor, channel, response));
}
