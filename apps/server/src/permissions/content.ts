// Editing and deleting posted content: Threads and Thread Responses follow the same rules
// (permissions.md › Threads, Thread Responses and Attachments, product.md › Editing and
// › Deleting). Its author, or a company Admin in a Channel they can read. Channel admins
// get nothing extra. In an Archived channel nothing is edited, and only Admins delete.
import type { Actor } from './actor';
import { canReadChannel } from './channel';
import { allow, type Decision, deny } from './decision';
import type { ThreadChannelAccess } from './thread';

/** What is being changed, for the refusal's wording. */
export type ContentNoun = 'Thread' | 'Thread Response';

const isAuthorOrAdmin = (actor: Actor, authorId: string | null) =>
  actor.role === 'admin' || (authorId !== null && authorId === actor.staffId);

export function canEditContent(
  actor: Actor,
  channel: ThreadChannelAccess,
  authorId: string | null,
  noun: ContentNoun,
): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (channel.isArchived) {
    return deny({
      kind: 'refused',
      message: 'This Channel is archived, so nothing in it can be edited.',
    });
  }
  if (!isAuthorOrAdmin(actor, authorId)) {
    return deny({
      kind: 'refused',
      message: `Only its author or a company Admin can edit this ${noun}.`,
    });
  }
  return allow();
}

export function canDeleteContent(
  actor: Actor,
  channel: ThreadChannelAccess,
  authorId: string | null,
  noun: ContentNoun,
): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (channel.isArchived && actor.role !== 'admin') {
    return deny({
      kind: 'refused',
      message: 'This Channel is archived, so only a company Admin can delete in it.',
    });
  }
  if (!isAuthorOrAdmin(actor, authorId)) {
    return deny({
      kind: 'refused',
      message: `Only its author or a company Admin can delete this ${noun}.`,
    });
  }
  return allow();
}
