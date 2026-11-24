// RLS suite: channel and channel_member, as ping_app with raw SQL and no server code.
//
// channel: ping_app may only read, through the visibility rule (Public, or a member; no
// Admin exception). create_channel is the only way to create one. Never deleted.
// channel_member: reads follow the visibility rule; writes have their own rules
// (ADR 0005). Company Admins get no exception anywhere.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createStaffMember,
  insertChannel,
  type Query,
} from '../../db/test-support';

const visibleChannelIds = async (query: Query, ids: string[]) =>
  (await query<{ id: string }>('select id from channel where id = any($1)', [ids])).rows
    .map((r) => r.id)
    .sort();

const memberIds = async (query: Query, channelId: string) =>
  (
    await query<{ staff_id: string }>(
      'select staff_id from channel_member where channel_id = $1 order by staff_id',
      [channelId],
    )
  ).rows.map((r) => r.staff_id);

type PlanNode = {
  'Parent Relationship'?: string;
  'Actual Loops': number;
  'Actual Rows': number;
  Plans?: PlanNode[];
};
const planNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(planNodes)];

describe('channel SELECT', () => {
  it('shows a Public channel to a Staff member who is not a member', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(member.id, async (query) => {
      expect(await visibleChannelIds(query, [channel.id])).toEqual([channel.id]);
    });
  });

  it('shows a Private channel to its members', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id }],
    });
    await asPingApp(member.id, async (query) => {
      expect(await visibleChannelIds(query, [channel.id])).toEqual([channel.id]);
    });
  });

  it('hides a Private channel from a Member who is not a member', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ visibility: 'private' });
    await asPingApp(member.id, async (query) => {
      expect(await visibleChannelIds(query, [channel.id])).toEqual([]);
    });
  });

  it('hides a Private channel from a company Admin who is not a member', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const channel = await insertChannel({ visibility: 'private' });
    await asPingApp(admin.id, async (query) => {
      expect(await visibleChannelIds(query, [channel.id])).toEqual([]);
    });
  });

  it('shows nothing to a Deactivated Staff member, even in their own Channels', async () => {
    const deactivated = await createStaffMember({ deactivated: true });
    const mine = await insertChannel({
      visibility: 'private',
      members: [{ staffId: deactivated.id }],
    });
    const open = await insertChannel({ visibility: 'public' });
    await asPingApp(deactivated.id, async (query) => {
      expect(await visibleChannelIds(query, [mine.id, open.id])).toEqual([]);
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(null, async (query) => {
      expect(await visibleChannelIds(query, [channel.id])).toEqual([]);
    });
  });

  it('evaluates the membership helper once per statement, not once per row', async () => {
    const member = await createStaffMember();
    for (let i = 0; i < 5; i++) {
      await insertChannel({
        visibility: i % 2 === 0 ? 'public' : 'private',
        members: [{ staffId: member.id }],
      });
    }
    await asPingApp(member.id, async (query) => {
      const result = await query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        'explain (analyze, verbose, format json) select id from channel',
      );
      const root = result.rows[0]?.['QUERY PLAN'][0]?.Plan;
      if (!root) throw new Error('no plan');
      expect(root['Actual Rows']).toBeGreaterThan(1);
      const mentionsHelper = (node: PlanNode) =>
        JSON.stringify({ ...node, Plans: undefined }).includes('current_staff_channel_ids');
      // The helper runs inside an InitPlan, once…
      const initPlans = planNodes(root).filter((n) => n['Parent Relationship'] === 'InitPlan');
      const helperPlans = initPlans.filter((n) => planNodes(n).some(mentionsHelper));
      expect(helperPlans.length).toBe(1);
      for (const node of planNodes(helperPlans[0] as PlanNode)) {
        expect(node['Actual Loops']).toBe(1);
      }
      // …and never in the per-row filter of the scan over channel.
      const outside = planNodes(root).filter(
        (n) => !initPlans.some((p) => planNodes(p).includes(n)),
      );
      expect(outside.some(mentionsHelper)).toBe(false);
      expect(JSON.stringify(root)).not.toContain('is_channel_member');
    });
  });
});

describe('channel INSERT, UPDATE and DELETE', () => {
  it('refuses a direct insert of a Public channel: create_channel is the only way', async () => {
    const member = await createStaffMember();
    await asPingApp(member.id, async (query) => {
      await expect(
        query(
          `insert into channel (name, description, visibility, created_by)
           values ('Open', '', 'public', $1)`,
          [member.id],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('refuses a direct insert of a Private channel', async () => {
    const member = await createStaffMember();
    await asPingApp(member.id, async (query) => {
      await expect(
        query(
          `insert into channel (name, description, visibility, created_by)
           values ('Secret', '', 'private', $1)`,
          [member.id],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('refuses an update, even from the Channel admin', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    await asPingApp(member.id, async (query) => {
      await expect(
        query(`update channel set visibility = 'public' where id = $1`, [channel.id]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('refuses a delete: Channels are never deleted', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: admin.id, channelAdmin: true }],
    });
    await asPingApp(admin.id, async (query) => {
      await expect(query('delete from channel where id = $1', [channel.id])).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});

// Channel settings (#42): ping_app may update a Channel's name, description and "Who can
// resolve threads?", as its Channel admin. Never its visibility: turning a Channel Private
// goes through make_channel_private, and nothing makes one Public.
describe('channel UPDATE', () => {
  const rename = (query: Query, channelId: string) =>
    query(
      `update channel set name = 'Renamed', description = 'New', resolve_policy = 'author_and_channel_admins'
            where id = $1`,
      [channelId],
    );

  it('lets a Channel admin change the name, description and resolve setting', async () => {
    const channelAdmin = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asPingApp(channelAdmin.id, async (query) => {
      expect((await rename(query, channel.id)).rowCount).toBe(1);
      const row = await query(
        'select name, description, resolve_policy from channel where id = $1',
        [channel.id],
      );
      expect(row.rows).toEqual([
        { name: 'Renamed', description: 'New', resolve_policy: 'author_and_channel_admins' },
      ]);
    });
  });

  it.each([
    ['a plain member', 'member'],
    ['a non-member', 'none'],
    ['a company Admin who isn’t Channel admin', 'admin'],
  ] as const)('changes nothing for %s', async (_name, who) => {
    const channelAdmin = await createStaffMember();
    const actor = await createStaffMember({ role: who === 'admin' ? 'admin' : 'member' });
    const channel = await insertChannel({
      members: [
        { staffId: channelAdmin.id, channelAdmin: true },
        ...(who === 'member' ? [{ staffId: actor.id }] : []),
      ],
    });
    await asPingApp(actor.id, async (query) => {
      expect((await rename(query, channel.id)).rowCount).toBe(0);
    });
  });

  it('changes nothing for a Deactivated Channel admin', async () => {
    const channelAdmin = await createStaffMember();
    const admin = await createStaffMember({ role: 'admin' });
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asOwner((query) =>
      query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
        channelAdmin.id,
        admin.id,
      ]),
    );
    await asPingApp(channelAdmin.id, async (query) => {
      expect((await rename(query, channel.id)).rowCount).toBe(0);
    });
  });

  it('fails closed with no app.staff_id', async () => {
    const channel = await insertChannel();
    await asPingApp(null, async (query) => {
      expect((await rename(query, channel.id)).rowCount).toBe(0);
    });
  });

  it.each([
    ['visibility', `visibility = 'private'`],
    ['created_by', 'created_by = created_by'],
    ['archived_at', 'archived_at = now()'],
  ])('refuses %s, even from the Channel admin', async (_column, set) => {
    const channelAdmin = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asPingApp(channelAdmin.id, async (query) => {
      await expect(query(`update channel set ${set} where id = $1`, [channel.id])).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});

describe('channel_member SELECT', () => {
  it('shows the members of a Public channel to a non-member, with no recursion error', async () => {
    const member = await createStaffMember();
    const outsider = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    await asPingApp(outsider.id, async (query) => {
      expect(await memberIds(query, channel.id)).toEqual([member.id]);
    });
  });

  it('shows the members of a Private channel to its members', async () => {
    const member = await createStaffMember();
    const other = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id, channelAdmin: true }, { staffId: other.id }],
    });
    await asPingApp(member.id, async (query) => {
      expect(await memberIds(query, channel.id)).toHaveLength(2);
    });
  });

  it('hides the members of a Private channel from a non-member company Admin', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    await asPingApp(admin.id, async (query) => {
      expect(await memberIds(query, channel.id)).toEqual([]);
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    await asPingApp(null, async (query) => {
      expect(await memberIds(query, channel.id)).toEqual([]);
    });
  });
});

const join = (query: Query, channelId: string, staffId: string, admin = false) =>
  query('insert into channel_member (channel_id, staff_id, is_channel_admin) values ($1, $2, $3)', [
    channelId,
    staffId,
    admin,
  ]);

describe('channel_member INSERT', () => {
  it('lets a Staff member add their own plain row to a Public channel (joining)', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(member.id, async (query) => {
      expect((await join(query, channel.id, member.id)).rowCount).toBe(1);
    });
  });

  it('refuses a Staff member making themself Channel admin of a Public channel', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(member.id, async (query) => {
      await expect(join(query, channel.id, member.id, true)).rejects.toThrow(/row-level security/);
    });
  });

  // Any member adds people to a Public channel (#37): this was refused before.
  it('lets a plain member add someone else, as a plain member, to their Public channel', async () => {
    const member = await createStaffMember();
    const other = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: member.id }],
    });
    await asPingApp(member.id, async (query) => {
      expect((await join(query, channel.id, other.id)).rowCount).toBe(1);
    });
  });

  it('refuses a plain member adding someone else as Channel admin of a Public channel', async () => {
    const member = await createStaffMember();
    const other = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: member.id }],
    });
    await asPingApp(member.id, async (query) => {
      await expect(join(query, channel.id, other.id, true)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a non-member adding someone else to a Public channel, company Admins included', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const other = await createStaffMember();
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(admin.id, async (query) => {
      await expect(join(query, channel.id, other.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a plain member adding someone else to a Private channel', async () => {
    const member = await createStaffMember();
    const other = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id }],
    });
    await asPingApp(member.id, async (query) => {
      await expect(join(query, channel.id, other.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a Deactivated plain member adding someone else to a Public channel', async () => {
    const deactivated = await createStaffMember({ deactivated: true });
    const other = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: deactivated.id }],
    });
    await asPingApp(deactivated.id, async (query) => {
      await expect(join(query, channel.id, other.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a non-member company Admin adding themself to a Private channel', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const channel = await insertChannel({ visibility: 'private' });
    await asPingApp(admin.id, async (query) => {
      await expect(join(query, channel.id, admin.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('lets a Channel admin add anyone, as Channel admin or not, to their Private channel', async () => {
    const channelAdmin = await createStaffMember();
    const a = await createStaffMember();
    const b = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asPingApp(channelAdmin.id, async (query) => {
      expect((await join(query, channel.id, a.id)).rowCount).toBe(1);
      expect((await join(query, channel.id, b.id, true)).rowCount).toBe(1);
    });
  });

  it('refuses everything when app.staff_id is unset', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(null, async (query) => {
      await expect(join(query, channel.id, member.id)).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses a Deactivated Channel admin', async () => {
    const deactivated = await createStaffMember({ deactivated: true });
    const other = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: deactivated.id, channelAdmin: true }],
    });
    await asPingApp(deactivated.id, async (query) => {
      await expect(join(query, channel.id, other.id)).rejects.toThrow(/row-level security/);
    });
  });
});

const promote = (query: Query, channelId: string, staffId: string) =>
  query(
    'update channel_member set is_channel_admin = true where channel_id = $1 and staff_id = $2',
    [channelId, staffId],
  );

describe('channel_member UPDATE', () => {
  it('lets a Channel admin promote a member', async () => {
    const channelAdmin = await createStaffMember();
    const member = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: member.id }],
    });
    await asPingApp(channelAdmin.id, async (query) => {
      expect((await promote(query, channel.id, member.id)).rowCount).toBe(1);
    });
  });

  it('stops a plain member promoting themself or anyone else', async () => {
    const channelAdmin = await createStaffMember();
    const member = await createStaffMember();
    const other = await createStaffMember();
    const channel = await insertChannel({
      members: [
        { staffId: channelAdmin.id, channelAdmin: true },
        { staffId: member.id },
        { staffId: other.id },
      ],
    });
    await asPingApp(member.id, async (query) => {
      expect((await promote(query, channel.id, member.id)).rowCount).toBe(0);
      expect((await promote(query, channel.id, other.id)).rowCount).toBe(0);
    });
  });

  it('stops a non-member company Admin promoting anyone in a Public channel', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const member = await createStaffMember();
    const channel = await insertChannel({ members: [{ staffId: member.id }] });
    await asPingApp(admin.id, async (query) => {
      expect((await promote(query, channel.id, member.id)).rowCount).toBe(0);
    });
  });

  it('changes nothing when app.staff_id is unset', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ members: [{ staffId: member.id }] });
    await asPingApp(null, async (query) => {
      expect((await promote(query, channel.id, member.id)).rowCount).toBe(0);
    });
  });
});

const remove = (query: Query, channelId: string, staffId: string) =>
  query('delete from channel_member where channel_id = $1 and staff_id = $2', [channelId, staffId]);

describe('channel_member DELETE', () => {
  it('lets a member delete their own row (leaving)', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id }],
    });
    await asPingApp(member.id, async (query) => {
      expect((await remove(query, channel.id, member.id)).rowCount).toBe(1);
    });
  });

  it('stops a plain member removing someone else', async () => {
    const member = await createStaffMember();
    const other = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: member.id }, { staffId: other.id }],
    });
    await asPingApp(member.id, async (query) => {
      expect((await remove(query, channel.id, other.id)).rowCount).toBe(0);
    });
  });

  it('lets a Channel admin remove a member', async () => {
    const channelAdmin = await createStaffMember();
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: member.id }],
    });
    await asPingApp(channelAdmin.id, async (query) => {
      expect((await remove(query, channel.id, member.id)).rowCount).toBe(1);
    });
  });

  it('stops a non-member company Admin removing anyone', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const member = await createStaffMember();
    const channel = await insertChannel({ members: [{ staffId: member.id }] });
    await asPingApp(admin.id, async (query) => {
      expect((await remove(query, channel.id, member.id)).rowCount).toBe(0);
    });
  });

  it('deletes nothing when app.staff_id is unset', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ members: [{ staffId: member.id }] });
    await asPingApp(null, async (query) => {
      expect((await remove(query, channel.id, member.id)).rowCount).toBe(0);
    });
  });

  it('deletes nothing for a Deactivated Staff member, even their own row', async () => {
    const deactivated = await createStaffMember({ deactivated: true });
    const channel = await insertChannel({ members: [{ staffId: deactivated.id }] });
    await asPingApp(deactivated.id, async (query) => {
      expect((await remove(query, channel.id, deactivated.id)).rowCount).toBe(0);
    });
  });
});

// joined_at decides who is auto-promoted when a sole Channel admin is Deactivated (the
// earliest wins), so nobody may choose it: an insert must use the transaction's own time,
// and ping_app may update only is_channel_admin.
describe('channel_member joined_at', () => {
  const joinAt = (query: Query, channelId: string, staffId: string, joinedAt: string) =>
    query('insert into channel_member (channel_id, staff_id, joined_at) values ($1, $2, $3)', [
      channelId,
      staffId,
      joinedAt,
    ]);

  it('lets a join that leaves joined_at to its default through, at the transaction’s time', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(member.id, async (query) => {
      await join(query, channel.id, member.id);
      const { rows } = await query<{ same: boolean }>(
        'select joined_at = now() as same from channel_member where channel_id = $1 and staff_id = $2',
        [channel.id, member.id],
      );
      expect(rows).toEqual([{ same: true }]);
    });
  });

  it('refuses a Staff member backdating their own join to a Public channel', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(member.id, async (query) => {
      await expect(joinAt(query, channel.id, member.id, '2020-01-01T00:00:00Z')).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it('refuses a Channel admin adding someone with a backdated joined_at', async () => {
    const channelAdmin = await createStaffMember();
    const other = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asPingApp(channelAdmin.id, async (query) => {
      await expect(joinAt(query, channel.id, other.id, '2020-01-01T00:00:00Z')).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it('refuses a Channel admin editing anyone’s joined_at, their own included', async () => {
    const channelAdmin = await createStaffMember();
    const member = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: member.id }],
    });
    for (const staffId of [channelAdmin.id, member.id]) {
      await asPingApp(channelAdmin.id, async (query) => {
        await expect(
          query(
            `update channel_member set joined_at = '2020-01-01T00:00:00Z'
              where channel_id = $1 and staff_id = $2`,
            [channel.id, staffId],
          ),
        ).rejects.toThrow(/permission denied/);
      });
    }
  });

  it('still lets a Channel admin promote a member', async () => {
    const channelAdmin = await createStaffMember();
    const member = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: member.id }],
    });
    await asPingApp(channelAdmin.id, async (query) => {
      expect((await promote(query, channel.id, member.id)).rowCount).toBe(1);
    });
  });
});

// The first system function: inserts a Channel and its first Channel admin together, for
// the Staff member in app.staff_id.
describe('create_channel', () => {
  const create = (query: Query, visibility: 'public' | 'private') =>
    query<{ id: string | null }>(
      `select public.create_channel('Ops', 'Daily operations', $1) as id`,
      [visibility],
    );

  it('creates a Private channel with the acting Staff member as its Channel admin', async () => {
    const member = await createStaffMember();
    await asPingApp(member.id, async (query) => {
      const id = (await create(query, 'private')).rows[0]?.id;
      expect(id).toBeTruthy();
      const channel = await query<{ created_by: string; visibility: string }>(
        'select created_by, visibility from channel where id = $1',
        [id],
      );
      expect(channel.rows).toEqual([{ created_by: member.id, visibility: 'private' }]);
      const members = await query(
        'select staff_id, is_channel_admin from channel_member where channel_id = $1',
        [id],
      );
      expect(members.rows).toEqual([{ staff_id: member.id, is_channel_admin: true }]);
    });
  });

  it('cannot be steered to another Staff member: it takes no Staff member argument', async () => {
    const member = await createStaffMember();
    const other = await createStaffMember();
    await asPingApp(member.id, async (query) => {
      await expect(
        query(`select public.create_channel('Ops', '', 'public', $1)`, [other.id]),
      ).rejects.toThrow(/does not exist/);
    });
  });

  it('does nothing when app.staff_id is unset', async () => {
    await asPingApp(null, async (query) => {
      expect((await create(query, 'public')).rows[0]?.id).toBeNull();
    });
  });

  it('does nothing for a Deactivated Staff member', async () => {
    const deactivated = await createStaffMember({ deactivated: true });
    await asPingApp(deactivated.id, async (query) => {
      expect((await create(query, 'public')).rows[0]?.id).toBeNull();
    });
  });

  it('does nothing for an app.staff_id that is no Staff member', async () => {
    await asPingApp(randomUUID(), async (query) => {
      expect((await create(query, 'public')).rows[0]?.id).toBeNull();
    });
  });
});
