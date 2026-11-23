// The Mute routes. Each follows the exemplar (features/channel/routes.ts): signedIn,
// validate(), all the work in withActorTx with a require… helper inside it, then publish()
// after a change commits. Muting or unmuting twice changes nothing.
//
// - channelMuteRoutes, mounted at /api/channels/:channelId/mute: mute or unmute a whole
//   Channel, for its members.
// - threadMuteRoutes, mounted at /api/channels/:channelId/threads/:threadId/mute: mute or
//   unmute one Thread, for anyone who can read it.
import { channelParams, threadParams } from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse/publish';
import { validate } from '../../lib/validate';
import { requireCanMuteChannel, requireCanMuteThread } from '../../permissions/attention';
import { addMute, findMuteChannel, findMuteThreadChannel, removeMute } from './queries';

type Options = { auth: Auth; database: Database };

/** Mute or unmute a whole Channel. */
export function channelMuteRoutes({ auth, database }: Options) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      .put('/', signedIn(auth), validate('param', channelParams), async (c) => {
        const { channelId } = c.req.valid('param');
        const staffId = await withActorTx(c, async (ctx) => {
          const access = await findMuteChannel(ctx, channelId);
          if (!access) throw new NotFoundError();
          requireCanMuteChannel(ctx.actor, access);
          await addMute(ctx, channelId, null);
          return ctx.actor.staffId;
        });
        publish({ kind: 'attention.changed', staffId });
        return c.body(null, 204);
      })

      // Unmuting takes membership too: leaving a Channel already drops its mute.
      .delete('/', signedIn(auth), validate('param', channelParams), async (c) => {
        const { channelId } = c.req.valid('param');
        const staffId = await withActorTx(c, async (ctx) => {
          const access = await findMuteChannel(ctx, channelId);
          if (!access) throw new NotFoundError();
          requireCanMuteChannel(ctx.actor, access);
          await removeMute(ctx, channelId, null);
          return ctx.actor.staffId;
        });
        publish({ kind: 'attention.changed', staffId });
        return c.body(null, 204);
      })
  );
}

/** Mute or unmute one Thread. */
export function threadMuteRoutes({ auth, database }: Options) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      .put('/', signedIn(auth), validate('param', threadParams), async (c) => {
        const { channelId, threadId } = c.req.valid('param');
        const staffId = await withActorTx(c, async (ctx) => {
          const access = await findMuteThreadChannel(ctx, channelId, threadId);
          if (!access) throw new NotFoundError();
          requireCanMuteThread(ctx.actor, access);
          await addMute(ctx, channelId, threadId);
          return ctx.actor.staffId;
        });
        publish({ kind: 'attention.changed', staffId });
        return c.body(null, 204);
      })

      .delete('/', signedIn(auth), validate('param', threadParams), async (c) => {
        const { channelId, threadId } = c.req.valid('param');
        const staffId = await withActorTx(c, async (ctx) => {
          const access = await findMuteThreadChannel(ctx, channelId, threadId);
          if (!access) throw new NotFoundError();
          requireCanMuteThread(ctx.actor, access);
          await removeMute(ctx, channelId, threadId);
          return ctx.actor.staffId;
        });
        publish({ kind: 'attention.changed', staffId });
        return c.body(null, 204);
      })
  );
}
