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
  requireCanBrowseChannels,
  requireCanCreateChannel,
  requireCanJoinChannel,
  requireCanLeaveChannel,
  requireCanListOwnChannels,
  requireCanReadChannel,
} from '../../permissions/channel';
import { createChannel } from '../../system-actions';
import {
  countOthersInChannel,
  findChannel,
  joinChannel,
  leaveChannel,
  listMemberChannels,
  listPublicChannels,
  lockChannelMembership,
} from './queries';

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

      // Browse channels: every Public channel, with a Join button or "Joined". Registered
      // before /:channelId, which would refuse "browse" as a Channel ID.
      .get('/browse', signedIn(auth), async (c) => {
        const channels = await withActorTx(c, (ctx) => {
          requireCanBrowseChannels(ctx.actor);
          return listPublicChannels(ctx);
        });
        return c.json(channels);
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

      // Join a Public channel. Joining one you're already in changes nothing. A Private
      // channel you aren't in answers 404, as when reading it.
      .post('/:channelId/join', signedIn(auth), validate('param', channelParams), async (c) => {
        const { channelId } = c.req.valid('param');
        const joined = await withActorTx(c, async (ctx) => {
          const found = await findChannel(ctx, channelId);
          if (!found) throw new NotFoundError();
          requireCanJoinChannel(ctx.actor, found);
          if (found.isMember) return { channel: found, changed: false };
          await joinChannel(ctx, channelId);
          return { channel: await findChannel(ctx, channelId), changed: true };
        });
        // Just joined, in the same transaction: a Public channel can't be hidden.
        if (!joined.channel) throw new Error('A joined Channel did not read back');
        if (joined.changed) publish({ kind: 'channel.changed', channelId });
        return c.json(joined.channel);
      })

      // Leave a Channel: deletes the membership. The last active Channel admin can't. The
      // membership lock comes first, so two Channel admins leaving at once can't each
      // count the other as staying.
      .post('/:channelId/leave', signedIn(auth), validate('param', channelParams), async (c) => {
        const { channelId } = c.req.valid('param');
        await withActorTx(c, async (ctx) => {
          await lockChannelMembership(ctx, channelId);
          const found = await findChannel(ctx, channelId);
          if (!found) throw new NotFoundError();
          const others = await countOthersInChannel(ctx, channelId);
          requireCanLeaveChannel(ctx.actor, { ...found, ...others });
          await leaveChannel(ctx, channelId);
        });
        publish({ kind: 'channel.changed', channelId });
        return c.body(null, 204);
      })
  );
}
