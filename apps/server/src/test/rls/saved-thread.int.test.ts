// RLS suite: saved_thread, as ping_app with raw SQL and no server code.
//
// A Staff member reads, Saves and removes only their own Saved Threads, in Channels they
// can read, with no Admin exception. Nobody updates one. Other people's rows go only
// through clean_up_lost_access and deactivate_staff_member (fan-out-saved-mute.int.test.ts).
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

const save = (query: Query, staffId: string, channelId: string, threadId: string) =>
  query('insert into saved_thread (staff_id, thread_id, channel_id) values ($1, $2, $3)', [
    staffId,
    threadId,
    channelId,
  ]);

/** Whether the acting Staff member sees a Saved row on the Thread. */
const seesSaved = async (query: Query, threadId: string) =>
  (await query('select 1 from saved_thread where thread_id = $1', [threadId])).rowCount === 1;

/** A Thread in a fresh Channel, and a Staff member who may or may not be in it. */
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

/** As threadFor, with the owner's Saved row already in place. */
async function savedThread(options: Parameters<typeof threadFor>[0]) {
  const fixture = await threadFor(options);
  await asOwner((query) =>
    save(query, fixture.owner.id, fixture.channel.id, fixture.thread.id),
  );
  return fixture;
}

describe('saved_thread SELECT', () => {
  it('shows a Staff member their own Saved Thread and nobody else’s', async () => {
    const { owner, author, thread } = await savedThread({ ownerIsMember: true });
    await asPingApp(owner.id, async (query) => {
      expect(await seesSaved(query, thread.id)).toBe(true);
    });
    await asPingApp(author.id, async (query) => {
      expect(await seesSaved(query, thread.id)).toBe(false);
    });
  });

  it('keeps a Public channel’s Saved Thread readable by someone who is not a member', async () => {
    const { owner, thread } = await savedThread({ ownerIsMember: false });
    await asPingApp(owner.id, async (query) => {
      expect(await seesSaved(query, thread.id)).toBe(true);
    });
  });

  it('hides a Private channel’s Saved Thread from someone who is not a member', async () => {
    const { owner, thread } = await savedThread({ visibility: 'private', ownerIsMember: false });
    await asPingApp(owner.id, async (query) => {
      expect(await seesSaved(query, thread.id)).toBe(false);
    });
  });

  it('shows nothing to a Deactivated Staff member', async () => {
    const { owner, thread } = await savedThread({ ownerIsMember: true, ownerDeactivated: true });
    await asPingApp(owner.id, async (query) => {
      expect(await seesSaved(query, thread.id)).toBe(false);
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    const { thread } = await savedThread({ ownerIsMember: true });
    await asPingApp(null, async (query) => {
      expect(await seesSaved(query, thread.id)).toBe(false);
    });
  });
});

describe('saved_thread INSERT', () => {
  it('lets a Staff member Save a Thread they can read, member or not', async () => {
    const member = await threadFor({ ownerIsMember: true });
    const reader = await threadFor({ ownerIsMember: false });
    for (const { owner, channel, thread } of [member, reader]) {
      await asPingApp(owner.id, async (query) => {
        await save(query, owner.id, channel.id, thread.id);
        expect(await seesSaved(query, thread.id)).toBe(true);
      });
    }
  });

  it('refuses a Thread in a Private channel they aren’t in', async () => {
    const { owner, channel, thread } = await threadFor({
      visibility: 'private',
      ownerIsMember: false,
    });
    await asPingApp(owner.id, (query) =>
      expect(save(query, owner.id, channel.id, thread.id)).rejects.toMatchObject({
        code: '42501',
      }),
    );
  });

  it('refuses to Save for someone else', async () => {
    const { owner, author, channel, thread } = await threadFor({ ownerIsMember: true });
    await asPingApp(owner.id, (query) =>
      expect(save(query, author.id, channel.id, thread.id)).rejects.toMatchObject({
        code: '42501',
      }),
    );
  });

  it('refuses a Deactivated Staff member, and an unset app.staff_id', async () => {
    const { owner, channel, thread } = await threadFor({
      ownerIsMember: true,
      ownerDeactivated: true,
    });
    await asPingApp(owner.id, (query) =>
      expect(save(query, owner.id, channel.id, thread.id)).rejects.toMatchObject({
        code: '42501',
      }),
    );
    await asPingApp(null, (query) =>
      expect(save(query, owner.id, channel.id, thread.id)).rejects.toMatchObject({
        code: '42501',
      }),
    );
  });
});

describe('saved_thread UPDATE and DELETE', () => {
  it('refuses to update a Saved Thread, even your own', async () => {
    const { owner, thread } = await savedThread({ ownerIsMember: true });
    await asPingApp(owner.id, (query) =>
      expect(
        query('update saved_thread set saved_at = now() where thread_id = $1', [thread.id]),
      ).rejects.toMatchObject({ code: '42501' }),
    );
  });

  it('removes the Staff member’s own Saved Thread and no one else’s', async () => {
    const { owner, author, channel, thread } = await savedThread({ ownerIsMember: true });
    await asOwner((query) => save(query, author.id, channel.id, thread.id));
    await asPingApp(owner.id, async (query) => {
      const result = await query('delete from saved_thread where thread_id = $1', [thread.id]);
      expect(result.rowCount).toBe(1);
      await actAs(query, author.id);
      expect(await seesSaved(query, thread.id)).toBe(true);
    });
  });

  it('goes with its Thread when the Thread is deleted', async () => {
    const { owner, thread } = await savedThread({ ownerIsMember: true });
    await asOwner(async (query) => {
      await query('delete from thread where id = $1', [thread.id]);
      const left = await query('select 1 from saved_thread where staff_id = $1', [owner.id]);
      expect(left.rowCount).toBe(0);
    });
  });
});
