// The Section feature's queries. Each takes the request's ActorTx from withActorTx, so
// row-level security applies to every one: the actor reads and changes only their own
// Sections and placements, and someone else's Section reads as missing.
import type { SectionView } from '@ping/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import type { PlacementAccess } from '../../permissions/section';

const { channel, channelMember, section, sectionChannel } = schema;

const sectionOrder = [asc(section.position), asc(section.createdAt), asc(section.id)];

/**
 * The actor's Sections in their order, each with its Channels in theirs. Only Channels
 * they're still a member of: leaving one drops its placement, and this keeps the sidebar
 * right even before that has run.
 */
export async function listSections({ tx, actor }: ActorTx): Promise<SectionView[]> {
  // One after the other: a transaction is one connection, which runs one query at a time.
  const sections = await tx
    .select({ id: section.id, name: section.name, collapsed: section.collapsed })
    .from(section)
    .orderBy(...sectionOrder);
  const placements = await tx
    .select({ sectionId: sectionChannel.sectionId, channelId: sectionChannel.channelId })
    .from(sectionChannel)
    .innerJoin(
      channelMember,
      and(
        eq(channelMember.channelId, sectionChannel.channelId),
        eq(channelMember.staffId, actor.staffId),
      ),
    )
    .orderBy(asc(sectionChannel.position), asc(sectionChannel.channelId));
  return sections.map((s) => ({
    ...s,
    channelIds: placements.filter((p) => p.sectionId === s.id).map((p) => p.channelId),
  }));
}

/** One of the actor's Sections, or undefined when it's missing or someone else's. */
export async function findSection(
  ctx: ActorTx,
  sectionId: string,
): Promise<SectionView | undefined> {
  return (await listSections(ctx)).find((s) => s.id === sectionId);
}

/** Whether the Section is the actor's own: someone else's reads as missing. */
export async function isOwnSection({ tx }: ActorTx, sectionId: string): Promise<boolean> {
  const rows = await tx.select({ id: section.id }).from(section).where(eq(section.id, sectionId));
  return rows.length > 0;
}

/** + New section: below the actor's other Sections. Returns its ID. */
export async function createSection({ tx, actor }: ActorTx, name: string): Promise<string> {
  const [row] = await tx
    .insert(section)
    .values({
      staffId: actor.staffId,
      name,
      position: sql`(select coalesce(max(${section.position}) + 1, 0) from ${section})`,
    })
    .returning({ id: section.id });
  if (!row) throw new Error('A created Section did not read back');
  return row.id;
}

/** Renames a Section, or collapses or expands it. False when it's missing or someone else's. */
export async function updateSection(
  { tx }: ActorTx,
  sectionId: string,
  changes: { name?: string | undefined; collapsed?: boolean | undefined },
): Promise<boolean> {
  const rows = await tx
    .update(section)
    .set({
      ...(changes.name === undefined ? {} : { name: changes.name }),
      ...(changes.collapsed === undefined ? {} : { collapsed: changes.collapsed }),
    })
    .where(eq(section.id, sectionId))
    .returning({ id: section.id });
  return rows.length > 0;
}

/**
 * Deletes a Section. Its placements cascade, which moves its Channels back to the default
 * Channels section. False when it's missing or someone else's.
 */
export async function deleteSection({ tx }: ActorTx, sectionId: string): Promise<boolean> {
  const rows = await tx
    .delete(section)
    .where(eq(section.id, sectionId))
    .returning({ id: section.id });
  return rows.length > 0;
}

/** The IDs of all the actor's Sections. */
export async function listSectionIds({ tx }: ActorTx): Promise<string[]> {
  const rows = await tx.select({ id: section.id }).from(section);
  return rows.map((row) => row.id);
}

/** Puts the actor's Sections in this order. */
export async function setSectionOrder({ tx }: ActorTx, sectionIds: string[]): Promise<void> {
  if (sectionIds.length === 0) return;
  await tx
    .update(section)
    .set({
      position: sql`array_position(${sql.param(sectionIds)}::uuid[], ${section.id}) - 1`,
    })
    .where(inArray(section.id, sectionIds));
}

/**
 * The Channel, as the permissions module needs it to place it: its visibility and whether
 * the actor is a member. Undefined when it's missing or hidden.
 */
export async function findPlacementChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<PlacementAccess | undefined> {
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

/** Moves a Channel back to the default Channels section: deletes its placement. */
export async function unplaceChannel({ tx, actor }: ActorTx, channelId: string): Promise<void> {
  await tx
    .delete(sectionChannel)
    .where(and(eq(sectionChannel.staffId, actor.staffId), eq(sectionChannel.channelId, channelId)));
}

/**
 * Places a Channel in one of the actor's Sections at `position` (its end when left out or
 * past it), and renumbers that Section's Channels from 0. The Section it leaves keeps its
 * order; gaps in it don't matter.
 */
export async function placeChannel(
  ctx: ActorTx,
  channelId: string,
  sectionId: string,
  position: number | undefined,
): Promise<void> {
  const { tx, actor } = ctx;
  await unplaceChannel(ctx, channelId);
  const rest = await tx
    .select({ channelId: sectionChannel.channelId })
    .from(sectionChannel)
    .where(eq(sectionChannel.sectionId, sectionId))
    .orderBy(asc(sectionChannel.position), asc(sectionChannel.channelId));
  const ordered = rest.map((row) => row.channelId);
  ordered.splice(Math.min(position ?? ordered.length, ordered.length), 0, channelId);
  await tx
    .insert(sectionChannel)
    .values(
      ordered.map((id, index) => ({
        staffId: actor.staffId,
        channelId: id,
        sectionId,
        position: index,
      })),
    )
    .onConflictDoUpdate({
      target: [sectionChannel.staffId, sectionChannel.channelId],
      set: { position: sql`excluded.position` },
    });
}
