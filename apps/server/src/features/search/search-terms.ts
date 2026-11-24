// Turning what a Staff member typed into Postgres tsquery text (product.md › Search ›
// Matching): every word must match, and the last one matches as a prefix while they type.
// Only letters and digits survive, so nothing typed can add a tsquery operator.

export type SearchTerms = { words: string; last: string };

/**
 * `words`: every word but the last, all required, for `to_tsquery('english', …)` (empty
 * when there's one word). `last`: the last word as a prefix, which the query matches both
 * stemmed and as typed, so a word cut short ("of" on the way to "office") narrows the
 * results instead of being dropped as a stop word. Null when nothing searchable is left.
 */
export function toSearchTerms(text: string): SearchTerms | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  const last = words?.pop();
  if (!words || last === undefined) return null;
  return { words: words.join(' & '), last: `${last}:*` };
}
