import { describe, expect, it } from 'vitest';
import { extractBodyText, RICH_TEXT_MESSAGES, richTextDoc } from './rich-text';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const link = (href: string) => ({
  type: 'link',
  attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null },
});
const item = (...content: unknown[]) => ({ type: 'listItem', content });

const refusal = (body: unknown) => {
  const result = richTextDoc.safeParse(body);
  return result.success ? null : result.error.issues.map((issue) => issue.message);
};

/**
 * Everything the composer can produce, in the JSON TipTap 3's StarterKit emits (checked
 * against editor.getJSON() in the browser).
 */
const everyAllowedFormat = doc(
  { type: 'heading', attrs: { level: 1 }, content: [text('Heading 1')] },
  { type: 'heading', attrs: { level: 2 }, content: [text('Heading 2')] },
  { type: 'heading', attrs: { level: 3 }, content: [text('Heading 3')] },
  p(
    text('bold', [{ type: 'bold' }]),
    text(' italic', [{ type: 'italic' }]),
    text(' underline', [{ type: 'underline' }]),
    text(' strike', [{ type: 'strike' }]),
    text(' code', [{ type: 'code' }]),
    text(' both', [{ type: 'bold' }, { type: 'italic' }]),
    { type: 'hardBreak' },
    text('a link', [link('https://example.com/path?q=1')]),
    text(' mail', [link('mailto:someone@example.com')]),
    text(' plain', [link('http://example.com')]),
    text(' 🎉 emoji'),
    // A line break inside formatted text carries the marks around it.
    text('linked', [link('https://example.com')]),
    { type: 'hardBreak', marks: [link('https://example.com'), { type: 'bold' }] },
    text('lines', [link('https://example.com')]),
  ),
  { type: 'codeBlock', attrs: { language: null }, content: [text('const x = 1;')] },
  { type: 'blockquote', content: [p(text('Quoted'))] },
  {
    type: 'bulletList',
    content: [item(p(text('One')), { type: 'bulletList', content: [item(p(text('Nested')))] })],
  },
  { type: 'orderedList', attrs: { start: 1, type: null }, content: [item(p(text('First')))] },
  p(text('Hi '), {
    type: 'mention',
    attrs: {
      id: '00000000-0000-4000-8000-000000000001',
      label: 'Jordi Puig',
      mentionSuggestionChar: '@',
    },
    marks: [{ type: 'bold' }],
  }),
  { type: 'paragraph' },
);

describe('richTextDoc', () => {
  it('accepts a paragraph of plain text', () => {
    const body = doc(p(text('Hello')));
    expect(richTextDoc.parse(body)).toEqual(body);
  });

  it('accepts every allowed format', () => {
    expect(refusal(everyAllowedFormat)).toBeNull();
  });

  it('accepts the empty document the editor starts with', () => {
    expect(refusal(doc({ type: 'paragraph' }))).toBeNull();
    expect(refusal({ type: 'doc' })).toBeNull();
  });

  it.each([
    ['a horizontal rule', doc({ type: 'horizontalRule' })],
    ['an image', doc({ type: 'image', attrs: { src: 'https://example.com/x.png' } })],
    ['a table', doc({ type: 'table', content: [] })],
    ['an unknown mark', doc(p(text('x', [{ type: 'highlight' }])))],
    ['a text style mark', doc(p(text('x', [{ type: 'textStyle', attrs: { color: 'red' } }])))],
    ['a style attribute on a paragraph', doc({ type: 'paragraph', attrs: { style: 'x' } })],
    ['a class on a heading', doc({ type: 'heading', attrs: { level: 1, class: 'x' } })],
    ['a heading level 4', doc({ type: 'heading', attrs: { level: 4 }, content: [text('x')] })],
    ['a heading with no level', doc({ type: 'heading', content: [text('x')] })],
    ['text directly in the document', doc(text('x'))],
    ['a paragraph inside a paragraph', doc(p(p(text('x'))))],
    ['a list holding a paragraph', doc({ type: 'bulletList', content: [p(text('x'))] })],
    ['an empty list', doc({ type: 'bulletList', content: [] })],
    [
      'marks inside a code block',
      doc({ type: 'codeBlock', content: [text('x', [{ type: 'bold' }])] }),
    ],
    [
      'a hard break inside a code block',
      doc({ type: 'codeBlock', content: [{ type: 'hardBreak' }] }),
    ],
    ['an empty text node', doc(p(text('')))],
    ['the same mark twice', doc(p(text('x', [{ type: 'bold' }, { type: 'bold' }])))],
    ['an extra key on a node', doc({ type: 'paragraph', onclick: 'x' })],
    ['an extra key on a mark', doc(p(text('x', [{ type: 'bold', href: 'x' }])))],
    ['attributes on a bold mark', doc(p(text('x', [{ type: 'bold', attrs: { a: 1 } }])))],
    ['a mention without a Staff member ID', doc(p({ type: 'mention', attrs: { label: 'x' } }))],
    ['a mention whose ID is not a UUID', doc(p({ type: 'mention', attrs: { id: 'jordi' } }))],
    ['a code block language with spaces', doc({ type: 'codeBlock', attrs: { language: 'a b' } })],
    ['content that is not a list', doc({ type: 'paragraph', content: 'x' })],
    ['a document that is not a doc', { type: 'paragraph' }],
    ['a document with extra keys', { type: 'doc', content: [], html: '<b>x</b>' }],
    ['a string', '<p>Hello</p>'],
    ['null', null],
  ])('refuses %s', (_name, body) => {
    expect(refusal(body)).toEqual([RICH_TEXT_MESSAGES.notAllowed]);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['JAVASCRIPT: in capitals', 'JAVASCRIPT:alert(1)'],
    ['javascript: behind a space', ' javascript:alert(1)'],
    ['javascript: with a tab inside', 'java\tscript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['ftp:', 'ftp://example.com'],
    ['a relative link', '/channels/1'],
    ['a protocol-relative link', '//evil.example.com'],
    ['an empty link', ''],
  ])('refuses a link with %s', (_name, href) => {
    expect(refusal(doc(p(text('x', [link(href)]))))).toEqual([RICH_TEXT_MESSAGES.link]);
  });

  it('refuses a link with no href', () => {
    expect(refusal(doc(p(text('x', [{ type: 'link', attrs: {} }]))))).toEqual([
      RICH_TEXT_MESSAGES.notAllowed,
    ]);
  });

  it('refuses a link with a class or an odd target', () => {
    const odd = {
      ...link('https://example.com'),
      attrs: { href: 'https://example.com', target: '_top' },
    };
    expect(refusal(doc(p(text('x', [odd]))))).toEqual([RICH_TEXT_MESSAGES.link]);
  });

  it('refuses more than 20,000 characters of text', () => {
    expect(refusal(doc(p(text('x'.repeat(20_000)))))).toBeNull();
    expect(refusal(doc(p(text('x'.repeat(10_000))), p(text('x'.repeat(10_001)))))).toEqual([
      RICH_TEXT_MESSAGES.tooLong,
    ]);
  });

  it('refuses blocks nested too deeply, without overflowing the stack', () => {
    let nested: unknown = p(text('deep'));
    for (let i = 0; i < 10_000; i++) nested = { type: 'blockquote', content: [nested] };
    expect(refusal(doc(nested))).toEqual([RICH_TEXT_MESSAGES.tooDeep]);
  });

  it('allows a few levels of nested lists', () => {
    let nested: unknown = p(text('deep'));
    for (let i = 0; i < 4; i++) nested = { type: 'bulletList', content: [item(nested)] };
    expect(refusal(doc(nested))).toBeNull();
  });

  it('refuses a document with too many nodes', () => {
    const many = Array.from({ length: 6_000 }, () => ({ type: 'paragraph' }));
    expect(refusal(doc(...many))).toEqual([RICH_TEXT_MESSAGES.tooLong]);
  });
});

describe('extractBodyText', () => {
  it('joins blocks and hard breaks with new lines, so words never run together', () => {
    const body = richTextDoc.parse(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
        p(text('Hello', [{ type: 'bold' }]), text(' world'), { type: 'hardBreak' }, text('again')),
        { type: 'bulletList', content: [item(p(text('One'))), item(p(text('Two')))] },
        { type: 'blockquote', content: [p(text('Quoted'))] },
        { type: 'codeBlock', attrs: { language: null }, content: [text('a\nb')] },
      ),
    );
    expect(extractBodyText(body)).toBe('Title\nHello world\nagain\nOne\nTwo\nQuoted\na\nb');
  });

  it('keeps link text, not the link', () => {
    const body = richTextDoc.parse(doc(p(text('the docs', [link('https://example.com')]))));
    expect(extractBodyText(body)).toBe('the docs');
  });

  it('writes a Mention as @ and the name it was made with', () => {
    const mention = {
      type: 'mention',
      attrs: { id: '00000000-0000-4000-8000-000000000001', label: 'Laura Gomez' },
    };
    const body = richTextDoc.parse(doc(p(text('Ask '), mention, text(' first'))));
    expect(extractBodyText(body)).toBe('Ask @Laura Gomez first');
  });

  it('is empty for an empty document, and skips empty blocks', () => {
    expect(extractBodyText(richTextDoc.parse(doc({ type: 'paragraph' })))).toBe('');
    const sparse = doc({ type: 'paragraph' }, p(text('x')), { type: 'paragraph' });
    expect(extractBodyText(richTextDoc.parse(sparse))).toBe('x');
  });
});
