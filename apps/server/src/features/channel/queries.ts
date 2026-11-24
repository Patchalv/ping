// The Channel feature's queries. Each takes the request's ActorTx from withActorTx, so
// row-level security applies to every one and the actor always matches app.staff_id: a
// Private channel the actor isn't in reads as missing.
import type {
  BrowseChannel,
  ChannelMemberView,
  ChannelView,
  MemberCandidate,
  ResolvePolicy,
  SidebarChannel,
} from '@ping/shared';
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import type { AuditEventKind } from '../../db/schema';
import type { ChannelAdminTarget } from '../../permissions/channel';

const { auditEvent, channel, channelMember, mute, staffMember, user } = schema;

/** Whether the actor muted the whole Channel. */
const isMuted = (actorId: string) => sql<boolean>`exists (
  select 1 from ${mute}
   where ${mute.channelId} = ${channel.id} and ${mute.staffId} = ${actorId}::uuid
     and ${mute.threadId} is null)`;

/** A Channel's active members: "member" means an active member, so Deactivated ones don't count. */
const memberCount = sql<number>`(
  select count(*)::int from ${channelMember}
    join ${staffMember} on ${staffMember.id} = ${channelMember.staffId}
   where ${channelMember.channelId} = ${channel.id} and ${staffMember.deactivatedAt} is null)`;

/** A Channel as the actor sees it, or undefined when it's missing or hidden. */
export async function findChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<ChannelView | undefined> {
  const rows = await tx
    .select({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      visibility: channel.visibility,
      resolvePolicy: channel.resolvePolicy,
      memberCount,
      isChannelAdmin: channelMember.isChannelAdmin,
      isArchived: sql<boolean>`${channel.archivedAt} is not null`,
      isMuted: isMuted(actor.staffId),
    })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(eq(channel.id, channelId));
  const row = rows[0];
  if (!row) return undefined;
  const { isChannelAdmin, ...rest } = row;
  // The left join finds the actor's own channel_member row, or nothing.
  return { ...rest, isMember: isChannelAdmin !== null, isChannelAdmin: isChannelAdmin ?? false };
}

/**
 * The Channels the actor is a member of, by name. Filtered on their own channel_member
 * rows: row-level security alone would also return every Public channel.
 */
export function listMemberChannels({ tx, actor }: ActorTx): Promise<SidebarChannel[]> {
  return tx
    .select({
      id: channel.id,
      name: channel.name,
      visibility: channel.visibility,
      isMuted: isMuted(actor.staffId),
    })
    .from(channel)
    .innerJoin(channelMember, eq(channelMember.channelId, channel.id))
    .where(eq(channelMember.staffId, actor.staffId))
    .orderBy(asc(channel.name), asc(channel.id));
}

/**
 * Browse channels: every Public channel that isn't Archived (nobody can join those), by
 * name. Filtered on visibility: row-level security alone would also return the actor's
 * Private channels.
 */
export async function listPublicChannels({ tx, actor }: ActorTx): Promise<BrowseChannel[]> {
  const rows = await tx
    .select({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      memberCount,
      actorRow: channelMember.staffId,
    })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(and(eq(channel.visibility, 'public'), isNull(channel.archivedAt)))
    .orderBy(asc(channel.name), asc(channel.id));
  return rows.map(({ actorRow, ...rest }) => ({ ...rest, isMember: actorRow !== null }));
}

/**
 * Adds the actor to a Channel as a plain member. joined_at is left to its default, the
 * transaction's time, which row-level security insists on. Someone already in it is left
 * as they were, joined_at included: it decides who is auto-promoted on a Deactivation.
 */
export async function joinChannel({ tx, actor }: ActorTx, channelId: string): Promise<void> {
  await tx
    .insert(channelMember)
    .values({ channelId, staffId: actor.staffId })
    .onConflictDoNothing();
}

/**
 * Takes the Channel's membership lock for the rest of the transaction. Every change that
 * could leave a Channel without an active Channel admin (leaving now; removing members
 * and Channel admin roles later) takes it before reading who is Channel admin, so two such
 * changes at once can't both see the other's Channel admin still there.
 */
export async function lockChannelMembership({ tx }: ActorTx, channelId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('ping.channel_membership'), hashtext(${channelId}))`,
  );
}

/** Who else is in the Channel: its other active members and active Channel admins. */
export async function countOthersInChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<{ otherActiveMembers: number; otherActiveChannelAdmins: number }> {
  const rows = await tx
    .select({
      otherActiveMembers: sql<number>`count(*)::int`,
      otherActiveChannelAdmins: sql<number>`(count(*) filter (where ${channelMember.isChannelAdmin}))::int`,
    })
    .from(channelMember)
    .innerJoin(staffMember, eq(staffMember.id, channelMember.staffId))
    .where(
      and(
        eq(channelMember.channelId, channelId),
        ne(channelMember.staffId, actor.staffId),
        isNull(staffMember.deactivatedAt),
      ),
    );
  return rows[0] ?? { otherActiveMembers: 0, otherActiveChannelAdmins: 0 };
}

/** Deletes the actor's own membership. */
export async function leaveChannel({ tx, actor }: ActorTx, channelId: string): Promise<void> {
  await tx
    .delete(channelMember)
    .where(and(eq(channelMember.channelId, channelId), eq(channelMember.staffId, actor.staffId)));
}

// Members and Channel admins (#37).

/**
 * A Channel's members for its Members tab: Channel admins first, then by name. Deactivated
 * members stay listed, flagged, so the tab can grey them. The caller has checked the actor
 * can read the Channel; row-level security would hide a Private one anyway.
 */
export async function listChannelMembers(
  { tx }: ActorTx,
  channelId: string,
): Promise<ChannelMemberView[]> {
  return tx
    .select({
      staffId: channelMember.staffId,
      name: user.name,
      isChannelAdmin: channelMember.isChannelAdmin,
      isDeactivated: sql<boolean>`${staffMember.deactivatedAt} is not null`,
    })
    .from(channelMember)
    .innerJoin(staffMember, eq(staffMember.id, channelMember.staffId))
    .innerJoin(user, eq(user.id, channelMember.staffId))
    .where(eq(channelMember.channelId, channelId))
    .orderBy(
      desc(channelMember.isChannelAdmin),
      sql`${staffMember.deactivatedAt} is not null`,
      asc(user.name),
      asc(channelMember.staffId),
    );
}

/**
 * Who the add-members picker offers, by name: active Staff members (not Invited, not
 * Deactivated) who aren't in the Channel.
 */
export async function listMemberCandidates(
  { tx }: ActorTx,
  channelId: string,
): Promise<MemberCandidate[]> {
  return tx
    .select({ staffId: staffMember.id, name: user.name })
    .from(staffMember)
    .innerJoin(user, eq(user.id, staffMember.id))
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channelId), eq(channelMember.staffId, staffMember.id)),
    )
    .where(
      and(
        isNotNull(staffMember.joinedAt),
        isNull(staffMember.deactivatedAt),
        isNull(channelMember.staffId),
      ),
    )
    .orderBy(asc(user.name), asc(staffMember.id));
}

/**
 * Someone a membership change is about: whether they're an active Staff member (an unknown
 * ID isn't), and their place in the Channel. `otherActiveChannelAdmins` counts the
 * Channel's active Channel admins apart from them.
 */
export async function findMemberTarget(
  { tx }: ActorTx,
  channelId: string,
  staffId: string,
): Promise<ChannelAdminTarget> {
  const [person] = await tx
    .select({
      isActiveStaff: sql<boolean>`${staffMember.joinedAt} is not null and ${staffMember.deactivatedAt} is null`,
    })
    .from(staffMember)
    .where(eq(staffMember.id, staffId));
  const [membership] = await tx
    .select({ isChannelAdmin: channelMember.isChannelAdmin })
    .from(channelMember)
    .where(and(eq(channelMember.channelId, channelId), eq(channelMember.staffId, staffId)));
  const [admins] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(channelMember)
    .innerJoin(staffMember, eq(staffMember.id, channelMember.staffId))
    .where(
      and(
        eq(channelMember.channelId, channelId),
        ne(channelMember.staffId, staffId),
        eq(channelMember.isChannelAdmin, true),
        isNull(staffMember.deactivatedAt),
      ),
    );
  return {
    staffId,
    isActiveStaff: person?.isActiveStaff ?? false,
    isMember: membership !== undefined,
    isChannelAdmin: membership?.isChannelAdmin ?? false,
    otherActiveChannelAdmins: admins?.count ?? 0,
  };
}

/**
 * Adds someone as a plain member, at the transaction's time (row-level security insists).
 * Someone already in it is left as they were. Returns whether they were added.
 */
export async function addChannelMember(
  { tx }: ActorTx,
  channelId: string,
  staffId: string,
): Promise<boolean> {
  const added = await tx
    .insert(channelMember)
    .values({ channelId, staffId })
    .onConflictDoNothing()
    .returning({ staffId: channelMember.staffId });
  return added.length > 0;
}

/** Deletes someone's membership. */
export async function removeChannelMember(
  { tx }: ActorTx,
  channelId: string,
  staffId: string,
): Promise<void> {
  await tx
    .delete(channelMember)
    .where(and(eq(channelMember.channelId, channelId), eq(channelMember.staffId, staffId)));
}

/**
 * Appoints a member as Channel admin or removes the role, as the Channel's Channel admin.
 * Returns whether it changed anything.
 */
export async function setChannelAdminRole(
  { tx }: ActorTx,
  channelId: string,
  staffId: string,
  isChannelAdmin: boolean,
): Promise<boolean> {
  const changed = await tx
    .update(channelMember)
    .set({ isChannelAdmin })
    .where(
      and(
        eq(channelMember.channelId, channelId),
        eq(channelMember.staffId, staffId),
        ne(channelMember.isChannelAdmin, isChannelAdmin),
      ),
    )
    .returning({ staffId: channelMember.staffId });
  return changed.length > 0;
}

/** Records a membership change in audit_event, as the actor. */
export async function recordMembershipChange(
  { tx, actor }: ActorTx,
  kind: Extract<AuditEventKind, `channel_${string}`>,
  channelId: string,
  targetStaffId: string,
): Promise<void> {
  await tx.insert(auditEvent).values({ actorId: actor.staffId, kind, channelId, targetStaffId });
}

// Channel settings (#42).

/**
 * Changes a Channel's name, description and "Who can resolve threads?", whichever are
 * given, as its Channel admin. Never its visibility: makeChannelPrivate does that.
 */
export async function updateChannelSettings(
  { tx }: ActorTx,
  channelId: string,
  settings: { name?: string; description?: string; resolvePolicy?: ResolvePolicy },
): Promise<void> {
  const { name, description, resolvePolicy } = settings;
  if (name === undefined && description === undefined && resolvePolicy === undefined) return;
  // Drizzle leaves out the ones that are undefined.
  await tx
    .update(channel)
    .set({ name, description, resolvePolicy })
    .where(eq(channel.id, channelId));
}

/** Records a Channel turning Private in audit_event, as the actor. */
export async function recordChannelMadePrivate(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<void> {
  await tx
    .insert(auditEvent)
    .values({ actorId: actor.staffId, kind: 'channel_made_private', channelId });
}
