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
    expect(result).toEqual({ staffId: expect.any(String), emailSent: true, reissued: false });

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

  it('issues a fresh link when run again for the same Invited Admin', async () => {
    const first = await run({ name: 'Patrick', email: 'patrick@example.com' });
    const firstToken = inviteTokenFor(mailbox, 'patrick@example.com');
    const again = await run({ name: 'Patrick', email: 'Patrick@Example.com' });
    expect(again).toEqual({ staffId: first.staffId, emailSent: true, reissued: true });

    const newToken = inviteTokenFor(mailbox, 'patrick@example.com');
    expect(newToken).not.toBe(firstToken);
    const rows = await owner(async (query) => ({
      staff: (await query('select id from staff_member')).rowCount,
      hashes: (await query<{ token_hash: string }>('select token_hash from staff_invite')).rows,
      audit: (await query<{ kind: string }>('select kind from audit_event order by created_at'))
        .rows,
    }));
    expect(rows.staff).toBe(1);
    expect(rows.hashes).toEqual([{ token_hash: hashInviteToken(newToken) }]);
    expect(rows.audit.map((event) => event.kind)).toEqual(['staff_invited', 'staff_invite_resent']);
  });

  it('refuses the same email once that Admin has joined', async () => {
    await run({ name: 'Patrick', email: 'patrick@example.com' });
    await owner((query) => query('update staff_member set joined_at = now()'));
    await expect(run({ name: 'Patrick', email: 'patrick@example.com' })).rejects.toThrow(
      'An Admin already exists',
    );
  });

  it('gives the link, without an error, when staging holds the email back', async () => {
    const held = await bootstrapAdmin(
      {
        systemActions,
        mailer: fakeMailer(mailbox, { environment: 'staging', allowlist: [] }),
        appUrl: 'https://staging.ping.bypatrick.app',
      },
      { name: 'Patrick', email: 'patrick@example.com' },
    );
    expect(held).toEqual({
      staffId: expect.any(String),
      emailSent: false,
      reissued: false,
      error: undefined,
      link: expect.stringMatching(/^https:\/\/staging\.ping\.bypatrick\.app\/accept-invite#token=/),
    });
    expect(mailbox.sent).toEqual([]);
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
      reissued: false,
      error: expect.any(Error),
      link: expect.stringMatching(
        /^https:\/\/ping\.bypatrick\.app\/accept-invite#token=[\w-]{43}$/,
      ),
    });
    const failed = await owner((query) =>
      query('select 1 from staff_invite where email_failed_at is not null'),
    );
    expect(failed.rowCount).toBe(1);
  });

  it('refuses an email that a Staff member already has, saying whose', async () => {
    await run({ name: 'Patrick', email: 'patrick@example.com' });
    await owner((query) => query(`update staff_member set role = 'member', joined_at = now()`));
    await expect(run({ name: 'Patrick', email: 'Patrick@example.com' })).rejects.toThrow(
      'That email belongs to an active Staff member.',
    );
  });

  it('refuses a malformed email', async () => {
    await expect(run({ name: 'Patrick', email: 'nope' })).rejects.toThrow(
      'Enter an email address like name@example.com.',
    );
  });
});
