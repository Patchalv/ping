// A search result's snippet: Postgres's ts_headline marks the matched words with two
// control characters (stripped from the text first, so only ts_headline writes them), and
// the API answers with plain and matched parts, never HTML.
import type { SnippetPart } from '@ping/shared';

export const MATCH_START = '\u0002';
export const MATCH_STOP = '\u0003';

const MARK = new RegExp(`${MATCH_START}([^${MATCH_STOP}]*)${MATCH_STOP}`, 'g');

/** The parts of a ts_headline, spacing collapsed, matched words side by side joined. */
export function toSnippet(headline: string): SnippetPart[] {
  const text = headline.replace(/\s+/g, ' ').trim();
  const parts: SnippetPart[] = [];
  const push = (part: SnippetPart) => {
    if (part.text === '') return;
    const last = parts.at(-1);
    if (last && last.match === part.match) last.text += part.text;
    else parts.push(part);
  };
  let from = 0;
  for (const found of text.matchAll(MARK)) {
    const between = text.slice(from, found.index);
    // A space between two matched words belongs to the match.
    if (between === ' ' && parts.at(-1)?.match) push({ text: between, match: true });
    else push({ text: between, match: false });
    push({ text: found[1] ?? '', match: true });
    from = found.index + found[0].length;
  }
  push({ text: text.slice(from), match: false });
  return parts;
}
