import { describe, expect, it } from 'vitest';
import { emojiSchema, isSingleEmoji, threadReactionParams } from './reaction';

describe('isSingleEmoji', () => {
  it.each([
    ['a thumbs up', '👍'],
    ['a heart with a variation selector', '❤️'],
    ['a skin tone', '👍🏽'],
    ['a family (a joined sequence)', '👨‍👩‍👧‍👦'],
    ['a flag', '🇪🇸'],
    ['a keycap', '1️⃣'],
    ['a party popper', '🎉'],
  ])('accepts %s', (_name, emoji) => {
    expect(isSingleEmoji(emoji)).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['a letter', 'a'],
    ['a word', 'yes'],
    ['a digit', '1'],
    ['two emoji', '👍🎉'],
    ['an emoji with text', '👍 ok'],
    ['a space', ' '],
    ['a very long sequence', '👍'.repeat(40)],
  ])('refuses %s', (_name, text) => {
    expect(isSingleEmoji(text)).toBe(false);
  });
});

describe('emojiSchema', () => {
  it('accepts one emoji', () => {
    expect(emojiSchema.parse('🎉')).toBe('🎉');
  });

  it('says what to do when it is not one emoji', () => {
    const result = emojiSchema.safeParse('hello');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Pick a single emoji to react with.');
  });
});

describe('threadReactionParams', () => {
  const ids = {
    channelId: '00000000-0000-4000-8000-000000000001',
    threadId: '00000000-0000-4000-8000-000000000002',
  };

  it('reads the emoji from the route', () => {
    expect(threadReactionParams.parse({ ...ids, emoji: '👍' }).emoji).toBe('👍');
  });

  it('refuses a route whose emoji is not one', () => {
    expect(threadReactionParams.safeParse({ ...ids, emoji: 'nope' }).success).toBe(false);
  });
});
