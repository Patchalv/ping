// RLS suite: how Saved Threads and mutes change the system functions (product.md › Who gets
// a Ping, › Losing access; data-model.md › The clean-up routine).
//
// Who gets a Ping lives in fan_out_pings, because it reads other people's mutes and Saved
// rows, which ping_app can't. So the who-gets-a-Ping rules are tested here, one case per
// rule, rather than through a TypeScript copy that could drift from the SQL.
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createStaffMember,
  insertChannel,
  insertThread,
  type Query,
  type StaffFixture,
} from '../../db/test-support';

const emptyDoc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

const actAs = (query: Query, staffId: string | null) =>
  query(`select set_config('app.staff_id', $1, true)`, [staffId ?? '']);

const sendResponse = async (query: Query, channelId: string, threadId: string) => {
  const result = await query<{ id: string }>(
    `insert into thread_response (thread_id, channel_id, author_id, body, body_text)
     values ($1, $2, current_setting('app.staff_id')::uuid, $3, 'hi') returning id`,
    [threadId, channelId, emptyDoc],
  );
  const row = result.rows[0];
  if (!row) throw new Error('no thread response');
  return row.id;
};

const startThread = async (query: Query, channelId: string) => {
  const result = await query<{ id: string }>(
    `insert into thread (channel_id, author_id, title, body, body_text)
     values ($1, current_setting('app.staff_id')::uuid, 'Hello', $2, 'hi') returning id`,
    [channelId, emptyDoc],
  );
  const row = result.rows[0];
  if (!row) throw new Error('no thread');
  return row.id;
};

const fanOut = async (query: Query, threadId: string, responseId?: string) =>
  (
    await query<{ n: number }>('select public.fan_out_pings($1, $2) as n', [
      threadId,
      responseId ?? null,
    ])
  ).rows[0]?.n;

const addMember = (channelId: string, staffId: string) =>
  asOwner((query) =>
    query('insert into channel_member (channel_id, staff_id) values ($1, $2)', [
      channelId,
      staffId,
    ]),
  );

/**
 * Runs `fn` as the owner in one committed transaction, acting as `staffId`. The clean-up
 * cases use it because asPingApp rolls back and ping_app can't read other people's rows
 * afterwards; the system functions act for app.staff_id all the same.
 */
const asOwnerActingAs = (staffId: string | null, fn: (query: Query) => Promise<unknown>) =>
  asOwner(async (query) => {
    await query('begin');
    await actAs(query, staffId);
    await fn(query);
    await query('commit');
  });

/**
 * Removes `leaverId` from the Channel and runs the clean-up as `actorId`, the way the leave
 * and remove routes do in one transaction.
 */
const leaveAndCleanUp = (channelId: string, leaverId: string, actorId = leaverId) =>
  asOwnerActingAs(actorId, async (query) => {
    await query('delete from channel_member where channel_id = $1 and staff_id = $2', [
      channelId,
      leaverId,
    ]);
    await query('select public.clean_up_lost_access($1)', [channelId]);
  });

/** Every Ping, Saved and mute row of one Staff member in the Channel, read as the owner. */
function attentionOf(staffId: string, channelId: string) {
  return asOwner(async (query) => {
    const count = async (sql: string) =>
      (await query<{ n: number }>(sql, [staffId, channelId])).rows[0]?.n ?? 0;
    return {
      pingCount: await count(
        'select coalesce(sum(count), 0)::int as n from ping where staff_id = $1 and channel_id = $2',
      ),
      saved: await count(
        'select count(*)::int as n from saved_thread where staff_id = $1 and channel_id = $2',
      ),
      channelMutes: await count(
        'select count(*)::int as n from mute where staff_id = $1 and channel_id = $2 and thread_id is null',
      ),
      threadMutes: await count(
        'select count(*)::int as n from mute where staff_id = $1 and channel_id = $2 and thread_id is not null',
      ),
    };
  });
}

type Setup = { saved?: boolean; channelMute?: boolean; threadMute?: boolean };

/** Puts a Staff member's Saved and mute rows in place, as the owner. */
function arrange(staff: StaffFixture, channelId: string, threadId: string, setup: Setup) {
  return asOwner(async (query) => {
    if (setup.saved) {
      await query(
        'insert into saved_thread (staff_id, thread_id, channel_id) values ($1, $2, $3)',
        [staff.id, threadId, channelId],
      );
    }
    if (setup.channelMute) {
      await query('insert into mute (staff_id, channel_id) values ($1, $2)', [staff.id, channelId]);
    }
    if (setup.threadMute) {
      await query('insert into mute (staff_id, channel_id, thread_id) values ($1, $2, $3)', [
        staff.id,
        channelId,
        threadId,
      ]);
    }
  });
}

type SceneOptions = {
  visibility?: 'public' | 'private';
  subjectIsMember: boolean;
  subjectDeactivated?: boolean;
  subject?: Setup;
};

/**
 * A Channel with an author and a Thread, and one other Staff member, `subject`, set up as
 * the case says: a member or not, Deactivated or not, with Saved and mutes in place.
 */
async function scene(options: SceneOptions) {
  const author = await createStaffMember();
  const subject = await createStaffMember({ deactivated: options.subjectDeactivated });
  const channel = await insertChannel({
    visibility: options.visibility ?? 'public',
    members: [
      { staffId: author.id, channelAdmin: true },
      ...(options.subjectIsMember ? [{ staffId: subject.id }] : []),
    ],
  });
  const thread = await insertThread({ channelId: channel.id, authorId: author.id });
  await arrange(subject, channel.id, thread.id, options.subject ?? {});
  return { author, subject, channel, thread };
}

/** The author sends a Thread Response; the subject's Ping count after the fan-out. */
function pingAfterResponse({
  author,
  subject,
  channel,
  thread,
}: Awaited<ReturnType<typeof scene>>) {
  return asPingApp(author.id, async (query) => {
    const responseId = await sendResponse(query, channel.id, thread.id);
    await fanOut(query, thread.id, responseId);
    // asPingApp rolls back, so read the subject's Ping as them, inside the transaction.
    await actAs(query, subject.id);
    const row = await query<{ count: number }>('select count from ping where thread_id = $1', [
      thread.id,
    ]);
    return row.rows[0]?.count ?? 0;
  });
}

describe('fan_out_pings for a new Thread Response', () => {
  it.each<[string, SceneOptions, number]>([
    ['Pings a member', { subjectIsMember: true }, 1],
    [
      'skips a member who muted the Channel',
      { subjectIsMember: true, subject: { channelMute: true } },
      0,
    ],
    [
      'skips a member who muted the Thread',
      { subjectIsMember: true, subject: { threadMute: true } },
      0,
    ],
    [
      'Pings a member who Saved the Thread, once',
      { subjectIsMember: true, subject: { saved: true } },
      1,
    ],
    [
      'Pings someone who Saved the Thread in a Public channel they aren’t in',
      { subjectIsMember: false, subject: { saved: true } },
      1,
    ],
    [
      // Saved adds them to the fan-out, and a mute takes away only Channel members: Saved
      // doesn't mute, and a mute doesn't undo Saving (product.md › Edge cases).
      'Pings someone who Saved the Thread even when they muted it',
      { subjectIsMember: true, subject: { saved: true, channelMute: true, threadMute: true } },
      1,
    ],
    ['skips a non-member who hasn’t Saved it', { subjectIsMember: false }, 0],
    [
      'skips a Deactivated Staff member who Saved it',
      { subjectIsMember: false, subjectDeactivated: true, subject: { saved: true } },
      0,
    ],
    [
      // clean_up_lost_access removes such a row; the fan-out never relies on that.
      'skips someone who Saved a Thread in a Private channel they aren’t in',
      { visibility: 'private', subjectIsMember: false, subject: { saved: true } },
      0,
    ],
  ])('%s', async (_name, options, expected) => {
    expect(await pingAfterResponse(await scene(options))).toBe(expected);
  });

  it('never Pings the author, even when they Saved the Thread', async () => {
    const { author, channel, thread } = await scene({ subjectIsMember: true });
    await arrange(author, channel.id, thread.id, { saved: true });
    await asPingApp(author.id, async (query) => {
      const responseId = await sendResponse(query, channel.id, thread.id);
      expect(await fanOut(query, thread.id, responseId)).toBe(1);
      const own = await query('select 1 from ping where thread_id = $1', [thread.id]);
      expect(own.rowCount).toBe(0);
    });
  });
});

describe('fan_out_pings for a new Thread', () => {
  it('ignores mutes', async () => {
    const { author, subject, channel } = await scene({
      subjectIsMember: true,
      subject: { channelMute: true },
    });
    await asPingApp(author.id, async (query) => {
      const threadId = await startThread(query, channel.id);
      expect(await fanOut(query, threadId)).toBe(1);
      await actAs(query, subject.id);
      const row = await query('select 1 from ping where thread_id = $1', [threadId]);
      expect(row.rowCount).toBe(1);
    });
  });
});

describe('clean_up_lost_access', () => {
  const everything: Setup = { saved: true, channelMute: true, threadMute: true };

  it('keeps Saved and drops mutes when a member leaves a Public channel', async () => {
    const { subject, channel } = await scene({ subjectIsMember: true, subject: everything });
    await leaveAndCleanUp(channel.id, subject.id);
    expect(await attentionOf(subject.id, channel.id)).toMatchObject({
      saved: 1,
      channelMutes: 0,
      threadMutes: 0,
    });
  });

  it('drops only the Channel mute of someone removed from a Public channel', async () => {
    // They can still read every Thread in it; only the Channel mute needs membership.
    const { author, subject, channel } = await scene({
      subjectIsMember: true,
      subject: everything,
    });
    await leaveAndCleanUp(channel.id, subject.id, author.id);
    expect(await attentionOf(subject.id, channel.id)).toMatchObject({
      saved: 1,
      channelMutes: 0,
      threadMutes: 1,
    });
  });

  it('keeps a reader’s Thread mute in a Public channel when someone else leaves', async () => {
    const { subject, channel } = await scene({
      subjectIsMember: false,
      subject: { threadMute: true },
    });
    const leaver = await createStaffMember();
    await addMember(channel.id, leaver.id);
    await leaveAndCleanUp(channel.id, leaver.id);
    expect(await attentionOf(subject.id, channel.id)).toMatchObject({ threadMutes: 1 });
  });

  it.each([
    ['leaves', false],
    ['is removed from', true],
  ])('drops Saved and mutes when a member %s a Private channel', async (_how, removed) => {
    const { author, subject, channel } = await scene({
      visibility: 'private',
      subjectIsMember: true,
      subject: everything,
    });
    await leaveAndCleanUp(channel.id, subject.id, removed ? author.id : subject.id);
    expect(await attentionOf(subject.id, channel.id)).toEqual({
      pingCount: 0,
      saved: 0,
      channelMutes: 0,
      threadMutes: 0,
    });
  });

  it('keeps the Saved Threads and mutes of someone still in a Private channel', async () => {
    const { author, subject, channel } = await scene({
      visibility: 'private',
      subjectIsMember: true,
      subject: everything,
    });
    const leaver = await createStaffMember();
    await addMember(channel.id, leaver.id);
    await leaveAndCleanUp(channel.id, leaver.id, author.id);
    expect(await attentionOf(subject.id, channel.id)).toEqual({
      pingCount: 0,
      saved: 1,
      channelMutes: 1,
      threadMutes: 1,
    });
  });

  it('does nothing when app.staff_id is unset', async () => {
    const { subject, channel } = await scene({
      visibility: 'private',
      subjectIsMember: true,
      subject: everything,
    });
    await asOwnerActingAs(null, async (query) => {
      await query('delete from channel_member where channel_id = $1 and staff_id = $2', [
        channel.id,
        subject.id,
      ]);
      await query('select public.clean_up_lost_access($1)', [channel.id]);
    });
    expect(await attentionOf(subject.id, channel.id)).toMatchObject({
      saved: 1,
      channelMutes: 1,
      threadMutes: 1,
    });
  });
});

describe('deactivate_staff_member', () => {
  it('drops the Deactivated Staff member’s Saved Threads and mutes', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { subject, channel } = await scene({
      subjectIsMember: true,
      subject: { saved: true, channelMute: true, threadMute: true },
    });
    await asOwnerActingAs(admin.id, async (query) => {
      await query(
        'update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1',
        [subject.id, admin.id],
      );
      await query('select * from public.deactivate_staff_member($1)', [subject.id]);
    });
    expect(await attentionOf(subject.id, channel.id)).toEqual({
      pingCount: 0,
      saved: 0,
      channelMutes: 0,
      threadMutes: 0,
    });
  });
});
