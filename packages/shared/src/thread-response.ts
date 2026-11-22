// Thread Responses: the request schemas both apps use, and the shapes the server answers
// with.
import { z } from 'zod';
import { EMPTY_RICH_TEXT, extractBodyText, type RichTextDoc, richTextDoc } from './rich-text';
import { type ThreadAuthor, threadParams } from './thread';

export const THREAD_RESPONSE_MESSAGES = {
  empty: 'Write something before sending.',
} as const;

/**
 * POST …/threads/:threadId/responses (send) and PATCH …/responses/:threadResponseId
 * (edit). The body passes the allowlist and has some text in it.
 */
export const threadResponseBody = z.object({
  body: richTextDoc
    .default(EMPTY_RICH_TEXT)
    .refine((doc) => extractBodyText(doc).trim() !== '', THREAD_RESPONSE_MESSAGES.empty),
});
export type ThreadResponseBody = z.input<typeof threadResponseBody>;

/** Routes under …/threads/:threadId/responses/:threadResponseId. */
export const threadResponseParams = threadParams.extend({
  threadResponseId: z.uuid({ error: 'That isn’t a Thread Response.' }),
});

/**
 * The "edited" mark. `by` is set only when someone other than the author made the last
 * edit, for "edited by <name>".
 */
export type EditedMark = { at: string; by: { staffId: string; name: string } | null };

/**
 * What the viewer may do with a Thread or Thread Response, decided by the server's
 * permissions module. The web only hides the controls they can't use.
 */
export type ContentActions = { canEdit: boolean; canDelete: boolean };

/** A Thread Response as the Thread view shows it. A deleted one has no body. */
export type ThreadResponseView = {
  id: string;
  threadId: string;
  author: ThreadAuthor;
  createdAt: string;
  edited: EditedMark | null;
  /** Null once deleted: the "Thread Response deleted" placeholder. */
  body: RichTextDoc | null;
  isDeleted: boolean;
} & ContentActions;

/** GET …/threads/:threadId/responses: all of a Thread's Thread Responses, oldest first. */
export type ThreadResponseList = { responses: ThreadResponseView[] };
