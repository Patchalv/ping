// The search dialog's pure parts (screens.md › Search): which rows it lists, how the
// arrow keys move between them, and which words of a title to mark.
import type { ChannelSearchResult, SnippetPart, ThreadSearchResult } from '@ping/shared';

/** How many of each the dialog lists; the search screen has the rest. */
const QUICK_CHANNELS = 3;
export const QUICK_THREADS = 5;

/** The Channel the dialog was opened from, which "Only in" narrows to. */
export type QuickScope = { channelId: string; channelName: string };

export type QuickRow =
  | { kind: 'all' }
  | ({ kind: 'only' } & QuickScope)
  | { kind: 'channel'; channel: ChannelSearchResult }
  | { kind: 'thread'; thread: ThreadSearchResult };

/** All results or Only in: the rows that hand off to the search screen. */
export const isActionRow = (row: QuickRow) => row.kind === 'all' || row.kind === 'only';

/**
 * The rows, in order: All results, Only in (when opened from a Channel), then the top
 * Channels and Threads. While Only in is chosen, `threads` are that Channel's and the
 * Channels are left out.
 */
export function quickRows({
  scope,
  scoped,
  channels,
  threads,
}: {
  scope?: QuickScope | undefined;
  scoped: boolean;
  channels: ChannelSearchResult[];
  threads: ThreadSearchResult[];
}): QuickRow[] {
  return [
    { kind: 'all' },
    ...(scope ? [{ kind: 'only' as const, ...scope }] : []),
    ...(scoped ? [] : channels.slice(0, QUICK_CHANNELS)).map((channel) => ({
      kind: 'channel' as const,
      channel,
    })),
    ...threads.slice(0, QUICK_THREADS).map((thread) => ({ kind: 'thread' as const, thread })),
  ];
}

/**
 * The highlighted row, and whether the list shows only the Channel's Threads. Reaching
 * Only in scopes the list and reaching All results unscopes it; the rows between keep
 * whichever was last, so arrowing past Only in doesn't swap the list under the cursor.
 */
export type Highlight = { index: number; scoped: boolean };

export const FRESH_HIGHLIGHT: Highlight = { index: 0, scoped: false };

/** Moves the highlight by `delta` rows, wrapping at either end. */
export function moveHighlight(current: Highlight, rows: QuickRow[], delta: number): Highlight {
  if (rows.length === 0) return FRESH_HIGHLIGHT;
  const index = (((current.index + delta) % rows.length) + rows.length) % rows.length;
  const kind = rows[index]?.kind;
  return { index, scoped: kind === 'only' ? true : kind === 'all' ? false : current.scoped };
}

const WORD = /[\p{L}\p{N}]+/gu;

/** A rough English stem, so "booking" marks "Booked" as the server's stemming finds it. */
const stem = (word: string) => {
  const bare = word.replace(/(ing|ed|es|s)$/, '');
  return bare.length >= 3 ? bare : word;
};

/**
 * The title, with the words that match the typed text marked: those starting with a typed
 * word, or sharing its stem. Never HTML: the parts are text.
 */
export function markTitle(title: string, typed: string): SnippetPart[] {
  const terms = typed.toLowerCase().match(WORD) ?? [];
  const matches = (word: string) => {
    const lower = word.toLowerCase();
    return terms.some((term) => lower.startsWith(term) || stem(lower) === stem(term));
  };
  const parts: SnippetPart[] = [];
  const push = (text: string, match: boolean) => {
    if (text === '') return;
    const last = parts.at(-1);
    if (last && last.match === match) last.text += text;
    else parts.push({ text, match });
  };
  let from = 0;
  for (const found of title.matchAll(WORD)) {
    push(title.slice(from, found.index), false);
    push(found[0], matches(found[0]));
    from = found.index + found[0].length;
  }
  push(title.slice(from), false);
  return parts.length > 0 ? parts : [{ text: title, match: false }];
}
