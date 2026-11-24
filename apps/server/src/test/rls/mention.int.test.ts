// RLS suite: mention, and fan_out_pings for Mentions, as ping_app with raw SQL and no
// server code.
//
// The visibility rule, FOR ALL, with no Admin exception, the same as thread's. A Mention is
// written and removed only on a post the actor may edit (their own, or any as a company
// Admin), and only someone who can read the Thread can be Mentioned. ping_app never updates
// one. The fan-out Pings the Mention rows created in its own transaction: a new post's, or
// those an edit added.
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createInvitedStaffMember,
  createStaffMember,
  insertChannel,
  insertMention,
  insertThread,
  insertThreadResponse,
  type Query,
} from '../../db/test-support';

const emptyDoc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

const visibleIds = async (query: Query, ids: string[]) =>
  (await query<{ id: string }>('select id from mention where id = any($1)', [ids])).rows
    .map((r) => r.id)
    .sort();

type PlanNode = {
  'Parent Relationship'?: string;
  'Actual Loops': number;
  'Actual Rows': number;
  Plans?: PlanNode[];
};
const planNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(planNodes)];

/** A Channel of the given kind with a Thread and a Thread Response by `author`. */
async function channelWithPosts(visibility: 'public' | 'private', memberIds: string[] = []) {
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
  return { author, channel, thread, response };
}

/** A Channel whose Thread and Thread Response each Mention `mentionedId`. */
async function channelWithMentions(visibility: 'public' | 'private', memberIds: string[] = []) {
  const posts = await channelWithPosts(visibility, memberIds);
  const onThread = await insertMention({
    channelId: posts.channel.id,
    threadId: posts.thread.id,
    staffId: posts.author.id,
  });
  const onResponse = await insertMention({
    channelId: posts.channel.id,
    threadResponseId: posts.response.id,
    staffId: posts.author.id,
  });
  return { ...posts, onThread, onResponse };
}

const mentionInThread = (
  query: Query,
  ids: { channelId: string; threadId: string },
  staffId: string,
) =>
  query(`insert into mention (channel_id, thread_id, staff_id) values ($1, $2, $3)`, [
    ids.channelId,
    ids.threadId,
    staffId,
  ]);

/** Switches the case's transaction to another Staff member. */
const actAs = (query: Query, staffId: string | null) =>
  query(`select set_config('app.staff_id', $1, true)`, [staffId ?? '']);

/** A Staff member's open Ping count on a Thread, read as them; 0 with none. */
async function pingCountOf(query: Query, staffId: string, threadId: string): Promise<number> {
  const me = await query<{ id: string }>(`select current_setting('app.staff_id') as id`);
  await actAs(query, staffId);
  const result = await query<{ count: number }>(
    'select count from ping where staff_id = $1 and thread_id = $2',
    [staffId, threadId],
  );
  await actAs(query, me.rows[0]?.id ?? null);
  return result.rows[0]?.count ?? 0;
}

const fanOut = async (query: Query, threadId: string, responseId: string | null = null) =>
  (
    await query<{ pinged: number }>('select public.fan_out_pings($1, $2) as pinged', [
      threadId,
      responseId,
    ])
  ).rows[0]?.pinged;

describe('mention SELECT', () => {
  it('shows a Public channel’s Mentions to a Staff member who is not a member', async () => {
    const outsider = await createStaffMember();
    const { onThread, onResponse } = await channelWithMentions('public');
    await asPingApp(outsider.id, async (query) => {
      expect(await visibleIds(query, [onThread, onResponse])).toEqual(
        [onThread, onResponse].sort(),
      );
    });
  });

  it('shows a Private channel’s Mentions to its members', async () => {
    const member = await createStaffMember();
    const { onThread } = await channelWithMentions('private', [member.id]);
    await asPingApp(member.id, async (query) => {
      expect(await visibleIds(query, [onThread])).toEqual([onThread]);
    });
  });

  it.each([
    ['a Member', 'member'],
    ['a company Admin: there is no Admin exception', 'admin'],
  ] as const)(
    'hides a Private channel’s Mentions from %s who is not a member',
    async (_n, role) => {
      const outsider = await createStaffMember({ role });
      const { onThread, onResponse } = await channelWithMentions('private');
      await asPingApp(outsider.id, async (query) => {
        expect(await visibleIds(query, [onThread, onResponse])).toEqual([]);
      });
    },
  );

  it('shows nothing to a Deactivated Staff member, even in their own Channels', async () => {
    const deactivated = await createStaffMember({ deactivated: true });
    const { onThread } = await channelWithMentions('private', [deactivated.id]);
    await asPingApp(deactivated.id, async (query) => {
      expect(await visibleIds(query, [onThread])).toEqual([]);
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    const { onThread } = await channelWithMentions('public');
    await asPingApp(null, async (query) => {
      expect(await visibleIds(query, [onThread])).toEqual([]);
    });
  });

  it('evaluates the membership helper once per statement, not once per row', async () => {
    const member = await createStaffMember();
    for (let i = 0; i < 5; i++) {
      await channelWithMentions(i % 2 === 0 ? 'public' : 'private', [member.id]);
    }
    await asPingApp(member.id, async (query) => {
      const result = await query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        'explain (analyze, verbose, format json) select id from mention',
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

describe('mention INSERT', () => {
  it('lets an author Mention a non-member of a Public channel, without them joining', async () => {
    const outsider = await createStaffMember();
    const { author, channel, thread } = await channelWithPosts('public');
    await asPingApp(author.id, async (query) => {
      const result = await mentionInThread(
        query,
        { channelId: channel.id, threadId: thread.id },
        outsider.id,
      );
      expect(result.rowCount).toBe(1);
    });
    const joined = await asOwner((query) =>
      query('select 1 from channel_member where channel_id = $1 and staff_id = $2', [
        channel.id,
        outsider.id,
      ]),
    );
    expect(joined.rowCount).toBe(0);
  });

  it('lets an author Mention a member in a Thread Response of a Private channel', async () => {
    const member = await createStaffMember();
    const { author, channel, response } = await channelWithPosts('private', [member.id]);
    await asPingApp(author.id, async (query) => {
      const result = await query(
        'insert into mention (channel_id, thread_response_id, staff_id) values ($1, $2, $3)',
        [channel.id, response.id, member.id],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it('lets a company Admin Mention someone in another person’s post', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const member = await createStaffMember();
    const { channel, thread } = await channelWithPosts('public', [member.id]);
    await asPingApp(admin.id, async (query) => {
      const result = await mentionInThread(
        query,
        { channelId: channel.id, threadId: thread.id },
        member.id,
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it('refuses a Mention of a non-member of a Private channel', async () => {
    const outsider = await createStaffMember();
    const { author, channel, thread } = await channelWithPosts('private');
    await asPingApp(author.id, async (query) => {
      await expect(
        mentionInThread(query, { channelId: channel.id, threadId: thread.id }, outsider.id),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it.each([
    ['an Invited Staff member', () => createInvitedStaffMember()],
    ['a Deactivated Staff member', () => createStaffMember({ deactivated: true })],
  ])('refuses a Mention of %s, even in a Public channel', async (_n, create) => {
    const target = await create();
    const { author, channel, thread } = await channelWithPosts('public');
    await asPingApp(author.id, async (query) => {
      await expect(
        mentionInThread(query, { channelId: channel.id, threadId: thread.id }, target.id),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a Mention in a post the actor may not edit', async () => {
    const member = await createStaffMember();
    const { channel, thread } = await channelWithPosts('public', [member.id]);
    await asPingApp(member.id, async (query) => {
      await expect(
        mentionInThread(query, { channelId: channel.id, threadId: thread.id }, member.id),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses everything when app.staff_id is unset', async () => {
    const member = await createStaffMember();
    const { channel, thread } = await channelWithPosts('public', [member.id]);
    await asPingApp(null, async (query) => {
      await expect(
        mentionInThread(query, { channelId: channel.id, threadId: thread.id }, member.id),
      ).rejects.toThrow(/row-level security/);
    });
  });
});

describe('mention UPDATE', () => {
  it('refuses to update a Mention, even on your own post', async () => {
    const { author, onThread } = await channelWithMentions('public');
    const other = await createStaffMember();
    await asPingApp(author.id, async (query) => {
      await expect(
        query('update mention set staff_id = $1 where id = $2', [other.id, onThread]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe('mention DELETE', () => {
  it('lets an author remove the Mentions on their own posts', async () => {
    const { author, onThread, onResponse } = await channelWithMentions('public');
    await asPingApp(author.id, async (query) => {
      const result = await query('delete from mention where id = any($1)', [
        [onThread, onResponse],
      ]);
      expect(result.rowCount).toBe(2);
    });
  });

  it('lets a company Admin remove the Mentions on someone else’s post', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { onThread } = await channelWithMentions('public');
    await asPingApp(admin.id, async (query) => {
      const result = await query('delete from mention where id = $1', [onThread]);
      expect(result.rowCount).toBe(1);
    });
  });

  it('removes nothing on someone else’s post for a Member', async () => {
    const member = await createStaffMember();
    const { onThread, onResponse } = await channelWithMentions('public', [member.id]);
    await asPingApp(member.id, async (query) => {
      const result = await query('delete from mention where id = any($1)', [
        [onThread, onResponse],
      ]);
      expect(result.rowCount).toBe(0);
    });
  });

  it('removes nothing when app.staff_id is unset', async () => {
    const { onThread } = await channelWithMentions('public');
    await asPingApp(null, async (query) => {
      const result = await query('delete from mention where id = $1', [onThread]);
      expect(result.rowCount).toBe(0);
    });
  });
});

describe('fan_out_pings and Mentions', () => {
  /** Starts a Thread as the acting Staff member and Mentions `mentionedIds` in it. */
  const startThreadMentioning = async (query: Query, channelId: string, mentionedIds: string[]) => {
    const result = await query<{ id: string }>(
      `insert into thread (channel_id, author_id, title, body, body_text)
       values ($1, current_setting('app.staff_id')::uuid, 'Hello', $2, 'hi') returning id`,
      [channelId, emptyDoc],
    );
    const threadId = result.rows[0]?.id;
    if (!threadId) throw new Error('no thread');
    for (const staffId of mentionedIds)
      await mentionInThread(query, { channelId, threadId }, staffId);
    return threadId;
  };

  /** Edits a Thread as the acting Staff member, now. */
  const editThread = (query: Query, threadId: string) =>
    query(
      `update thread set body_text = 'edited', edited_at = now(),
         edited_by = current_setting('app.staff_id')::uuid where id = $1`,
      [threadId],
    );

  it('Pings a Mentioned non-member of a Public channel, and a Mentioned member only once', async () => {
    const author = await createStaffMember();
    const member = await createStaffMember();
    const outsider = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: author.id, channelAdmin: true }, { staffId: member.id }],
    });
    await asPingApp(author.id, async (query) => {
      const threadId = await startThreadMentioning(query, channel.id, [member.id, outsider.id]);
      expect(await fanOut(query, threadId)).toBe(2);
      expect(await pingCountOf(query, member.id, threadId)).toBe(1);
      expect(await pingCountOf(query, outsider.id, threadId)).toBe(1);
    });
  });

  it('Pings a Mentioned person in a new Thread Response', async () => {
    const outsider = await createStaffMember();
    const { author, channel, thread } = await channelWithPosts('public');
    await asPingApp(author.id, async (query) => {
      const sent = await query<{ id: string }>(
        `insert into thread_response (thread_id, channel_id, author_id, body, body_text)
         values ($1, $2, current_setting('app.staff_id')::uuid, $3, 'hi') returning id`,
        [thread.id, channel.id, emptyDoc],
      );
      const responseId = sent.rows[0]?.id ?? '';
      await query(
        'insert into mention (channel_id, thread_response_id, staff_id) values ($1, $2, $3)',
        [channel.id, responseId, outsider.id],
      );
      expect(await fanOut(query, thread.id, responseId)).toBe(1);
      expect(await pingCountOf(query, outsider.id, thread.id)).toBe(1);
    });
  });

  it('Pings only the newly Mentioned after an edit, not members or earlier Mentions', async () => {
    const member = await createStaffMember();
    const earlier = await createStaffMember();
    const added = await createStaffMember();
    const { author, channel, thread } = await channelWithPosts('public', [member.id]);
    await insertMention({ channelId: channel.id, threadId: thread.id, staffId: earlier.id });
    await asPingApp(author.id, async (query) => {
      await editThread(query, thread.id);
      await mentionInThread(query, { channelId: channel.id, threadId: thread.id }, added.id);
      expect(await fanOut(query, thread.id)).toBe(1);
      expect(await pingCountOf(query, added.id, thread.id)).toBe(1);
      expect(await pingCountOf(query, earlier.id, thread.id)).toBe(0);
      expect(await pingCountOf(query, member.id, thread.id)).toBe(0);
    });
  });

  it('Pings the newly Mentioned after a company Admin’s edit where they aren’t a member', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const added = await createStaffMember();
    const { channel, thread } = await channelWithPosts('public');
    await asPingApp(admin.id, async (query) => {
      await editThread(query, thread.id);
      await mentionInThread(query, { channelId: channel.id, threadId: thread.id }, added.id);
      expect(await fanOut(query, thread.id)).toBe(1);
    });
  });

  it('never Pings the person who acted, even when they Mention themself', async () => {
    const { author, channel } = await channelWithPosts('public');
    await asPingApp(author.id, async (query) => {
      const threadId = await startThreadMentioning(query, channel.id, [author.id]);
      expect(await fanOut(query, threadId)).toBe(0);
    });
  });

  it('skips a Mentioned person who can no longer read a Private channel', async () => {
    const former = await createStaffMember();
    const { author, channel, thread } = await channelWithPosts('private', [former.id]);
    await asPingApp(author.id, async (query) => {
      await editThread(query, thread.id);
      await mentionInThread(query, { channelId: channel.id, threadId: thread.id }, former.id);
      // The author, as Channel admin, removes them in the same transaction.
      await query('delete from channel_member where channel_id = $1 and staff_id = $2', [
        channel.id,
        former.id,
      ]);
      expect(await fanOut(query, thread.id)).toBe(0);
    });
  });

  it('can’t be steered at a post the actor didn’t write or edit in this transaction', async () => {
    const member = await createStaffMember();
    const { channel, thread } = await channelWithPosts('public', [member.id]);
    const admin = await createStaffMember({ role: 'admin' });
    const target = await createStaffMember();
    await asPingApp(admin.id, async (query) => {
      // A Mention row written, but no edit made: the fan-out ignores it.
      await mentionInThread(query, { channelId: channel.id, threadId: thread.id }, target.id);
      expect(await fanOut(query, thread.id)).toBe(0);
    });
  });

  it('does nothing when app.staff_id is unset', async () => {
    const { thread } = await channelWithPosts('public');
    await asPingApp(null, async (query) => {
      expect(await fanOut(query, thread.id)).toBe(0);
    });
  });
});
