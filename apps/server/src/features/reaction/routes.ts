// The Reaction routes, mounted at /api/channels/:channelId/threads/:threadId. Each follows
// the exemplar (features/channel/routes.ts): signedIn, validate(), all the work in
// withActorTx with a require… helper inside it, then publish() after a change commits.
//
// PUT adds the actor's reaction and DELETE removes it. Both are idempotent and answer
// with the target's reactions now. Members only, outside an Archived channel.
import {
  type ReactionList,
  threadReactionParams,
  threadResponseReactionParams,
} from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse/publish';
import { validate } from '../../lib/validate';
import { requireCanReact } from '../../permissions/reaction';
import {
  acknowledgePing,
  addReaction,
  findReactionChannel,
  liveResponseExists,
  type ReactionTarget,
  reactionsOf,
  removeReaction,
} from './queries';

export function reactionRoutes({ auth, database }: { auth: Auth; database: Database }) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // React to a Thread.
      .put(
        '/reactions/:emoji',
        signedIn(auth),
        validate('param', threadReactionParams),
        async (c) => {
          const { channelId, threadId, emoji } = c.req.valid('param');
          const list = await withActorTx(c, async (ctx): Promise<ReactionList> => {
            const access = await findReactionChannel(ctx, channelId, threadId);
            if (!access) throw new NotFoundError();
            requireCanReact(ctx.actor, access);
            const target: ReactionTarget = { kind: 'thread', channelId, threadId };
            await addReaction(ctx, target, emoji);
            // Reacting Acknowledges the Ping, whether to the Thread or one of its Thread Responses.
            await acknowledgePing(ctx, threadId);
            return { reactions: await reactionsOf(ctx, target) };
          });
          publish({ kind: 'thread.changed', channelId, threadId });
          publish({ kind: 'ping.changed', channelId, threadId });
          return c.json(list);
        },
      )

      // Take back a reaction to a Thread.
      .delete(
        '/reactions/:emoji',
        signedIn(auth),
        validate('param', threadReactionParams),
        async (c) => {
          const { channelId, threadId, emoji } = c.req.valid('param');
          const list = await withActorTx(c, async (ctx): Promise<ReactionList> => {
            const access = await findReactionChannel(ctx, channelId, threadId);
            if (!access) throw new NotFoundError();
            requireCanReact(ctx.actor, access);
            const target: ReactionTarget = { kind: 'thread', channelId, threadId };
            await removeReaction(ctx, target, emoji);
            return { reactions: await reactionsOf(ctx, target) };
          });
          publish({ kind: 'thread.changed', channelId, threadId });
          return c.json(list);
        },
      )

      // React to a Thread Response. A deleted one is gone, so it answers 404.
      .put(
        '/responses/:threadResponseId/reactions/:emoji',
        signedIn(auth),
        validate('param', threadResponseReactionParams),
        async (c) => {
          const { channelId, threadId, threadResponseId, emoji } = c.req.valid('param');
          const list = await withActorTx(c, async (ctx): Promise<ReactionList> => {
            const access = await findReactionChannel(ctx, channelId, threadId);
            if (!access) throw new NotFoundError();
            requireCanReact(ctx.actor, access);
            if (!(await liveResponseExists(ctx, threadId, threadResponseId))) {
              throw new NotFoundError();
            }
            const target: ReactionTarget = { kind: 'thread_response', channelId, threadResponseId };
            await addReaction(ctx, target, emoji);
            // Reacting Acknowledges the Ping, whether to the Thread or one of its Thread Responses.
            await acknowledgePing(ctx, threadId);
            return { reactions: await reactionsOf(ctx, target) };
          });
          publish({ kind: 'thread_response.changed', channelId, threadId, threadResponseId });
          publish({ kind: 'ping.changed', channelId, threadId });
          return c.json(list);
        },
      )

      // Take back a reaction to a Thread Response.
      .delete(
        '/responses/:threadResponseId/reactions/:emoji',
        signedIn(auth),
        validate('param', threadResponseReactionParams),
        async (c) => {
          const { channelId, threadId, threadResponseId, emoji } = c.req.valid('param');
          const list = await withActorTx(c, async (ctx): Promise<ReactionList> => {
            const access = await findReactionChannel(ctx, channelId, threadId);
            if (!access) throw new NotFoundError();
            requireCanReact(ctx.actor, access);
            if (!(await liveResponseExists(ctx, threadId, threadResponseId))) {
              throw new NotFoundError();
            }
            const target: ReactionTarget = { kind: 'thread_response', channelId, threadResponseId };
            await removeReaction(ctx, target, emoji);
            return { reactions: await reactionsOf(ctx, target) };
          });
          publish({ kind: 'thread_response.changed', channelId, threadId, threadResponseId });
          return c.json(list);
        },
      )
  );
}
