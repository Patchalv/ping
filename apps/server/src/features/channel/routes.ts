// The Channel routes, mounted at /api/channels. The exemplar every later feature copies:
//
// 1. `signedIn` first, so a request with no session answers 401.
// 2. `validate(...)` with a schema from packages/shared; read input only through c.req.valid.
// 3. A require… helper from permissions/ before any work. Denies are thrown, never returned.
// 4. Every query inside withStaffTx, awaited.
// 5. publish() after the transaction commits, for every change.
// 6. Chained, so Hono RPC infers the types apps/web calls.
import type { ChannelView } from '@ping/shared';
import { channelParams, createChannelBody } from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { type ActorEnv, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse';
import { validate } from '../../lib/validate';
import { requireCanCreateChannel, requireCanReadChannel } from '../../permissions/channel';
import { createChannel } from '../../system-actions';
import { findChannel, listMemberChannels } from './queries';

/** The Channel as the client sees it, without the decision-only fields. */
const toView = ({ membership: _membership, ...view }: ChannelView & { membership: unknown }) =>
  view satisfies ChannelView;

export function channelRoutes({ auth, database }: { auth: Auth; database: Database }) {
  const actor = signedIn(auth, database);

  return (
    new Hono<ActorEnv>()
      // The sidebar: the Channels the actor is a member of.
      .get('/', actor, async (c) => {
        const { staffId } = c.get('actor');
        const channels = await database.withStaffTx(staffId, (tx) =>
          listMemberChannels(tx, staffId),
        );
        return c.json(channels);
      })

      // Create a Channel. Its creator becomes its first Channel admin.
      .post('/', actor, validate('json', createChannelBody), async (c) => {
        const me = c.get('actor');
        const input = c.req.valid('json');
        requireCanCreateChannel(me);
        const created = await database.withStaffTx(me.staffId, async (tx) => {
          const id = await createChannel(tx, input);
          return findChannel(tx, id, me.staffId);
        });
        // Just created, in the same transaction, by a member: it can't be hidden.
        if (!created) throw new Error('A created Channel did not read back');
        publish({ kind: 'channel.created', channelId: created.id });
        return c.json(toView(created), 201);
      })

      // Open a Channel. A Private channel the actor isn't in answers 404, Admins included.
      .get('/:channelId', actor, validate('param', channelParams), async (c) => {
        const me = c.get('actor');
        const { channelId } = c.req.valid('param');
        const channel = await database.withStaffTx(me.staffId, (tx) =>
          findChannel(tx, channelId, me.staffId),
        );
        if (!channel) throw new NotFoundError();
        requireCanReadChannel(me, channel);
        return c.json(toView(channel));
      })
  );
}
