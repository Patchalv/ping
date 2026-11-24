// RLS suite: mute, as ping_app with raw SQL and no server code.
//
// A Staff member reads, adds and removes only their own mutes, in Channels they can read,
// with no Admin exception. A Channel mute also needs membership; a Thread mute needs only
// being able to read the Thread. Nobody updates one. Other people's mutes go only through
// clean_up_lost_access and deactivate_staff_member (fan-out-saved-mute.int.test.ts).
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createStaffMember,
  insertChannel,
  insertThread,
  type Query,
} from '../../db/test-support';

/** Switches the case's transaction to another Staff member. */
const actAs = (query: Query, staffId: string | null) =>
  query(`select set_config('app.staff_id', $1, true)`, [staffId ?? '']);

/** Mutes the Channel, or the Thread when one is given. */
const mute = (query: Query, staffId: string, channelId: string, threadId: string | null = null) =>
  query('insert into mute (staff_id, channel_id, thread_id) values ($1, $2, $3)', [
    staffId,
    channelId,
    threadId,
  ]);

/** How many mutes the acting Staff member sees in the Channel. */
const mutesSeen = async (query: Query, channelId: string) =>
  (await query('select 1 from mute where channel_id = $1', [channelId])).rowCount;

async function threadFor(options: {
  visibility?: 'public' | 'private';
  ownerIsMember: boolean;
  ownerDeactivated?: boolean;
}) {
  const owner = await createStaffMember({ deactivated: options.ownerDeactivated });
  const author = await createStaffMember();
  const channel = await insertChannel({
    visibility: options.visibility ?? 'public',
    members: [
      { staffId: author.id, channelAdmin: true },
      ...(options.ownerIsMember ? [{ staffId: owner.id }] : []),
    ],
  });
  const thread = await insertThread({ channelId: channel.id, authorId: author.id });
  return { owner, author, channel, thread };
}

/** As threadFor, with the owner's Thread mute already in place (and a Channel mute for a member). */
async function mutedThread(options: Parameters<typeof threadFor>[0]) {
  const fixture = await threadFor(options);
  await asOwner(async (query) => {
    await mute(query, fixture.owner.id, fixture.channel.id, fixture.thread.id);
    if (options.ownerIsMember) await mute(query, fixture.owner.id, fixture.channel.id);
  });
  return fixture;
}

describe('mute SELECT', () => {
  it('shows a Staff member their own mutes and nobody else’s', async () => {
    const { owner, author, channel } = await mutedThread({ ownerIsMember: true });
    await asPingApp(owner.id, async (query) => {
      expect(await mutesSeen(query, channel.id)).toBe(2);
    });
    await asPingApp(author.id, async (query) => {
      expect(await mutesSeen(query, channel.id)).toBe(0);
    });
  });

  it('keeps a Public channel’s Thread mute readable by someone who is not a member', async () => {
    const { owner, channel } = await mutedThread({ ownerIsMember: false });
    await asPingApp(owner.id, async (query) => {
      expect(await mutesSeen(query, channel.id)).toBe(1);
    });
  });

  it('hides a Private channel’s mutes from someone who is not a member', async () => {
    const { owner, channel } = await mutedThread({ visibility: 'private', ownerIsMember: false });
    await asPingApp(owner.id, async (query) => {
      expect(await mutesSeen(query, channel.id)).toBe(0);
    });
  });

  it('shows nothing to a Deactivated Staff member, or when app.staff_id is unset', async () => {
    const { owner, channel } = await mutedThread({ ownerIsMember: true, ownerDeactivated: true });
    await asPingApp(owner.id, async (query) => {
      expect(await mutesSeen(query, channel.id)).toBe(0);
    });
    await asPingApp(null, async (query) => {
      expect(await mutesSeen(query, channel.id)).toBe(0);
    });
  });
});

describe('mute INSERT', () => {
  it('lets a member mute the Channel and a Thread in it', async () => {
    const { owner, channel, thread } = await threadFor({ ownerIsMember: true });
    await asPingApp(owner.id, async (query) => {
      await mute(query, owner.id, channel.id);
      await mute(query, owner.id, channel.id, thread.id);
      expect(await mutesSeen(query, channel.id)).toBe(2);
    });
  });

  it('lets a non-member mute a Thread in a Public channel, but not the Channel', async () => {
    const { owner, channel, thread } = await threadFor({ ownerIsMember: false });
    await asPingApp(owner.id, async (query) => {
      await mute(query, owner.id, channel.id, thread.id);
      expect(await mutesSeen(query, channel.id)).toBe(1);
    });
    await asPingApp(owner.id, (query) =>
      expect(mute(query, owner.id, channel.id)).rejects.toMatchObject({ code: '42501' }),
    );
  });

  it('refuses a Thread in a Private channel they aren’t in', async () => {
    const { owner, channel, thread } = await threadFor({
      visibility: 'private',
      ownerIsMember: false,
    });
    await asPingApp(owner.id, (query) =>
      expect(mute(query, owner.id, channel.id, thread.id)).rejects.toMatchObject({
        code: '42501',
      }),
    );
  });

  it('refuses to mute for someone else', async () => {
    const { owner, author, channel } = await threadFor({ ownerIsMember: true });
    await asPingApp(owner.id, (query) =>
      expect(mute(query, author.id, channel.id)).rejects.toMatchObject({ code: '42501' }),
    );
  });

  it('refuses a Deactivated Staff member, and an unset app.staff_id', async () => {
    const { owner, channel, thread } = await threadFor({
      ownerIsMember: true,
      ownerDeactivated: true,
    });
    await asPingApp(owner.id, (query) =>
      expect(mute(query, owner.id, channel.id, thread.id)).rejects.toMatchObject({
        code: '42501',
      }),
    );
    await asPingApp(null, (query) =>
      expect(mute(query, owner.id, channel.id, thread.id)).rejects.toMatchObject({
        code: '42501',
      }),
    );
  });

  it('keeps one Channel mute per Staff member', async () => {
    const { owner, channel } = await threadFor({ ownerIsMember: true });
    await asPingApp(owner.id, async (query) => {
      await mute(query, owner.id, channel.id);
      await expect(mute(query, owner.id, channel.id)).rejects.toMatchObject({ code: '23505' });
    });
  });
});

describe('mute UPDATE and DELETE', () => {
  it('refuses to update a mute, even your own', async () => {
    const { owner, channel } = await mutedThread({ ownerIsMember: true });
    await asPingApp(owner.id, (query) =>
      expect(
        query('update mute set thread_id = null where channel_id = $1', [channel.id]),
      ).rejects.toMatchObject({ code: '42501' }),
    );
  });

  it('removes the Staff member’s own mutes and no one else’s', async () => {
    const { owner, author, channel } = await mutedThread({ ownerIsMember: true });
    await asOwner((query) => mute(query, author.id, channel.id));
    await asPingApp(owner.id, async (query) => {
      const result = await query('delete from mute where channel_id = $1', [channel.id]);
      expect(result.rowCount).toBe(2);
      await actAs(query, author.id);
      expect(await mutesSeen(query, channel.id)).toBe(1);
    });
  });

  it('drops a Thread mute with its Thread, and keeps the Channel mute', async () => {
    const { owner, channel, thread } = await mutedThread({ ownerIsMember: true });
    await asOwner(async (query) => {
      await query('delete from thread where id = $1', [thread.id]);
      const left = await query<{ thread_id: string | null }>(
        'select thread_id from mute where staff_id = $1 and channel_id = $2',
        [owner.id, channel.id],
      );
      expect(left.rows).toEqual([{ thread_id: null }]);
    });
  });
});
