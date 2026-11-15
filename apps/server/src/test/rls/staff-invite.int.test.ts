// RLS suite: staff_invite, as ping_app with raw SQL and no server code.
// Every command: active Admins only. ping_system reads, inserts, marks a failed email and
// deletes (invite acceptance and bootstrap-admin), with no Staff member set.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  asPingSystem,
  createStaffMember,
  type StaffFixture,
} from '../../db/test-support';

/** An Invited Staff member with a live invite row, inserted as the owner. */
async function invitedWithInvite(): Promise<StaffFixture> {
  const invited = await createStaffMember({ invited: true });
  await asOwner((query) =>
    query(
      `insert into staff_invite (staff_id, token_hash, expires_at)
       values ($1, $2, now() + interval '7 days')`,
      [invited.id, randomUUID()],
    ),
  );
  return invited;
}

const insertInvite = `insert into staff_invite (staff_id, token_hash, expires_at, created_by)
  values ($1, $2, now() + interval '7 days', $3)`;

describe('staff_invite SELECT', () => {
  it('lets an Admin read invites', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const invited = await invitedWithInvite();
    await asPingApp(admin.id, async (query) => {
      const rows = await query('select staff_id from staff_invite where staff_id = $1', [
        invited.id,
      ]);
      expect(rows.rowCount).toBe(1);
    });
  });

  it('returns nothing to a Member', async () => {
    const member = await createStaffMember();
    const invited = await invitedWithInvite();
    await asPingApp(member.id, async (query) => {
      const rows = await query('select staff_id from staff_invite where staff_id = $1', [
        invited.id,
      ]);
      expect(rows.rowCount).toBe(0);
    });
  });

  it('returns nothing to a Deactivated Admin', async () => {
    const admin = await createStaffMember({ role: 'admin', deactivated: true });
    await invitedWithInvite();
    await asPingApp(admin.id, async (query) => {
      expect((await query('select staff_id from staff_invite')).rowCount).toBe(0);
    });
  });

  it('returns nothing when app.staff_id is unset', async () => {
    await invitedWithInvite();
    await asPingApp(null, async (query) => {
      expect((await query('select staff_id from staff_invite')).rowCount).toBe(0);
    });
  });
});

describe('staff_invite INSERT', () => {
  it('lets an Admin insert', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const invited = await createStaffMember({ invited: true });
    await asPingApp(admin.id, async (query) => {
      const result = await query(insertInvite, [invited.id, randomUUID(), admin.id]);
      expect(result.rowCount).toBe(1);
    });
  });

  it('refuses a Member', async () => {
    const member = await createStaffMember();
    const invited = await createStaffMember({ invited: true });
    await asPingApp(member.id, async (query) => {
      await expect(query(insertInvite, [invited.id, randomUUID(), member.id])).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it('refuses when app.staff_id is unset', async () => {
    const invited = await createStaffMember({ invited: true });
    await asPingApp(null, async (query) => {
      await expect(query(insertInvite, [invited.id, randomUUID(), null])).rejects.toThrow(
        /row-level security/,
      );
    });
  });
});

describe('staff_invite UPDATE', () => {
  const resend = `update staff_invite set token_hash = $2, expires_at = now() + interval '7 days'
    where staff_id = $1`;

  it('lets an Admin replace the token (Resend)', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const invited = await invitedWithInvite();
    await asPingApp(admin.id, async (query) => {
      expect((await query(resend, [invited.id, randomUUID()])).rowCount).toBe(1);
    });
  });

  it('changes nothing for a Member', async () => {
    const member = await createStaffMember();
    const invited = await invitedWithInvite();
    await asPingApp(member.id, async (query) => {
      expect((await query(resend, [invited.id, randomUUID()])).rowCount).toBe(0);
    });
  });

  it('changes nothing when app.staff_id is unset', async () => {
    const invited = await invitedWithInvite();
    await asPingApp(null, async (query) => {
      expect((await query(resend, [invited.id, randomUUID()])).rowCount).toBe(0);
    });
  });
});

describe('staff_invite DELETE', () => {
  const remove = 'delete from staff_invite where staff_id = $1';

  it('lets an Admin delete (Cancel)', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const invited = await invitedWithInvite();
    await asPingApp(admin.id, async (query) => {
      expect((await query(remove, [invited.id])).rowCount).toBe(1);
    });
  });

  it('deletes nothing for a Member', async () => {
    const member = await createStaffMember();
    const invited = await invitedWithInvite();
    await asPingApp(member.id, async (query) => {
      expect((await query(remove, [invited.id])).rowCount).toBe(0);
    });
  });

  it('deletes nothing when app.staff_id is unset', async () => {
    const invited = await invitedWithInvite();
    await asPingApp(null, async (query) => {
      expect((await query(remove, [invited.id])).rowCount).toBe(0);
    });
  });
});

describe('staff_invite as ping_system', () => {
  it('reads, locks, marks a failed email and deletes an invite', async () => {
    const invited = await invitedWithInvite();
    await asPingSystem(async (query) => {
      const locked = await query(
        'select staff_id from staff_invite where staff_id = $1 for update',
        [invited.id],
      );
      expect(locked.rowCount).toBe(1);
      const marked = await query(
        'update staff_invite set email_failed_at = now() where staff_id = $1',
        [invited.id],
      );
      expect(marked.rowCount).toBe(1);
      expect(
        (await query('delete from staff_invite where staff_id = $1', [invited.id])).rowCount,
      ).toBe(1);
    });
  });

  it('can only change email_failed_at, never the token', async () => {
    const invited = await invitedWithInvite();
    await asPingSystem(async (query) => {
      await expect(
        query('update staff_invite set token_hash = $2 where staff_id = $1', [
          invited.id,
          randomUUID(),
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('can set joined_at, and nothing else, on staff_member', async () => {
    const invited = await invitedWithInvite();
    await asPingSystem(async (query) => {
      const joined = await query('update staff_member set joined_at = now() where id = $1', [
        invited.id,
      ]);
      expect(joined.rowCount).toBe(1);
      await expect(
        query(`update staff_member set role = 'admin' where id = $1`, [invited.id]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
