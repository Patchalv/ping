// What changing a role, Deactivating and reactivating answer, beyond the permission
// matrix (product.md › Staff members and roles, › Deactivation).
import type { StaffMemberView } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createStaffMember,
  insertChannel,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

let testApp: TestApp;
let admin: StaffFixture;
let adminCookie: string;

beforeAll(async () => {
  testApp = createTestApp();
  admin = await createStaffMember({ role: 'admin' });
  adminCookie = await signIn(testApp, admin);
});
afterAll(async () => {
  await testApp.close();
});

function request(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return testApp.app.request(path, {
    method: init.method ?? 'GET',
    headers: jsonHeaders({ cookie: init.cookie ?? adminCookie }),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

const changeRole = (staffId: string, role: 'admin' | 'member') =>
  request(`/api/staff/${staffId}/role`, { method: 'PATCH', body: { role } });
const deactivate = (staffId: string) =>
  request(`/api/staff/${staffId}/deactivate`, { method: 'POST' });
const reactivate = (staffId: string) =>
  request(`/api/staff/${staffId}/reactivate`, { method: 'POST' });

const errorMessage = async (res: Response) =>
  ((await res.json()) as { error: { message: string } }).error.message;

const auditKinds = (staffId: string) =>
  asOwner(
    async (query) =>
      (
        await query<{ kind: string; actor_id: string }>(
          `select kind, actor_id from audit_event
          where target_staff_id = $1 and kind like 'staff\\_%' order by created_at`,
          [staffId],
        )
      ).rows,
  );

const staffRow = (staffId: string) =>
  asOwner(
    async (query) =>
      (
        await query<{ role: string; deactivated_by: string | null; deactivated: boolean }>(
          'select role, deactivated_by, deactivated_at is not null as deactivated from staff_member where id = $1',
          [staffId],
        )
      ).rows[0],
  );

const memberRoles = (channelId: string) =>
  asOwner(
    async (query) =>
      (
        await query<{ staff_id: string; is_channel_admin: boolean }>(
          'select staff_id, is_channel_admin from channel_member where channel_id = $1 order by joined_at, staff_id',
          [channelId],
        )
      ).rows,
  );

describe('PATCH /api/staff/:staffId/role', () => {
  it('makes a Member an Admin and back, recording each change', async () => {
    const person = await createStaffMember();

    const promoted = await changeRole(person.id, 'admin');
    expect(promoted.status).toBe(200);
    expect(((await promoted.json()) as StaffMemberView).role).toBe('admin');
    expect((await changeRole(person.id, 'member')).status).toBe(200);

    expect((await staffRow(person.id))?.role).toBe('member');
    expect(await auditKinds(person.id)).toEqual([
      { kind: 'staff_role_changed', actor_id: admin.id },
      { kind: 'staff_role_changed', actor_id: admin.id },
    ]);
  });

  it('refuses an Admin changing their own role, with a message', async () => {
    // Another active Admin, so this isn't the last-Admin case (unit-tested in permissions).
    await createStaffMember({ role: 'admin' });
    const res = await changeRole(admin.id, 'member');
    expect(res.status).toBe(403);
    expect(await errorMessage(res)).toBe('Ask another Admin to change your role.');
    expect((await staffRow(admin.id))?.role).toBe('admin');
  });

  it('refuses a Deactivated Staff member: reactivate them first', async () => {
    const gone = await createStaffMember({ deactivated: true });
    const res = await changeRole(gone.id, 'admin');
    expect(res.status).toBe(409);
    expect(await errorMessage(res)).toBe('Reactivate them before changing their role.');
  });

  it('answers 404 for an unknown Staff member', async () => {
    expect((await changeRole('00000000-0000-4000-8000-000000000000', 'admin')).status).toBe(404);
  });

  it('answers 400 for a role that isn’t Admin or Member', async () => {
    const person = await createStaffMember();
    const res = await request(`/api/staff/${person.id}/role`, {
      method: 'PATCH',
      body: { role: 'owner' },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/staff/:staffId/deactivate', () => {
  it('Deactivates them, ends their sessions at once and records it', async () => {
    const person = await createStaffMember();
    const theirCookie = await signIn(testApp, person);
    expect((await request('/api/staff/me', { cookie: theirCookie })).status).toBe(200);

    const res = await deactivate(person.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as StaffMemberView).state).toBe('deactivated');

    expect(await staffRow(person.id)).toEqual({
      role: 'member',
      deactivated_by: admin.id,
      deactivated: true,
    });
    const sessions = await asOwner((query) =>
      query('select id from session where user_id = $1', [person.id]),
    );
    expect(sessions.rowCount).toBe(0);
    expect((await request('/api/staff/me', { cookie: theirCookie })).status).toBe(401);
    expect(await auditKinds(person.id)).toEqual([
      { kind: 'staff_deactivated', actor_id: admin.id },
    ]);
  });

  it('promotes and archives in Private channels the Admin can’t see, and keeps their memberships', async () => {
    const [leaver, other] = await Promise.all([createStaffMember(), createStaffMember()]);
    const oneToOne = await insertChannel({
      visibility: 'private',
      members: [{ staffId: leaver.id, channelAdmin: true }, { staffId: other.id }],
    });
    const alone = await insertChannel({
      visibility: 'private',
      members: [{ staffId: leaver.id, channelAdmin: true }],
    });

    expect((await deactivate(leaver.id)).status).toBe(200);

    expect(await memberRoles(oneToOne.id)).toEqual(
      expect.arrayContaining([
        { staff_id: leaver.id, is_channel_admin: true },
        { staff_id: other.id, is_channel_admin: true },
      ]),
    );
    const channels = await asOwner(
      async (query) =>
        (
          await query<{ id: string; archived_by: string | null }>(
            'select id, archived_by from channel where id = any($1) order by id',
            [[oneToOne.id, alone.id]],
          )
        ).rows,
    );
    expect(channels).toEqual(
      expect.arrayContaining([
        { id: oneToOne.id, archived_by: null },
        { id: alone.id, archived_by: admin.id },
      ]),
    );
  });

  it('refuses an Admin Deactivating themself, with a message', async () => {
    await createStaffMember({ role: 'admin' });
    const res = await deactivate(admin.id);
    expect(res.status).toBe(403);
    expect(await errorMessage(res)).toBe('Ask another Admin to Deactivate you.');
  });

  it('refuses an Invited person: cancel the invite instead', async () => {
    const invited = await createStaffMember({ invited: true });
    const res = await deactivate(invited.id);
    expect(res.status).toBe(409);
    expect(await errorMessage(res)).toBe('They haven’t joined yet. Cancel their invite instead.');
  });

  it('refuses someone already Deactivated', async () => {
    const gone = await createStaffMember({ deactivated: true });
    const res = await deactivate(gone.id);
    expect(res.status).toBe(409);
    expect(await errorMessage(res)).toBe('They’re already Deactivated.');
  });
});

describe('POST /api/staff/:staffId/reactivate', () => {
  it('restores memberships and Channel admin roles as they were; promotions made meanwhile stand', async () => {
    const [leaver, other] = await Promise.all([createStaffMember(), createStaffMember()]);
    const channel = await insertChannel({
      members: [{ staffId: leaver.id, channelAdmin: true }, { staffId: other.id }],
    });
    expect((await deactivate(leaver.id)).status).toBe(200);

    const res = await reactivate(leaver.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as StaffMemberView).state).toBe('active');

    expect(await memberRoles(channel.id)).toEqual(
      expect.arrayContaining([
        { staff_id: leaver.id, is_channel_admin: true },
        { staff_id: other.id, is_channel_admin: true },
      ]),
    );
    expect(await staffRow(leaver.id)).toEqual({
      role: 'member',
      deactivated_by: null,
      deactivated: false,
    });
    // They can sign in again.
    expect((await request('/api/staff/me', { cookie: await signIn(testApp, leaver) })).status).toBe(
      200,
    );
    expect((await auditKinds(leaver.id)).map((event) => event.kind)).toEqual([
      'staff_deactivated',
      'staff_reactivated',
    ]);
  });

  it('refuses someone who isn’t Deactivated', async () => {
    const person = await createStaffMember();
    const res = await reactivate(person.id);
    expect(res.status).toBe(409);
    expect(await errorMessage(res)).toBe('They aren’t Deactivated.');
  });
});
