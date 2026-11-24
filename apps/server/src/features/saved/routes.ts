// The Saved routes. Each follows the exemplar (features/channel/routes.ts): signedIn,
// validate(), all the work in withActorTx with a require… helper inside it, then publish()
// after a change commits.
//
// - savedRoutes, mounted at /api/saved: the Saved view.
// - saveRoutes, mounted at /api/channels/:channelId/threads/:threadId/saved: Save a Thread
//   (which Acknowledges its Ping), or remove it from Saved.
import { listSavedQuery, threadParams } from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse/publish';
import { validate } from '../../lib/validate';
import {
  requireCanListOwnSaved,
  requireCanRemoveSavedThread,
  requireCanSaveThread,
} from '../../permissions/attention';
import { findSavedChannel, listSaved, removeSavedThread, saveThread } from './queries';

type Options = { auth: Auth; database: Database };

/** The Staff member's own Saved list, newest saved first. */
export function savedRoutes({ auth, database }: Options) {
  const withActorTx = createWithActorTx(database);

  return new Hono().get('/', signedIn(auth), validate('query', listSavedQuery), async (c) => {
    const { after } = c.req.valid('query');
    const page = await withActorTx(c, (ctx) => {
      requireCanListOwnSaved(ctx.actor);
      return listSaved(ctx, after);
    });
    return c.json(page);
  });
}

/** Save a Thread, or remove it from Saved. */
export function saveRoutes({ auth, database }: Options) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // Save: anyone who can read the Thread. Saving Acknowledges its Ping.
      .put('/', signedIn(auth), validate('param', threadParams), async (c) => {
        const { channelId, threadId } = c.req.valid('param');
        const staffId = await withActorTx(c, async (ctx) => {
          const access = await findSavedChannel(ctx, channelId, threadId);
          if (!access) throw new NotFoundError();
          requireCanSaveThread(ctx.actor, access);
          await saveThread(ctx, channelId, threadId);
          return ctx.actor.staffId;
        });
        // Only their own Ping changed, so their own sessions are the only ones to tell.
        publish({ kind: 'attention.changed', staffId });
        return c.body(null, 204);
      })

      // Remove from Saved: leaves any Ping alone. Removing one not Saved changes nothing.
      .delete('/', signedIn(auth), validate('param', threadParams), async (c) => {
        const { channelId, threadId } = c.req.valid('param');
        const staffId = await withActorTx(c, async (ctx) => {
          const access = await findSavedChannel(ctx, channelId, threadId);
          if (!access) throw new NotFoundError();
          requireCanRemoveSavedThread(ctx.actor, access);
          await removeSavedThread(ctx, threadId);
          return ctx.actor.staffId;
        });
        publish({ kind: 'attention.changed', staffId });
        return c.body(null, 204);
      })
  );
}
