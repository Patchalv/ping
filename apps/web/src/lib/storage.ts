// localStorage for per-browser preferences (theme, sidebar width). Storage can be missing
// or blocked (private windows, strict settings, unit tests), so a read falls back to null
// and a failed write only means the choice lasts for this visit.

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not saved; it still applies until the page reloads.
  }
}
