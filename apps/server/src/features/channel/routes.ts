// The Channel routes, mounted at /api/channels: the exemplar. Each route runs signedIn,
// then validate(), then does all its work in withActorTx, deciding with a require…
// helper before it returns or changes anything, and calls publish() after a change
// commits. The rules are in docs/conventions.md › Server routes.
import {
  addChannelMemberBody,
  channelMemberParams,
  channelParams,
  createChannelBody,
  setChannelAdminBody,
  updateChannelBody,
} from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse/publish';
import { validate } from '../../lib/validate';
import {
  channelMemberActions,
  needsCompanyAdminPower,
  requireCanAddChannelMember,
  requireCanAddMembers,
  requireCanBrowseChannels,
  requireCanChangeChannelSettings,
  requireCanCreateChannel,
  requireCanJoinChannel,
  requireCanLeaveChannel,
  requireCanListOwnChannels,
  requireCanReadChannel,
  requireCanRemoveChannelMember,
  requireCanSetChannelAdmin,
} from '../../permissions/channel';
import {
  adminSetChannelAdmin,
  cleanUpLostAccess,
  createChannel,
  makeChannelPrivate,
} from '../../system-actions';
import {
  addChannelMember,
  countOthersInChannel,
  findChannel,
  findMemberTarget,
  joinChannel,
  leaveChannel,
  listChannelMembers,
  listMemberCandidates,
  listMemberChannels,
  listPublicChannels,
  lockChannelMembership,
  recordChannelMadePrivate,
  recordMembershipChange,
  removeChannelMember,
  setChannelAdminRole,
  updateChannelSettings,
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

      // Change a Channel's settings: Channel admins only, outside an Archived channel.
      // Turning a Public channel Private also starts its System thread and, in the same
      // transaction, drops every non-member's Pings, Saved Threads and mutes. Nobody makes
      // a Private channel Public.
      .patch(
        '/:channelId',
        signedIn(auth),
        validate('param', channelParams),
        validate('json', updateChannelBody),
        async (c) => {
          const { channelId } = c.req.valid('param');
          const { visibility, ...settings } = c.req.valid('json');
          const result = await withActorTx(c, async (ctx) => {
            const found = await findChannel(ctx, channelId);
            if (!found) throw new NotFoundError();
            requireCanChangeChannelSettings(ctx.actor, found, { visibility });
            await updateChannelSettings(ctx, channelId, settings);
            // Visibility first: the clean-up works from the Channel being Private.
            const systemThreadId =
              visibility === 'private' ? await makeChannelPrivate(ctx.tx, channelId) : null;
            if (systemThreadId) {
              await cleanUpLostAccess(ctx.tx, channelId);
              await recordChannelMadePrivate(ctx, channelId);
            }
            return { channel: await findChannel(ctx, channelId), systemThreadId };
          });
          // The actor is its Channel admin, in the same transaction: it can't be hidden.
          if (!result.channel) throw new Error('A changed Channel did not read back');
          publish({ kind: 'channel.changed', channelId });
          if (result.systemThreadId) {
            const threadId = result.systemThreadId;
            // Everyone hears it, so non-members drop it at once; members see the System thread.
            publish({ kind: 'channel.made_private', channelId });
            publish({ kind: 'thread.created', channelId, threadId });
            publish({ kind: 'ping.changed', channelId, threadId });
          }
          return c.json(result.channel);
        },
      )

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
          await recordMembershipChange(ctx, 'channel_joined', channelId, ctx.actor.staffId);
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
          await cleanUpLostAccess(ctx.tx, channelId);
          await recordMembershipChange(ctx, 'channel_left', channelId, ctx.actor.staffId);
        });
        publish({ kind: 'channel.changed', channelId });
        // The leaver's other tabs, which may no longer read a Private channel.
        publish({ kind: 'membership.changed', staffId: c.var.session.staffId });
        publish({ kind: 'ping.changed', channelId });
        return c.body(null, 204);
      })

      // The Members tab: the Channel's members, Channel admins marked, and which member
      // controls the actor gets. Anyone who can read the Channel.
      .get('/:channelId/members', signedIn(auth), validate('param', channelParams), async (c) => {
        const { channelId } = c.req.valid('param');
        const result = await withActorTx(c, async (ctx) => {
          const found = await findChannel(ctx, channelId);
          if (!found) throw new NotFoundError();
          requireCanReadChannel(ctx.actor, found);
          const members = await listChannelMembers(ctx, channelId);
          return {
            members,
            actorStaffId: ctx.actor.staffId,
            can: channelMemberActions(ctx.actor, found),
          };
        });
        return c.json(result);
      })

      // The add-members picker: active Staff members who aren't in the Channel. Only for
      // someone who may add members.
      .get(
        '/:channelId/member-candidates',
        signedIn(auth),
        validate('param', channelParams),
        async (c) => {
          const { channelId } = c.req.valid('param');
          const candidates = await withActorTx(c, async (ctx) => {
            const found = await findChannel(ctx, channelId);
            if (!found) throw new NotFoundError();
            requireCanAddMembers(ctx.actor, found);
            return listMemberCandidates(ctx, channelId);
          });
          return c.json(candidates);
        },
      )

      // Add someone as a plain member: any member of a Public channel, Channel admins of a
      // Private one. Adding someone already in it changes nothing.
      .post(
        '/:channelId/members',
        signedIn(auth),
        validate('param', channelParams),
        validate('json', addChannelMemberBody),
        async (c) => {
          const { channelId } = c.req.valid('param');
          const { staffId } = c.req.valid('json');
          const changed = await withActorTx(c, async (ctx) => {
            const found = await findChannel(ctx, channelId);
            if (!found) throw new NotFoundError();
            const target = await findMemberTarget(ctx, channelId, staffId);
            requireCanAddChannelMember(ctx.actor, found, target);
            const added = await addChannelMember(ctx, channelId, staffId);
            if (added)
              await recordMembershipChange(ctx, 'channel_member_added', channelId, staffId);
            return added;
          });
          if (changed) publish({ kind: 'channel.changed', channelId });
          return c.body(null, 204);
        },
      )

      // Remove a member: Channel admins only. The membership lock comes first, so two
      // Channel admins removing each other at once can't both go.
      .delete(
        '/:channelId/members/:staffId',
        signedIn(auth),
        validate('param', channelMemberParams),
        async (c) => {
          const { channelId, staffId } = c.req.valid('param');
          await withActorTx(c, async (ctx) => {
            await lockChannelMembership(ctx, channelId);
            const found = await findChannel(ctx, channelId);
            if (!found) throw new NotFoundError();
            const target = await findMemberTarget(ctx, channelId, staffId);
            requireCanRemoveChannelMember(ctx.actor, found, target);
            await removeChannelMember(ctx, channelId, staffId);
            await cleanUpLostAccess(ctx.tx, channelId);
            await recordMembershipChange(ctx, 'channel_member_removed', channelId, staffId);
          });
          publish({ kind: 'channel.changed', channelId });
          // The removed member, who may no longer read a Private channel.
          publish({ kind: 'membership.changed', staffId });
          publish({ kind: 'ping.changed', channelId });
          return c.body(null, 204);
        },
      )

      // Appoint a Channel admin or remove the role: the Channel's Channel admins, and a
      // company Admin on a Public channel, for anyone including themself. The membership
      // lock comes first, so the last active Channel admin always stays.
      .patch(
        '/:channelId/members/:staffId',
        signedIn(auth),
        validate('param', channelMemberParams),
        validate('json', setChannelAdminBody),
        async (c) => {
          const { channelId, staffId } = c.req.valid('param');
          const { isChannelAdmin } = c.req.valid('json');
          const changed = await withActorTx(c, async (ctx) => {
            await lockChannelMembership(ctx, channelId);
            const found = await findChannel(ctx, channelId);
            if (!found) throw new NotFoundError();
            const target = await findMemberTarget(ctx, channelId, staffId);
            requireCanSetChannelAdmin(ctx.actor, found, target, isChannelAdmin);
            const viaCompanyAdmin = needsCompanyAdminPower(found, target);
            const done = viaCompanyAdmin
              ? await adminSetChannelAdmin(ctx.tx, {
                  channelId,
                  staffId,
                  makeChannelAdmin: isChannelAdmin,
                })
              : await setChannelAdminRole(ctx, channelId, staffId, isChannelAdmin);
            if (done) {
              // A company Admin appointing someone outside the Channel adds them too.
              if (!target.isMember) {
                await recordMembershipChange(ctx, 'channel_member_added', channelId, staffId);
              }
              await recordMembershipChange(
                ctx,
                isChannelAdmin ? 'channel_admin_appointed' : 'channel_admin_removed',
                channelId,
                staffId,
              );
            }
            return done;
          });
          if (changed) publish({ kind: 'channel.changed', channelId });
          return c.body(null, 204);
        },
      )
  );
}
