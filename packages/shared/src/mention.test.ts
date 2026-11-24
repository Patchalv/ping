import { describe, expect, it } from 'vitest';
import { mentionChanges, mentionedStaffIds } from './mention';
import type { RichTextDoc } from './rich-text';

const JORDI = '00000000-0000-4000-8000-000000000001';
const LAURA = '00000000-0000-4000-8000-000000000002';
const PABLO = '00000000-0000-4000-8000-000000000003';

const mention = (id: string, label = 'Someone') =>
  ({ type: 'mention', attrs: { id, label, mentionSuggestionChar: '@' } }) as const;

describe('mentionedStaffIds', () => {
  it('finds no one in a body without Mentions', () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    };
    expect(mentionedStaffIds(doc)).toEqual([]);
  });

  it('finds Mentions in every kind of block, once each, in order', () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, mention(LAURA)] },
        { type: 'heading', attrs: { level: 2 }, content: [mention(JORDI)] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [mention(LAURA)] }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [mention(PABLO, 'Pablo')] }],
            },
          ],
        },
      ],
    };
    expect(mentionedStaffIds(doc)).toEqual([LAURA, JORDI, PABLO]);
  });

  it('treats IDs in any letter case as the same Staff member', () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [mention(LAURA), mention(LAURA.toUpperCase())] }],
    };
    expect(mentionedStaffIds(doc)).toEqual([LAURA]);
  });
});

describe('mentionChanges', () => {
  it('finds everyone newly Mentioned in a new post', () => {
    expect(mentionChanges([], [JORDI, LAURA])).toEqual({ added: [JORDI, LAURA], removed: [] });
  });

  it('finds only the people an edit adds, and those it drops', () => {
    expect(mentionChanges([JORDI, LAURA], [LAURA, PABLO])).toEqual({
      added: [PABLO],
      removed: [JORDI],
    });
  });

  it('finds no one new when an edit keeps the same Mentions', () => {
    expect(mentionChanges([JORDI, LAURA], [LAURA, JORDI])).toEqual({ added: [], removed: [] });
  });
});
