// What the @ picker shows for what's been typed after the @.
import type { MentionCandidate } from '@ping/shared';

/** How many people the picker lists at once. */
const MENTION_PICKER_LIMIT = 8;

/** Lower case, without accents, so "@ramon" finds Ramón. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * The candidates whose name contains the query, those whose name starts with it first, in
 * their order otherwise. An empty query lists the first few.
 */
export function matchMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const wanted = fold(query.trim());
  const starts: MentionCandidate[] = [];
  const contains: MentionCandidate[] = [];
  for (const candidate of candidates) {
    const name = fold(candidate.name);
    if (name.startsWith(wanted)) starts.push(candidate);
    else if (name.includes(wanted)) contains.push(candidate);
  }
  return [...starts, ...contains].slice(0, MENTION_PICKER_LIMIT);
}
