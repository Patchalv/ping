// What the Staff member routes answer, beyond the permission matrix: inviting, listing,
// Resend and Cancel, with the email they send through a fake transport.
import { randomUUID } from 'node:crypto';
import type { StaffMemberView } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOwner, createStaffMember, type StaffFixture } from '../../db/test-support';
import { hashInviteToken } from '../../lib/invite';
import {
  createTestApp,
  inviteTokenFor,
  jsonHeaders,
  signIn,
  type TestApp,
} from '../../test/test-app';

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

function asAdmin(path: string, init: { method?: string; body?: unknown; ip?: string } = {}) {
  return testApp.app.request(path, {
    method: init.method ?? 'GET',
    headers: jsonHeaders({
      cookie: adminCookie,
      ...(init.ip ? { 'fly-client-ip': init.ip } : {}),
    }),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

const freshEmail = () => `invitee-${randomUUID()}@example.test`;

/** Runs `send` with every email failing, as SMTP would. */
async function withFailingMail<T>(send: () => T | Promise<T>): Promise<T> {
  testApp.mailbox.failing = true;
  try {
    return await send();
  } finally {
    testApp.mailbox.failing = false;
  }
}

function invite(body: { name: string; email: string; role: 'admin' | 'member' }) {
  return asAdmin('/api/staff/invites', { method: 'POST', body });
}

async function rowsFor(staffId: string) {
  return asOwner(async (query) => ({
    user: (
      await query<{ name: string; email: string; email_verified: boolean }>(
        'select name, email, email_verified from "user" where id = $1',
        [staffId],
      )
    ).rows[0],
    accounts: (await query('select id from account where user_id = $1', [staffId])).rowCount,
    staff: (
      await query<{ role: string; invited_by: string | null; joined_at: Date | null }>(
        'select role, invited_by, joined_at from staff_member where id = $1',
        [staffId],
      )
    ).rows[0],
    invite: (
      await query<{
        token_hash: string;
        expires_at: Date;
        created_by: string | null;
        email_failed_at: Date | null;
      }>(
        'select token_hash, expires_at, created_by, email_failed_at from staff_invite where staff_id = $1',
        [staffId],
      )
    ).rows[0],
    audit: (
      await query<{ kind: string; actor_id: string | null }>(
        'select kind, actor_id from audit_event where target_staff_id = $1 order by created_at',
        [staffId],
      )
    ).rows,
  }));
}

describe('POST /api/staff/invites', () => {
  it('creates the user (no password), the Staff member and the invite, and sends the email', async () => {
    const email = freshEmail();
    const res = await invite({ name: 'Rosa Ferrer', email: email.toUpperCase(), role: 'member' });

    expect(res.status).toBe(201);
    const created = (await res.json()) as StaffMemberView;
    expect(created).toEqual({
      id: expect.any(String),
      name: 'Rosa Ferrer',
      email,
      role: 'member',
      state: 'invited',
      invite: { expired: false, emailFailed: false },
    });

    const rows = await rowsFor(created.id);
    expect(rows.user).toEqual({ name: 'Rosa Ferrer', email, email_verified: false });
    expect(rows.accounts).toBe(0);
    expect(rows.staff).toEqual({ role: 'member', invited_by: admin.id, joined_at: null });
    expect(rows.invite?.created_by).toBe(admin.id);
    expect(rows.invite?.email_failed_at).toBeNull();
    const days = ((rows.invite?.expires_at.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
    expect(rows.audit).toEqual([{ kind: 'staff_invited', actor_id: admin.id }]);

    // The token is in the email; only its hash is stored.
    const token = inviteTokenFor(testApp.mailbox, email);
    expect(rows.invite?.token_hash).toBe(hashInviteToken(token));
    const mail = testApp.mailbox.sent.findLast((sent) => sent.to === email);
    expect(mail?.from).toBe('Ping <no-reply@ping.bypatrick.app>');
    expect(mail?.text).toContain(`http://localhost:5173/accept-invite#token=${token}`);
  });

  it.each([
    ['an active Staff member', {}, 'Someone with that email is already in Ping.'],
    [
      'an Invited person',
      { invited: true },
      'That person has already been invited. Resend their invite from the list.',
    ],
    [
      'a Deactivated Staff member',
      { deactivated: true },
      'That email belongs to a Deactivated Staff member. Reactivate them instead.',
    ],
  ])('refuses an email that belongs to %s, ignoring case', async (_name, options, message) => {
    const existing = await createStaffMember(options);
    const sentBefore = testApp.mailbox.sent.length;
    const res = await invite({ name: 'Copy', email: existing.email.toUpperCase(), role: 'member' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: 'conflict', message } });
    expect(testApp.mailbox.sent.length).toBe(sentBefore);
  });

  it('keeps the invite when the email fails, marks it and reports it without the address', async () => {
    const email = freshEmail();
    testApp.mailbox.failing = true;
    const reportedBefore = testApp.reported.length;
    try {
      const res = await invite({ name: 'Unlucky', email, role: 'member' });
      expect(res.status).toBe(201);
      const created = (await res.json()) as StaffMemberView;
      expect(created.invite).toEqual({ expired: false, emailFailed: true });
      expect((await rowsFor(created.id)).invite?.email_failed_at).toBeInstanceOf(Date);
    } finally {
      testApp.mailbox.failing = false;
    }
    const reported = testApp.reported.slice(reportedBefore);
    expect(reported).toHaveLength(1);
    expect(String(reported[0])).not.toContain(email);
  });

  it('answers 400 with every failing field', async () => {
    const res = await invite({ name: '', email: 'nope', role: 'member' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues: { path: string }[] } };
    expect(body.error.issues.map((issue) => issue.path)).toEqual(['name', 'email']);
  });

  it('is rate limited per client IP', async () => {
    const ip = '10.200.0.1';
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await asAdmin('/api/staff/invites', {
        method: 'POST',
        ip,
        body: { name: '', email: 'nope', role: 'member' },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((status) => status === 400)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('GET /api/staff', () => {
  it('lists active, Invited (expired, email failed) and Deactivated Staff members', async () => {
    const active = await createStaffMember();
    const deactivated = await createStaffMember({ deactivated: true });
    const failed = (await (
      await withFailingMail(() => invite({ name: 'Failed', email: freshEmail(), role: 'admin' }))
    ).json()) as StaffMemberView;
    const expired = (await (
      await invite({ name: 'Expired', email: freshEmail(), role: 'member' })
    ).json()) as StaffMemberView;
    await asOwner((query) =>
      query(
        `update staff_invite set expires_at = now() - interval '1 minute' where staff_id = $1`,
        [expired.id],
      ),
    );

    const res = await asAdmin('/api/staff');
    expect(res.status).toBe(200);
    const byId = new Map(((await res.json()) as StaffMemberView[]).map((row) => [row.id, row]));
    expect(byId.get(active.id)).toMatchObject({
      state: 'active',
      invite: null,
      email: active.email,
    });
    expect(byId.get(deactivated.id)).toMatchObject({ state: 'deactivated', invite: null });
    expect(byId.get(failed.id)).toMatchObject({
      state: 'invited',
      role: 'admin',
      invite: { expired: false, emailFailed: true },
    });
    expect(byId.get(expired.id)).toMatchObject({
      state: 'invited',
      invite: { expired: true, emailFailed: false },
    });
  });
});

describe('GET /api/staff/me', () => {
  it('answers the signed-in Staff member’s role', async () => {
    const res = await asAdmin('/api/staff/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: admin.id, role: 'admin' });
  });
});

describe('POST /api/staff/:staffId/invite/resend', () => {
  it('issues a new token, invalidates the old one, extends the expiry and clears a failed email', async () => {
    const email = freshEmail();
    const created = (await (
      await withFailingMail(() => invite({ name: 'Again', email, role: 'member' }))
    ).json()) as StaffMemberView;
    await asOwner((query) =>
      query(`update staff_invite set expires_at = now() - interval '1 day' where staff_id = $1`, [
        created.id,
      ]),
    );
    const before = await rowsFor(created.id);

    const res = await asAdmin(`/api/staff/${created.id}/invite/resend`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: created.id,
      state: 'invited',
      invite: { expired: false, emailFailed: false },
    });

    const after = await rowsFor(created.id);
    const token = inviteTokenFor(testApp.mailbox, email);
    expect(after.invite?.token_hash).toBe(hashInviteToken(token));
    expect(after.invite?.token_hash).not.toBe(before.invite?.token_hash);
    expect(after.invite?.email_failed_at).toBeNull();
    expect(after.invite?.expires_at.getTime() ?? 0).toBeGreaterThan(Date.now() + 6.99 * 86_400_000);
    expect(after.audit.map((event) => event.kind)).toEqual([
      'staff_invited',
      'staff_invite_resent',
    ]);
  });

  it('refuses someone who has joined', async () => {
    const member = await createStaffMember();
    const res = await asAdmin(`/api/staff/${member.id}/invite/resend`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: 'conflict', message: 'They’ve already joined Ping.' },
    });
  });

  it('answers 404 for an unknown Staff member', async () => {
    const res = await asAdmin(`/api/staff/${randomUUID()}/invite/resend`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/staff/:staffId/invite', () => {
  it('hard-deletes the Invited person’s user, Staff member and invite rows', async () => {
    const email = freshEmail();
    const created = (await (
      await invite({ name: 'Gone', email, role: 'member' })
    ).json()) as StaffMemberView;

    const res = await asAdmin(`/api/staff/${created.id}/invite`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const rows = await rowsFor(created.id);
    expect(rows.user).toBeUndefined();
    expect(rows.staff).toBeUndefined();
    expect(rows.invite).toBeUndefined();
    expect(rows.audit.map((event) => event.kind)).toEqual([
      'staff_invited',
      'staff_invite_cancelled',
    ]);
    // The email is free to invite again.
    expect((await invite({ name: 'Back', email, role: 'member' })).status).toBe(201);
  });

  it('refuses, and deletes nothing, for someone who has joined', async () => {
    const member = await createStaffMember();
    const res = await asAdmin(`/api/staff/${member.id}/invite`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    const rows = await rowsFor(member.id);
    expect(rows.user).toBeDefined();
    expect(rows.staff).toBeDefined();
  });

  it('answers 404 for an unknown Staff member', async () => {
    const res = await asAdmin(`/api/staff/${randomUUID()}/invite`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('on staging', () => {
  let staging: TestApp;
  let stagingAdminCookie: string;
  beforeAll(async () => {
    staging = createTestApp({ mail: { environment: 'staging', allowlist: ['@allowed.test'] } });
    stagingAdminCookie = await signIn(staging, await createStaffMember({ role: 'admin' }));
  });
  afterAll(async () => {
    await staging.close();
  });

  const inviteOnStaging = (email: string) =>
    staging.app.request('/api/staff/invites', {
      method: 'POST',
      headers: jsonHeaders({ cookie: stagingAdminCookie }),
      body: JSON.stringify({ name: 'Staging Test', email, role: 'member' }),
    });

  it('shows "Email not sent" for an address off the allowlist, without reporting it', async () => {
    const res = await inviteOnStaging(`held-${randomUUID()}@elsewhere.test`);
    expect(res.status).toBe(201);
    expect(((await res.json()) as StaffMemberView).invite).toEqual({
      expired: false,
      emailFailed: true,
    });
    expect(staging.mailbox.sent).toHaveLength(0);
    expect(staging.reported).toEqual([]);
  });

  it('sends to an allowlisted domain, with [Staging] in the subject', async () => {
    const email = `ok-${randomUUID()}@allowed.test`;
    const res = await inviteOnStaging(email);
    expect(((await res.json()) as StaffMemberView).invite?.emailFailed).toBe(false);
    expect(staging.mailbox.sent.findLast((mail) => mail.to === email)?.subject).toBe(
      '[Staging] You’re invited to Ping',
    );
  });
});
