// RLS suite: reaction, as ping_app with raw SQL and no server code.
//
// The visibility rule, FOR ALL, with no Admin exception, the same as thread's. Inserts
// must be the acting Staff member's own and in a Channel they belong to (even a Public
// one). ping_app deletes only its own reactions, apart from those of a deleted Thread
// Response. It never updates one. Whether a Channel is archived is the permissions
// module's job.
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createStaffMember,
  insertChannel,
  insertReaction,
  insertThread,
  insertThreadResponse,
  type Query,
} from '../../db/test-support';

const visibleIds = async (query: Query, ids: string[]) =>
  (await query<{ id: string }>('select id from reaction where id = any($1)', [ids])).rows
    .map((r) => r.id)
    .sort();

type PlanNode = {
  'Parent Relationship'?: string;
  'Actual Loops': number;
  'Actual Rows': number;
  Plans?: PlanNode[];
};
const planNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(planNodes)];

/**
 * A Channel of the given kind with a Thread and a Thread Response by its Channel admin,
 * and one reaction on each by `reactor` (a member, or the Channel admin by default).
 */
async function channelWithReactions(visibility: 'public' | 'private', memberIds: string[] = []) {
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
  const onThread = await insertReaction({
    channelId: channel.id,
    threadId: thread.id,
    staffId: author.id,
  });
  const onResponse = await insertReaction({
    channelId: channel.id,
    threadResponseId: response.id,
    staffId: author.id,
  });
  return { author, channel, thread, response, onThread, onResponse };
}

const reactToThread = (
  query: Query,
  ids: { channelId: string; threadId: string },
  staffId: string,
) =>
  query(`insert into reaction (channel_id, thread_id, staff_id, emoji) values ($1, $2, $3, '🎉')`, [
    ids.channelId,
    ids.threadId,
    staffId,
  ]);

describe('reaction SELECT', () => {
  it('shows a Public channel’s reactions to a Staff member who is not a member', async () => {
    const outsider = await createStaffMember();
    const { onThread, onResponse } = await channelWithReactions('public');
    await asPingApp(outsider.id, async (query) => {
      expect(await visibleIds(query, [onThread, onResponse])).toEqual(
        [onThread, onResponse].sort(),
      );
    });
  });

  it('shows a Private channel’s reactions to its members', async () => {
    const member = await createStaffMember();
    const { onThread } = await channelWithReactions('private', [member.id]);
    await asPingApp(member.id, async (query) => {
      expect(await visibleIds(query, [onThread])).toEqual([onThread]);
    });
  });

  it.each([
    ['a Member', 'member'],
    ['a company Admin: there is no Admin exception', 'admin'],
  ] as const)(
    'hides a Private channel’s reactions from %s who is not a member',
    async (_n, role) => {
      const outsider = await createStaffMember({ role });
      const { onThread, onResponse } = await channelWithReactions('private');
      await asPingApp(outsider.id, async (query) => {
        expect(await visibleIds(query, [onThread, onResponse])).toEqual([]);
      });
    },
  );

  it('shows nothing to a Deactivated Staff member, even in their own Channels', async () => {
    const deactivated = await createStaffMember({ deactivated: true });
    const mine = await channelWithReactions('private', [deactivated.id]);
    await asPingApp(deactivated.id, async (query) => {
      expect(await visibleIds(query, [mine.onThread])).toEqual([]);
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    const { onThread } = await channelWithReactions('public');
    await asPingApp(null, async (query) => {
      expect(await visibleIds(query, [onThread])).toEqual([]);
    });
  });

  it('evaluates the membership helper once per statement, not once per row', async () => {
    const member = await createStaffMember();
    for (let i = 0; i < 5; i++) {
      await channelWithReactions(i % 2 === 0 ? 'public' : 'private', [member.id]);
    }
    await asPingApp(member.id, async (query) => {
      const result = await query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        'explain (analyze, verbose, format json) select id from reaction',
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

describe('reaction INSERT', () => {
  it('lets a member react to a Thread in their Private channel', async () => {
    const member = await createStaffMember();
    const { channel, thread } = await channelWithReactions('private', [member.id]);
    await asPingApp(member.id, async (query) => {
      const ids = { channelId: channel.id, threadId: thread.id };
      expect((await reactToThread(query, ids, member.id)).rowCount).toBe(1);
    });
  });

  it('lets a member react to a Thread Response', async () => {
    const member = await createStaffMember();
    const { channel, response } = await channelWithReactions('public', [member.id]);
    await asPingApp(member.id, async (query) => {
      const result = await query(
        `insert into reaction (channel_id, thread_response_id, staff_id, emoji)
         values ($1, $2, $3, '🎉')`,
        [channel.id, response.id, member.id],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it.each([
    ['a Member', 'member'],
    ['a company Admin', 'admin'],
  ] as const)(
    'refuses %s who is not a member, even in a Public channel: reacting takes membership',
    async (_n, role) => {
      const outsider = await createStaffMember({ role });
      const { channel, thread } = await channelWithReactions('public');
      await asPingApp(outsider.id, async (query) => {
        const ids = { channelId: channel.id, threadId: thread.id };
        await expect(reactToThread(query, ids, outsider.id)).rejects.toThrow(/row-level security/);
      });
    },
  );

  it('refuses a reaction in someone else’s name', async () => {
    const member = await createStaffMember();
    const { channel, thread, author } = await channelWithReactions('public', [member.id]);
    await asPingApp(member.id, async (query) => {
      const ids = { channelId: channel.id, threadId: thread.id };
      await expect(reactToThread(query, ids, author.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses everything when app.staff_id is unset', async () => {
    const someone = await createStaffMember();
    const { channel, thread } = await channelWithReactions('public');
    await asPingApp(null, async (query) => {
      const ids = { channelId: channel.id, threadId: thread.id };
      await expect(reactToThread(query, ids, someone.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a second reaction with the same emoji by the same Staff member', async () => {
    const { author, channel, thread } = await channelWithReactions('public');
    await asPingApp(author.id, async (query) => {
      const ids = { channelId: channel.id, threadId: thread.id };
      expect((await reactToThread(query, ids, author.id)).rowCount).toBe(1);
      await expect(reactToThread(query, ids, author.id)).rejects.toThrow(
        /reaction_thread_staff_emoji_unique/,
      );
    });
  });

  it('lets two Staff members react with the same emoji', async () => {
    const other = await createStaffMember();
    const { channel, thread } = await channelWithReactions('public', [other.id]);
    await asPingApp(other.id, async (query) => {
      const ids = { channelId: channel.id, threadId: thread.id };
      expect((await reactToThread(query, ids, other.id)).rowCount).toBe(1);
    });
  });

  it('refuses a reaction with no target, or with two', async () => {
    const { author, channel, thread, response } = await channelWithReactions('public');
    await asPingApp(author.id, async (query) => {
      await expect(
        query(`insert into reaction (channel_id, staff_id, emoji) values ($1, $2, '🎉')`, [
          channel.id,
          author.id,
        ]),
      ).rejects.toThrow(/reaction_exactly_one_target/);
    });
    await asPingApp(author.id, async (query) => {
      await expect(
        query(
          `insert into reaction (channel_id, thread_id, thread_response_id, staff_id, emoji)
           values ($1, $2, $3, $4, '🎉')`,
          [channel.id, thread.id, response.id, author.id],
        ),
      ).rejects.toThrow(/reaction_exactly_one_target/);
    });
  });

  it('refuses a channel_id that doesn’t match its target’s', async () => {
    const member = await createStaffMember();
    const { thread } = await channelWithReactions('public', [member.id]);
    const other = await insertChannel({ members: [{ staffId: member.id, channelAdmin: true }] });
    await asPingApp(member.id, async (query) => {
      const ids = { channelId: other.id, threadId: thread.id };
      await expect(reactToThread(query, ids, member.id)).rejects.toThrow(/foreign key/);
    });
  });
});

describe('reaction UPDATE', () => {
  it('is never granted: ping_app cannot change a reaction', async () => {
    const { author, onThread } = await channelWithReactions('public');
    await asPingApp(author.id, async (query) => {
      await expect(
        query(`update reaction set emoji = '🎉' where id = $1`, [onThread]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe('reaction DELETE', () => {
  it('lets a Staff member take back their own reaction', async () => {
    const { author, onThread } = await channelWithReactions('public');
    await asPingApp(author.id, async (query) => {
      const result = await query('delete from reaction where id = $1', [onThread]);
      expect(result.rowCount).toBe(1);
    });
  });

  it('deletes nothing of someone else’s, company Admins included', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const member = await createStaffMember();
    const { onThread } = await channelWithReactions('public', [member.id, admin.id]);
    for (const staff of [member, admin]) {
      await asPingApp(staff.id, async (query) => {
        const result = await query('delete from reaction where id = $1', [onThread]);
        expect(result.rowCount).toBe(0);
      });
    }
    const { rows } = await asOwner((query) =>
      query('select id from reaction where id = $1', [onThread]),
    );
    expect(rows).toHaveLength(1);
  });

  it('lets a Staff member delete the reactions of a deleted Thread Response, and only then', async () => {
    const member = await createStaffMember();
    const { author, onResponse, response } = await channelWithReactions('public', [member.id]);
    await asPingApp(member.id, async (query) => {
      expect((await query('delete from reaction where id = $1', [onResponse])).rowCount).toBe(0);
    });
    await asPingApp(author.id, async (query) => {
      await query(
        `update thread_response set body = null, body_text = null, deleted_at = now(), deleted_by = $2
          where id = $1`,
        [response.id, author.id],
      );
      expect((await query('delete from reaction where id = $1', [onResponse])).rowCount).toBe(1);
    });
  });

  it('deletes nothing in a Private channel the Staff member is not in', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { onThread } = await channelWithReactions('private');
    await asPingApp(admin.id, async (query) => {
      expect((await query('delete from reaction where id = $1', [onThread])).rowCount).toBe(0);
    });
  });

  it('deletes nothing when app.staff_id is unset', async () => {
    const { onThread } = await channelWithReactions('public');
    await asPingApp(null, async (query) => {
      expect((await query('delete from reaction where id = $1', [onThread])).rowCount).toBe(0);
    });
  });
});

describe('reaction cascades', () => {
  it('goes with its Thread, and with its Thread’s Thread Responses', async () => {
    const { thread, onThread, onResponse } = await channelWithReactions('public');
    await asOwner((query) => query('delete from thread where id = $1', [thread.id]));
    const { rows } = await asOwner((query) =>
      query('select id from reaction where id = any($1)', [[onThread, onResponse]]),
    );
    expect(rows).toEqual([]);
  });
});
