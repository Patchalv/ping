import type { SectionView, SidebarChannel } from '@ping/shared';
import { describe, expect, it } from 'vitest';
import { groupChannels, moveSection, placeIn, shownChannels } from './sidebar-sections';

const channel = (id: string, name: string): SidebarChannel => ({
  id,
  name,
  visibility: 'public',
});

const section = (id: string, channelIds: string[], collapsed = false): SectionView => ({
  id,
  name: id,
  collapsed,
  channelIds,
});

const ids = (channels: SidebarChannel[]) => channels.map((c) => c.id);

describe('groupChannels', () => {
  const channels = [channel('c', 'Cleaning'), channel('a', 'Admissions'), channel('b', 'Building')];

  it('puts each placed Channel in its Section, in the Section’s order', () => {
    const { sections } = groupChannels(channels, [section('s1', ['c', 'a'])]);
    expect(sections.map((s) => ids(s.channels))).toEqual([['c', 'a']]);
  });

  it('leaves unplaced Channels in the default section, by name', () => {
    const { unplaced } = groupChannels(channels, [section('s1', ['b'])]);
    expect(ids(unplaced)).toEqual(['a', 'c']);
  });

  it('skips a placement whose Channel the Staff member is no longer in', () => {
    const { sections } = groupChannels(channels, [section('s1', ['gone', 'a'])]);
    expect(sections.map((s) => ids(s.channels))).toEqual([['a']]);
  });

  it('puts every Channel in the default section while Sections are loading', () => {
    expect(ids(groupChannels(channels, undefined).unplaced)).toEqual(['a', 'b', 'c']);
  });
});

describe('shownChannels', () => {
  const channels = [channel('a', 'A'), channel('b', 'B')];
  const pingCountIn = (id: string) => (id === 'b' ? 2 : 0);

  it('shows every Channel of an expanded Section', () => {
    expect(ids(shownChannels(channels, false, pingCountIn))).toEqual(['a', 'b']);
  });

  it('shows only the Channels with Pings in a collapsed Section', () => {
    expect(ids(shownChannels(channels, true, pingCountIn))).toEqual(['b']);
  });
});

describe('placeIn', () => {
  const sections = [section('s1', ['a', 'b']), section('s2', ['c'])];

  it('moves a Channel to another Section, at its end by default', () => {
    expect(placeIn(sections, { channelId: 'a', sectionId: 's2' }).map((s) => s.channelIds)).toEqual(
      [['b'], ['c', 'a']],
    );
  });

  it('moves a Channel to a position, counted without it', () => {
    expect(
      placeIn(sections, { channelId: 'b', sectionId: 's1', position: 0 }).map((s) => s.channelIds),
    ).toEqual([['b', 'a'], ['c']]);
  });

  it('moves a Channel back to the default section', () => {
    expect(placeIn(sections, { channelId: 'c', sectionId: null }).map((s) => s.channelIds)).toEqual(
      [['a', 'b'], []],
    );
  });
});

describe('moveSection', () => {
  it('moves a Section up or down by one', () => {
    expect(moveSection(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveSection(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('moves a Section before another', () => {
    expect(moveSection(['a', 'b', 'c'], 'c', { before: 'a' })).toEqual(['c', 'a', 'b']);
    expect(moveSection(['a', 'b', 'c'], 'a', { before: 'c' })).toEqual(['b', 'a', 'c']);
  });

  it('leaves the order alone past either end', () => {
    expect(moveSection(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(moveSection(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
  });
});
