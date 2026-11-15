import { describe, expect, it } from 'vitest';
import {
  hashInviteToken,
  INVITE_LIFETIME_MS,
  inviteEmail,
  inviteExpiry,
  newInviteToken,
} from './invite';

describe('invite tokens', () => {
  it('are long, random and URL-safe, and only their hash is stored', () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashInviteToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
  });

  it('hash to a known SHA-256 hex digest', () => {
    expect(hashInviteToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('expire 7 days after they are issued', () => {
    const now = new Date('2026-11-15T10:00:00Z');
    expect(INVITE_LIFETIME_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(inviteExpiry(now).toISOString()).toBe('2026-11-22T10:00:00.000Z');
  });
});

describe('inviteEmail', () => {
  const mail = inviteEmail({
    to: 'rosa@example.com',
    name: 'Rosa <b>Ferrer</b>',
    appUrl: 'https://staging.ping.bypatrick.app',
    token: 'tok_123',
  });

  it('links to the set-password page with the token in the fragment, never the path', () => {
    const link = 'https://staging.ping.bypatrick.app/accept-invite#token=tok_123';
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`href="${link}"`);
  });

  it('keeps the person’s name out of the subject and escapes it in the HTML', () => {
    expect(mail.to).toBe('rosa@example.com');
    expect(mail.subject).toBe('You’re invited to Ping');
    expect(mail.html).toContain('Rosa &lt;b&gt;Ferrer&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Ferrer</b>');
  });

  it('says how long the link lasts', () => {
    expect(mail.text).toContain('7 days');
  });
});
