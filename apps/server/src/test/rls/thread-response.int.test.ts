// RLS suite: thread_response, as ping_app with raw SQL and no server code.
//
// The visibility rule, FOR ALL, with no Admin exception, the same as thread's. ping_app
// may read, insert and update the content and the edit and delete marks, never delete:
// a deleted Thread Response stays as its placeholder. An insert must be by the acting
// Staff member. Who may send, edit or delete is the permissions module's job.
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createStaffMember,
  insertChannel,
  insertThread,
  insertThreadResponse,
  type Query,
} from '../../db/test-support';

const visibleIds = async (query: Query, ids: string[]) =>
  (await query<{ id: string }>('select id from thread_response where id = any($1)', [ids])).rows
    .map((r) => r.id)
    .sort();

const BODY = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done' }] }],
});

const sendAs = (
  query: Query,
  where: { threadId: string; channelId: string },
  authorId: string | null,
) =>
  query(
    `insert into thread_response (thread_id, channel_id, author_id, body, body_text)
     values ($1, $2, $3, $4, 'Done')`,
    [where.threadId, where.channelId, authorId, BODY],
  );

type PlanNode = {
  'Parent Relationship'?: string;
  'Actual Loops': number;
  'Actual Rows': number;
  Plans?: PlanNode[];
};
const planNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(planNodes)];

/** A Channel of the given kind with a Thread and one Thread Response, by its Channel admin. */
async function channelWithResponse(visibility: 'public' | 'private', memberIds: string[] = []) {
  const author = await createStaffMember();
  const channel = await insertChannel({
    visibility,
    members: [
      { staffId: author.id, channelAdmin: true },
      ...memberIds.map((staffId) => ({ staffId })),
    ],
  });
  const thread = await insertThread({ channelId: channel.id, authorId: author.id });
  const response = await insertThreadResponse({
    threadId: thread.id,
    channelId: channel.id,
    authorId: author.id,
  });
  return {
    author,
    channel,
    thread,
    response,
    where: { threadId: thread.id, channelId: channel.id },
  };
}

describe('thread_response SELECT', () => {
  it('shows a Public channel’s Thread Responses to a Staff member who is not a member', async () => {
    const outsider = await createStaffMember();
    const { response } = await channelWithResponse('public');
    await asPingApp(outsider.id, async (query) => {
      expect(await visibleIds(query, [response.id])).toEqual([response.id]);
    });
  });

  it('shows a Private channel’s Thread Responses to its members', async () => {
    const member = await createStaffMember();
    const { response } = await channelWithResponse('private', [member.id]);
    await asPingApp(member.id, async (query) => {
      expect(await visibleIds(query, [response.id])).toEqual([response.id]);
    });
  });

  it.each([
    ['a Member', 'member'],
    ['a company Admin: there is no Admin exception', 'admin'],
  ] as const)(
    'hides a Private channel’s Thread Responses from %s who is not a member',
    async (_n, role) => {
      const outsider = await createStaffMember({ role });
      const { response } = await channelWithResponse('private');
      await asPingApp(outsider.id, async (query) => {
        expect(await visibleIds(query, [response.id])).toEqual([]);
      });
    },
  );

  it('shows nothing to a Deactivated Staff member, even in their own Channels', async () => {
    const deactivated = await createStaffMember({ deactivated: true });
    const mine = await channelWithResponse('private', [deactivated.id]);
    const open = await channelWithResponse('public');
    await asPingApp(deactivated.id, async (query) => {
      expect(await visibleIds(query, [mine.response.id, open.response.id])).toEqual([]);
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    const { response } = await channelWithResponse('public');
    await asPingApp(null, async (query) => {
      expect(await visibleIds(query, [response.id])).toEqual([]);
    });
  });

  it('evaluates the membership helper once per statement, not once per row', async () => {
    const member = await createStaffMember();
    for (let i = 0; i < 5; i++) {
      await channelWithResponse(i % 2 === 0 ? 'public' : 'private', [member.id]);
    }
    await asPingApp(member.id, async (query) => {
      const result = await query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        'explain (analyze, verbose, format json) select id from thread_response',
      );
      const root = result.rows[0]?.['QUERY PLAN'][0]?.Plan;
      if (!root) throw new Error('no plan');
      expect(root['Actual Rows']).toBeGreaterThan(1);
      const mentionsHelper = (node: PlanNode) =>
        JSON.stringify({ ...node, Plans: undefined }).includes('current_staff_channel_ids');
      const initPlans = planNodes(root).filter((n) => n['Parent Relationship'] === 'InitPlan');
      const helperPlans = initPlans.filter((n) => planNodes(n).some(mentionsHelper));
      expect(helperPlans.length).toBeGreaterThan(0);
      for (const node of helperPlans.flatMap(planNodes)) {
        expect(node['Actual Loops']).toBe(1);
      }
      const outside = planNodes(root).filter(
        (n) => !initPlans.some((p) => planNodes(p).includes(n)),
      );
      expect(outside.some(mentionsHelper)).toBe(false);
    });
  });
});

describe('thread_response INSERT', () => {
  it('lets a member send one in their Private channel', async () => {
    const member = await createStaffMember();
    const { where } = await channelWithResponse('private', [member.id]);
    await asPingApp(member.id, async (query) => {
      expect((await sendAs(query, where, member.id)).rowCount).toBe(1);
    });
  });

  it('lets anyone insert into a Public channel: membership is the server’s check', async () => {
    const outsider = await createStaffMember();
    const { where } = await channelWithResponse('public');
    await asPingApp(outsider.id, async (query) => {
      expect((await sendAs(query, where, outsider.id)).rowCount).toBe(1);
    });
  });

  it.each([
    ['a Member', 'member'],
    ['a company Admin', 'admin'],
  ] as const)('refuses %s inserting into a Private channel they are not in', async (_n, role) => {
    const outsider = await createStaffMember({ role });
    const { where } = await channelWithResponse('private');
    await asPingApp(outsider.id, async (query) => {
      await expect(sendAs(query, where, outsider.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses one in someone else’s name', async () => {
    const member = await createStaffMember();
    const { where, author } = await channelWithResponse('public', [member.id]);
    await asPingApp(member.id, async (query) => {
      await expect(sendAs(query, where, author.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses one born deleted', async () => {
    const member = await createStaffMember();
    const { where } = await channelWithResponse('public', [member.id]);
    await asPingApp(member.id, async (query) => {
      await expect(
        query(
          `insert into thread_response (thread_id, channel_id, author_id, deleted_at, deleted_by)
           values ($1, $2, $3, now(), $3)`,
          [where.threadId, where.channelId, member.id],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a channel_id that doesn’t match its Thread’s', async () => {
    const member = await createStaffMember();
    const { where } = await channelWithResponse('public', [member.id]);
    const other = await insertChannel({ members: [{ staffId: member.id, channelAdmin: true }] });
    await asPingApp(member.id, async (query) => {
      await expect(
        sendAs(query, { threadId: where.threadId, channelId: other.id }, member.id),
      ).rejects.toThrow(/foreign key/);
    });
  });

  it('refuses everything when app.staff_id is unset', async () => {
    const someone = await createStaffMember();
    const { where } = await channelWithResponse('public');
    await asPingApp(null, async (query) => {
      await expect(sendAs(query, where, someone.id)).rejects.toThrow(/row-level security/);
    });
  });
});

describe('thread_response UPDATE', () => {
  it('lets a Staff member edit or delete the content of one they can see', async () => {
    const { author, response } = await channelWithResponse('public');
    await asPingApp(author.id, async (query) => {
      const result = await query(
        `update thread_response set body = null, body_text = null, deleted_at = now(), deleted_by = $2
          where id = $1`,
        [response.id, author.id],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it('refuses a deleted one that keeps its body', async () => {
    const { author, response } = await channelWithResponse('public');
    await asPingApp(author.id, async (query) => {
      await expect(
        query(`update thread_response set deleted_at = now(), deleted_by = $2 where id = $1`, [
          response.id,
          author.id,
        ]),
      ).rejects.toThrow(/thread_response_body_unless_deleted/);
    });
  });

  it.each([
    ['author_id', `author_id = gen_random_uuid()`],
    ['thread_id', `thread_id = gen_random_uuid()`],
    ['channel_id', `channel_id = gen_random_uuid()`],
    ['created_at', `created_at = now() - interval '1 day'`],
  ])('refuses changing %s: ping_app may only change the content', async (_col, set) => {
    const { author, response } = await channelWithResponse('public');
    await asPingApp(author.id, async (query) => {
      await expect(
        query(`update thread_response set ${set} where id = $1`, [response.id]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('updates nothing in a Private channel the Staff member is not in, Admins included', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { response } = await channelWithResponse('private');
    await asPingApp(admin.id, async (query) => {
      const result = await query(`update thread_response set body_text = 'x' where id = $1`, [
        response.id,
      ]);
      expect(result.rowCount).toBe(0);
    });
  });

  it('updates nothing when app.staff_id is unset', async () => {
    const { response } = await channelWithResponse('public');
    await asPingApp(null, async (query) => {
      const result = await query(`update thread_response set body_text = 'x' where id = $1`, [
        response.id,
      ]);
      expect(result.rowCount).toBe(0);
    });
  });
});

describe('thread_response DELETE', () => {
  it('refuses a delete, even from the author: a deleted one stays as its placeholder', async () => {
    const { author, response } = await channelWithResponse('public');
    await asPingApp(author.id, async (query) => {
      await expect(
        query('delete from thread_response where id = $1', [response.id]),
      ).rejects.toThrow(/permission denied/);
    });
    await asOwner(async (query) => {
      const left = await query('select id from thread_response where id = $1', [response.id]);
      expect(left.rowCount).toBe(1);
    });
  });
});
