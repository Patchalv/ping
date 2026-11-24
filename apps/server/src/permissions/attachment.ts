// Attachments (permissions.md › Threads, Thread Responses and Attachments). Adding a file
// follows posting: whoever may post or edit in the Channel. Downloading follows reading
// the Thread. A pending Attachment belongs to its uploader alone; row-level security hides
// everyone else's, so a save can only attach the actor's own.
import { ATTACHMENT_MESSAGES, ATTACHMENTS_PER_POST_MAX } from '@ping/shared';
import type { Actor } from './actor';
import { canReadChannel } from './channel';
import { allow, type Decision, deny, requireAllowed } from './decision';
import type { ThreadChannelAccess } from './thread';

/**
 * "Whoever is posting": members start Threads and send Thread Responses, and company
 * Admins edit in any Channel they can read. Nobody posts or edits in an Archived channel.
 */
export function canAddAttachment(actor: Actor, channel: ThreadChannelAccess): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (channel.isArchived) {
    return deny({
      kind: 'refused',
      message: 'This Channel is archived, so nobody can attach files in it.',
    });
  }
  if (!channel.isMember && actor.role !== 'admin') {
    return deny({ kind: 'refused', message: 'Join this Channel to attach files in it.' });
  }
  return allow();
}

/**
 * An Attachment as opening it needs: its Channel once attached, or null while pending, and
 * who added it.
 */
export type DownloadAccess = { channel: ThreadChannelAccess | null; uploaderId: string };

/**
 * Attached: anyone who can read the Thread, including in Archived channels and Resolved
 * threads. Pending: only its uploader; to anyone else it doesn't exist.
 */
export function canDownloadAttachment(actor: Actor, attachment: DownloadAccess): Decision {
  if (attachment.channel) return canReadChannel(actor, attachment.channel);
  return attachment.uploaderId === actor.staffId ? allow() : deny({ kind: 'hidden' });
}

/**
 * What a save asks to attach: how many IDs it sent, how many of those are the actor's own
 * pending Attachments, and how many the post already has.
 */
export type AttachRequest = { requested: number; available: number; alreadyAttached: number };

/** Only the actor's own pending Attachments, and no more than 5 on one post. */
export function canAttach(request: AttachRequest): Decision {
  if (request.available < request.requested) {
    return deny({ kind: 'refused', message: ATTACHMENT_MESSAGES.unavailable });
  }
  if (request.alreadyAttached + request.requested > ATTACHMENTS_PER_POST_MAX) {
    return deny({ kind: 'refused', message: ATTACHMENT_MESSAGES.tooMany });
  }
  return allow();
}

export function requireCanAddAttachment(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canAddAttachment(actor, channel));
}

export function requireCanDownloadAttachment(actor: Actor, attachment: DownloadAccess): void {
  requireAllowed(canDownloadAttachment(actor, attachment));
}

export function requireCanAttach(request: AttachRequest): void {
  requireAllowed(canAttach(request));
}
