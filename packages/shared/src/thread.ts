// Threads: the request schemas both apps use, and the shapes the server answers with.
import { z } from 'zod';
import { channelParams } from './channel';
import type { ContentActions, EditedMark } from './edited';
import type { ThreadPing } from './ping';
import type { ReactionSummary } from './reaction';
import { EMPTY_RICH_TEXT, type RichTextDoc, richTextDoc } from './rich-text';

export const THREAD_TITLE_MAX = 200;
/** How many Threads a Thread list loads at a time (screens.md › Baseline behaviours). */
export const THREAD_PAGE_SIZE = 50;

/** A Thread's title and description, the same rules when starting and editing one. */
const threadContent = {
  title: z
    .string({ error: 'Give the Thread a title.' })
    .trim()
    .min(1, 'Give the Thread a title.')
    .max(THREAD_TITLE_MAX, `Keep the title to ${THREAD_TITLE_MAX} characters or fewer.`),
  body: richTextDoc.default(EMPTY_RICH_TEXT),
};

/** POST /api/channels/:channelId/threads: start a Thread. */
export const startThreadBody = z.object(threadContent);
export type StartThreadBody = z.input<typeof startThreadBody>;

/** PATCH /api/channels/:channelId/threads/:threadId: edit a Thread's title and description. */
export const editThreadBody = z.object(threadContent);
export type EditThreadBody = z.input<typeof editThreadBody>;

/** Routes under /api/channels/:channelId/threads/:threadId, and the SPA's Thread route. */
export const threadParams = channelParams.extend({
  threadId: z.uuid({ error: 'That isn’t a Thread link.' }),
});

/**
 * GET /api/channels/:channelId/threads. `after` is the last Thread of the page before,
 * for Load more.
 */
export const listThreadsQuery = z.object({
  after: z.uuid({ error: 'That isn’t a Thread.' }).optional(),
});

/** Who started a Thread. Null for a System thread, which Ping started. */
export type ThreadAuthor = { staffId: string; name: string; isDeactivated: boolean };

/** A row in a Thread list. Times are ISO strings. */
export type ThreadRow = {
  id: string;
  channelId: string;
  title: string;
  /** The start of the description, as plain text. */
  preview: string;
  author: ThreadAuthor | null;
  isSystem: boolean;
  createdAt: string;
  latestActivityAt: string;
  /** "N Thread Responses": deleted ones count, because their placeholders still show. */
  responseCount: number;
  /** Who reacted to the Thread, by emoji, in the order each emoji first appeared. */
  reactions: ReactionSummary[];
  /** Whether the viewer may react: Channel members, outside an Archived channel. */
  canReact: boolean;
  /** What's new for the viewer in the Thread: its open Ping's count, 0 with none. */
  pingCount: number;
};

/** A page of a Channel's Thread list, by Latest activity, newest first. */
export type ThreadPage = {
  threads: ThreadRow[];
  /** Pass as `after` to load the next page; null when this is the last. */
  nextCursor: string | null;
};

/**
 * A Thread as the Thread view shows it, and what the viewer may do with it. Its Thread
 * Responses load separately.
 */
export type ThreadView = Omit<ThreadRow, 'preview'> & {
  body: RichTextDoc;
  edited: EditedMark | null;
  /** Whether the viewer may send a Thread Response here. */
  canRespond: boolean;
  /** The viewer's open Ping on the Thread, or null. */
  ping: ThreadPing | null;
} & ContentActions;
