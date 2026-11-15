// Invite acceptance, outside the permission matrix: these routes have no session (they are
// on the route-coverage allowlist), so they are tested directly here, including expired,
// used and unknown tokens.
import { randomUUID } from 'node:crypto';
import type { StaffMemberView } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOwner, createStaffMember } from '../../db/test-support';
import {
  BREACHED_PASSWORD,
  createTestApp,
  inviteTokenFor,
  jsonHeaders,
  signIn,
  type TestApp,
} from '../../test/test-app';

let testApp: TestApp;
let adminCookie: string;

beforeAll(async () => {
  testApp = createTestApp();
  adminCookie = await signIn(testApp, await createStaffMember({ role: 'admin' }));
});
afterAll(async () => {
  await testApp.close();
});

const NEW_PASSWORD = 'a-long-new-password-for-ping';

/** Invites someone through the Admin route and returns their ID, email and token. */
async function invited(name = 'Rosa Ferrer') {
  const email = `invitee-${randomUUID()}@example.test`;
  const res = await testApp.app.request('/api/staff/invites', {
    method: 'POST',
    headers: jsonHeaders({ cookie: adminCookie }),
    body: JSON.stringify({ name, email, role: 'member' }),
  });
  const { id } = (await res.json()) as StaffMemberView;
  return { id, email, token: inviteTokenFor(testApp.mailbox, email) };
}

function post(path: string, body: unknown) {
  return testApp.app.request(path, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

const lookup = (token: string) => post('/api/invites/lookup', { token });
const accept = (token: string, password = NEW_PASSWORD) =>
  post('/api/invites/accept', { token, password });

async function expire(staffId: string) {
  await asOwner((query) =>
    query(`update staff_invite set expires_at = now() - interval '1 minute' where staff_id = $1`, [
      staffId,
    ]),
  );
}

const UNKNOWN = {
  error: {
    code: 'not_found',
    message: 'This invite link doesn’t work any more. Ask a Ping Admin to send a new one.',
  },
};
const EXPIRED = {
  error: {
    code: 'conflict',
    message: 'This invite has expired. Ask a Ping Admin to resend it.',
  },
};

describe('POST /api/invites/lookup', () => {
  it('answers the name and email for a live token', async () => {
    const person = await invited('Rosa Ferrer');
    const res = await lookup(person.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Rosa Ferrer', email: person.email });
  });

  it('refuses an unknown token', async () => {
    const res = await lookup('not-a-real-token');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(UNKNOWN);
  });

  it('refuses an expired token', async () => {
    const person = await invited();
    await expire(person.id);
    const res = await lookup(person.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(EXPIRED);
  });
});

describe('POST /api/invites/accept', () => {
  it('sets the password, verifies the email, sets joined_at, deletes the invite and signs in', async () => {
    const person = await invited();
    const res = await accept(person.token);
    expect(res.status).toBe(200);

    const cookie = res.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const session = await testApp.app.request('/api/auth/get-session', { headers: { cookie } });
    expect(((await session.json()) as { user: { id: string } }).user.id).toBe(person.id);

    const rows = await asOwner(async (query) => ({
      verified: (
        await query<{ email_verified: boolean }>(
          'select email_verified from "user" where id = $1',
          [person.id],
        )
      ).rows[0]?.email_verified,
      joined: (
        await query<{ joined_at: Date | null }>(
          'select joined_at from staff_member where id = $1',
          [person.id],
        )
      ).rows[0]?.joined_at,
      invites: (await query('select 1 from staff_invite where staff_id = $1', [person.id]))
        .rowCount,
      signIns: (
        await query(
          `select 1 from audit_event where kind = 'sign_in_succeeded' and target_staff_id = $1`,
          [person.id],
        )
      ).rowCount,
    }));
    expect(rows).toEqual({ verified: true, joined: expect.any(Date), invites: 0, signIns: 1 });

    // The password works for an ordinary sign-in afterwards.
    await expect(
      signIn(testApp, { email: person.email, password: NEW_PASSWORD }),
    ).resolves.toBeTruthy();
  });

  it('works once: the used token is refused', async () => {
    const person = await invited();
    expect((await accept(person.token)).status).toBe(200);
    const again = await accept(person.token, 'another-long-password-here');
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual(UNKNOWN);
  });

  it('gives one success to two submits at once', async () => {
    const person = await invited();
    const statuses = (await Promise.all([accept(person.token), accept(person.token)])).map(
      (res) => res.status,
    );
    expect(statuses.sort()).toEqual([200, 404]);
  });

  it('refuses an expired token, and changes nothing', async () => {
    const person = await invited();
    await expire(person.id);
    const res = await accept(person.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(EXPIRED);
    const joined = await asOwner((query) =>
      query('select joined_at from staff_member where id = $1 and joined_at is null', [person.id]),
    );
    expect(joined.rowCount).toBe(1);
  });

  it('refuses an unknown token', async () => {
    const res = await accept('not-a-real-token');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(UNKNOWN);
  });

  it('refuses the old token after Resend', async () => {
    const person = await invited();
    await testApp.app.request(`/api/staff/${person.id}/invite/resend`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: adminCookie }),
    });
    expect((await accept(person.token)).status).toBe(404);
    expect((await accept(inviteTokenFor(testApp.mailbox, person.email))).status).toBe(200);
  });

  it('refuses a breached password on the password field, and keeps the invite', async () => {
    const person = await invited();
    const res = await accept(person.token, BREACHED_PASSWORD);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'validation',
        message: 'That password has appeared in a data breach. Choose a different one.',
        issues: [
          {
            path: 'password',
            message: 'That password has appeared in a data breach. Choose a different one.',
          },
        ],
      },
    });
    expect((await lookup(person.token)).status).toBe(200);
  });

  it('refuses a password under 12 characters', async () => {
    const person = await invited();
    const res = await accept(person.token, 'short');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues: { path: string; message: string }[] } };
    expect(body.error.issues).toEqual([
      { path: 'password', message: 'Use at least 12 characters.' },
    ]);
  });

  it('is rate limited per client IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await testApp.app.request('/api/invites/accept', {
        method: 'POST',
        headers: jsonHeaders({ 'fly-client-ip': '10.201.0.1' }),
        body: JSON.stringify({ token: 'not-a-real-token', password: NEW_PASSWORD }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 404)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
