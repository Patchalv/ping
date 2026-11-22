// Thread Responses: the request schemas both apps use, and the shapes the server answers
// with.
import { z } from 'zod';
import type { ContentActions, EditedMark } from './edited';
import { EMPTY_RICH_TEXT, extractBodyText, type RichTextDoc, richTextDoc } from './rich-text';
import { type ThreadAuthor, threadParams } from './thread';

const EMPTY_MESSAGE = 'Write something before sending.';

/**
 * POST …/threads/:threadId/responses (send) and PATCH …/responses/:threadResponseId
 * (edit). The body passes the allowlist and has some text in it.
 */
export const threadResponseBody = z.object({
  body: richTextDoc
    .default(EMPTY_RICH_TEXT)
    .refine((doc) => extractBodyText(doc).trim() !== '', EMPTY_MESSAGE),
});
export type ThreadResponseBody = z.input<typeof threadResponseBody>;

/** Routes under …/threads/:threadId/responses/:threadResponseId. */
export const threadResponseParams = threadParams.extend({
  threadResponseId: z.uuid({ error: 'That isn’t a Thread Response.' }),
});

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

/** "1 Thread Response", "3 Thread Responses". */
export function threadResponseCount(count: number): string {
  return `${count} ${count === 1 ? 'Thread Response' : 'Thread Responses'}`;
}
