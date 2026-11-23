// The Thread routes, mounted at /api/channels/:channelId/threads. Each follows the
// exemplar (features/channel/routes.ts): signedIn, validate(), all the work in
// withActorTx with a require… helper inside it, then publish() after a change commits.
import {
  channelParams,
  editThreadBody,
  listThreadsQuery,
  startThreadBody,
  type ThreadView,
  threadParams,
} from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse/publish';
import { validate } from '../../lib/validate';
import {
  requireCanDeleteThread,
  requireCanEditThread,
  requireCanReadThreads,
  requireCanResolveThread,
  requireCanStartThread,
} from '../../permissions/thread';
import { fanOutPings } from '../../system-actions';
import {
  auditAdminChange,
  deleteThread,
  editThread,
  findThread,
  findThreadAuthorship,
  findThreadChannel,
  listThreads,
  setThreadResolved,
  startThread,
} from './queries';

export function threadRoutes({ auth, database }: { auth: Auth; database: Database }) {
  const withActorTx = createWithActorTx(database);

  /**
   * Resolve or reopen, for both routes: the work in withActorTx with the require… helper
   * inside it, then publish() once it commits. No Pings: a Mention is how to call
   * attention to a reopen.
   */
  async function setResolved(
    c: Parameters<typeof withActorTx>[0],
    { channelId, threadId }: { channelId: string; threadId: string },
    resolved: boolean,
  ): Promise<ThreadView> {
    const view = await withActorTx(c, async (ctx) => {
      const channel = await findThreadChannel(ctx, channelId);
      if (!channel) throw new NotFoundError();
      requireCanReadThreads(ctx.actor, channel);
      const authorship = await findThreadAuthorship(ctx, channelId, threadId);
      if (!authorship) throw new NotFoundError();
      requireCanResolveThread(ctx.actor, channel, authorship);
      await setThreadResolved(ctx, channelId, threadId, resolved);
      return findThread(ctx, channel, channelId, threadId);
    });
    if (!view) throw new Error('A resolved or reopened Thread did not read back');
    publish({ kind: 'thread.changed', channelId, threadId });
    return view;
  }

  return (
    new Hono()
      // The Channel's Thread list, a page at a time, as the Thread list controls choose:
      // Status, Pings, sort and direction.
      .get(
        '/',
        signedIn(auth),
        validate('param', channelParams),
        validate('query', listThreadsQuery),
        async (c) => {
          const { channelId } = c.req.valid('param');
          const view = c.req.valid('query');
          const page = await withActorTx(c, async (ctx) => {
            const found = await findThreadChannel(ctx, channelId);
            if (!found) throw new NotFoundError();
            requireCanReadThreads(ctx.actor, found);
            return listThreads(ctx, found, channelId, view);
          });
          return c.json(page);
        },
      )

      // Start a Thread: Channel members only, not in an Archived channel. The body
      // schema has already held the description to the allowlist.
      .post(
        '/',
        signedIn(auth),
        validate('param', channelParams),
        validate('json', startThreadBody),
        async (c) => {
          const { channelId } = c.req.valid('param');
          const input = c.req.valid('json');
          const started = await withActorTx(c, async (ctx) => {
            const found = await findThreadChannel(ctx, channelId);
            if (!found) throw new NotFoundError();
            requireCanStartThread(ctx.actor, found);
            const id = await startThread(ctx, channelId, input);
            await fanOutPings(ctx.tx, { threadId: id });
            return findThread(ctx, found, channelId, id);
          });
          // Just started, in the same transaction, by a member: it can't be hidden.
          if (!started) throw new Error('A started Thread did not read back');
          publish({ kind: 'thread.created', channelId, threadId: started.id });
          publish({ kind: 'ping.changed', channelId, threadId: started.id });
          return c.json(started, 201);
        },
      )

      // Open a Thread. One in another Channel answers 404, like a missing one.
      .get('/:threadId', signedIn(auth), validate('param', threadParams), async (c) => {
        const { channelId, threadId } = c.req.valid('param');
        const found = await withActorTx(c, async (ctx) => {
          const channel = await findThreadChannel(ctx, channelId);
          if (!channel) throw new NotFoundError();
          requireCanReadThreads(ctx.actor, channel);
          const view = await findThread(ctx, channel, channelId, threadId);
          if (!view) throw new NotFoundError();
          return view;
        });
        return c.json(found);
      })

      // Edit a Thread's title and description: its author, or a company Admin in a
      // Channel they can read. Latest activity doesn't move.
      .patch(
        '/:threadId',
        signedIn(auth),
        validate('param', threadParams),
        validate('json', editThreadBody),
        async (c) => {
          const { channelId, threadId } = c.req.valid('param');
          const input = c.req.valid('json');
          const edited = await withActorTx(c, async (ctx) => {
            const channel = await findThreadChannel(ctx, channelId);
            if (!channel) throw new NotFoundError();
            requireCanReadThreads(ctx.actor, channel);
            const authorship = await findThreadAuthorship(ctx, channelId, threadId);
            if (!authorship) throw new NotFoundError();
            requireCanEditThread(ctx.actor, channel, authorship);
            await editThread(ctx, threadId, input);
            await auditAdminChange(ctx, 'admin_edited_thread', {
              channelId,
              authorId: authorship.authorId,
            });
            return findThread(ctx, channel, channelId, threadId);
          });
          if (!edited) throw new Error('An edited Thread did not read back');
          publish({ kind: 'thread.changed', channelId, threadId });
          return c.json(edited);
        },
      )

      // Resolve a Thread (PUT) or reopen it (DELETE), as the Channel's "Who can resolve
      // threads?" setting allows. Neither Pings anyone or moves Latest activity.
      .put('/:threadId/resolved', signedIn(auth), validate('param', threadParams), async (c) =>
        c.json(await setResolved(c, c.req.valid('param'), true)),
      )
      .delete('/:threadId/resolved', signedIn(auth), validate('param', threadParams), async (c) =>
        c.json(await setResolved(c, c.req.valid('param'), false)),
      )

      // Delete a Thread, for real, with its Thread Responses: its author, or a company
      // Admin in a Channel they can read; in an Archived channel, only Admins.
      .delete('/:threadId', signedIn(auth), validate('param', threadParams), async (c) => {
        const { channelId, threadId } = c.req.valid('param');
        await withActorTx(c, async (ctx) => {
          const channel = await findThreadChannel(ctx, channelId);
          if (!channel) throw new NotFoundError();
          requireCanReadThreads(ctx.actor, channel);
          const authorship = await findThreadAuthorship(ctx, channelId, threadId);
          if (!authorship) throw new NotFoundError();
          requireCanDeleteThread(ctx.actor, channel, authorship);
          await deleteThread(ctx, threadId);
          await auditAdminChange(ctx, 'admin_deleted_thread', {
            channelId,
            authorId: authorship.authorId,
          });
        });
        publish({ kind: 'thread.deleted', channelId, threadId });
        // Its Pings went with it.
        publish({ kind: 'ping.changed', channelId, threadId });
        return c.body(null, 204);
      })
  );
}
