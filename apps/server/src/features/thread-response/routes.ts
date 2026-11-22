// The Thread Response routes, mounted at
// /api/channels/:channelId/threads/:threadId/responses. Each follows the exemplar
// (features/channel/routes.ts): signedIn, validate(), all the work in withActorTx with a
// require… helper inside it, then publish() after a change commits.
import {
  type ThreadResponseList,
  threadParams,
  threadResponseBody,
  threadResponseParams,
} from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse';
import { validate } from '../../lib/validate';
import { requireCanReadThreads } from '../../permissions/thread';
import {
  requireCanDeleteThreadResponse,
  requireCanEditThreadResponse,
  requireCanSendThreadResponse,
} from '../../permissions/thread-response';
import { fanOutPings } from '../../system-actions';
import {
  acknowledgePing,
  auditAdminChange,
  deleteThreadResponse,
  editThreadResponse,
  findLiveResponseAuthor,
  findResponseChannel,
  listThreadResponses,
  sendThreadResponse,
} from './queries';

export function threadResponseRoutes({ auth, database }: { auth: Auth; database: Database }) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // A Thread's Thread Responses, all of them, oldest first, placeholders included.
      .get('/', signedIn(auth), validate('param', threadParams), async (c) => {
        const { channelId, threadId } = c.req.valid('param');
        const list = await withActorTx(c, async (ctx): Promise<ThreadResponseList> => {
          const access = await findResponseChannel(ctx, channelId, threadId);
          if (!access) throw new NotFoundError();
          requireCanReadThreads(ctx.actor, access);
          return { responses: await listThreadResponses(ctx, access, threadId) };
        });
        return c.json(list);
      })

      // Send a Thread Response: Channel members only, not in an Archived channel. It
      // moves the Thread's Latest activity forward.
      .post(
        '/',
        signedIn(auth),
        validate('param', threadParams),
        validate('json', threadResponseBody),
        async (c) => {
          const { channelId, threadId } = c.req.valid('param');
          const { body } = c.req.valid('json');
          const sent = await withActorTx(c, async (ctx) => {
            const access = await findResponseChannel(ctx, channelId, threadId);
            if (!access) throw new NotFoundError();
            requireCanSendThreadResponse(ctx.actor, access);
            const id = await sendThreadResponse(ctx, { channelId, threadId }, body);
            await fanOutPings(ctx.tx, { threadId, threadResponseId: id });
            // Sending a Thread Response Acknowledges the sender's own Ping.
            await acknowledgePing(ctx, threadId);
            const [view] = await listThreadResponses(ctx, access, threadId, id);
            return view;
          });
          // Just sent, in the same transaction, by a member: it can't be hidden.
          if (!sent) throw new Error('A sent Thread Response did not read back');
          publish({
            kind: 'thread_response.created',
            channelId,
            threadId,
            threadResponseId: sent.id,
          });
          publish({ kind: 'ping.changed', channelId, threadId });
          return c.json(sent, 201);
        },
      )

      // Edit a Thread Response: its author, or a company Admin in a Channel they can read.
      // A deleted one is gone, so it answers 404.
      .patch(
        '/:threadResponseId',
        signedIn(auth),
        validate('param', threadResponseParams),
        validate('json', threadResponseBody),
        async (c) => {
          const { channelId, threadId, threadResponseId } = c.req.valid('param');
          const { body } = c.req.valid('json');
          const edited = await withActorTx(c, async (ctx) => {
            const access = await findResponseChannel(ctx, channelId, threadId);
            if (!access) throw new NotFoundError();
            requireCanReadThreads(ctx.actor, access);
            const response = await findLiveResponseAuthor(ctx, threadId, threadResponseId);
            if (!response) throw new NotFoundError();
            requireCanEditThreadResponse(ctx.actor, access, response);
            await editThreadResponse(ctx, threadResponseId, body);
            await auditAdminChange(ctx, 'admin_edited_thread_response', {
              channelId,
              authorId: response.authorId,
            });
            const [view] = await listThreadResponses(ctx, access, threadId, threadResponseId);
            return view;
          });
          if (!edited) throw new Error('An edited Thread Response did not read back');
          publish({ kind: 'thread_response.changed', channelId, threadId, threadResponseId });
          return c.json(edited);
        },
      )

      // Delete a Thread Response: its author, or a company Admin in a Channel they can
      // read; in an Archived channel, only Admins. It leaves the placeholder.
      .delete(
        '/:threadResponseId',
        signedIn(auth),
        validate('param', threadResponseParams),
        async (c) => {
          const { channelId, threadId, threadResponseId } = c.req.valid('param');
          await withActorTx(c, async (ctx) => {
            const access = await findResponseChannel(ctx, channelId, threadId);
            if (!access) throw new NotFoundError();
            requireCanReadThreads(ctx.actor, access);
            const response = await findLiveResponseAuthor(ctx, threadId, threadResponseId);
            if (!response) throw new NotFoundError();
            requireCanDeleteThreadResponse(ctx.actor, access, response);
            await deleteThreadResponse(ctx, threadResponseId);
            await auditAdminChange(ctx, 'admin_deleted_thread_response', {
              channelId,
              authorId: response.authorId,
            });
          });
          publish({ kind: 'thread_response.changed', channelId, threadId, threadResponseId });
          return c.body(null, 204);
        },
      )
  );
}
