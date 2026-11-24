// Attachments, as the Thread and Thread Response features attach and show them (data-model.md
// › On Threads and Thread Responses). Features don't share code, but both may use db/, like
// mention.ts. Every query runs in the request's transaction as ping_app, so row-level
// security applies: a pending Attachment is visible, and attachable, only to its uploader.
import type { AttachmentView, RemovedAttachmentView } from '@ping/shared';
import { and, count, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { AttachRequest } from '../permissions/attachment';
import type { Tx } from './index';
import { attachment, pendingFileDeletion, threadResponse, user } from './schema';

/** A Thread or a Thread Response: the post an Attachment is on. */
export type AttachmentPost = { threadId: string } | { threadResponseId: string };

const onPost = (post: AttachmentPost) =>
  'threadId' in post
    ? eq(attachment.threadId, post.threadId)
    : eq(attachment.threadResponseId, post.threadResponseId);

/** What attaching these IDs to the post would mean, for the permissions module. */
export async function planAttach(
  tx: Tx,
  actorId: string,
  post: AttachmentPost | undefined,
  ids: readonly string[],
): Promise<AttachRequest> {
  const [pending, existing] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([{ n: 0 }])
      : tx
          .select({ n: count() })
          .from(attachment)
          .where(
            and(
              inArray(attachment.id, [...ids]),
              isNull(attachment.channelId),
              eq(attachment.uploaderId, actorId),
            ),
          ),
    post
      ? tx
          .select({ n: count() })
          .from(attachment)
          .where(and(onPost(post), isNull(attachment.removedAt)))
      : Promise.resolve([{ n: 0 }]),
  ]);
  return {
    requested: ids.length,
    available: pending[0]?.n ?? 0,
    alreadyAttached: existing[0]?.n ?? 0,
  };
}

/**
 * Attaches the actor's pending Attachments to a post just written in this transaction.
 * The plan was checked first, so every row must move; if one didn't (another save took it
 * meanwhile), the whole save rolls back.
 */
export async function attachPending(
  tx: Tx,
  actorId: string,
  post: AttachmentPost,
  channelId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const moved = await tx
    .update(attachment)
    .set({ channelId, ...post })
    .where(
      and(
        inArray(attachment.id, [...ids]),
        isNull(attachment.channelId),
        eq(attachment.uploaderId, actorId),
      ),
    )
    .returning({ id: attachment.id });
  if (moved.length !== ids.length) throw new Error('A pending Attachment changed while saving');
}

type AttachmentPostColumn = typeof attachment.threadId | typeof attachment.threadResponseId;

/** One Attachment as JSON, in the AttachmentView shape. */
const attachmentJson = sql`jsonb_build_object(
  'id', ${attachment.id},
  'filename', ${attachment.originalFilename},
  'contentType', ${attachment.contentType},
  'sizeBytes', ${attachment.sizeBytes},
  'isImage', ${attachment.contentType} like 'image/%')`;

/** An Attachment as the Thread view loads it: with its uploader, who may remove it. */
export type PostedAttachmentRow = AttachmentView & { uploaderId: string };

/**
 * The Attachments on the post whose ID is `id`, oldest first, as JSON; the first `limit`
 * of them when it's given.
 */
export function attachmentsSql(
  target: AttachmentPostColumn,
  id: SQL | AnyPgColumn,
  limit?: number,
): SQL<AttachmentView[]> {
  return liveAttachmentsSql(attachmentJson, target, id, limit);
}

/** Every Attachment on the post whose ID is `id`, oldest first, with its uploader. */
export function postedAttachmentsSql(
  target: AttachmentPostColumn,
  id: SQL | AnyPgColumn,
): SQL<PostedAttachmentRow[]> {
  return liveAttachmentsSql(
    sql`${attachmentJson} || jsonb_build_object('uploaderId', ${attachment.uploaderId})`,
    target,
    id,
  );
}

function liveAttachmentsSql<T>(
  json: SQL,
  target: AttachmentPostColumn,
  id: SQL | AnyPgColumn,
  limit?: number,
): SQL<T[]> {
  const firstOnly = limit === undefined ? sql`` : sql`limit ${limit}`;
  return sql<T[]>`coalesce((
    select jsonb_agg(a.item order by a.created_at, a.id) from (
      select ${json} as item, ${attachment.createdAt} as created_at, ${attachment.id} as id
        from ${attachment}
       where ${target} = ${id} and ${attachment.removedAt} is null
       order by ${attachment.createdAt}, ${attachment.id}
       ${firstOnly}) a), '[]'::jsonb)`;
}

/** How many Attachments the post whose ID is `id` has. */
export function attachmentCountSql(
  target: AttachmentPostColumn,
  id: SQL | AnyPgColumn,
): SQL<number> {
  return sql<number>`(
    select count(*)::int from ${attachment}
     where ${target} = ${id} and ${attachment.removedAt} is null)`;
}

/**
 * The "Attachment removed by <name>" placeholders on the post whose ID is `id`, oldest
 * first, as JSON. Nothing about the file itself.
 */
export function removedAttachmentsSql(
  target: AttachmentPostColumn,
  id: SQL | AnyPgColumn,
): SQL<RemovedAttachmentView[]> {
  return sql<RemovedAttachmentView[]>`coalesce((
    select jsonb_agg(
             jsonb_build_object('id', ${attachment.id}, 'removedByName', ${user.name})
             order by ${attachment.createdAt}, ${attachment.id})
      from ${attachment}
      join ${user} on ${user.id} = ${attachment.removedBy}
     where ${target} = ${id} and ${attachment.removedAt} is not null), '[]'::jsonb)`;
}

/**
 * Queues the files of the Attachments still showing on a Thread and its Thread Responses,
 * before the Thread is deleted and its rows cascade away. Removed ones, and those on a
 * deleted Thread Response, were queued when that happened.
 */
export async function queueThreadFiles(tx: Tx, threadId: string): Promise<void> {
  await queueFiles(
    tx,
    sql`select ${attachment.objectKey} from ${attachment}
         left join ${threadResponse} on ${threadResponse.id} = ${attachment.threadResponseId}
        where (${attachment.threadId} = ${threadId} or ${threadResponse.threadId} = ${threadId})
          and ${attachment.removedAt} is null and ${threadResponse.deletedAt} is null`,
  );
}

/** Queues the files of a Thread Response's Attachments, as it's deleted. */
export async function queueThreadResponseFiles(tx: Tx, threadResponseId: string): Promise<void> {
  await queueFiles(
    tx,
    sql`select ${attachment.objectKey} from ${attachment}
        where ${attachment.threadResponseId} = ${threadResponseId}
          and ${attachment.removedAt} is null`,
  );
}

/** Queues one removed Attachment's file. */
export async function queueFile(tx: Tx, objectKey: string): Promise<void> {
  await queueFiles(tx, sql`select ${objectKey}::uuid`);
}

/**
 * Queues files for the file-deletion sweeper (data-model.md › Housekeeping), in the
 * request's transaction, so the change and its queued deletions commit together. A file
 * already queued stays queued once.
 */
async function queueFiles(tx: Tx, objectKeys: SQL): Promise<void> {
  await tx.execute(
    sql`insert into ${pendingFileDeletion} (object_key) ${objectKeys} on conflict do nothing`,
  );
}
