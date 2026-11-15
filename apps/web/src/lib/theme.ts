// The colour theme: the Staff member's choice (System, Light or Dark), kept in this
// browser. A small external store read with useSyncExternalStore, so it needs no React
// context and no effect. public/theme-init.js applies the same choice before first
// paint, so the page never flashes the wrong theme.
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Shared with public/theme-init.js. */
const STORAGE_KEY = 'ping-theme';
const listeners = new Set<() => void>();
// Absent outside a browser, such as in unit tests that import the router.
const systemDark =
  typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');

export const isThemeChoice = (value: unknown): value is ThemeChoice =>
  value === 'system' || value === 'light' || value === 'dark';

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    // No storage, or it's blocked (private windows, strict settings): follow the system.
    return 'system';
  }
}

let choice = readChoice();

function apply() {
  const dark = choice === 'dark' || (choice === 'system' && Boolean(systemDark?.matches));
  document.documentElement.classList.toggle('dark', dark);
}

systemDark?.addEventListener('change', () => {
  if (choice === 'system') apply();
});

export function setThemeChoice(next: ThemeChoice) {
  choice = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not saved, but it still applies for this visit.
  }
  apply();
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The current choice. Changes re-render the caller. */
export const useThemeChoice = () => useSyncExternalStore(subscribe, () => choice);
