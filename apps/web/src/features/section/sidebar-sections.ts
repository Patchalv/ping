// The sidebar's Sections as pure functions: which Channels go where, which a collapsed
// Section still shows, and the cache after a move (screens.md › Sidebar).
import type { PlaceChannelBody, SectionView, SidebarChannel } from '@ping/shared';

export type SectionGroup = { section: SectionView; channels: SidebarChannel[] };

/**
 * Splits the Staff member's Channels into their Sections, in each Section's order, and the
 * default Channels section, by name. A placement for a Channel they're no longer in is
 * skipped. While the Sections load, every Channel sits in the default section.
 */
export function groupChannels(
  channels: SidebarChannel[],
  sections: SectionView[] | undefined,
): { sections: SectionGroup[]; unplaced: SidebarChannel[] } {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const groups = (sections ?? []).map((section) => ({
    section,
    channels: section.channelIds.flatMap((id) => byId.get(id) ?? []),
  }));
  const placed = new Set(groups.flatMap((g) => g.channels.map((c) => c.id)));
  const unplaced = channels
    .filter((c) => !placed.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { sections: groups, unplaced };
}

/** A collapsed Section still shows its Channels that have Pings. */
export function shownChannels(
  channels: SidebarChannel[],
  collapsed: boolean,
  pingCountIn: (channelId: string) => number,
): SidebarChannel[] {
  return collapsed ? channels.filter((c) => pingCountIn(c.id) > 0) : channels;
}

export type Placement = { channelId: string } & PlaceChannelBody;

/** The Sections after moving a Channel, as the server will have them. */
export function placeIn(
  sections: SectionView[],
  { channelId, sectionId, position }: Placement,
): SectionView[] {
  return sections.map((s) => {
    const rest = s.channelIds.filter((id) => id !== channelId);
    if (s.id !== sectionId) return { ...s, channelIds: rest };
    const at = Math.min(position ?? rest.length, rest.length);
    return { ...s, channelIds: [...rest.slice(0, at), channelId, ...rest.slice(at)] };
  });
}

/**
 * The Section order after moving one: up (-1) or down (1) by one, from its menu, or
 * before another, from a drag. Past either end, nothing changes.
 */
export function moveSection(
  sectionIds: string[],
  sectionId: string,
  move: -1 | 1 | { before: string },
): string[] {
  const from = sectionIds.indexOf(sectionId);
  if (from === -1) return sectionIds;
  const rest = sectionIds.filter((id) => id !== sectionId);
  const to = typeof move === 'number' ? from + move : rest.indexOf(move.before);
  if (to < 0 || to > rest.length) return sectionIds;
  return [...rest.slice(0, to), sectionId, ...rest.slice(to)];
}
