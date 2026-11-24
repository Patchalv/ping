// Threads: the request schemas both apps use, and the shapes the server answers with.
import { z } from 'zod';
import {
  type AttachmentView,
  attachmentIds,
  type PostedAttachmentView,
  type RemovedAttachmentView,
} from './attachment';
import { channelParams } from './channel';
import type { ContentActions, EditedMark } from './edited';
import type { MentionNames } from './mention';
import type { ThreadPing } from './ping';
import type { ReactionSummary } from './reaction';
import { EMPTY_RICH_TEXT, type RichTextDoc, richTextDoc } from './rich-text';
import type { SystemThreadEvent } from './system-thread';

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
  /** Pending Attachments the save attaches; an edit adds them to those already there. */
  attachmentIds,
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
 * The SPA's open-Thread route: `response` is a Thread Response to scroll to, as a search
 * result opens it. A garbled one is ignored, so the Thread still opens.
 */
export const threadRouteSearch = z.object({
  response: z.uuid().optional().catch(undefined),
});

/**
 * The Thread list controls (product.md › A Channel's Thread list): Status, Pings ("with"
 * means Threads where the viewer has a Ping now), sort and direction. Each choice falls
 * back to its default, so a view stored by an older version still reads.
 */
const status = z.enum(['open', 'resolved', 'all'], { error: 'Choose Open, Resolved or All.' });
const pings = z.enum(['all', 'with'], { error: 'Choose All or With Pings.' });
const sort = z.enum(['latest_activity', 'date_started'], {
  error: 'Choose Latest activity or Date started.',
});
const direction = z.enum(['desc', 'asc'], { error: 'Choose newest or oldest first.' });

export const threadListView = z.object({
  status: status.catch('open'),
  pings: pings.catch('all'),
  sort: sort.catch('latest_activity'),
  direction: direction.catch('desc'),
});
export type ThreadListView = z.infer<typeof threadListView>;

export const DEFAULT_THREAD_LIST_VIEW: ThreadListView = threadListView.parse({});

/**
 * GET /api/channels/:channelId/threads: one view of the list. Unlike a stored view, an
 * unknown choice here is a mistake, so it's refused. `after` is the last Thread of the
 * page before, for Load more.
 */
export const listThreadsQuery = z.object({
  status: status.default('open'),
  pings: pings.default('all'),
  sort: sort.default('latest_activity'),
  direction: direction.default('desc'),
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
  /**
   * What a System thread announces, with the current names of the people involved; null
   * for an ordinary Thread. Its title is already written from it.
   */
  system: SystemThreadEvent | null;
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
  /** Whether the Thread is on the viewer's Saved list. */
  isSaved: boolean;
  /** When the Thread was resolved, or null while it's open. */
  resolvedAt: string | null;
  /** "@You": the viewer is Mentioned in the Thread or one of its Thread Responses. */
  mentionsYou: boolean;
  /** The Thread's first Attachments, oldest first (THREAD_ROW_ATTACHMENTS of them). */
  attachments: AttachmentView[];
  /** How many Attachments the Thread has in all. */
  attachmentCount: number;
};

/** How many Attachments a Thread row shows. */
export const THREAD_ROW_ATTACHMENTS = 3;

/** A page of one view of a Channel's Thread list. */
export type ThreadPage = {
  threads: ThreadRow[];
  /** Pass as `after` to load the next page; null when this is the last. */
  nextCursor: string | null;
  /**
   * "N Resolved hidden": the Resolved threads the Open view leaves out that the Pings
   * choice would show. 0 in the Resolved and All views.
   */
  resolvedHidden: number;
};

/**
 * A Thread as the Thread view shows it, and what the viewer may do with it. Its Thread
 * Responses load separately.
 */
export type ThreadView = Omit<ThreadRow, 'preview'> & {
  /** Every Attachment on the Thread, oldest first. */
  attachments: PostedAttachmentView[];
  /** The placeholders of removed Attachments, oldest first. */
  removedAttachments: RemovedAttachmentView[];
  body: RichTextDoc;
  /** The current name of everyone Mentioned in the body. */
  mentionNames: MentionNames;
  edited: EditedMark | null;
  /** Whether the viewer may send a Thread Response here. */
  canRespond: boolean;
  /** The viewer's open Ping on the Thread, or null. */
  ping: ThreadPing | null;
  /** Whether the viewer muted this Thread (not the whole Channel). */
  isMuted: boolean;
  /**
   * Whether the viewer may resolve the Thread, or reopen it when it's Resolved: the
   * Channel's "Who can resolve threads?" setting decides both.
   */
  canResolve: boolean;
} & ContentActions;
