import { describe, expect, it } from 'vitest';
import { perEmailLimit, RESET_LIFETIME_SECONDS, resetEmail } from './password-reset';

describe('resetEmail', () => {
  const mail = resetEmail({
    to: 'rosa@example.com',
    name: 'Rosa <b>Ferrer</b>',
    appUrl: 'https://staging.ping.bypatrick.app/',
    token: 'tok_123',
  });

  it('links to the set-password page with the token in the fragment, never the path', () => {
    const link = 'https://staging.ping.bypatrick.app/reset-password#token=tok_123';
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`href="${link}"`);
  });

  it('keeps the person’s name out of the subject and escapes it in the HTML', () => {
    expect(mail.to).toBe('rosa@example.com');
    expect(mail.subject).toBe('Reset your Ping password');
    expect(mail.html).toContain('Rosa &lt;b&gt;Ferrer&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Ferrer</b>');
  });

  it('says the link lasts 1 hour and works once', () => {
    expect(RESET_LIFETIME_SECONDS).toBe(3600);
    expect(mail.text).toContain('works once and lasts 1 hour');
  });
});

describe('perEmailLimit', () => {
  const HOUR = 60 * 60 * 1000;

  it('allows 3 requests per email per hour, ignoring case', () => {
    let time = 0;
    const limit = perEmailLimit({ max: 3, windowMs: HOUR, now: () => time });
    expect(limit.take('rosa@example.com')).toBe(true);
    expect(limit.take('Rosa@Example.com')).toBe(true);
    expect(limit.take('rosa@example.com')).toBe(true);
    expect(limit.take('rosa@example.com')).toBe(false);
    // Another address has its own count.
    expect(limit.take('jordi@example.com')).toBe(true);
    time = HOUR - 1;
    expect(limit.take('rosa@example.com')).toBe(false);
    time = HOUR;
    expect(limit.take('rosa@example.com')).toBe(true);
  });
});
