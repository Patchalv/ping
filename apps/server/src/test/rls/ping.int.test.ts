// RLS suite: ping and its two system functions, as ping_app with raw SQL and no server code.
//
// A Staff member reads and deletes only their own Pings, in Channels they can read, with no
// Admin exception. ping_app never inserts or updates one: fan_out_pings creates and bumps
// other people's Pings, and clean_up_lost_access drops the ones whose owner lost access.
// Each function acts for app.staff_id, does nothing when it's unset, and can't be steered
// at anyone through its arguments.
//
// ping_app reads only its own Pings, so a case that checks someone else's switches
// app.staff_id with `actAs` inside its transaction.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createInvitedStaffMember,
  createStaffMember,
  insertChannel,
  insertThread,
  type Query,
} from '../../db/test-support';

const emptyDoc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

const insertPing = (query: Query, channelId: string, threadId: string, staffId: string) =>
  // Only the owner can insert a Ping; the case's own connection is ping_app, so it goes
  // through the fan-out in the tests that need one. This helper is for the owner-side
  // fixtures, used outside asPingApp.
  query('insert into ping (staff_id, thread_id, channel_id, count) values ($1, $2, $3, 1)', [
    staffId,
    threadId,
    channelId,
  ]);

/** Switches the case's transaction to another Staff member. */
const actAs = (query: Query, staffId: string | null) =>
  query(`select set_config('app.staff_id', $1, true)`, [staffId ?? '']);

/** Starts a Thread as the acting Staff member, in this case's transaction. */
const startThread = async (query: Query, channelId: string): Promise<string> => {
  const result = await query<{ id: string }>(
    `insert into thread (channel_id, author_id, title, body, body_text)
     values ($1, current_setting('app.staff_id')::uuid, 'Hello', $2, 'hi') returning id`,
    [channelId, emptyDoc],
  );
  const row = result.rows[0];
  if (!row) throw new Error('no thread');
  return row.id;
};

/** Sends a Thread Response as the acting Staff member, in this case's transaction. */
const sendResponse = async (query: Query, channelId: string, threadId: string): Promise<string> => {
  const result = await query<{ id: string }>(
    `insert into thread_response (thread_id, channel_id, author_id, body, body_text)
     values ($1, $2, current_setting('app.staff_id')::uuid, $3, 'hi') returning id`,
    [threadId, channelId, emptyDoc],
  );
  const row = result.rows[0];
  if (!row) throw new Error('no thread response');
  return row.id;
};

const fanOut = async (query: Query, threadId: string, responseId?: string) =>
  (
    await query<{ n: number }>('select public.fan_out_pings($1, $2) as n', [
      threadId,
      responseId ?? null,
    ])
  ).rows[0]?.n;

const cleanUp = async (query: Query, channelId: string) =>
  (await query<{ n: number }>('select public.clean_up_lost_access($1) as n', [channelId])).rows[0]
    ?.n;

/** The acting Staff member's Pings on the Thread: count, or undefined with no Ping. */
const myCount = async (query: Query, threadId: string) =>
  (await query<{ count: number }>('select count from ping where thread_id = $1', [threadId]))
    .rows[0]?.count;

/** A Thread in a fresh Channel started by its author, and a Ping for `owner` via the owner. */
async function pingedThread(options: {
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
  await asOwner((query) => insertPing(query, channel.id, thread.id, owner.id));
  return { owner, author, channel, thread };
}

describe('ping SELECT and DELETE', () => {
  it('shows a Staff member their own Ping and nobody else’s', async () => {
    const { owner, author, thread } = await pingedThread({ ownerIsMember: true });
    await asPingApp(owner.id, async (query) => {
      expect(await myCount(query, thread.id)).toBe(1);
    });
    await asPingApp(author.id, async (query) => {
      expect(await myCount(query, thread.id)).toBeUndefined();
    });
  });

  it('keeps a Public channel’s Ping readable by someone who is not a member', async () => {
    const { owner, thread } = await pingedThread({ ownerIsMember: false });
    await asPingApp(owner.id, async (query) => {
      expect(await myCount(query, thread.id)).toBe(1);
    });
  });

  it('hides a Private channel’s Ping from someone who is not a member', async () => {
    const { owner, thread } = await pingedThread({ visibility: 'private', ownerIsMember: false });
    await asPingApp(owner.id, async (query) => {
      expect(await myCount(query, thread.id)).toBeUndefined();
    });
  });

  it('shows nothing to a Deactivated Staff member', async () => {
    const { owner, thread } = await pingedThread({ ownerIsMember: true, ownerDeactivated: true });
    await asPingApp(owner.id, async (query) => {
      expect(await myCount(query, thread.id)).toBeUndefined();
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    const { thread } = await pingedThread({ ownerIsMember: true });
    await asPingApp(null, async (query) => {
      expect(await myCount(query, thread.id)).toBeUndefined();
    });
  });

  it('deletes the Staff member’s own Ping and no one else’s', async () => {
    const { owner, author, channel, thread } = await pingedThread({ ownerIsMember: true });
    await asOwner((query) => insertPing(query, channel.id, thread.id, author.id));
    await asPingApp(owner.id, async (query) => {
      const result = await query('delete from ping where thread_id = $1', [thread.id]);
      expect(result.rowCount).toBe(1);
      await actAs(query, author.id);
      expect(await myCount(query, thread.id)).toBe(1);
    });
  });

  it('refuses to insert a Ping, even your own', async () => {
    const { owner, channel, thread } = await pingedThread({ ownerIsMember: true });
    await asPingApp(owner.id, (query) =>
      expect(
        query('insert into ping (staff_id, thread_id, channel_id) values ($1, $2, $3)', [
          randomUUID(),
          thread.id,
          channel.id,
        ]),
      ).rejects.toMatchObject({ code: '42501' }),
    );
  });

  it('refuses to update a Ping, even your own', async () => {
    const { owner, thread } = await pingedThread({ ownerIsMember: true });
    await asPingApp(owner.id, (query) =>
      expect(
        query('update ping set count = 99 where thread_id = $1', [thread.id]),
      ).rejects.toMatchObject({ code: '42501' }),
    );
  });
});

/** A Channel with an author, and members who will be Pinged. */
async function channelOf(memberCount: number, visibility: 'public' | 'private' = 'public') {
  const author = await createStaffMember();
  const members = await Promise.all(Array.from({ length: memberCount }, () => createStaffMember()));
  const channel = await insertChannel({
    visibility,
    members: [
      { staffId: author.id, channelAdmin: true },
      ...members.map((m) => ({ staffId: m.id })),
    ],
  });
  return { author, members, channel };
}

describe('fan_out_pings', () => {
  it('Pings every active member except the author for a new Thread', async () => {
    const { author, members, channel } = await channelOf(2);
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      expect(await fanOut(query, threadId)).toBe(2);
      expect(await myCount(query, threadId)).toBeUndefined();
      for (const member of members) {
        await actAs(query, member.id);
        expect(await myCount(query, threadId)).toBe(1);
      }
    });
  });

  it('never Pings a Deactivated or Invited member', async () => {
    const author = await createStaffMember();
    const deactivated = await createStaffMember({ deactivated: true });
    const invited = await createInvitedStaffMember();
    const active = await createStaffMember();
    const channel = await insertChannel({
      members: [author, deactivated, invited, active].map((m) => ({ staffId: m.id })),
    });
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      expect(await fanOut(query, threadId)).toBe(1);
      await actAs(query, deactivated.id);
      expect(await myCount(query, threadId)).toBeUndefined();
      await actAs(query, active.id);
      expect(await myCount(query, threadId)).toBe(1);
    });
  });

  it('raises an open Ping’s count for a new Thread Response, and leaves the author alone', async () => {
    const { author, members, channel } = await channelOf(1);
    const [member] = members;
    if (!member) throw new Error('no member');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      await fanOut(query, threadId);
      await actAs(query, member.id);
      expect(await myCount(query, threadId)).toBe(1);
      await actAs(query, author.id);
      const responseId = await sendResponse(query, channel.id, threadId);
      expect(await fanOut(query, threadId, responseId)).toBe(1);
      expect(await myCount(query, threadId)).toBeUndefined();
      await actAs(query, member.id);
      expect(await myCount(query, threadId)).toBe(2);
    });
  });

  it('keeps first_at and moves last_at forward as the count rises', async () => {
    const { author, members, channel } = await channelOf(1);
    const [member] = members;
    if (!member) throw new Error('no member');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      await fanOut(query, threadId);
      const responseId = await sendResponse(query, channel.id, threadId);
      await fanOut(query, threadId, responseId);
      await actAs(query, member.id);
      const row = await query<{ count: number; ordered: boolean }>(
        'select count, first_at <= last_at as ordered from ping where thread_id = $1',
        [threadId],
      );
      expect(row.rows).toEqual([{ count: 2, ordered: true }]);
    });
  });

  it('does nothing when app.staff_id is unset', async () => {
    const { author, members, channel } = await channelOf(1);
    const [member] = members;
    if (!member) throw new Error('no member');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      await actAs(query, null);
      expect(await fanOut(query, threadId)).toBe(0);
      await actAs(query, member.id);
      expect(await myCount(query, threadId)).toBeUndefined();
    });
  });

  it('does nothing for a Deactivated Staff member', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { author, members, channel } = await channelOf(1);
    const [member] = members;
    if (!member) throw new Error('no member');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      await actAs(query, admin.id);
      await query(
        'update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1',
        [author.id, admin.id],
      );
      await actAs(query, author.id);
      expect(await fanOut(query, threadId)).toBe(0);
      await actAs(query, member.id);
      expect(await myCount(query, threadId)).toBeUndefined();
    });
  });

  it('can’t be steered at someone else’s post', async () => {
    const { author, members, channel } = await channelOf(2);
    const [member, other] = members;
    if (!member || !other) throw new Error('members');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      // A member tries to Ping the Channel about the author's Thread.
      await actAs(query, member.id);
      expect(await fanOut(query, threadId)).toBe(0);
      await actAs(query, other.id);
      expect(await myCount(query, threadId)).toBeUndefined();
    });
  });

  it('can’t be steered at an old post', async () => {
    const { author, channel } = await channelOf(1);
    const old = await insertThread({ channelId: channel.id, authorId: author.id });
    await asPingApp(author.id, async (query) => {
      expect(await fanOut(query, old.id)).toBe(0);
    });
  });

  it('does nothing for an author who is not a member of the Channel', async () => {
    const { members, channel } = await channelOf(1);
    const outsider = await createStaffMember();
    const [member] = members;
    if (!member) throw new Error('no member');
    await asPingApp(outsider.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      expect(await fanOut(query, threadId)).toBe(0);
      await actAs(query, member.id);
      expect(await myCount(query, threadId)).toBeUndefined();
    });
  });

  it('takes a Thread Response only from its own author and Thread', async () => {
    const { author, members, channel } = await channelOf(1);
    const [member] = members;
    if (!member) throw new Error('no member');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      const otherThreadId = await startThread(query, channel.id);
      const responseId = await sendResponse(query, channel.id, threadId);
      // The Thread Response isn't in that Thread.
      expect(await fanOut(query, otherThreadId, responseId)).toBe(0);
      await actAs(query, member.id);
      expect(await myCount(query, otherThreadId)).toBeUndefined();
    });
  });
});

describe('clean_up_lost_access', () => {
  it('drops a former member’s Pings in a Private channel', async () => {
    const { author, members, channel } = await channelOf(1, 'private');
    const [member] = members;
    if (!member) throw new Error('no member');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      await fanOut(query, threadId);
      await query('delete from channel_member where channel_id = $1 and staff_id = $2', [
        channel.id,
        member.id,
      ]);
      expect(await cleanUp(query, channel.id)).toBe(1);
      await actAs(query, member.id);
      expect(await myCount(query, threadId)).toBeUndefined();
    });
  });

  it('keeps a former member’s Pings in a Public channel', async () => {
    const { author, members, channel } = await channelOf(1);
    const [member] = members;
    if (!member) throw new Error('no member');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      await fanOut(query, threadId);
      await query('delete from channel_member where channel_id = $1 and staff_id = $2', [
        channel.id,
        member.id,
      ]);
      expect(await cleanUp(query, channel.id)).toBe(0);
      await actAs(query, member.id);
      expect(await myCount(query, threadId)).toBe(1);
    });
  });

  it('can’t drop the Pings of someone who still has access', async () => {
    const { author, members, channel } = await channelOf(2, 'private');
    const [member, remaining] = members;
    if (!member || !remaining) throw new Error('members');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      await fanOut(query, threadId);
      await query('delete from channel_member where channel_id = $1 and staff_id = $2', [
        channel.id,
        member.id,
      ]);
      expect(await cleanUp(query, channel.id)).toBe(1);
      await actAs(query, remaining.id);
      expect(await myCount(query, threadId)).toBe(1);
    });
  });

  it('does nothing when app.staff_id is unset', async () => {
    const { author, members, channel } = await channelOf(1, 'private');
    const [member] = members;
    if (!member) throw new Error('no member');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      await fanOut(query, threadId);
      await query('delete from channel_member where channel_id = $1 and staff_id = $2', [
        channel.id,
        member.id,
      ]);
      await actAs(query, null);
      expect(await cleanUp(query, channel.id)).toBe(0);
    });
  });
});

describe('deactivate_staff_member and Pings', () => {
  it('drops the Deactivated Staff member’s Pings, even in a Public channel', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { owner, thread } = await pingedThread({ ownerIsMember: true });
    await asPingApp(admin.id, async (query) => {
      await query(
        'update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1',
        [owner.id, admin.id],
      );
      await query('select * from public.deactivate_staff_member($1)', [owner.id]);
      // Reactivating restores access, and back-fills nothing.
      await query(
        'update staff_member set deactivated_at = null, deactivated_by = null where id = $1',
        [owner.id],
      );
      await actAs(query, owner.id);
      expect(await myCount(query, thread.id)).toBeUndefined();
    });
  });
});

describe('deleting a Thread', () => {
  it('removes everyone’s Pings on it', async () => {
    const { author, members, channel } = await channelOf(1);
    const [member] = members;
    if (!member) throw new Error('no member');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      await fanOut(query, threadId);
      await query('delete from thread where id = $1', [threadId]);
      await actAs(query, member.id);
      expect(await myCount(query, threadId)).toBeUndefined();
    });
  });
});
