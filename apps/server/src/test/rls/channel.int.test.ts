// RLS suite: channel and channel_member, as ping_app with raw SQL and no server code.
// The visibility rule: a row is visible when its Channel is Public or the acting Staff
// member is a member of it. No Admin exception. Channels are never deleted.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { asPingApp, createStaffMember, insertChannel } from '../../db/test-support';

const visibleChannelIds = async (
  query: Parameters<Parameters<typeof asPingApp>[1]>[0],
  ids: string[],
) =>
  (await query<{ id: string }>('select id from channel where id = any($1)', [ids])).rows
    .map((r) => r.id)
    .sort();

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
});

describe('channel INSERT', () => {
  it('lets a Staff member insert a Public channel directly', async () => {
    const member = await createStaffMember();
    await asPingApp(member.id, async (query) => {
      const result = await query(
        `insert into channel (name, description, visibility, created_by)
         values ('Open', '', 'public', $1)`,
        [member.id],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it('refuses a plain insert of a Private channel, because the creator is not a member yet', async () => {
    const member = await createStaffMember();
    await asPingApp(member.id, async (query) => {
      await expect(
        query(
          `insert into channel (name, description, visibility, created_by)
           values ('Secret', '', 'private', $1)`,
          [member.id],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses any insert when app.staff_id is unset', async () => {
    const member = await createStaffMember();
    await asPingApp(null, async (query) => {
      await expect(
        query(
          `insert into channel (name, description, visibility, created_by)
           values ('Open', '', 'public', $1)`,
          [member.id],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });
});

describe('channel UPDATE', () => {
  it('reaches a Private channel only for its members', async () => {
    const member = await createStaffMember();
    const outsider = await createStaffMember({ role: 'admin' });
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    await asPingApp(outsider.id, async (query) => {
      const result = await query(`update channel set name = 'Taken' where id = $1`, [channel.id]);
      expect(result.rowCount).toBe(0);
    });
    await asPingApp(member.id, async (query) => {
      const result = await query(`update channel set name = 'Renamed' where id = $1`, [channel.id]);
      expect(result.rowCount).toBe(1);
    });
  });

  it('lets a member write a Channel they can read: write rules live in the permissions module', async () => {
    // The visibility rule guards reads. Who may change a Channel's settings is the server's
    // permissions module's job (permissions.md › Policies).
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    await asPingApp(member.id, async (query) => {
      const result = await query(`update channel set visibility = 'public' where id = $1`, [
        channel.id,
      ]);
      expect(result.rowCount).toBe(1);
    });
  });

  it('changes nothing when app.staff_id is unset', async () => {
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(null, async (query) => {
      const result = await query(`update channel set name = 'Renamed' where id = $1`, [channel.id]);
      expect(result.rowCount).toBe(0);
    });
  });
});

describe('channel DELETE', () => {
  it('is refused to everyone: Channels are never deleted', async () => {
    const member = await createStaffMember({ role: 'admin' });
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    await asPingApp(member.id, async (query) => {
      await expect(query('delete from channel where id = $1', [channel.id])).rejects.toThrow(
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
      const rows = await query('select staff_id from channel_member where channel_id = $1', [
        channel.id,
      ]);
      expect(rows.rows).toEqual([{ staff_id: member.id }]);
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
      const rows = await query('select staff_id from channel_member where channel_id = $1', [
        channel.id,
      ]);
      expect(rows.rowCount).toBe(2);
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
      const rows = await query('select staff_id from channel_member where channel_id = $1', [
        channel.id,
      ]);
      expect(rows.rowCount).toBe(0);
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    await asPingApp(null, async (query) => {
      const rows = await query('select staff_id from channel_member where channel_id = $1', [
        channel.id,
      ]);
      expect(rows.rowCount).toBe(0);
    });
  });
});

describe('channel_member INSERT', () => {
  it('lets a Staff member add a row to a Public channel', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(member.id, async (query) => {
      const result = await query(
        'insert into channel_member (channel_id, staff_id) values ($1, $2)',
        [channel.id, member.id],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it('refuses a non-member adding themself to a Private channel', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const channel = await insertChannel({ visibility: 'private' });
    await asPingApp(admin.id, async (query) => {
      await expect(
        query('insert into channel_member (channel_id, staff_id) values ($1, $2)', [
          channel.id,
          admin.id,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses when app.staff_id is unset', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ visibility: 'public' });
    await asPingApp(null, async (query) => {
      await expect(
        query('insert into channel_member (channel_id, staff_id) values ($1, $2)', [
          channel.id,
          member.id,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });
});

describe('channel_member UPDATE', () => {
  it('cannot promote anyone in a Private channel the actor is not in', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id }],
    });
    await asPingApp(admin.id, async (query) => {
      const result = await query(
        'update channel_member set is_channel_admin = true where channel_id = $1',
        [channel.id],
      );
      expect(result.rowCount).toBe(0);
    });
  });

  it('changes nothing when app.staff_id is unset', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: member.id }],
    });
    await asPingApp(null, async (query) => {
      const result = await query(
        'update channel_member set is_channel_admin = true where channel_id = $1',
        [channel.id],
      );
      expect(result.rowCount).toBe(0);
    });
  });
});

describe('channel_member DELETE', () => {
  it('lets a member of a Private channel delete a row there', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    await asPingApp(member.id, async (query) => {
      const result = await query(
        'delete from channel_member where channel_id = $1 and staff_id = $2',
        [channel.id, member.id],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it('cannot remove anyone from a Private channel the actor is not in', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    await asPingApp(admin.id, async (query) => {
      const result = await query('delete from channel_member where channel_id = $1', [channel.id]);
      expect(result.rowCount).toBe(0);
    });
  });

  it('deletes nothing when app.staff_id is unset', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'public',
      members: [{ staffId: member.id }],
    });
    await asPingApp(null, async (query) => {
      const result = await query('delete from channel_member where channel_id = $1', [channel.id]);
      expect(result.rowCount).toBe(0);
    });
  });
});

// The first system function: inserts a Channel and its first Channel admin together, for
// the Staff member in app.staff_id.
describe('create_channel', () => {
  const create = (
    query: Parameters<Parameters<typeof asPingApp>[1]>[0],
    visibility: 'public' | 'private',
  ) =>
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
