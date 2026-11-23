// Reads a rich-text body (ProseMirror JSON on the allowlist, ADR 0003) as React elements.
// Never HTML: every node becomes a known element, and a link the server would refuse
// renders as plain text.
import {
  isAllowedLinkHref,
  type MentionNames,
  type RichTextBlock,
  type RichTextDoc,
  type RichTextInline,
  type RichTextListItem,
  type RichTextMark,
} from '@ping/shared';
import type { ReactNode } from 'react';
import { cn } from '#/lib/utils';
import { PROSE } from './prose';

export function RichTextView({
  doc,
  mentionNames,
  className,
}: {
  doc: RichTextDoc;
  /** The current name of everyone Mentioned, so a rename shows everywhere. */
  mentionNames: MentionNames;
  className?: string;
}) {
  return <div className={cn(PROSE, className)}>{blocks(doc.content, mentionNames)}</div>;
}

// Headings render two levels down: the page and the Thread title sit above them.
const HEADING = { 1: 'h3', 2: 'h4', 3: 'h5' } as const;

function blocks(
  nodes: readonly (RichTextBlock | RichTextListItem)[] | undefined,
  names: MentionNames,
): ReactNode[] {
  return (nodes ?? []).map((node, index) => block(node, `${node.type}-${index}`, names));
}

function block(
  node: RichTextBlock | RichTextListItem,
  key: string,
  names: MentionNames,
): ReactNode {
  switch (node.type) {
    case 'paragraph':
      // An empty paragraph keeps its line, as it did in the editor.
      return <p key={key}>{node.content?.length ? inlines(node.content, names) : <br />}</p>;
    case 'heading': {
      const Tag = HEADING[node.attrs.level];
      return (
        <Tag key={key} data-level={node.attrs.level} className="font-bold">
          {inlines(node.content, names)}
        </Tag>
      );
    }
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{inlines(node.content, names)}</code>
        </pre>
      );
    case 'blockquote':
      return <blockquote key={key}>{blocks(node.content, names)}</blockquote>;
    case 'bulletList':
      return <ul key={key}>{blocks(node.content, names)}</ul>;
    case 'orderedList':
      return (
        <ol key={key} start={node.attrs?.start ?? undefined}>
          {blocks(node.content, names)}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{blocks(node.content, names)}</li>;
  }
}

function inlines(nodes: readonly RichTextInline[] | undefined, names: MentionNames): ReactNode[] {
  return (nodes ?? []).map((node, index) => inline(node, `${node.type}-${index}`, names));
}

function inline(node: RichTextInline, key: string, names: MentionNames): ReactNode {
  switch (node.type) {
    case 'text':
      return <MarkedText key={key} text={node.text} marks={node.marks ?? []} />;
    case 'hardBreak':
      return <br key={key} />;
    case 'mention':
      // The Mention stores the ID: show the person's current name, or the name it was made
      // with if the server didn't send one.
      return (
        <span key={key} className="font-semibold text-primary">
          @{names[node.attrs.id.toLowerCase()] ?? node.attrs.label ?? 'someone'}
        </span>
      );
  }
}

/** Wraps the text in each of its marks, innermost first. */
function MarkedText({ text, marks }: { text: string; marks: readonly RichTextMark[] }) {
  return marks.reduceRight<ReactNode>((inner, mark) => wrap(mark, inner), text);
}

function wrap(mark: RichTextMark, inner: ReactNode): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong>{inner}</strong>;
    case 'italic':
      return <em>{inner}</em>;
    case 'underline':
      return <u>{inner}</u>;
    case 'strike':
      return <s>{inner}</s>;
    case 'code':
      return <code>{inner}</code>;
    case 'link':
      return isAllowedLinkHref(mark.attrs.href) ? (
        <a href={mark.attrs.href} target="_blank" rel="noopener noreferrer nofollow">
          {inner}
        </a>
      ) : (
        inner
      );
  }
}
