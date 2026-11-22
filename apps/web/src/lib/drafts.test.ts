import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts, draftKey, readDraft, saveDraft } from './drafts';

/** A Map-backed localStorage: the unit tests run in Node, which has none. */
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const jordi = '00000000-0000-4000-8000-0000000000a1';

describe('drafts', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keys each draft by Staff member and place', () => {
    expect(draftKey(jordi, 'new-thread', 'c1')).toBe(`ping:draft:${jordi}:new-thread:c1`);
  });

  it('saves a draft and reads it back', () => {
    const key = draftKey(jordi, 'new-thread', 'c1');
    saveDraft(key, { title: 'Heater' });
    expect(readDraft(key)).toEqual({ title: 'Heater' });
  });

  it('removes the draft when saved as null', () => {
    const key = draftKey(jordi, 'new-thread', 'c1');
    saveDraft(key, { title: 'Heater' });
    saveDraft(key, null);
    expect(readDraft(key)).toBeNull();
  });

  it('reads a damaged draft as none', () => {
    localStorage.setItem(draftKey(jordi, 'new-thread', 'c1'), '{not json');
    expect(readDraft(draftKey(jordi, 'new-thread', 'c1'))).toBeNull();
  });

  it('clears every draft on sign-out, and nothing else', () => {
    saveDraft(draftKey(jordi, 'new-thread', 'c1'), { title: 'a' });
    saveDraft(draftKey(jordi, 'new-thread', 'c2'), { title: 'b' });
    localStorage.setItem('ping-sidebar-width', '300');
    clearDrafts();
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('ping-sidebar-width')).toBe('300');
  });

  it('does nothing when storage is unavailable', () => {
    vi.unstubAllGlobals();
    const key = draftKey(jordi, 'new-thread', 'c1');
    expect(() => saveDraft(key, { title: 'x' })).not.toThrow();
    expect(readDraft(key)).toBeNull();
    expect(() => clearDrafts()).not.toThrow();
  });
});
