// Changing your own display name and email (product.md › Profiles), beyond the permission
// matrix. The email change runs Better Auth's change-email flow behind Ping's routes:
// POST /api/staff/:staffId/email sends a link to the new address, and
// POST /api/email-change/confirm (on the route-coverage allowlist) makes the change.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOwner, createStaffMember, type StaffFixture } from '../../db/test-support';
import { liveHub } from '../../lib/sse/publish';
import {
  createTestApp,
  emailChangeTokenFor,
  jsonHeaders,
  signIn,
  type TestApp,
} from '../../test/test-app';

let testApp: TestApp;
beforeAll(() => {
  testApp = createTestApp();
});
afterAll(async () => {
  await testApp.close();
});

const freshEmail = () => `new-${randomUUID()}@example.test`;

/** A signed-in Staff member and their Cookie header. */
async function signedIn(options: { role?: 'admin' | 'member' } = {}) {
  const staff = await createStaffMember(options);
  return { staff, cookie: await signIn(testApp, staff) };
}

function send(path: string, init: { cookie?: string; method?: string; body?: unknown }) {
  return testApp.app.request(path, {
    method: init.method ?? 'POST',
    headers: jsonHeaders(init.cookie ? { cookie: init.cookie } : {}),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

function requestEmailChange(staff: StaffFixture, cookie: string, email: string) {
  return send(`/api/staff/${staff.id}/email`, { cookie, body: { email } });
}

function confirm(token: string, cookie?: string) {
  return send('/api/email-change/confirm', { body: { token }, ...(cookie ? { cookie } : {}) });
}

async function userRow(staffId: string) {
  return asOwner(async (query) => {
    const result = await query<{ name: string; email: string }>(
      'select name, email from "user" where id = $1',
      [staffId],
    );
    return result.rows[0];
  });
}

async function auditKinds(staffId: string) {
  return asOwner(async (query) => {
    const result = await query<{ kind: string; actor_id: string | null }>(
      `select kind, actor_id from audit_event
        where target_staff_id = $1 and kind like 'email_%' order by created_at`,
      [staffId],
    );
    return result.rows;
  });
}

async function signInStatus(email: string, password: string): Promise<number> {
  const res = await send('/api/auth/sign-in/email', { body: { email, password } });
  return res.status;
}

describe('changing your email', () => {
  it('sends a link to the new address, and changes the email only when it’s opened', async () => {
    const { staff, cookie } = await signedIn();
    const newEmail = freshEmail();

    const res = await requestEmailChange(staff, cookie, newEmail.toUpperCase());
    expect(res.status).toBe(202);
    expect(await userRow(staff.id)).toEqual({ name: staff.name, email: staff.email });
    expect(testApp.mailbox.sent.filter((mail) => mail.to === staff.email)).toEqual([]);

    const token = emailChangeTokenFor(testApp.mailbox, newEmail);
    const published: unknown[] = [];
    const stopWatching = liveHub.watch((event) => published.push(event));
    const confirmed = await confirm(token);
    stopWatching();
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ email: newEmail });
    // Open screens hear it (the publish-coverage check counts on this test).
    expect(published).toContainEqual({ kind: 'staff.changed', staffId: staff.id });

    expect(await userRow(staff.id)).toEqual({ name: staff.name, email: newEmail });
    expect(await signInStatus(newEmail, staff.password)).toBe(200);
    expect(await signInStatus(staff.email, staff.password)).toBe(401);
    expect(await auditKinds(staff.id)).toEqual([
      { kind: 'email_change_requested', actor_id: staff.id },
      { kind: 'email_changed', actor_id: staff.id },
    ]);
  });

  it('works signed out, as when the link is opened on another device', async () => {
    const { staff, cookie } = await signedIn();
    const newEmail = freshEmail();
    await requestEmailChange(staff, cookie, newEmail);

    const res = await confirm(emailChangeTokenFor(testApp.mailbox, newEmail));
    expect(res.status).toBe(200);
    expect((await userRow(staff.id))?.email).toBe(newEmail);
  });

  it('keeps addresses out of the audit record', async () => {
    const { staff, cookie } = await signedIn();
    const newEmail = freshEmail();
    await requestEmailChange(staff, cookie, newEmail);
    await confirm(emailChangeTokenFor(testApp.mailbox, newEmail));

    const rows = await asOwner(async (query) => {
      const result = await query('select * from audit_event where target_staff_id = $1', [
        staff.id,
      ]);
      return JSON.stringify(result.rows);
    });
    expect(rows).not.toContain(newEmail);
    expect(rows).not.toContain(staff.email);
  });

  it('refuses an address already in use, by anyone, without sending a link', async () => {
    const { staff, cookie } = await signedIn();
    for (const other of [
      await createStaffMember(),
      await createStaffMember({ invited: true }),
      await createStaffMember({ deactivated: true }),
    ]) {
      const sentBefore = testApp.mailbox.sent.length;
      const res = await requestEmailChange(staff, cookie, other.email.toUpperCase());
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: 'conflict', message: 'Someone in Ping already uses that email.' },
      });
      expect(testApp.mailbox.sent.length).toBe(sentBefore);
    }
    expect(await auditKinds(staff.id)).toEqual([]);
  });

  it('refuses your own current address on the email field', async () => {
    const { staff, cookie } = await signedIn();
    const res = await requestEmailChange(staff, cookie, staff.email);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { issues: [{ path: 'email', message: 'That’s already your email.' }] },
    });
  });

  it('makes the link work once', async () => {
    const { staff, cookie } = await signedIn();
    const newEmail = freshEmail();
    await requestEmailChange(staff, cookie, newEmail);
    const token = emailChangeTokenFor(testApp.mailbox, newEmail);

    expect((await confirm(token)).status).toBe(200);
    const again = await confirm(token);
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({
      error: {
        code: 'not_found',
        message:
          'This link doesn’t work any more. Change your email again from your profile to get a new one.',
      },
    });
  });

  it('never revives an old link when the email changes back', async () => {
    const { staff, cookie } = await signedIn();
    const newEmail = freshEmail();
    await requestEmailChange(staff, cookie, newEmail);
    const first = emailChangeTokenFor(testApp.mailbox, newEmail);
    expect((await confirm(first)).status).toBe(200);

    // Back to the original address, which makes the first JWT's binding true again.
    const newCookie = await signIn(testApp, { email: newEmail, password: staff.password });
    await requestEmailChange(staff, newCookie, staff.email);
    expect((await confirm(emailChangeTokenFor(testApp.mailbox, staff.email))).status).toBe(200);

    expect((await confirm(first)).status).toBe(404);
    expect((await userRow(staff.id))?.email).toBe(staff.email);
  });

  it('replaces an older link with a newer one', async () => {
    const { staff, cookie } = await signedIn();
    const [older, newer] = [freshEmail(), freshEmail()];
    await requestEmailChange(staff, cookie, older);
    await requestEmailChange(staff, cookie, newer);

    expect((await confirm(emailChangeTokenFor(testApp.mailbox, older))).status).toBe(404);
    expect((await confirm(emailChangeTokenFor(testApp.mailbox, newer))).status).toBe(200);
    expect((await userRow(staff.id))?.email).toBe(newer);
  });

  it('refuses an unknown token', async () => {
    const res = await confirm('not-a-real-token');
    expect(res.status).toBe(404);
  });

  it('refuses an expired link, and the email stays the same', async () => {
    const { staff, cookie } = await signedIn();
    const newEmail = freshEmail();
    await requestEmailChange(staff, cookie, newEmail);
    await asOwner((query) =>
      query(
        `update verification set expires_at = now() - interval '1 minute'
          where identifier like 'email-change:%' and value = $1`,
        [staff.id],
      ),
    );

    const res = await confirm(emailChangeTokenFor(testApp.mailbox, newEmail));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: 'conflict',
        message:
          'This link has expired. Change your email again from your profile to get a new one.',
      },
    });
    expect((await userRow(staff.id))?.email).toBe(staff.email);
  });

  it('refuses the link once the new address is taken by someone else', async () => {
    const { staff, cookie } = await signedIn();
    const newEmail = freshEmail();
    await requestEmailChange(staff, cookie, newEmail);
    // An Admin invites someone with that address before the link is opened.
    await asOwner((query) =>
      query(`insert into "user" (name, email) values ('Rosa Ferrer', $1)`, [newEmail]),
    );

    const res = await confirm(emailChangeTokenFor(testApp.mailbox, newEmail));
    expect(res.status).toBe(409);
    expect((await userRow(staff.id))?.email).toBe(staff.email);
  });

  it('does nothing for a Staff member Deactivated since the link was sent', async () => {
    const { staff, cookie } = await signedIn();
    const newEmail = freshEmail();
    await requestEmailChange(staff, cookie, newEmail);
    const admin = await createStaffMember({ role: 'admin' });
    await asOwner((query) =>
      query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
        staff.id,
        admin.id,
      ]),
    );

    expect((await confirm(emailChangeTokenFor(testApp.mailbox, newEmail))).status).toBe(404);
    expect((await userRow(staff.id))?.email).toBe(staff.email);
  });

  it('refuses the link while someone else is signed in on this browser', async () => {
    const { staff, cookie } = await signedIn();
    const other = await signedIn();
    const newEmail = freshEmail();
    await requestEmailChange(staff, cookie, newEmail);

    const res = await confirm(emailChangeTokenFor(testApp.mailbox, newEmail), other.cookie);
    expect(res.status).toBe(404);
    expect((await userRow(staff.id))?.email).toBe(staff.email);
  });

  it('says so when the email can’t be sent, and leaves no live link', async () => {
    const { staff, cookie } = await signedIn();
    const reportedBefore = testApp.reported.length;
    testApp.mailbox.failing = true;
    let res: Response;
    try {
      res = await requestEmailChange(staff, cookie, freshEmail());
    } finally {
      testApp.mailbox.failing = false;
    }
    expect(res.status).toBe(503);
    expect(testApp.reported.length).toBe(reportedBefore + 1);
    expect(await auditKinds(staff.id)).toEqual([]);
    const links = await asOwner(async (query) => {
      const result = await query(
        `select 1 from verification where identifier like 'email-change:%' and value = $1`,
        [staff.id],
      );
      return result.rowCount;
    });
    expect(links).toBe(0);
  });
});

describe('on staging, with the new address off the allowlist', () => {
  let staging: TestApp;
  beforeAll(() => {
    staging = createTestApp({ mail: { environment: 'staging', allowlist: [] } });
  });
  afterAll(async () => {
    await staging.close();
  });

  it('says the email wasn’t sent, without reporting it', async () => {
    const staff = await createStaffMember();
    const cookie = await signIn(staging, staff);
    const res = await staging.app.request(`/api/staff/${staff.id}/email`, {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ email: freshEmail() }),
    });
    expect(res.status).toBe(503);
    expect(staging.reported).toEqual([]);
  });
});

describe('Better Auth’s own profile routes', () => {
  it.each([
    ['POST', '/api/auth/change-email', { newEmail: 'someone@example.test' }],
    ['POST', '/api/auth/update-user', { name: 'Someone' }],
    ['POST', '/api/auth/send-verification-email', { email: 'someone@example.test' }],
    ['GET', '/api/auth/verify-email?token=anything', undefined],
  ])('answers 404 for %s %s, so Ping’s routes are the only way in', async (method, path, body) => {
    const { staff, cookie } = await signedIn();
    const res = await send(path, { cookie, method, body });
    expect(res.status).toBe(404);
    expect(await userRow(staff.id)).toEqual({ name: staff.name, email: staff.email });
  });
});

describe('changing your display name', () => {
  it('changes it everywhere it’s read, the session included', async () => {
    const { staff, cookie } = await signedIn();
    const res = await send(`/api/staff/${staff.id}/name`, {
      cookie,
      method: 'PATCH',
      body: { name: '  Rosa Ferrer ' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: staff.id, name: 'Rosa Ferrer' });

    expect((await userRow(staff.id))?.name).toBe('Rosa Ferrer');
    const session = await testApp.auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.name).toBe('Rosa Ferrer');
  });

  it('refuses an empty name on its field', async () => {
    const { staff, cookie } = await signedIn();
    const res = await send(`/api/staff/${staff.id}/name`, {
      cookie,
      method: 'PATCH',
      body: { name: ' ' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { issues: [{ path: 'name', message: 'Enter your name.' }] },
    });
  });
});
