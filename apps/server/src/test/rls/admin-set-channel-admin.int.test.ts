// RLS cases for the admin_set_channel_admin system function (permissions.md › System
// functions): a company Admin appoints anyone, themself included, as Channel admin of a
// Public channel, or removes the role. The channel_member policies have no Admin
// exception, so this is the only way. It answers true when it changed a row.
//
// The server decides first, but any ping_app connection can call the function, so it
// guards itself: an active Admin in app.staff_id, a Public channel that isn't Archived, an
// active target, and a Channel that keeps an active Channel admin.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createInvitedStaffMember,
  createStaffMember,
  insertChannel,
  type Query,
} from '../../db/test-support';

const setChannelAdmin = async (
  query: Query,
  channelId: string,
  staffId: string,
  makeChannelAdmin: boolean,
) =>
  (
    await query<{ changed: boolean }>(
      'select public.admin_set_channel_admin($1, $2, $3) as changed',
      [channelId, staffId, makeChannelAdmin],
    )
  ).rows[0]?.changed;

/**
 * The Channel's rows (staff ID → is_channel_admin), read as the owner by default. Each
 * asPingApp case rolls back, so a change is read with that case's own `query`.
 */
const rowsOf = async (channelId: string, query?: Query) => {
  const read = (q: Query) =>
    q<{ staff_id: string; is_channel_admin: boolean }>(
      'select staff_id, is_channel_admin from channel_member where channel_id = $1',
      [channelId],
    );
  const result = query ? await read(query) : await asOwner(read);
  return Object.fromEntries(result.rows.map((r) => [r.staff_id, r.is_channel_admin]));
};

describe('admin_set_channel_admin', () => {
  it('lets a company Admin who is not a member make themself Channel admin of a Public channel', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const channelAdmin = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asPingApp(admin.id, async (query) => {
      expect(await setChannelAdmin(query, channel.id, admin.id, true)).toBe(true);
      const joined = await query<{ fresh: boolean }>(
        'select joined_at = now() as fresh from channel_member where channel_id = $1 and staff_id = $2',
        [channel.id, admin.id],
      );
      expect(joined.rows).toEqual([{ fresh: true }]);
      expect(await rowsOf(channel.id, query)).toEqual({
        [channelAdmin.id]: true,
        [admin.id]: true,
      });
    });
  });

  it('appoints a plain member and removes the role, keeping their joined_at', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const channelAdmin = await createStaffMember();
    const member = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: member.id }],
    });
    const joinedAt = (query: Query) =>
      query<{ joined_at: Date }>(
        'select joined_at from channel_member where channel_id = $1 and staff_id = $2',
        [channel.id, member.id],
      );
    await asPingApp(admin.id, async (query) => {
      const before = (await joinedAt(query)).rows;
      expect(await setChannelAdmin(query, channel.id, member.id, true)).toBe(true);
      expect(await rowsOf(channel.id, query)).toMatchObject({ [member.id]: true });
      expect(await setChannelAdmin(query, channel.id, member.id, false)).toBe(true);
      expect(await rowsOf(channel.id, query)).toMatchObject({ [member.id]: false });
      expect((await joinedAt(query)).rows).toEqual(before);
    });
  });

  it('adds someone who is not a member as Channel admin', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const other = await createStaffMember();
    const channel = await insertChannel();
    await asPingApp(admin.id, async (query) => {
      expect(await setChannelAdmin(query, channel.id, other.id, true)).toBe(true);
      expect(await rowsOf(channel.id, query)).toMatchObject({ [other.id]: true });
    });
  });

  it('does nothing for a Member: only company Admins have this power', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({ members: [{ staffId: member.id }] });
    await asPingApp(member.id, async (query) => {
      expect(await setChannelAdmin(query, channel.id, member.id, true)).toBe(false);
    });
    expect(await rowsOf(channel.id)).toEqual({ [member.id]: false });
  });

  it('does nothing in a Private channel, even one the company Admin is in', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: admin.id }],
    });
    await asPingApp(admin.id, async (query) => {
      expect(await setChannelAdmin(query, channel.id, admin.id, true)).toBe(false);
    });
    expect(await rowsOf(channel.id)).toEqual({ [admin.id]: false });
  });

  it('does nothing in an Archived channel', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const channel = await insertChannel({ archived: true });
    await asPingApp(admin.id, async (query) => {
      expect(await setChannelAdmin(query, channel.id, admin.id, true)).toBe(false);
    });
    expect(await rowsOf(channel.id)).toEqual({});
  });

  it('does nothing for an Invited or Deactivated target', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const invited = await createInvitedStaffMember();
    const deactivated = await createStaffMember({ deactivated: true });
    const channel = await insertChannel();
    await asPingApp(admin.id, async (query) => {
      expect(await setChannelAdmin(query, channel.id, invited.id, true)).toBe(false);
      expect(await setChannelAdmin(query, channel.id, deactivated.id, true)).toBe(false);
    });
    expect(await rowsOf(channel.id)).toEqual({});
  });

  it('never removes the last active Channel admin', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const channelAdmin = await createStaffMember();
    const deactivatedChannelAdmin = await createStaffMember({ deactivated: true });
    const channel = await insertChannel({
      members: [
        { staffId: channelAdmin.id, channelAdmin: true },
        { staffId: deactivatedChannelAdmin.id, channelAdmin: true },
      ],
    });
    await asPingApp(admin.id, async (query) => {
      expect(await setChannelAdmin(query, channel.id, channelAdmin.id, false)).toBe(false);
    });
    expect(await rowsOf(channel.id)).toMatchObject({ [channelAdmin.id]: true });
  });

  it('does nothing for a Deactivated company Admin', async () => {
    const admin = await createStaffMember({ role: 'admin', deactivated: true });
    const channel = await insertChannel();
    await asPingApp(admin.id, async (query) => {
      expect(await setChannelAdmin(query, channel.id, admin.id, true)).toBe(false);
    });
    expect(await rowsOf(channel.id)).toEqual({});
  });

  it('does nothing when app.staff_id is unset or is no Staff member', async () => {
    const other = await createStaffMember();
    const channel = await insertChannel();
    for (const staffId of [null, randomUUID()]) {
      await asPingApp(staffId, async (query) => {
        expect(await setChannelAdmin(query, channel.id, other.id, true)).toBe(false);
      });
    }
    expect(await rowsOf(channel.id)).toEqual({});
  });
});
