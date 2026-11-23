import { DEFAULT_THREAD_LIST_VIEW } from '@ping/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readThreadListView, saveThreadListView, threadListViewKey } from './list-view';

/** A Map-backed localStorage: the unit tests run in Node, which has none. */
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const frontDesk = '00000000-0000-4000-8000-0000000000c1';
const teaching = '00000000-0000-4000-8000-0000000000c2';

describe('the Thread list view kept in the browser', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keys each Channel’s view by the Channel', () => {
    expect(threadListViewKey(frontDesk)).toBe(`ping:thread-list:${frontDesk}`);
  });

  it('starts from the defaults when nothing is kept', () => {
    expect(readThreadListView(frontDesk)).toEqual(DEFAULT_THREAD_LIST_VIEW);
  });

  it('keeps a view per Channel', () => {
    const view = { status: 'all', pings: 'with', sort: 'date_started', direction: 'asc' } as const;
    saveThreadListView(frontDesk, view);
    expect(readThreadListView(frontDesk)).toEqual(view);
    expect(readThreadListView(teaching)).toEqual(DEFAULT_THREAD_LIST_VIEW);
  });

  it('falls back to the defaults for a kept value it can’t read', () => {
    localStorage.setItem(threadListViewKey(frontDesk), '{not json');
    expect(readThreadListView(frontDesk)).toEqual(DEFAULT_THREAD_LIST_VIEW);
    localStorage.setItem(threadListViewKey(frontDesk), JSON.stringify({ status: 'closed' }));
    expect(readThreadListView(frontDesk)).toEqual(DEFAULT_THREAD_LIST_VIEW);
  });

  it('works without storage: the defaults, and a save that does nothing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readThreadListView(frontDesk)).toEqual(DEFAULT_THREAD_LIST_VIEW);
    expect(() => saveThreadListView(frontDesk, DEFAULT_THREAD_LIST_VIEW)).not.toThrow();
  });
});
