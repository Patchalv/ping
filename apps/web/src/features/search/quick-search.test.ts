import type { ChannelSearchResult, ThreadSearchResult } from '@ping/shared';
import { describe, expect, it } from 'vitest';
import {
  FRESH_HIGHLIGHT,
  type Highlight,
  isActionRow,
  markTitle,
  moveHighlight,
  type QuickRow,
  quickRows,
} from './quick-search';

describe('markTitle', () => {
  it('marks the words that start with a typed word, ignoring case', () => {
    expect(markTitle('Boiler room rota', 'ROT boil')).toEqual([
      { text: 'Boiler', match: true },
      { text: ' room ', match: false },
      { text: 'rota', match: true },
    ]);
  });

  it('marks another form of a typed word', () => {
    expect(markTitle('Booked the rooms', 'booking room')).toEqual([
      { text: 'Booked', match: true },
      { text: ' the ', match: false },
      { text: 'rooms', match: true },
    ]);
  });

  it('marks nothing when nothing is typed or nothing matches', () => {
    expect(markTitle('Boiler room', '  ')).toEqual([{ text: 'Boiler room', match: false }]);
    expect(markTitle('Boiler room', 'heater')).toEqual([{ text: 'Boiler room', match: false }]);
  });

  it('reads punctuation in the typed text as a gap, never as a pattern', () => {
    expect(markTitle('Room (2) is cold', '(2) .*')).toEqual([
      { text: 'Room (', match: false },
      { text: '2', match: true },
      { text: ') is cold', match: false },
    ]);
  });

  it('marks words in other alphabets', () => {
    expect(markTitle('Mañana: año nuevo', 'añ')).toEqual([
      { text: 'Mañana: ', match: false },
      { text: 'año', match: true },
      { text: ' nuevo', match: false },
    ]);
  });
});

const channel = (id: string): ChannelSearchResult => ({
  id,
  name: id,
  description: '',
  visibility: 'public',
  isArchived: false,
  isMember: true,
  latestActivityAt: '2026-11-01T00:00:00.000Z',
});

const thread = (id: string): ThreadSearchResult => ({
  id,
  channelId: 'c',
  channelName: 'c',
  channelIsArchived: false,
  title: id,
  author: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  latestActivityAt: '2026-11-01T00:00:00.000Z',
  resolvedAt: null,
  response: null,
  snippet: [],
});

const kinds = (rows: QuickRow[]) =>
  rows.map((row) =>
    row.kind === 'channel' ? row.channel.id : row.kind === 'thread' ? row.thread.id : row.kind,
  );

const SCOPE = { channelId: 'front', channelName: 'front-desk' };
const channels = ['c1', 'c2', 'c3', 'c4'].map(channel);
const threads = ['t1', 't2', 't3', 't4', 't5', 't6'].map(thread);

describe('quickRows', () => {
  it('lists All results, then up to 3 Channels and 5 Threads', () => {
    expect(kinds(quickRows({ scoped: false, channels, threads }))).toEqual([
      'all',
      'c1',
      'c2',
      'c3',
      't1',
      't2',
      't3',
      't4',
      't5',
    ]);
  });

  it('offers Only in the Channel it was opened from', () => {
    expect(kinds(quickRows({ scope: SCOPE, scoped: false, channels: [], threads: [] }))).toEqual([
      'all',
      'only',
    ]);
  });

  it('marks All results and Only in as the rows that open the search screen', () => {
    const rows = quickRows({ scope: SCOPE, scoped: false, channels, threads });
    expect(rows.filter(isActionRow).map((row) => row.kind)).toEqual(['all', 'only']);
  });

  it('shows only Threads while Only in is chosen', () => {
    expect(
      kinds(quickRows({ scope: SCOPE, scoped: true, channels, threads: threads.slice(0, 2) })),
    ).toEqual(['all', 'only', 't1', 't2']);
  });
});

describe('moveHighlight', () => {
  const rows = quickRows({
    scope: SCOPE,
    scoped: false,
    channels: channels.slice(0, 1),
    threads: [],
  });

  it('starts on All results, unscoped', () => {
    expect(FRESH_HIGHLIGHT).toEqual({ index: 0, scoped: false });
  });

  it('scopes to the Channel on Only in, and stays scoped below it', () => {
    const onOnly = moveHighlight(FRESH_HIGHLIGHT, rows, 1);
    expect(onOnly).toEqual({ index: 1, scoped: true });
    expect(moveHighlight(onOnly, rows, 1)).toEqual({ index: 2, scoped: true });
  });

  it('unscopes on All results', () => {
    const scoped: Highlight = { index: 1, scoped: true };
    expect(moveHighlight(scoped, rows, -1)).toEqual({ index: 0, scoped: false });
  });

  it('wraps at either end', () => {
    expect(moveHighlight(FRESH_HIGHLIGHT, rows, -1)).toEqual({ index: 2, scoped: false });
    expect(moveHighlight({ index: 2, scoped: false }, rows, 1)).toEqual(FRESH_HIGHLIGHT);
  });
});
