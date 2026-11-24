import { describe, expect, it } from 'vitest';
import { mentionChanges, mentionedStaffIds, withCurrentMentionNames } from './mention';
import { extractBodyText, type RichTextDoc } from './rich-text';

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

describe('withCurrentMentionNames', () => {
  it('shows each Mentioned person’s current name, wherever the Mention sits', () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Ask ' }, mention(LAURA, 'Laura')] },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'blockquote',
                  content: [{ type: 'paragraph', content: [mention(JORDI, 'Jordi')] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const current = withCurrentMentionNames(doc, {
      [LAURA]: 'Laura Gómez-Puig',
      [JORDI]: 'Jordi Puig i Vidal',
    });
    expect(current).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Ask ' }, mention(LAURA, 'Laura Gómez-Puig')],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'blockquote',
                  content: [{ type: 'paragraph', content: [mention(JORDI, 'Jordi Puig i Vidal')] }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('keeps the name a Mention was made with when there is no current name for it', () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [mention(PABLO, 'Pablo')] }],
    };
    expect(withCurrentMentionNames(doc, { [LAURA]: 'Laura Gómez-Puig' })).toEqual(doc);
  });

  it('finds the current name whatever the letter case of the stored ID', () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [mention(LAURA.toUpperCase(), 'Laura')] }],
    };
    expect(extractBodyText(withCurrentMentionNames(doc, { [LAURA]: 'Laura Gómez-Puig' }))).toBe(
      '@Laura Gómez-Puig',
    );
  });

  it('leaves the saved body as it was', () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [mention(LAURA, 'Laura')] }],
    };
    const saved = JSON.parse(JSON.stringify(doc));
    withCurrentMentionNames(doc, { [LAURA]: 'Laura Gómez-Puig' });
    expect(doc).toEqual(saved);
  });

  it('updates Mentions in headings and code blocks, and keeps empty blocks', () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [mention(LAURA, 'Laura')] },
        { type: 'codeBlock', content: [mention(LAURA, 'Laura')] },
        { type: 'paragraph' },
        { type: 'bulletList' },
      ],
    };
    expect(extractBodyText(withCurrentMentionNames(doc, { [LAURA]: 'Laura Gómez-Puig' }))).toBe(
      '@Laura Gómez-Puig\n@Laura Gómez-Puig',
    );
  });
});
