// The Attachment routes. Each follows the exemplar (features/channel/routes.ts): signedIn,
// validate(), all the work in withActorTx with a require… helper inside it.
//
// - addAttachmentRoutes, mounted at /api/channels/:channelId/attachments: add a file while
//   writing a post. It's pending, visible only to its uploader, until the post is saved
//   (the Thread and Thread Response routes attach it). Nobody else can see it, so it
//   publishes nothing (test/publish-coverage.ts).
// - attachmentRoutes, mounted at /api/attachments: open one, through a signed link.
import { randomUUID } from 'node:crypto';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MESSAGES,
  addAttachmentForm,
  attachmentParams,
  channelParams,
  shortenFilename,
} from '@ping/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '../../lib/errors';
import type { Storage } from '../../lib/storage/storage';
import { validate } from '../../lib/validate';
import {
  requireCanAddAttachment,
  requireCanDownloadAttachment,
} from '../../permissions/attachment';
import { detectAttachmentType } from './file-type';
import { findAttachmentChannel, findDownloadTarget, insertPendingAttachment } from './queries';
import { DamagedImageError, stripImageMetadata } from './strip-metadata';

type Options = { auth: Auth; database: Database; storage?: Storage };

/** A multipart body's own overhead (boundaries, headers) on top of the file. */
const MULTIPART_OVERHEAD = 64 * 1024;

const fileIssue = (message: string) => new ValidationError(message, [{ path: 'file', message }]);

/** Storage isn't configured in a deployment until its secrets are set (config.ts). */
function requireStorage(storage: Storage | undefined): Storage {
  if (!storage) {
    throw new ServiceUnavailableError('Attachments aren’t set up yet. Try again later.');
  }
  return storage;
}

/**
 * The file as it will be stored: an allowed type, checked by its magic bytes as well as
 * its extension, and with every image's metadata stripped, whatever the browser did.
 */
function prepareFile(file: { name: string }, content: Uint8Array) {
  const filename = shortenFilename(file.name);
  const detected = detectAttachmentType(filename, content);
  if (!detected.ok) throw fileIssue(detected.message);
  try {
    const stripped = stripImageMetadata(content, detected.contentType);
    return { filename, contentType: detected.contentType, content: stripped };
  } catch (error) {
    if (error instanceof DamagedImageError) {
      throw fileIssue('This image is damaged, so Ping can’t take it. Choose another.');
    }
    throw error;
  }
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
            await store.put(objectKey, prepared.content, prepared.contentType);
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
          // Pending: row-level security already limited it to its uploader.
          if (target.channel) requireCanDownloadAttachment(ctx.actor, target.channel);
          return requireStorage(storage).signedDownloadUrl(target.objectKey, {
            filename: target.filename,
            contentType: target.contentType,
            inline: target.contentType.startsWith('image/'),
          });
        });
        c.header('X-Content-Type-Options', 'nosniff');
        return c.redirect(link, 302);
      })
  );
}
