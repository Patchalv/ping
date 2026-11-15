// bootstrap-admin, on a scratch database of its own: it refuses whenever any Admin exists,
// and every worker database already has many.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  asOwner,
  createScratchDatabase,
  dropDatabase,
  type Query,
  testUrls,
} from '../db/test-support';
import { hashInviteToken } from '../lib/invite';
import { fakeMailer, inviteTokenFor, type Mailbox } from '../test/test-app';
import { BootstrapRefusedError, bootstrapAdmin } from './bootstrap-admin';
import { createSystemActions, type SystemActions } from './index';

let database: string;
let systemActions: SystemActions;
let mailbox: Mailbox;

beforeEach(async () => {
  database = await createScratchDatabase();
  systemActions = createSystemActions(testUrls(database).system);
  mailbox = { sent: [], failing: false };
});
afterEach(async () => {
  await systemActions.close();
  await dropDatabase(database);
});

const run = (input: { name: string; email: string }) =>
  bootstrapAdmin(
    { systemActions, mailer: fakeMailer(mailbox), appUrl: 'https://ping.bypatrick.app' },
    input,
  );

const owner = <T>(fn: (query: Query) => Promise<T>) => asOwner(fn, database);

describe('bootstrapAdmin', () => {
  it('creates an Admin invite with no password, and sends the normal invite email', async () => {
    const result = await run({ name: 'Patrick', email: 'Patrick@Example.com' });
    expect(result).toEqual({ staffId: expect.any(String), emailSent: true });

    const rows = await owner(async (query) => ({
      user: (await query('select name, email, email_verified from "user"')).rows,
      accounts: (await query('select 1 from account')).rowCount,
      staff: (await query('select id, role, invited_by, joined_at from staff_member')).rows,
      invite: (await query('select staff_id, token_hash, created_by from staff_invite')).rows,
      audit: (await query('select kind, actor_id, target_staff_id from audit_event')).rows,
    }));
    expect(rows.user).toEqual([
      { name: 'Patrick', email: 'patrick@example.com', email_verified: false },
    ]);
    expect(rows.accounts).toBe(0);
    expect(rows.staff).toEqual([
      { id: result.staffId, role: 'admin', invited_by: null, joined_at: null },
    ]);
    const token = inviteTokenFor(mailbox, 'patrick@example.com');
    expect(rows.invite).toEqual([
      { staff_id: result.staffId, token_hash: hashInviteToken(token), created_by: null },
    ]);
    expect(rows.audit).toEqual([
      { kind: 'staff_invited', actor_id: null, target_staff_id: result.staffId },
    ]);
    expect(mailbox.sent[0]?.text).toContain('https://ping.bypatrick.app/accept-invite#token=');
  });

  it('refuses while an Invited Admin exists', async () => {
    await run({ name: 'Patrick', email: 'patrick@example.com' });
    await expect(run({ name: 'Doug', email: 'doug@example.com' })).rejects.toThrow(
      BootstrapRefusedError,
    );
    expect(mailbox.sent).toHaveLength(1);
  });

  it('refuses while an active Admin exists', async () => {
    await run({ name: 'Patrick', email: 'patrick@example.com' });
    await owner((query) => query('update staff_member set joined_at = now()'));
    await expect(run({ name: 'Doug', email: 'doug@example.com' })).rejects.toThrow(
      'An Admin already exists',
    );
  });

  it('lets only one of two runs at once through', async () => {
    const results = await Promise.allSettled([
      run({ name: 'Patrick', email: 'patrick@example.com' }),
      run({ name: 'Doug', email: 'doug@example.com' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('keeps the invite and marks it when the email fails', async () => {
    mailbox.failing = true;
    const result = await run({ name: 'Patrick', email: 'patrick@example.com' });
    // No Admin can Resend yet, so the operator gets the link to pass on.
    expect(result).toEqual({
      staffId: expect.any(String),
      emailSent: false,
      link: expect.stringMatching(
        /^https:\/\/ping\.bypatrick\.app\/accept-invite#token=[\w-]{43}$/,
      ),
    });
    const failed = await owner((query) =>
      query('select 1 from staff_invite where email_failed_at is not null'),
    );
    expect(failed.rowCount).toBe(1);
  });

  it('refuses a malformed email', async () => {
    await expect(run({ name: 'Patrick', email: 'nope' })).rejects.toThrow(
      'Enter an email address like name@example.com.',
    );
  });
});
