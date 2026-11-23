// The Ping routes. Each follows the exemplar (features/channel/routes.ts): signedIn,
// validate(), all the work in withActorTx with a require… helper inside it, then publish()
// after a change commits.
//
// - pingRoutes, mounted at /api/pings: the Pings view and the counts beside it.
// - markReadRoutes, mounted at /api/channels/:channelId/threads/:threadId/ping: mark a
//   Thread read, which Acknowledges its Ping.
import { listPingsQuery, threadParams } from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse/publish';
import { validate } from '../../lib/validate';
import { requireCanListOwnPings } from '../../permissions/ping';
import { requireCanReadThreads } from '../../permissions/thread';
import { findPingChannel, listPings, markRead, summarisePings } from './queries';

type Options = { auth: Auth; database: Database };

/** The Staff member's own Pings: the Pings view, newest activity first, and the counts. */
export function pingRoutes({ auth, database }: Options) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // The Pings view: Threads with a Ping, as the same Thread rows a Channel shows.
      .get('/', signedIn(auth), validate('query', listPingsQuery), async (c) => {
        const { after } = c.req.valid('query');
        const page = await withActorTx(c, (ctx) => {
          requireCanListOwnPings(ctx.actor);
          return listPings(ctx, after);
        });
        return c.json(page);
      })

      // The Pings badge and each Channel's count in the sidebar. Registered before any
      // route that would take "summary" as a parameter.
      .get('/summary', signedIn(auth), async (c) => {
        const summary = await withActorTx(c, (ctx) => {
          requireCanListOwnPings(ctx.actor);
          return summarisePings(ctx);
        });
        return c.json(summary);
      })
  );
}

/** Mark a Thread read. */
export function markReadRoutes({ auth, database }: Options) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // Mark read: anyone who can read the Thread, non-members of a Public channel
      // included. Marking one with no Ping changes nothing.
      .delete('/', signedIn(auth), validate('param', threadParams), async (c) => {
        const { channelId, threadId } = c.req.valid('param');
        await withActorTx(c, async (ctx) => {
          const access = await findPingChannel(ctx, channelId, threadId);
          if (!access) throw new NotFoundError();
          requireCanReadThreads(ctx.actor, access);
          await markRead(ctx, threadId);
        });
        publish({ kind: 'ping.changed', channelId, threadId });
        return c.body(null, 204);
      })
  );
}
