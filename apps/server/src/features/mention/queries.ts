// The Mention feature's queries: the @ picker's list. Each takes the request's ActorTx from
// withActorTx, so row-level security applies: a Private channel the actor isn't in reads
// as missing. (Saving Mentions with a post lives in db/mention.ts, which the Thread and
// Thread Response features share.)
import type { MentionCandidate } from '@ping/shared';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import type { ChannelAccess } from '../../permissions/channel';

const { channel, channelMember, staffMember, user } = schema;

/** The Channel as the permissions module needs it, or undefined when missing or hidden. */
export async function findMentionChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<ChannelAccess | undefined> {
  const [row] = await tx
    .select({
      visibility: channel.visibility,
      isMember: sql<boolean>`${channelMember.staffId} is not null`,
    })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(eq(channel.id, channelId));
  return row;
}

/**
 * Everyone who can read the Channel's Threads, by name: every active Staff member for a
 * Public channel, only its active members for a Private one. Invited and Deactivated
 * people never appear.
 */
export async function listMentionCandidates(
  { tx }: ActorTx,
  channelId: string,
  visibility: ChannelAccess['visibility'],
): Promise<MentionCandidate[]> {
  const inChannel =
    visibility === 'public'
      ? undefined
      : sql`exists (
          select 1 from ${channelMember}
           where ${channelMember.channelId} = ${channelId}
             and ${channelMember.staffId} = ${staffMember.id})`;
  return tx
    .select({ staffId: staffMember.id, name: user.name })
    .from(staffMember)
    .innerJoin(user, eq(user.id, staffMember.id))
    .where(and(isNotNull(staffMember.joinedAt), isNull(staffMember.deactivatedAt), inChannel))
    .orderBy(asc(user.name), asc(staffMember.id));
}
