import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, jsonHeaders, type TestApp } from '../test/test-app';
import { SEED_CHANNELS, SEED_PASSWORD, SEED_STAFF, seed } from './seed';
import { asOwner, testUrls } from './test-support';

describe('db:seed', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    await seed(testUrls().owner);
    testApp = createTestApp();
  });
  afterAll(async () => {
    await testApp.close();
  });

  const signIn = (email: string) =>
    testApp.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, password: SEED_PASSWORD }),
    });

  it('loads at least one Admin, several Members and one Deactivated Staff member', async () => {
    const rows = await asOwner((query) =>
      query<{ role: string; deactivated: boolean }>(
        `select role, deactivated_at is not null as deactivated from staff_member where id = any($1)`,
        [SEED_STAFF.map((s) => s.id)],
      ),
    );
    expect(rows.rows.filter((r) => r.role === 'admin' && !r.deactivated).length).toBeGreaterThan(0);
    expect(rows.rows.filter((r) => r.role === 'member' && !r.deactivated).length).toBeGreaterThan(
      1,
    );
    expect(rows.rows.filter((r) => r.deactivated)).toHaveLength(1);
  });

  it('is safe to run twice', async () => {
    await seed(testUrls().owner);
    const users = await asOwner((query) =>
      query('select id from "user" where id = any($1)', [SEED_STAFF.map((s) => s.id)]),
    );
    expect(users.rowCount).toBe(SEED_STAFF.length);
  });

  it('lets each active seeded Staff member sign in with the documented password', async () => {
    for (const staff of SEED_STAFF.filter((s) => !s.deactivated)) {
      expect((await signIn(staff.email)).status, staff.email).toBe(200);
    }
  });

  it('loads a Private channel the seeded Admin is not a member of, which answers them 404', async () => {
    const hidden = SEED_CHANNELS.find((c) => c.visibility === 'private');
    const admin = SEED_STAFF.find((s) => s.role === 'admin');
    expect(hidden?.members.some((m) => m.email === admin?.email)).toBe(false);

    const res = await signIn(admin?.email ?? '');
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const read = await testApp.app.request(`/api/channels/${hidden?.id}`, {
      headers: jsonHeaders({ cookie }),
    });
    expect(read.status).toBe(404);
  });

  it('gives every seeded Channel exactly one Channel admin', async () => {
    const rows = await asOwner((query) =>
      query<{ channel_id: string; admins: number }>(
        `select channel_id, count(*) filter (where is_channel_admin)::int as admins
           from channel_member where channel_id = any($1) group by channel_id`,
        [SEED_CHANNELS.map((c) => c.id)],
      ),
    );
    expect(rows.rows).toHaveLength(SEED_CHANNELS.length);
    for (const row of rows.rows) expect(row.admins).toBe(1);
  });

  it('refuses the seeded Deactivated Staff member', async () => {
    const deactivated = SEED_STAFF.find((s) => s.deactivated);
    expect((await signIn(deactivated?.email ?? '')).status).toBe(403);
  });
});
