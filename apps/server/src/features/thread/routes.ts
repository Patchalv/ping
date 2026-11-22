// The Thread routes, mounted at /api/channels/:channelId/threads. Each follows the
// exemplar (features/channel/routes.ts): signedIn, validate(), all the work in
// withActorTx with a require… helper inside it, then publish() after a change commits.
import { channelParams, listThreadsQuery, startThreadBody, threadParams } from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse';
import { validate } from '../../lib/validate';
import { requireCanReadThreads, requireCanStartThread } from '../../permissions/thread';
import { findThread, findThreadChannel, listThreads, startThread } from './queries';

export function threadRoutes({ auth, database }: { auth: Auth; database: Database }) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // The Channel's Thread list, by Latest activity, a page at a time.
      .get(
        '/',
        signedIn(auth),
        validate('param', channelParams),
        validate('query', listThreadsQuery),
        async (c) => {
          const { channelId } = c.req.valid('param');
          const { after } = c.req.valid('query');
          const page = await withActorTx(c, async (ctx) => {
            const found = await findThreadChannel(ctx, channelId);
            if (!found) throw new NotFoundError();
            requireCanReadThreads(ctx.actor, found);
            return listThreads(ctx, channelId, after);
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
            return findThread(ctx, channelId, id);
          });
          // Just started, in the same transaction, by a member: it can't be hidden.
          if (!started) throw new Error('A started Thread did not read back');
          publish({ kind: 'thread.created', channelId, threadId: started.id });
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
          const view = await findThread(ctx, channelId, threadId);
          if (!view) throw new NotFoundError();
          return view;
        });
        return c.json(found);
      })
  );
}
