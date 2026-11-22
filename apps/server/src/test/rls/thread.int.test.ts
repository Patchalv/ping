// RLS suite: thread, as ping_app with raw SQL and no server code.
//
// The visibility rule, FOR ALL, with no Admin exception: a Thread is visible when its
// Channel is Public or the acting Staff member is a member of it. ping_app may read and
// insert only; an insert must be an ordinary Thread by the acting Staff member. Who may
// start one (members only) is the permissions module's job.
import { describe, expect, it } from 'vitest';
import {
  asPingApp,
  createStaffMember,
  insertChannel,
  insertThread,
  insertThreadResponse,
  type Query,
} from '../../db/test-support';

const visibleThreadIds = async (query: Query, ids: string[]) =>
  (await query<{ id: string }>('select id from thread where id = any($1)', [ids])).rows
    .map((r) => r.id)
    .sort();

const BODY = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

const insertAs = (query: Query, channelId: string, authorId: string | null) =>
  query(
    `insert into thread (channel_id, author_id, title, body, body_text)
     values ($1, $2, 'Hello', $3, '')`,
    [channelId, authorId, BODY],
  );

type PlanNode = {
  'Parent Relationship'?: string;
  'Actual Loops': number;
  'Actual Rows': number;
  Plans?: PlanNode[];
};
const planNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(planNodes)];

/** A Channel of the given kind with one Thread in it, by its Channel admin. */
async function channelWithThread(visibility: 'public' | 'private', memberIds: string[] = []) {
  const author = await createStaffMember();
  const channel = await insertChannel({
    visibility,
    members: [
      { staffId: author.id, channelAdmin: true },
      ...memberIds.map((staffId) => ({ staffId })),
    ],
  });
  const thread = await insertThread({ channelId: channel.id, authorId: author.id });
  return { author, channel, thread };
}

describe('thread SELECT', () => {
  it('shows a Public channel’s Threads to a Staff member who is not a member', async () => {
    const member = await createStaffMember();
    const { thread } = await channelWithThread('public');
    await asPingApp(member.id, async (query) => {
      expect(await visibleThreadIds(query, [thread.id])).toEqual([thread.id]);
    });
  });

  it('shows a Private channel’s Threads to its members', async () => {
    const member = await createStaffMember();
    const { thread } = await channelWithThread('private', [member.id]);
    await asPingApp(member.id, async (query) => {
      expect(await visibleThreadIds(query, [thread.id])).toEqual([thread.id]);
    });
  });

  it.each([
    ['a Member', 'member'],
    ['a company Admin: there is no Admin exception', 'admin'],
  ] as const)('hides a Private channel’s Threads from %s who is not a member', async (_n, role) => {
    const outsider = await createStaffMember({ role });
    const { thread } = await channelWithThread('private');
    await asPingApp(outsider.id, async (query) => {
      expect(await visibleThreadIds(query, [thread.id])).toEqual([]);
    });
  });

  it('shows nothing to a Deactivated Staff member, even in their own Channels', async () => {
    const deactivated = await createStaffMember({ deactivated: true });
    const mine = await channelWithThread('private', [deactivated.id]);
    const open = await channelWithThread('public');
    await asPingApp(deactivated.id, async (query) => {
      expect(await visibleThreadIds(query, [mine.thread.id, open.thread.id])).toEqual([]);
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    const { thread } = await channelWithThread('public');
    await asPingApp(null, async (query) => {
      expect(await visibleThreadIds(query, [thread.id])).toEqual([]);
    });
  });

  it('evaluates the membership helper once per statement, not once per row', async () => {
    const member = await createStaffMember();
    for (let i = 0; i < 5; i++) {
      await channelWithThread(i % 2 === 0 ? 'public' : 'private', [member.id]);
    }
    await asPingApp(member.id, async (query) => {
      const result = await query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        'explain (analyze, verbose, format json) select id from thread',
      );
      const root = result.rows[0]?.['QUERY PLAN'][0]?.Plan;
      if (!root) throw new Error('no plan');
      expect(root['Actual Rows']).toBeGreaterThan(1);
      const mentionsHelper = (node: PlanNode) =>
        JSON.stringify({ ...node, Plans: undefined }).includes('current_staff_channel_ids');
      // The helper runs inside InitPlans (thread's policy, and channel's own policy under
      // the Public-channel check), each once…
      const initPlans = planNodes(root).filter((n) => n['Parent Relationship'] === 'InitPlan');
      const helperPlans = initPlans.filter((n) => planNodes(n).some(mentionsHelper));
      expect(helperPlans.length).toBeGreaterThan(0);
      for (const node of helperPlans.flatMap(planNodes)) {
        expect(node['Actual Loops']).toBe(1);
      }
      // …and never in the per-row filter of the scan over thread.
      const outside = planNodes(root).filter(
        (n) => !initPlans.some((p) => planNodes(p).includes(n)),
      );
      expect(outside.some(mentionsHelper)).toBe(false);
    });
  });
});

describe('thread INSERT', () => {
  it('lets a member start a Thread in their Private channel', async () => {
    const member = await createStaffMember();
    const { channel } = await channelWithThread('private', [member.id]);
    await asPingApp(member.id, async (query) => {
      expect((await insertAs(query, channel.id, member.id)).rowCount).toBe(1);
    });
  });

  it('lets anyone insert into a Public channel: membership is the server’s check', async () => {
    const outsider = await createStaffMember();
    const { channel } = await channelWithThread('public');
    await asPingApp(outsider.id, async (query) => {
      expect((await insertAs(query, channel.id, outsider.id)).rowCount).toBe(1);
    });
  });

  it.each([
    ['a Member', 'member'],
    ['a company Admin', 'admin'],
  ] as const)('refuses %s inserting into a Private channel they are not in', async (_n, role) => {
    const outsider = await createStaffMember({ role });
    const { channel } = await channelWithThread('private');
    await asPingApp(outsider.id, async (query) => {
      await expect(insertAs(query, channel.id, outsider.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a Thread in someone else’s name', async () => {
    const member = await createStaffMember();
    const { channel, author } = await channelWithThread('public', [member.id]);
    await asPingApp(member.id, async (query) => {
      await expect(insertAs(query, channel.id, author.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a System thread: only system functions start those', async () => {
    const member = await createStaffMember();
    const { channel } = await channelWithThread('public', [member.id]);
    await asPingApp(member.id, async (query) => {
      await expect(
        query(
          `insert into thread (channel_id, author_id, is_system, system_kind, system_payload, title, body, body_text)
           values ($1, null, true, 'channel_archived', '{}', 'Archived', $2, '')`,
          [channel.id, BODY],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a Deactivated Staff member', async () => {
    const deactivated = await createStaffMember({ deactivated: true });
    const { channel } = await channelWithThread('public', [deactivated.id]);
    await asPingApp(deactivated.id, async (query) => {
      await expect(insertAs(query, channel.id, deactivated.id)).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it('refuses everything when app.staff_id is unset', async () => {
    const author = await createStaffMember();
    const { channel } = await channelWithThread('public');
    await asPingApp(null, async (query) => {
      await expect(insertAs(query, channel.id, author.id)).rejects.toThrow(/row-level security/);
    });
  });
});

// Editing and deleting arrived with "Thread Responses, editing and deleting" (#39). Who may
// edit or delete (the author, or a company Admin) is the permissions module's job; the
// database lets a visible Thread be updated and deleted, and limits the columns.
describe('thread UPDATE', () => {
  it('lets a Staff member update the content of a Thread they can see', async () => {
    const { author, thread } = await channelWithThread('public');
    await asPingApp(author.id, async (query) => {
      const result = await query(
        `update thread set title = 'Changed', edited_at = now(), edited_by = $2 where id = $1`,
        [thread.id, author.id],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it.each([
    ['author_id', `author_id = gen_random_uuid()`],
    ['channel_id', `channel_id = gen_random_uuid()`],
    ['is_system', `is_system = true`],
    ['created_at', `created_at = now() - interval '1 day'`],
    ['resolved_at', `resolved_at = now()`],
  ])('refuses changing %s: ping_app may only change the content', async (_col, set) => {
    const { author, thread } = await channelWithThread('public');
    await asPingApp(author.id, async (query) => {
      await expect(query(`update thread set ${set} where id = $1`, [thread.id])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it('updates nothing in a Private channel the Staff member is not in, Admins included', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { thread } = await channelWithThread('private');
    await asPingApp(admin.id, async (query) => {
      const result = await query(`update thread set title = 'Changed' where id = $1`, [thread.id]);
      expect(result.rowCount).toBe(0);
    });
  });

  it('updates nothing when app.staff_id is unset', async () => {
    const { thread } = await channelWithThread('public');
    await asPingApp(null, async (query) => {
      const result = await query(`update thread set title = 'Changed' where id = $1`, [thread.id]);
      expect(result.rowCount).toBe(0);
    });
  });
});

describe('thread DELETE', () => {
  it('deletes a visible Thread, and its Thread Responses with it', async () => {
    const { author, channel, thread } = await channelWithThread('public');
    const response = await insertThreadResponse({
      threadId: thread.id,
      channelId: channel.id,
      authorId: author.id,
    });
    await asPingApp(author.id, async (query) => {
      expect((await query('delete from thread where id = $1', [thread.id])).rowCount).toBe(1);
      const left = await query('select id from thread_response where id = $1', [response.id]);
      // The cascade runs under FORCE ROW LEVEL SECURITY too.
      expect(left.rowCount).toBe(0);
    });
  });

  it('deletes nothing in a Private channel the Staff member is not in, Admins included', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { thread } = await channelWithThread('private');
    await asPingApp(admin.id, async (query) => {
      expect((await query('delete from thread where id = $1', [thread.id])).rowCount).toBe(0);
    });
  });

  it('deletes nothing when app.staff_id is unset', async () => {
    const { thread } = await channelWithThread('public');
    await asPingApp(null, async (query) => {
      expect((await query('delete from thread where id = $1', [thread.id])).rowCount).toBe(0);
    });
  });
});
