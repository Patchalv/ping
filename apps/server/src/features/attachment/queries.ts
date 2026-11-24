// The Attachment feature's queries. Each takes the request's ActorTx from withActorTx, so
// row-level security applies to every one: a pending Attachment is visible only to its
// uploader, and an attached one only to those who can read its Channel.
import { type AttachmentView, isImageType } from '@ping/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { ActorTx } from '../../auth/actor';
import { schema } from '../../db';
import type { DownloadAccess } from '../../permissions/attachment';
import type { ThreadChannelAccess } from '../../permissions/thread';

const { attachment, channel, channelMember, threadResponse } = schema;

/**
 * The Channel, as the permissions module needs it, or undefined when it's missing or
 * hidden. (Other features have their own; features don't share code.)
 */
export async function findAttachmentChannel(
  { tx, actor }: ActorTx,
  channelId: string,
): Promise<ThreadChannelAccess | undefined> {
  const [row] = await tx
    .select({
      visibility: channel.visibility,
      isMember: sql<boolean>`${channelMember.staffId} is not null`,
      isArchived: sql<boolean>`${channel.archivedAt} is not null`,
    })
    .from(channel)
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .where(eq(channel.id, channelId));
  return row;
}

/** Records a pending Attachment by the actor: no Channel and no post until a save. */
export async function insertPendingAttachment(
  { tx, actor }: ActorTx,
  file: { objectKey: string; filename: string; contentType: string; sizeBytes: number },
): Promise<AttachmentView> {
  const [row] = await tx
    .insert(attachment)
    .values({
      uploaderId: actor.staffId,
      objectKey: file.objectKey,
      originalFilename: file.filename,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
    })
    .returning({ id: attachment.id });
  if (!row) throw new Error('A pending Attachment did not insert');
  return {
    id: row.id,
    filename: file.filename,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    isImage: isImageType(file.contentType),
  };
}

/** What a download needs: the stored file, and who may open it. */
export type DownloadTarget = DownloadAccess & {
  objectKey: string;
  filename: string;
  contentType: string;
};

/**
 * The Attachment, or undefined when it's missing, hidden, removed, or on a deleted Thread
 * Response (whose Attachments go with its content).
 */
export async function findDownloadTarget(
  { tx, actor }: ActorTx,
  attachmentId: string,
): Promise<DownloadTarget | undefined> {
  const [row] = await tx
    .select({
      objectKey: attachment.objectKey,
      filename: attachment.originalFilename,
      contentType: attachment.contentType,
      channelId: attachment.channelId,
      uploaderId: attachment.uploaderId,
      visibility: channel.visibility,
      isMember: sql<boolean>`${channelMember.staffId} is not null`,
      isArchived: sql<boolean>`${channel.archivedAt} is not null`,
      responseDeleted: sql<boolean>`${threadResponse.deletedAt} is not null`,
      removed: sql<boolean>`${attachment.removedAt} is not null`,
    })
    .from(attachment)
    .leftJoin(channel, eq(channel.id, attachment.channelId))
    .leftJoin(
      channelMember,
      and(eq(channelMember.channelId, channel.id), eq(channelMember.staffId, actor.staffId)),
    )
    .leftJoin(threadResponse, eq(threadResponse.id, attachment.threadResponseId))
    .where(eq(attachment.id, attachmentId));
  if (!row || row.removed || row.responseDeleted) return undefined;
  const target = {
    objectKey: row.objectKey,
    filename: row.filename,
    contentType: row.contentType,
    uploaderId: row.uploaderId,
  };
  if (row.channelId === null) return { ...target, channel: null };
  // An attached Attachment's Channel is one the actor can read, or the row was hidden.
  if (!row.visibility) return undefined;
  return {
    ...target,
    channel: { visibility: row.visibility, isMember: row.isMember, isArchived: row.isArchived },
  };
}
