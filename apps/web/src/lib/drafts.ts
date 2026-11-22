// Unsent drafts, kept in this browser (screens.md › Baseline behaviours; conventions.md ›
// Forms › Drafts). Each key starts ping:draft:<staffMemberId>:, so one Staff member never
// sees another's, and signing out clears them all. Storage can be missing or blocked, so
// a draft that can't be kept is simply not kept.

const PREFIX = 'ping:draft:';

/** The key for one draft: whose it is, and where it was written. */
export function draftKey(staffMemberId: string, ...place: string[]): string {
  return `${PREFIX}${[staffMemberId, ...place].join(':')}`;
}

/** The saved draft, or null when there's none (or it can't be read). */
export function readDraft<T>(key: string): T | null {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? null : (JSON.parse(saved) as T);
  } catch {
    return null;
  }
}

/** Saves the draft; null removes it. */
export function saveDraft(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept; the form still holds it until it closes.
  }
}

/** Removes every draft in this browser. Signing out calls it. */
export function clearDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}
