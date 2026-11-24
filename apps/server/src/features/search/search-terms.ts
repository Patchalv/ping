// Turning what a Staff member typed into a Postgres tsquery (product.md › Search ›
// Matching): every word must match, and the last one matches as a prefix while they type.
// Only letters and digits survive, so nothing typed can add a tsquery operator.

/**
 * The tsquery text for `to_tsquery('english', …)`, or null when nothing searchable is
 * left. The words still go through English stemming in Postgres.
 */
export function toPrefixTsquery(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words) return null;
  return `${words.join(' & ')}:*`;
}
