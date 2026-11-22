// Reactions: the emoji rule and the shapes the server answers with (product.md › Reactions).
import { z } from 'zod';
import { threadParams } from './thread';
import { threadResponseParams } from './thread-response';

/** The most characters one emoji may take: the longest family or flag sequences fit. */
const EMOJI_MAX_LENGTH = 32;

const EMOJI_MESSAGE = 'Pick a single emoji to react with.';

/** One emoji sign: a pictograph, a flag (two regional indicators) or a keycap. */
const EMOJI_START = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]️?⃣)/u;

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Whether `text` is exactly one emoji (a ZWJ sequence or a skin tone counts as one). */
export function isSingleEmoji(text: string): boolean {
  if (text.length === 0 || text.length > EMOJI_MAX_LENGTH) return false;
  const parts = [...graphemes.segment(text)];
  return parts.length === 1 && EMOJI_START.test(text);
}

/** Any Unicode emoji, once. A word, a letter or several emoji are refused. */
const emojiSchema = z
  .string({ error: EMOJI_MESSAGE })
  .trim()
  .refine(isSingleEmoji, { error: EMOJI_MESSAGE });

/** Routes …/threads/:threadId/reactions/:emoji (the emoji, URL-encoded). */
export const threadReactionParams = threadParams.extend({ emoji: emojiSchema });

/** Routes …/responses/:threadResponseId/reactions/:emoji. */
export const threadResponseReactionParams = threadResponseParams.extend({ emoji: emojiSchema });

/** One emoji on a Thread or Thread Response: how many reacted, and whether the viewer did. */
export type ReactionSummary = { emoji: string; count: number; reacted: boolean };

/** What adding or removing a reaction answers: the target's reactions now. */
export type ReactionList = { reactions: ReactionSummary[] };
