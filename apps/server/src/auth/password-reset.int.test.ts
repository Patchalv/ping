// Password reset (product.md › Password reset), through Better Auth's real routes:
// POST /api/auth/request-password-reset and POST /api/auth/reset-password. Both sit on the
// route-coverage allowlist under POST /api/auth/*, so they're tested here directly.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asOwner, createStaffMember, type StaffFixture } from '../db/test-support';
import {
  BREACHED_PASSWORD,
  createTestApp,
  jsonHeaders,
  resetTokenFor,
  signIn,
  type TestApp,
  UNCHECKABLE_PASSWORD,
} from '../test/test-app';

const NEW_PASSWORD = 'a-brand-new-ping-password';

let testApp: TestApp;
beforeAll(() => {
  testApp = createTestApp();
});
afterAll(async () => {
  await testApp.close();
});

function requestReset(email: string) {
  return testApp.app.request('/api/auth/request-password-reset', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email }),
  });
}

function resetPassword(token: string, newPassword = NEW_PASSWORD) {
  return testApp.app.request('/api/auth/reset-password', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ token, newPassword }),
  });
}

async function signInStatus(email: string, password: string): Promise<number> {
  const res = await testApp.app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password }),
  });
  return res.status;
}

function emailsTo(address: string) {
  return testApp.mailbox.sent.filter((mail) => mail.to === address);
}

async function passwordHashOf(staffId: string): Promise<string | null> {
  return asOwner(async (query) => {
    const result = await query<{ password: string | null }>(
      `select password from account where user_id = $1 and provider_id = 'credential'`,
      [staffId],
    );
    return result.rows[0]?.password ?? null;
  });
}

/** A reset token for `staff`, written straight into Better Auth's verification table. */
async function insertResetToken(staff: StaffFixture, expiresAt = new Date(Date.now() + 60_000)) {
  const token = randomUUID().replaceAll('-', '').slice(0, 24);
  await asOwner((query) =>
    query(`insert into verification (id, identifier, value, expires_at) values ($1, $2, $3, $4)`, [
      randomUUID(),
      `reset-password:${token}`,
      staff.id,
      expiresAt,
    ]),
  );
  return token;
}

describe('asking for a reset link', () => {
  it('emails an active Staff member a link to the set-password page', async () => {
    const member = await createStaffMember();
    const res = await requestReset(member.email);
    expect(res.status).toBe(200);
    const [mail] = emailsTo(member.email);
    expect(mail?.subject).toBe('Reset your Ping password');
    expect(mail?.text).toMatch(/http:\/\/localhost:5173\/reset-password#token=[A-Za-z0-9]+/);
  });

  it('gives unknown, Invited and Deactivated emails the same answer, and emails nobody', async () => {
    const member = await createStaffMember();
    const known = await (await requestReset(member.email)).json();

    const invited = await createStaffMember({ invited: true });
    const deactivated = await createStaffMember({ deactivated: true });
    const unknown = `nobody-${randomUUID()}@example.test`;
    for (const email of [unknown, invited.email, deactivated.email]) {
      const res = await requestReset(email);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(known);
      expect(emailsTo(email)).toEqual([]);
    }
  });

  it('sends at most 3 links per email per hour, with the same answer after that', async () => {
    const member = await createStaffMember();
    const answers = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await requestReset(member.email.toUpperCase());
      answers.push({ status: res.status, body: await res.json() });
    }
    expect(emailsTo(member.email)).toHaveLength(3);
    expect(answers[3]).toEqual(answers[0]);
  });

  it('answers the same when the email fails, and reports the failure without the address', async () => {
    const member = await createStaffMember();
    const reportedBefore = testApp.reported.length;
    testApp.mailbox.failing = true;
    try {
      const res = await requestReset(member.email);
      expect(res.status).toBe(200);
    } finally {
      testApp.mailbox.failing = false;
    }
    const reported = testApp.reported.slice(reportedBefore);
    expect(reported).toHaveLength(1);
    expect(String(reported[0])).not.toContain(member.email);
  });

  it('is rate limited per IP by Better Auth', async () => {
    const headers = jsonHeaders();
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await testApp.app.request('/api/auth/request-password-reset', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: `nobody-${randomUUID()}@example.test` }),
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe('setting a new password from the link', () => {
  it('sets the password and signs the person out of every session', async () => {
    const member = await createStaffMember();
    const cookies = [await signIn(testApp, member), await signIn(testApp, member)];
    await requestReset(member.email);

    const res = await resetPassword(resetTokenFor(testApp.mailbox, member.email));
    expect(res.status).toBe(200);

    for (const cookie of cookies) {
      const session = await testApp.app.request('/api/auth/get-session', { headers: { cookie } });
      expect(await session.json()).toBeNull();
    }
    expect(await signInStatus(member.email, member.password)).toBe(401);
    expect(await signInStatus(member.email, NEW_PASSWORD)).toBe(200);
  });

  it('works once', async () => {
    const member = await createStaffMember();
    await requestReset(member.email);
    const token = resetTokenFor(testApp.mailbox, member.email);
    expect((await resetPassword(token)).status).toBe(200);

    const again = await resetPassword(token, 'yet-another-ping-password');
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    expect(await signInStatus(member.email, NEW_PASSWORD)).toBe(200);
  });

  it('refuses an expired link', async () => {
    const member = await createStaffMember();
    const token = await insertResetToken(member, new Date(Date.now() - 1000));
    const before = await passwordHashOf(member.id);
    const res = await resetPassword(token);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    expect(await passwordHashOf(member.id)).toBe(before);
  });

  it('refuses an unknown token', async () => {
    const res = await resetPassword('not-a-real-reset-token-x');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('makes a link expire 1 hour after it was asked for', async () => {
    const member = await createStaffMember();
    await requestReset(member.email);
    const token = resetTokenFor(testApp.mailbox, member.email);
    const lifetime = await asOwner(async (query) => {
      const result = await query<{ seconds: number }>(
        `select extract(epoch from expires_at - created_at)::int as seconds
           from verification where identifier = $1`,
        [`reset-password:${token}`],
      );
      return result.rows[0]?.seconds;
    });
    expect(lifetime).toBe(3600);
  });

  it.each([
    ['an Invited', { invited: true }],
    ['a Deactivated', { deactivated: true }],
  ])('never sets a password for %s person, even with a token', async (_, options) => {
    const person = await createStaffMember(options);
    const token = await insertResetToken(person);
    const before = await passwordHashOf(person.id);
    const res = await resetPassword(token);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    expect(await passwordHashOf(person.id)).toBe(before);
  });

  it('refuses a password from a known breach, keeping the link usable', async () => {
    const member = await createStaffMember();
    const token = await insertResetToken(member);
    const res = await resetPassword(token, BREACHED_PASSWORD);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'PASSWORD_COMPROMISED',
      message: 'That password has appeared in a data breach. Choose a different one.',
    });
    expect((await resetPassword(token)).status).toBe(200);
  });

  it('refuses rather than skip the breach check when it can’t run', async () => {
    const member = await createStaffMember();
    const token = await insertResetToken(member);
    const res = await resetPassword(token, UNCHECKABLE_PASSWORD);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      message: 'We couldn’t check your password just now. Try again in a minute.',
    });
  });

  it('refuses a password shorter than 12 characters', async () => {
    const member = await createStaffMember();
    const token = await insertResetToken(member);
    const res = await resetPassword(token, 'too-short');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
  });
});
