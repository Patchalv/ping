// Rich text: Thread and Thread Response bodies, stored as ProseMirror JSON (ADR 0003).
// The server accepts only the allowlist below, whatever the front end sends, so the body
// schema walks the whole document. TipTap's editor emits exactly this shape.
import { z } from 'zod';

/** The most text a body may hold, across all its nodes. */
export const RICH_TEXT_MAX = 20_000;
/** How deeply blocks may nest (lists in quotes in lists…). The document is level 0. */
const MAX_DEPTH = 12;
/** How many nodes a body may hold, so a crafted document can't make the walk expensive. */
const MAX_NODES = 5_000;
const LINK_HREF_MAX = 2_048;
const LINK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_LANGUAGE = /^[a-z0-9+#-]{1,30}$/i;
const ORDERED_LIST_TYPES: ReadonlySet<unknown> = new Set([null, '1', 'a', 'A', 'i', 'I']);

// The WHATWG URL parser, global in Node and every browser. This package compiles with no
// DOM or Node types, so it declares only what it uses.
declare const URL: new (input: string) => { protocol: string };

export const RICH_TEXT_MESSAGES = {
  notAllowed: 'This text has formatting Ping doesn’t allow. Remove it and try again.',
  link: 'Links must start with http://, https:// or mailto:.',
  tooLong: `Keep the text to ${RICH_TEXT_MAX.toLocaleString('en')} characters or fewer.`,
  tooDeep: 'Lists and quotes are nested too deeply. Flatten them and try again.',
} as const;

// The allowed document, as types. Attributes match what TipTap's extensions emit.

type MarkType = 'bold' | 'italic' | 'underline' | 'strike' | 'code';
export type RichTextMark =
  | { type: MarkType }
  | {
      type: 'link';
      attrs: {
        href: string;
        target?: '_blank' | null;
        rel?: string | null;
        class?: null;
        title?: string | null;
      };
    };

export type RichTextInline =
  | { type: 'text'; text: string; marks?: RichTextMark[] }
  | { type: 'hardBreak' }
  | {
      type: 'mention';
      attrs: { id: string; label?: string | null; mentionSuggestionChar?: '@' | null };
    };

export type RichTextBlock =
  | { type: 'paragraph'; content?: RichTextInline[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3 }; content?: RichTextInline[] }
  | { type: 'codeBlock'; attrs?: { language?: string | null }; content?: RichTextInline[] }
  | { type: 'blockquote'; content?: RichTextBlock[] }
  | { type: 'bulletList'; content?: RichTextListItem[] }
  | {
      type: 'orderedList';
      attrs?: { start?: number; type?: string | null };
      content?: RichTextListItem[];
    };

export type RichTextListItem = { type: 'listItem'; content?: RichTextBlock[] };

export type RichTextDoc = { type: 'doc'; content?: RichTextBlock[] };

/** An empty document, as the editor starts. */
export const EMPTY_RICH_TEXT: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

// The walk. Each check throws Refusal with the message the Staff member sees.

class Refusal extends Error {}

const refuse = (message: string = RICH_TEXT_MESSAGES.notAllowed): never => {
  throw new Refusal(message);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const BLOCKS = new Set([
  'paragraph',
  'heading',
  'codeBlock',
  'blockquote',
  'bulletList',
  'orderedList',
]);
const INLINES = new Set(['text', 'hardBreak', 'mention']);
const TEXT_ONLY = new Set(['text']);
const LIST_ITEMS = new Set(['listItem']);
const NOTHING = new Set<string>();

/** Which children each node may hold. */
const CHILDREN: Record<string, ReadonlySet<string>> = {
  doc: BLOCKS,
  paragraph: INLINES,
  heading: INLINES,
  codeBlock: TEXT_ONLY,
  blockquote: BLOCKS,
  bulletList: LIST_ITEMS,
  orderedList: LIST_ITEMS,
  listItem: BLOCKS,
  text: NOTHING,
  hardBreak: NOTHING,
  mention: NOTHING,
};

type AttrCheck = Record<string, { required?: boolean; ok(value: unknown): boolean }>;

const nullableString = (max: number) => (value: unknown) =>
  value === null || (typeof value === 'string' && value.length <= max);

/** The attributes each node may carry. A node missing here carries none. */
const NODE_ATTRS: Record<string, AttrCheck> = {
  heading: { level: { required: true, ok: (v) => v === 1 || v === 2 || v === 3 } },
  codeBlock: {
    language: { ok: (v) => v === null || (typeof v === 'string' && CODE_LANGUAGE.test(v)) },
  },
  orderedList: {
    start: { ok: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000 },
    type: { ok: (v) => ORDERED_LIST_TYPES.has(v) },
  },
  mention: {
    id: { required: true, ok: (v) => typeof v === 'string' && UUID.test(v) },
    label: { ok: nullableString(200) },
    mentionSuggestionChar: { ok: (v) => v === null || v === '@' },
  },
};

const PLAIN_MARKS: ReadonlySet<string> = new Set(['bold', 'italic', 'underline', 'strike', 'code']);

const LINK_ATTRS: AttrCheck = {
  href: { required: true, ok: isAllowedHref },
  target: { ok: (v) => v === null || v === '_blank' },
  rel: { ok: nullableString(100) },
  class: { ok: (v) => v === null },
  title: { ok: nullableString(200) },
};

/** http, https or mailto, as an absolute URL. Relative links are refused too. */
function isAllowedHref(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > LINK_HREF_MAX) return false;
  // Control characters (a tab hiding "java\tscript:") and outer spaces are refused outright.
  const hasControl = [...value].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (value.trim() !== value || hasControl) return false;
  try {
    return LINK_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function checkAttrs(attrs: unknown, allowed: AttrCheck | undefined, onBad?: () => never): void {
  if (attrs === undefined) {
    if (allowed && Object.values(allowed).some((a) => a.required)) refuse();
    return;
  }
  if (!isRecord(attrs)) refuse();
  const rules = allowed ?? {};
  for (const [key, value] of Object.entries(attrs as Record<string, unknown>)) {
    const rule = rules[key];
    if (!rule) refuse();
    if (!rule?.ok(value)) (onBad ?? refuse)();
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (rule.required && !(key in (attrs as Record<string, unknown>))) refuse();
  }
}

function checkMarks(marks: unknown, inCodeBlock: boolean): void {
  if (marks === undefined) return;
  if (!Array.isArray(marks) || inCodeBlock) refuse();
  const seen = new Set<string>();
  for (const mark of marks as unknown[]) {
    if (!isRecord(mark) || typeof mark.type !== 'string' || seen.has(mark.type)) refuse();
    const { type, attrs, ...rest } = mark as Record<string, unknown>;
    if (Object.keys(rest).length > 0) refuse();
    seen.add(type as string);
    if (type === 'link') {
      checkAttrs(attrs, LINK_ATTRS, () => refuse(RICH_TEXT_MESSAGES.link));
    } else if (PLAIN_MARKS.has(type as string)) {
      checkAttrs(attrs, undefined);
    } else {
      refuse();
    }
  }
}

const NODE_KEYS: ReadonlySet<string> = new Set(['type', 'attrs', 'content', 'text', 'marks']);

type Budget = { nodes: number; chars: number };

function checkNode(
  node: unknown,
  allowed: ReadonlySet<string>,
  parent: string,
  depth: number,
  budget: Budget,
): void {
  if (depth > MAX_DEPTH) refuse(RICH_TEXT_MESSAGES.tooDeep);
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) refuse(RICH_TEXT_MESSAGES.tooLong);
  if (!isRecord(node) || typeof node.type !== 'string' || !allowed.has(node.type)) refuse();
  const record = node as Record<string, unknown>;
  const type = record.type as string;
  if (Object.keys(record).some((key) => !NODE_KEYS.has(key))) refuse();
  checkAttrs(record.attrs, NODE_ATTRS[type]);

  if (type === 'text') {
    if (typeof record.text !== 'string' || record.text.length === 0) refuse();
    budget.chars += (record.text as string).length;
    if (budget.chars > RICH_TEXT_MAX) refuse(RICH_TEXT_MESSAGES.tooLong);
    checkMarks(record.marks, parent === 'codeBlock');
    if (record.content !== undefined) refuse();
    return;
  }
  if (record.text !== undefined || record.marks !== undefined) refuse();
  checkContent(record.content, type, depth, budget);
}

function checkContent(content: unknown, type: string, depth: number, budget: Budget): void {
  const allowed = CHILDREN[type] ?? NOTHING;
  if (content === undefined) return;
  if (!Array.isArray(content) || allowed.size === 0) refuse();
  if ((type === 'bulletList' || type === 'orderedList') && (content as unknown[]).length === 0) {
    refuse();
  }
  for (const child of content as unknown[]) checkNode(child, allowed, type, depth + 1, budget);
}

/** Why a document is refused, or null when every node is on the allowlist. */
function problemWith(value: unknown): string | null {
  try {
    if (!isRecord(value) || value.type !== 'doc') refuse();
    const { type: _type, content, ...rest } = value as Record<string, unknown>;
    if (Object.keys(rest).length > 0) refuse();
    checkContent(content, 'doc', 0, { nodes: 0, chars: 0 });
    return null;
  } catch (error) {
    if (error instanceof Refusal) return error.message;
    throw error;
  }
}

/**
 * The plain text of a body, for search and previews (`body_text`). Blocks and hard breaks
 * become new lines, so words never run together; empty blocks are skipped. A Mention is
 * written as @ and the name it was made with.
 */
export function extractBodyText(doc: RichTextDoc): string {
  const lines: string[] = [];
  const blocks = (nodes: readonly (RichTextBlock | RichTextListItem)[] | undefined) => {
    for (const node of nodes ?? []) {
      switch (node.type) {
        case 'paragraph':
        case 'heading':
        case 'codeBlock':
          lines.push(...inline(node.content).split('\n'));
          break;
        case 'blockquote':
        case 'bulletList':
        case 'orderedList':
        case 'listItem':
          blocks(node.content);
          break;
      }
    }
  };
  blocks(doc.content);
  return lines.filter((line) => line.length > 0).join('\n');
}

function inline(nodes: readonly RichTextInline[] | undefined): string {
  return (nodes ?? []).map(inlineText).join('');
}

function inlineText(node: RichTextInline): string {
  switch (node.type) {
    case 'text':
      return node.text;
    case 'hardBreak':
      return '\n';
    case 'mention':
      return node.attrs.label ? `@${node.attrs.label}` : '@';
  }
}

/**
 * A rich-text body. Refuses any node, mark, attribute or link scheme outside the
 * allowlist, and documents that are too long or nested too deeply.
 */
export const richTextDoc = z.unknown().transform((value, ctx): RichTextDoc => {
  const problem = problemWith(value);
  if (problem !== null) {
    ctx.addIssue({ code: 'custom', message: problem });
    return z.NEVER;
  }
  return value as RichTextDoc;
});
