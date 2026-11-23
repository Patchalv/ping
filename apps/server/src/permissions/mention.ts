// Mentions (permissions.md › Threads, Thread Responses and Attachments: "Mention someone").
// Whoever may post may Mention, but only Staff members who can read the Thread: any active
// Staff member in a Public channel, only Channel members in a Private one. Mentioning a
// non-member of a Public channel doesn't make them join.
import type { ChannelVisibility, StaffState } from '@ping/shared';
import type { Actor } from './actor';
import { type ChannelAccess, canReadChannel } from './channel';
import { allow, type Decision, deny, requireAllowed } from './decision';

export const MENTION_REFUSED =
  'You can only Mention people who can read this Thread. Remove the Mention and try again.';

/** The Mentioned person, as the decision needs them. Undefined when there's no such person. */
export type MentionTarget = { state: StaffState; isMember: boolean } | undefined;

/** Whether this person can be Mentioned in a Thread of this Channel. */
export function canMention(
  _actor: Actor,
  channel: { visibility: ChannelVisibility },
  mentioned: MentionTarget,
): Decision {
  if (
    mentioned !== undefined &&
    mentioned.state === 'active' &&
    (channel.visibility === 'public' || mentioned.isMember)
  ) {
    return allow();
  }
  return deny({ kind: 'refused', message: MENTION_REFUSED });
}

function requireCanMention(
  actor: Actor,
  channel: { visibility: ChannelVisibility },
  mentioned: MentionTarget,
): void {
  requireAllowed(canMention(actor, channel, mentioned));
}

/**
 * Checks everyone a save newly Mentions. People it already Mentioned stay, even if they've
 * since lost access, so editing an old post never fails on them.
 */
export function requireCanMentionEach(
  actor: Actor,
  channel: { visibility: ChannelVisibility },
  added: readonly string[],
  targets: ReadonlyMap<string, NonNullable<MentionTarget>>,
): void {
  for (const staffId of added) requireCanMention(actor, channel, targets.get(staffId));
}

/** The @ picker's list follows reading: anyone who can read the Channel may write in it. */
export function canListMentionCandidates(actor: Actor, channel: ChannelAccess): Decision {
  return canReadChannel(actor, channel);
}

export function requireCanListMentionCandidates(actor: Actor, channel: ChannelAccess): void {
  requireAllowed(canListMentionCandidates(actor, channel));
}
