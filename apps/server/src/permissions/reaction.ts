// Reactions (permissions.md › Threads, Thread Responses and Attachments: "react: Member").
// Adding and removing one take the same thing: Channel membership, outside an Archived
// channel. A non-member of a Public channel must join first; a Private channel they
// aren't in is hidden.
import type { Actor } from './actor';
import { canReadChannel } from './channel';
import { allow, type Decision, deny, requireAllowed } from './decision';
import type { ThreadChannelAccess } from './thread';

export function canReact(actor: Actor, channel: ThreadChannelAccess): Decision {
  const read = canReadChannel(actor, channel);
  if (!read.allow) return read;
  if (channel.isArchived) {
    return deny({
      kind: 'refused',
      message: 'This Channel is archived, so nobody can react in it.',
    });
  }
  if (!channel.isMember) {
    return deny({ kind: 'refused', message: 'Join this Channel to react.' });
  }
  return allow();
}

export function requireCanReact(actor: Actor, channel: ThreadChannelAccess): void {
  requireAllowed(canReact(actor, channel));
}
