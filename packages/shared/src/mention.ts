// Mentions (product.md › Mentions). A Mention node stores the Staff member's ID, so the
// server rebuilds the `mention` rows from the body on every save, and the people an edit
// adds are the only ones it Pings.
import type { RichTextBlock, RichTextDoc, RichTextInline, RichTextListItem } from './rich-text';

/** Someone the @ picker offers: an active Staff member who can read the Thread. */
export type MentionCandidate = { staffId: string; name: string };

export type MentionCandidateList = { candidates: MentionCandidate[] };

/**
 * The current name of everyone Mentioned in a body, by Staff ID, so a rename never leaves
 * an old name behind.
 */
export type MentionNames = Record<string, string>;

/**
 * Everyone Mentioned in a body, once each, in the order they first appear. IDs are
 * lower-cased, as Postgres writes a uuid.
 */
export function mentionedStaffIds(doc: RichTextDoc): string[] {
  const found = new Set<string>();
  const inlines = (nodes: readonly RichTextInline[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === 'mention') found.add(node.attrs.id.toLowerCase());
    }
  };
  const blocks = (nodes: readonly (RichTextBlock | RichTextListItem)[] | undefined) => {
    for (const node of nodes ?? []) {
      switch (node.type) {
        case 'paragraph':
        case 'heading':
        case 'codeBlock':
          inlines(node.content);
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
  return [...found];
}

export type MentionChanges = { added: string[]; removed: string[] };

/**
 * How a save changes who is Mentioned: `added` are the newly Mentioned, the only people
 * an edit Pings; `removed` lose their Mention.
 */
export function mentionChanges(
  before: readonly string[],
  after: readonly string[],
): MentionChanges {
  const was = new Set(before);
  const now = new Set(after);
  return {
    added: after.filter((id) => !was.has(id)),
    removed: before.filter((id) => !now.has(id)),
  };
}
