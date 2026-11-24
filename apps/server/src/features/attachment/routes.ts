// The Attachment routes. Each follows the exemplar (features/channel/routes.ts): signedIn,
// validate(), all the work in withActorTx with a require… helper inside it.
//
// - addAttachmentRoutes, mounted at /api/channels/:channelId/attachments: add a file while
//   writing a post. It's pending, visible only to its uploader, until the post is saved
//   (the Thread and Thread Response routes attach it). Nobody else can see it, so it
//   publishes nothing (test/publish-coverage.ts).
// - attachmentRoutes, mounted at /api/attachments: open one, through a signed link, or
//   remove one, which keeps an "Attachment removed by <name>" placeholder and queues its file
//   for the file-deletion sweeper.
import { randomUUID } from 'node:crypto';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MESSAGES,
  addAttachmentForm,
  attachmentParams,
  channelParams,
  isImageType,
} from '@ping/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError, ServiceUnavailableError } from '../../lib/errors';
import { publish } from '../../lib/sse/publish';
import type { Storage } from '../../lib/storage/storage';
import { validate } from '../../lib/validate';
import {
  requireCanAddAttachment,
  requireCanDownloadAttachment,
  requireCanRemoveAttachment,
} from '../../permissions/attachment';
import { fileIssue, prepareFile } from './prepare-file';
import {
  auditAdminRemoval,
  findAttachmentChannel,
  findDownloadTarget,
  findRemoveTarget,
  insertPendingAttachment,
  removeAttachment,
} from './queries';

type Options = { auth: Auth; database: Database; storage?: Storage };

/** A multipart body's own overhead (boundaries, headers) on top of the file. */
const MULTIPART_OVERHEAD = 64 * 1024;

/** Storage isn't configured in a deployment until its secrets are set (config.ts). */
function requireStorage(storage: Storage | undefined): Storage {
  if (!storage) {
    throw new ServiceUnavailableError('Attachments aren’t set up yet. Try again later.');
  }
  return storage;
}

export function addAttachmentRoutes({ auth, database, storage }: Options) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // Add a file while writing: whoever may post or edit in the Channel. The body limit
      // stops reading past 20 MB, so a huge upload can't fill the server's memory.
      .post(
        '/',
        signedIn(auth),
        bodyLimit({
          maxSize: ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD,
          onError: () => {
            throw fileIssue(ATTACHMENT_MESSAGES.tooLarge);
          },
        }),
        validate('param', channelParams),
        validate('form', addAttachmentForm),
        async (c) => {
          const { channelId } = c.req.valid('param');
          const { file } = c.req.valid('form');
          const added = await withActorTx(c, async (ctx) => {
            const access = await findAttachmentChannel(ctx, channelId);
            if (!access) throw new NotFoundError();
            requireCanAddAttachment(ctx.actor, access);
            const store = requireStorage(storage);
            const prepared = prepareFile(file, new Uint8Array(await file.arrayBuffer()));
            const objectKey = randomUUID();
            const view = await insertPendingAttachment(ctx, {
              objectKey,
              filename: prepared.filename,
              contentType: prepared.contentType,
              sizeBytes: prepared.content.length,
            });
            // Stored before the row commits: a failed store rolls the row back. A commit
            // that fails after the store leaves an object no row points to; the sweepers
            // (#51) only see rows, so that rare case stays until a storage clean-up.
            await store.put(objectKey, prepared.content, {
              filename: prepared.filename,
              contentType: prepared.contentType,
              inline: isImageType(prepared.contentType),
            });
            return view;
          });
          return c.json(added, 201);
        },
      )
  );
}

export function attachmentRoutes({ auth, database, storage }: Options) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // Open an Attachment: anyone who can read its Thread (a pending one, only its
      // uploader). Redirects to a signed link that expires in under 5 minutes, served as a
      // download, or inline for images, with the type the server detected.
      .get('/:attachmentId', signedIn(auth), validate('param', attachmentParams), async (c) => {
        const { attachmentId } = c.req.valid('param');
        const link = await withActorTx(c, async (ctx) => {
          const target = await findDownloadTarget(ctx, attachmentId);
          if (!target) throw new NotFoundError();
          requireCanDownloadAttachment(ctx.actor, target);
          return requireStorage(storage).signedDownloadUrl(target.objectKey, {
            filename: target.filename,
            contentType: target.contentType,
            inline: isImageType(target.contentType),
          });
        });
        c.header('X-Content-Type-Options', 'nosniff');
        return c.redirect(link, 302);
      })

      // Remove an Attachment: its uploader, the Channel's admins, or a company Admin, in a
      // Channel they can read, Archived ones included. The file is deleted for real by the
      // sweeper; the placeholder stays.
      .delete('/:attachmentId', signedIn(auth), validate('param', attachmentParams), async (c) => {
        const { attachmentId } = c.req.valid('param');
        const target = await withActorTx(c, async (ctx) => {
          const found = await findRemoveTarget(ctx, attachmentId);
          if (!found) throw new NotFoundError();
          requireCanRemoveAttachment(ctx.actor, found);
          if (!(await removeAttachment(ctx, attachmentId))) throw new NotFoundError();
          await auditAdminRemoval(ctx, found);
          return found;
        });
        const { channelId, threadId, threadResponseId } = target;
        publish(
          threadResponseId
            ? { kind: 'thread_response.changed', channelId, threadId, threadResponseId }
            : { kind: 'thread.changed', channelId, threadId },
        );
        return c.body(null, 204);
      })
  );
}
