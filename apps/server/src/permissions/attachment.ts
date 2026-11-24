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

/**
 * An attached Attachment as removing it needs: its Channel, with whether the actor is one
 * of its Channel admins, and who added it. A pending or already removed one, or one on a
 * deleted Thread Response, is missing, so it never gets here.
 */
export type RemoveAccess = { channel: RemovalChannelAccess; uploaderId: string };

/** The Channel as removing needs it: reading, plus whether the actor is a Channel admin. */
export type RemovalChannelAccess = ThreadChannelAccess & { isChannelAdmin: boolean };

/**
 * Its uploader, the Channel's admins, and company Admins, in a Channel they can read.
 * Archived channels included, so wrongly shared personal data can always come down.
 */
export function canRemoveAttachment(actor: Actor, attachment: RemoveAccess): Decision {
  const read = canReadChannel(actor, attachment.channel);
  if (!read.allow) return read;
  if (
    attachment.uploaderId === actor.staffId ||
    attachment.channel.isChannelAdmin ||
    actor.role === 'admin'
  ) {
    return allow();
  }
  return deny({
    kind: 'refused',
    message:
      'Only the person who added this file, the Channel’s admins and company Admins can remove it.',
  });
}

/**
 * A post's Attachments as the Thread view shows them: each says whether the actor may
 * remove it, and who uploaded it stays on the server.
 */
export function withRemoveActions<T extends { uploaderId: string }>(
  actor: Actor,
  channel: RemovalChannelAccess,
  attachments: readonly T[],
): (Omit<T, 'uploaderId'> & { canRemove: boolean })[] {
  return attachments.map(({ uploaderId, ...rest }) => ({
    ...rest,
    canRemove: canRemoveAttachment(actor, { channel, uploaderId }).allow,
  }));
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

export function requireCanRemoveAttachment(actor: Actor, attachment: RemoveAccess): void {
  requireAllowed(canRemoveAttachment(actor, attachment));
}
