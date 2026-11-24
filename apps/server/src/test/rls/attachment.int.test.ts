// RLS suite: attachment, as ping_app with raw SQL and no server code.
//
// Pending (no Channel): its uploader only, and ping_app inserts only its own pending rows.
// Attached: the visibility rule, with no Admin exception. The only update is attaching:
// the uploader moves their own pending row onto a post they may edit, in a Channel they can
// read. ping_app never deletes one (removal arrives with #51).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  asPingApp,
  createStaffMember,
  insertAttachment,
  insertChannel,
  insertThread,
  insertThreadResponse,
  type Query,
} from '../../db/test-support';

const visibleIds = async (query: Query, ids: string[]) =>
  (await query<{ id: string }>('select id from attachment where id = any($1)', [ids])).rows
    .map((r) => r.id)
    .sort();

type PlanNode = {
  'Parent Relationship'?: string;
  'Actual Loops': number;
  'Actual Rows': number;
  Plans?: PlanNode[];
};
const planNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(planNodes)];

/** A Channel with a Thread and a Thread Response by `author`, plus `memberIds`. */
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

/** Attachments by the author on the Thread and on the Thread Response. */
async function channelWithAttachments(visibility: 'public' | 'private', memberIds: string[] = []) {
  const posts = await channelWithPosts(visibility, memberIds);
  const onThread = await insertAttachment({
    uploaderId: posts.author.id,
    channelId: posts.channel.id,
    threadId: posts.thread.id,
  });
  const onResponse = await insertAttachment({
    uploaderId: posts.author.id,
    channelId: posts.channel.id,
    threadResponseId: posts.response.id,
  });
  return { ...posts, onThread: onThread.id, onResponse: onResponse.id };
}

const insertPending = (query: Query, uploaderId: string) =>
  query(
    `insert into attachment (uploader_id, object_key, original_filename, content_type, size_bytes)
     values ($1, $2, 'rota.pdf', 'application/pdf', 12) returning id`,
    [uploaderId, randomUUID()],
  );

const attachToThread = (
  query: Query,
  id: string,
  target: { channelId: string; threadId: string },
) =>
  query('update attachment set channel_id = $2, thread_id = $3 where id = $1', [
    id,
    target.channelId,
    target.threadId,
  ]);

describe('attachment SELECT', () => {
  it('shows a pending Attachment to its uploader only', async () => {
    const uploader = await createStaffMember();
    const other = await createStaffMember();
    const admin = await createStaffMember({ role: 'admin' });
    const pending = await insertAttachment({ uploaderId: uploader.id });
    await asPingApp(uploader.id, async (query) => {
      expect(await visibleIds(query, [pending.id])).toEqual([pending.id]);
    });
    for (const someoneElse of [other, admin]) {
      await asPingApp(someoneElse.id, async (query) => {
        expect(await visibleIds(query, [pending.id])).toEqual([]);
      });
    }
  });

  it('shows a Public channel’s Attachments to a Staff member who is not a member', async () => {
    const outsider = await createStaffMember();
    const { onThread, onResponse } = await channelWithAttachments('public');
    await asPingApp(outsider.id, async (query) => {
      expect(await visibleIds(query, [onThread, onResponse])).toEqual(
        [onThread, onResponse].sort(),
      );
    });
  });

  it('shows a Private channel’s Attachments to its members only, Admins included', async () => {
    const member = await createStaffMember();
    const outsider = await createStaffMember();
    const admin = await createStaffMember({ role: 'admin' });
    const { onThread, onResponse } = await channelWithAttachments('private', [member.id]);
    await asPingApp(member.id, async (query) => {
      expect(await visibleIds(query, [onThread, onResponse])).toEqual(
        [onThread, onResponse].sort(),
      );
    });
    for (const someone of [outsider, admin]) {
      await asPingApp(someone.id, async (query) => {
        expect(await visibleIds(query, [onThread, onResponse])).toEqual([]);
      });
    }
  });

  it('shows nothing to a Deactivated Staff member, even their own pending Attachment', async () => {
    const gone = await createStaffMember({ deactivated: true });
    const pending = await insertAttachment({ uploaderId: gone.id });
    const { onThread } = await channelWithAttachments('public');
    await asPingApp(gone.id, async (query) => {
      expect(await visibleIds(query, [pending.id, onThread])).toEqual([]);
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    const uploader = await createStaffMember();
    const pending = await insertAttachment({ uploaderId: uploader.id });
    const { onThread } = await channelWithAttachments('public');
    await asPingApp(null, async (query) => {
      expect(await visibleIds(query, [pending.id, onThread])).toEqual([]);
    });
  });

  it('evaluates the membership helper once per statement, not once per row', async () => {
    const member = await createStaffMember();
    for (let i = 0; i < 5; i++) {
      await channelWithAttachments(i % 2 === 0 ? 'public' : 'private', [member.id]);
    }
    await asPingApp(member.id, async (query) => {
      const result = await query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        'explain (analyze, verbose, format json) select id from attachment',
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

describe('attachment INSERT', () => {
  it('lets a Staff member add their own pending Attachment', async () => {
    const uploader = await createStaffMember();
    await asPingApp(uploader.id, async (query) => {
      expect((await insertPending(query, uploader.id)).rowCount).toBe(1);
    });
  });

  it('refuses a pending Attachment in someone else’s name', async () => {
    const uploader = await createStaffMember();
    const other = await createStaffMember();
    await asPingApp(uploader.id, async (query) => {
      await expect(insertPending(query, other.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses to insert straight onto a post, skipping the pending state', async () => {
    const { author, channel, thread } = await channelWithPosts('public');
    await asPingApp(author.id, async (query) => {
      await expect(
        query(
          `insert into attachment (channel_id, thread_id, uploader_id, object_key,
                                   original_filename, content_type, size_bytes)
           values ($1, $2, $3, $4, 'rota.pdf', 'application/pdf', 12)`,
          [channel.id, thread.id, author.id, randomUUID()],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a Deactivated Staff member', async () => {
    const gone = await createStaffMember({ deactivated: true });
    await asPingApp(gone.id, async (query) => {
      await expect(insertPending(query, gone.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses everything when app.staff_id is unset', async () => {
    const uploader = await createStaffMember();
    await asPingApp(null, async (query) => {
      await expect(insertPending(query, uploader.id)).rejects.toThrow(/row-level security/);
    });
  });
});

describe('attachment UPDATE (attaching)', () => {
  it('lets the uploader attach their pending Attachment to their own Thread', async () => {
    const { author, channel, thread } = await channelWithPosts('private');
    const pending = await insertAttachment({ uploaderId: author.id });
    await asPingApp(author.id, async (query) => {
      const result = await attachToThread(query, pending.id, {
        channelId: channel.id,
        threadId: thread.id,
      });
      expect(result.rowCount).toBe(1);
    });
  });

  it('lets the uploader attach to their own Thread Response', async () => {
    const { author, channel, response } = await channelWithPosts('public');
    const pending = await insertAttachment({ uploaderId: author.id });
    await asPingApp(author.id, async (query) => {
      const result = await query(
        'update attachment set channel_id = $2, thread_response_id = $3 where id = $1',
        [pending.id, channel.id, response.id],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it('lets a company Admin attach their own pending Attachment to someone else’s post', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { channel, thread } = await channelWithPosts('public');
    const pending = await insertAttachment({ uploaderId: admin.id });
    await asPingApp(admin.id, async (query) => {
      const result = await attachToThread(query, pending.id, {
        channelId: channel.id,
        threadId: thread.id,
      });
      expect(result.rowCount).toBe(1);
    });
  });

  it('changes nothing when attaching someone else’s pending Attachment', async () => {
    const { author, channel, thread } = await channelWithPosts('public');
    const other = await createStaffMember();
    const theirs = await insertAttachment({ uploaderId: other.id });
    await asPingApp(author.id, async (query) => {
      const result = await attachToThread(query, theirs.id, {
        channelId: channel.id,
        threadId: thread.id,
      });
      expect(result.rowCount).toBe(0);
    });
  });

  it('refuses attaching to a post the uploader may not edit', async () => {
    const member = await createStaffMember();
    const { channel, thread } = await channelWithPosts('public', [member.id]);
    const pending = await insertAttachment({ uploaderId: member.id });
    await asPingApp(member.id, async (query) => {
      await expect(
        attachToThread(query, pending.id, { channelId: channel.id, threadId: thread.id }),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses attaching into a Private channel the uploader isn’t in, Admins included', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { channel, thread } = await channelWithPosts('private');
    const pending = await insertAttachment({ uploaderId: admin.id });
    await asPingApp(admin.id, async (query) => {
      await expect(
        attachToThread(query, pending.id, { channelId: channel.id, threadId: thread.id }),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('changes nothing on an attached Attachment: moving it or rewriting its file', async () => {
    const { author, onThread } = await channelWithAttachments('public');
    const elsewhere = await channelWithPosts('public');
    await asPingApp(author.id, async (query) => {
      const moved = await query('update attachment set thread_id = $2 where id = $1', [
        onThread,
        elsewhere.thread.id,
      ]);
      expect(moved.rowCount).toBe(0);
      await expect(
        query('update attachment set object_key = $2 where id = $1', [onThread, randomUUID()]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('changes nothing when app.staff_id is unset', async () => {
    const { author, channel, thread } = await channelWithPosts('public');
    const pending = await insertAttachment({ uploaderId: author.id });
    await asPingApp(null, async (query) => {
      const result = await attachToThread(query, pending.id, {
        channelId: channel.id,
        threadId: thread.id,
      });
      expect(result.rowCount).toBe(0);
    });
  });
});

describe('attachment DELETE', () => {
  it('is not granted to ping_app, even for the uploader’s own pending Attachment', async () => {
    const uploader = await createStaffMember();
    const pending = await insertAttachment({ uploaderId: uploader.id });
    await asPingApp(uploader.id, async (query) => {
      await expect(query('delete from attachment where id = $1', [pending.id])).rejects.toThrow(
        /permission denied/,
      );
    });
    await asPingApp(null, async (query) => {
      await expect(query('delete from attachment where id = $1', [pending.id])).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
