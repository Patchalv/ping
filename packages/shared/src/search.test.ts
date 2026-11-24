import { describe, expect, it } from 'vitest';
import { searchChannelsQuery, searchRouteSearch, searchThreadsQuery } from './search';

const CHANNEL = '0b1f7d5e-8f53-4f7a-9f3e-1d1c1e5a7b10';
const STAFF = '7c3e2a1b-4d5f-4a6b-8c7d-9e0f1a2b3c4d';

const messageOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe('searchThreadsQuery', () => {
  it('trims the text and defaults Status to All and the page to 50, with no In or From', () => {
    expect(searchThreadsQuery.parse({ q: '  rota ' })).toEqual({
      q: 'rota',
      status: 'all',
      limit: 50,
    });
  });

  it('takes a smaller page, as the query string sends it', () => {
    expect(searchThreadsQuery.parse({ q: 'rota', limit: '5' }).limit).toBe(5);
    expect(searchThreadsQuery.parse({ q: 'rota', limit: '1' }).limit).toBe(1);
    expect(searchThreadsQuery.parse({ q: 'rota', limit: '50' }).limit).toBe(50);
  });

  it('takes In, From, Status and a page cursor', () => {
    expect(
      searchThreadsQuery.parse({
        q: 'rota',
        in: CHANNEL,
        from: STAFF,
        status: 'resolved',
        after: CHANNEL,
      }),
    ).toEqual({
      q: 'rota',
      in: CHANNEL,
      from: STAFF,
      status: 'resolved',
      after: CHANNEL,
      limit: 50,
    });
  });

  it.each([
    ['no text', {}, 'Type something to search for.'],
    ['only spaces', { q: '   ' }, 'Type something to search for.'],
    ['too much text', { q: 'a'.repeat(201) }, 'Keep the search to 200 characters or fewer.'],
    ['an unknown Status', { q: 'rota', status: 'closed' }, 'Choose All, Open or Resolved.'],
    ['a bad Channel', { q: 'rota', in: 'nope' }, 'That isn’t a Channel.'],
    ['a bad person', { q: 'rota', from: 'nope' }, 'That isn’t a Staff member.'],
    ['a page of none', { q: 'rota', limit: '0' }, 'Ask for 1 to 50 Threads.'],
    ['a page too big', { q: 'rota', limit: '51' }, 'Ask for 1 to 50 Threads.'],
    ['a page in parts', { q: 'rota', limit: '2.5' }, 'Ask for 1 to 50 Threads.'],
    ['a page that isn’t a number', { q: 'rota', limit: 'abc' }, 'Ask for 1 to 50 Threads.'],
  ])('refuses %s with a plain message', (_name, query, message) => {
    expect(messageOf(searchThreadsQuery.safeParse(query))).toBe(message);
  });
});

describe('searchChannelsQuery', () => {
  it('takes only the text', () => {
    expect(searchChannelsQuery.parse({ q: ' front ' })).toEqual({ q: 'front' });
  });
});

describe('searchRouteSearch', () => {
  it('defaults to nothing typed, the All tab and Status All', () => {
    expect(searchRouteSearch.parse({})).toEqual({ q: '', tab: 'all', status: 'all' });
  });

  it('keeps the chips and the suggested Channel', () => {
    expect(
      searchRouteSearch.parse({
        q: 'rota',
        tab: 'threads',
        in: CHANNEL,
        from: STAFF,
        status: 'open',
        near: CHANNEL,
      }),
    ).toEqual({
      q: 'rota',
      tab: 'threads',
      in: CHANNEL,
      from: STAFF,
      status: 'open',
      near: CHANNEL,
    });
  });

  it('falls back to the defaults for anything a link garbled', () => {
    expect(
      searchRouteSearch.parse({ q: 5, tab: 'people', in: 'x', from: 'y', status: 'z', near: 1 }),
    ).toEqual({ q: '', tab: 'all', status: 'all' });
  });
});
