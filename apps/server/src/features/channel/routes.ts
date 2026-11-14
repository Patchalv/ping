// The Channel routes, mounted at /api/channels: the exemplar. Each route runs signedIn,
// then validate(), then does all its work in withActorTx, deciding with a require…
// helper before it returns or changes anything, and calls publish() after a change
// commits. The rules are in docs/conventions.md › Server routes.
import { channelParams, createChannelBody } from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse';
import { validate } from '../../lib/validate';
import {
  requireCanCreateChannel,
  requireCanListOwnChannels,
  requireCanReadChannel,
} from '../../permissions/channel';
import { createChannel } from '../../system-actions';
import { findChannel, listMemberChannels } from './queries';

export function channelRoutes({ auth, database }: { auth: Auth; database: Database }) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // The sidebar: the Channels the actor is a member of.
      .get('/', signedIn(auth), async (c) => {
        const channels = await withActorTx(c, (ctx) => {
          requireCanListOwnChannels(ctx.actor);
          return listMemberChannels(ctx);
        });
        return c.json(channels);
      })

      // Create a Channel. Its creator becomes its first Channel admin.
      .post('/', signedIn(auth), validate('json', createChannelBody), async (c) => {
        const input = c.req.valid('json');
        const created = await withActorTx(c, async (ctx) => {
          requireCanCreateChannel(ctx.actor);
          const id = await createChannel(ctx.tx, input);
          return findChannel(ctx, id);
        });
        // Just created, in the same transaction, by a member: it can't be hidden.
        if (!created) throw new Error('A created Channel did not read back');
        publish({ kind: 'channel.created', channelId: created.id });
        return c.json(created, 201);
      })

      // Open a Channel. Reading needs the row to decide, so it loads first. A Private
      // channel the actor isn't in answers 404, Admins included.
      .get('/:channelId', signedIn(auth), validate('param', channelParams), async (c) => {
        const { channelId } = c.req.valid('param');
        const channel = await withActorTx(c, async (ctx) => {
          const found = await findChannel(ctx, channelId);
          if (!found) throw new NotFoundError();
          requireCanReadChannel(ctx.actor, found);
          return found;
        });
        return c.json(channel);
      })
  );
}
