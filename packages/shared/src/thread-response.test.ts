import { describe, expect, it } from 'vitest';
import { RICH_TEXT_MESSAGES } from './rich-text';
import { threadResponseBody, threadResponseCount, threadResponseParams } from './thread-response';

const EMPTY = 'Write something before sending.';

describe('threadResponseCount', () => {
  it.each([
    [0, '0 Thread Responses'],
    [1, '1 Thread Response'],
    [3, '3 Thread Responses'],
  ])('reads %i as "%s"', (count, label) => {
    expect(threadResponseCount(count)).toBe(label);
  });
});

const body = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fixed it' }] }],
};

describe('threadResponseBody', () => {
  it('accepts a body with text in it', () => {
    expect(threadResponseBody.parse({ body })).toEqual({ body });
  });

  it.each([
    ['no body', {}, EMPTY],
    ['an empty document', { body: { type: 'doc', content: [{ type: 'paragraph' }] } }, EMPTY],
    [
      'a body of only spaces',
      {
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
        },
      },
      EMPTY,
    ],
    [
      'a body outside the allowlist',
      { body: { type: 'doc', content: [{ type: 'horizontalRule' }] } },
      RICH_TEXT_MESSAGES.notAllowed,
    ],
  ])('refuses %s, saying what to do', (_name, input, message) => {
    const result = threadResponseBody.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['body', message],
    ]);
  });
});

describe('threadResponseParams', () => {
  const ids = {
    channelId: '00000000-0000-4000-8000-000000000001',
    threadId: '00000000-0000-4000-8000-000000000002',
    threadResponseId: '00000000-0000-4000-8000-000000000003',
  };

  it('accepts three UUIDs', () => {
    expect(threadResponseParams.parse(ids)).toEqual(ids);
  });

  it('refuses a Thread Response ID that is not a UUID', () => {
    const result = threadResponseParams.safeParse({ ...ids, threadResponseId: 'nope' });
    expect(result.error?.issues[0]?.message).toBe('That isn’t a Thread Response.');
  });
});
