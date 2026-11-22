// RLS cases for the deactivate_staff_member system function (permissions.md › System
// functions, data-model.md › The clean-up routine). The Admin's request sets
// deactivated_at and deactivated_by itself; the function then promotes a replacement sole
// Channel admin and archives Channels left with no active members, in every Channel,
// including Private ones the Admin can't see. It answers one row per Channel it changed.
//
// The promotion choice lives here, in SQL, because only the function can see every
// Channel, so these cases are its tests: earliest joined_at, then the Staff member
// created first.
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createStaffMember,
  insertChannel,
  type Query,
} from '../../db/test-support';

type Changed = { channel_id: string; promoted_staff_id: string | null; archived: boolean };

/** Deactivates `targetId` the way the route does, then runs the function. */
async function deactivate(query: Query, adminId: string, targetId: string): Promise<Changed[]> {
  await query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
    targetId,
    adminId,
  ]);
  return (
    await query<Changed>(
      'select channel_id, promoted_staff_id, archived from public.deactivate_staff_member($1)',
      [targetId],
    )
  ).rows;
}

/** Sets when each member joined, as the owner. */
async function setJoinedAt(channelId: string, joined: Record<string, string>): Promise<void> {
  await asOwner(async (query) => {
    for (const [staffId, at] of Object.entries(joined)) {
      await query(
        'update channel_member set joined_at = $3 where channel_id = $1 and staff_id = $2',
        [channelId, staffId, at],
      );
    }
  });
}

describe('deactivate_staff_member: promotion', () => {
  it('promotes the active member who joined earliest when the sole Channel admin goes', async () => {
    const [admin, leaver, early, late] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      createStaffMember(),
      createStaffMember(),
      createStaffMember(),
    ]);
    const channel = await insertChannel({
      members: [
        { staffId: leaver.id, channelAdmin: true },
        { staffId: late.id },
        { staffId: early.id },
      ],
    });
    await setJoinedAt(channel.id, {
      [leaver.id]: '2026-01-01T00:00:00Z',
      [early.id]: '2026-02-01T00:00:00Z',
      [late.id]: '2026-03-01T00:00:00Z',
    });

    await asPingApp(admin.id, async (query) => {
      expect(await deactivate(query, admin.id, leaver.id)).toEqual([
        { channel_id: channel.id, promoted_staff_id: early.id, archived: false },
      ]);
      const roles = await query<{ staff_id: string; is_channel_admin: boolean }>(
        'select staff_id, is_channel_admin from channel_member where channel_id = $1',
        [channel.id],
      );
      expect(roles.rows).toContainEqual({ staff_id: early.id, is_channel_admin: true });
      expect(roles.rows).toContainEqual({ staff_id: late.id, is_channel_admin: false });
      // Kept: their membership and Channel admin role, for reactivation.
      expect(roles.rows).toContainEqual({ staff_id: leaver.id, is_channel_admin: true });
    });
  });

  it('breaks a tie on joined_at by who became a Staff member first', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const leaver = await createStaffMember();
    const first = await createStaffMember();
    const second = await createStaffMember();
    const channel = await insertChannel({
      members: [
        { staffId: leaver.id, channelAdmin: true },
        { staffId: second.id },
        { staffId: first.id },
      ],
    });
    await setJoinedAt(channel.id, {
      [first.id]: '2026-02-01T00:00:00Z',
      [second.id]: '2026-02-01T00:00:00Z',
    });

    await asPingApp(admin.id, async (query) => {
      expect(await deactivate(query, admin.id, leaver.id)).toEqual([
        { channel_id: channel.id, promoted_staff_id: first.id, archived: false },
      ]);
    });
  });

  it('skips Deactivated members', async () => {
    const [admin, leaver, gone, active] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      createStaffMember(),
      createStaffMember({ deactivated: true }),
      createStaffMember(),
    ]);
    const channel = await insertChannel({
      members: [
        { staffId: leaver.id, channelAdmin: true },
        { staffId: gone.id },
        { staffId: active.id },
      ],
    });
    await setJoinedAt(channel.id, {
      [gone.id]: '2026-01-01T00:00:00Z',
      [active.id]: '2026-02-01T00:00:00Z',
    });

    await asPingApp(admin.id, async (query) => {
      expect(await deactivate(query, admin.id, leaver.id)).toEqual([
        { channel_id: channel.id, promoted_staff_id: active.id, archived: false },
      ]);
    });
  });

  it('promotes nobody when another active Channel admin remains', async () => {
    const [admin, leaver, otherAdmin, member] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      createStaffMember(),
      createStaffMember(),
      createStaffMember(),
    ]);
    await insertChannel({
      members: [
        { staffId: leaver.id, channelAdmin: true },
        { staffId: otherAdmin.id, channelAdmin: true },
        { staffId: member.id },
      ],
    });

    await asPingApp(admin.id, async (query) => {
      expect(await deactivate(query, admin.id, leaver.id)).toEqual([]);
    });
  });

  it('promotes when the only other Channel admin is Deactivated', async () => {
    const [admin, leaver, goneAdmin, member] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      createStaffMember(),
      createStaffMember({ deactivated: true }),
      createStaffMember(),
    ]);
    const channel = await insertChannel({
      members: [
        { staffId: leaver.id, channelAdmin: true },
        { staffId: goneAdmin.id, channelAdmin: true },
        { staffId: member.id },
      ],
    });

    await asPingApp(admin.id, async (query) => {
      expect(await deactivate(query, admin.id, leaver.id)).toEqual([
        { channel_id: channel.id, promoted_staff_id: member.id, archived: false },
      ]);
    });
  });

  it('changes nothing where they were an ordinary member', async () => {
    const [admin, leaver, channelAdmin] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      createStaffMember(),
      createStaffMember(),
    ]);
    await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: leaver.id }],
    });

    await asPingApp(admin.id, async (query) => {
      expect(await deactivate(query, admin.id, leaver.id)).toEqual([]);
    });
  });
});

describe('deactivate_staff_member: archiving', () => {
  it('archives a Channel left with no active members, by the acting Admin', async () => {
    const [admin, leaver, gone] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      createStaffMember(),
      createStaffMember({ deactivated: true }),
    ]);
    const channel = await insertChannel({
      members: [{ staffId: leaver.id, channelAdmin: true }, { staffId: gone.id }],
    });

    await asPingApp(admin.id, async (query) => {
      expect(await deactivate(query, admin.id, leaver.id)).toEqual([
        { channel_id: channel.id, promoted_staff_id: null, archived: true },
      ]);
      const row = await query<{ archived_by: string; archived: boolean }>(
        'select archived_by, archived_at is not null as archived from channel where id = $1',
        [channel.id],
      );
      expect(row.rows).toEqual([{ archived_by: admin.id, archived: true }]);
    });
  });

  it('leaves an already archived Channel as it was', async () => {
    const [admin, leaver] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      createStaffMember(),
    ]);
    await insertChannel({ archived: true, members: [{ staffId: leaver.id, channelAdmin: true }] });

    await asPingApp(admin.id, async (query) => {
      expect(await deactivate(query, admin.id, leaver.id)).toEqual([]);
    });
  });

  it('keeps a 1:1 Private channel open and makes the other person its Channel admin, though the Admin can’t see it', async () => {
    const [admin, leaver, other] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      createStaffMember(),
      createStaffMember(),
    ]);
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: leaver.id, channelAdmin: true }, { staffId: other.id }],
    });

    await asPingApp(admin.id, async (query) => {
      expect(await deactivate(query, admin.id, leaver.id)).toEqual([
        { channel_id: channel.id, promoted_staff_id: other.id, archived: false },
      ]);
      // Still hidden from the Admin afterwards: the function changed it, not their access.
      const visible = await query('select id from channel where id = $1', [channel.id]);
      expect(visible.rows).toEqual([]);
    });
  });

  it('archives a Private channel the Admin can’t see when nobody active is left', async () => {
    const [admin, leaver] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      createStaffMember(),
    ]);
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: leaver.id, channelAdmin: true }],
    });

    await asPingApp(admin.id, async (query) => {
      expect(await deactivate(query, admin.id, leaver.id)).toEqual([
        { channel_id: channel.id, promoted_staff_id: null, archived: true },
      ]);
    });
  });
});

describe('deactivate_staff_member: acts only for app.staff_id, and can’t be steered', () => {
  const run = (query: Query, targetId: string) =>
    query('select * from public.deactivate_staff_member($1)', [targetId]);

  /** A sole Channel admin with one other member: the function would promote them. */
  async function soleChannelAdmin() {
    const [leaver, member] = await Promise.all([createStaffMember(), createStaffMember()]);
    await insertChannel({
      members: [{ staffId: leaver.id, channelAdmin: true }, { staffId: member.id }],
    });
    return leaver;
  }

  it('refuses when app.staff_id is unset', async () => {
    const leaver = await soleChannelAdmin();
    await asPingApp(null, async (query) => {
      await expect(run(query, leaver.id)).rejects.toThrow(/deactivate_staff_member refused/);
    });
  });

  it('refuses a Member actor', async () => {
    const [member, leaver] = await Promise.all([createStaffMember(), soleChannelAdmin()]);
    await asOwner((query) =>
      query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
        leaver.id,
        member.id,
      ]),
    );
    await asPingApp(member.id, async (query) => {
      await expect(run(query, leaver.id)).rejects.toThrow(/deactivate_staff_member refused/);
    });
  });

  it('refuses a target who is still active', async () => {
    const [admin, leaver] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      soleChannelAdmin(),
    ]);
    await asPingApp(admin.id, async (query) => {
      await expect(run(query, leaver.id)).rejects.toThrow(/deactivate_staff_member refused/);
    });
  });

  it('refuses a target Deactivated before this transaction', async () => {
    const [admin, leaver] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      soleChannelAdmin(),
    ]);
    await asOwner((query) =>
      query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
        leaver.id,
        admin.id,
      ]),
    );
    await asPingApp(admin.id, async (query) => {
      await expect(run(query, leaver.id)).rejects.toThrow(/deactivate_staff_member refused/);
    });
  });

  it('refuses a target Deactivated by someone else', async () => {
    const [admin, otherAdmin, leaver] = await Promise.all([
      createStaffMember({ role: 'admin' }),
      createStaffMember({ role: 'admin' }),
      soleChannelAdmin(),
    ]);
    await asPingApp(admin.id, async (query) => {
      await query(
        'update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1',
        [leaver.id, otherAdmin.id],
      );
      await expect(run(query, leaver.id)).rejects.toThrow(/deactivate_staff_member refused/);
    });
  });
});
