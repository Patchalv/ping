import { describe, expect, it } from 'vitest';
import { EMAIL_CHANGE_LIFETIME_SECONDS, emailChangeEmail } from './email-change';

describe('emailChangeEmail', () => {
  const mail = emailChangeEmail({
    to: 'rosa.new@example.com',
    name: 'Rosa <b>Ferrer</b>',
    appUrl: 'https://staging.ping.bypatrick.app/',
    token: 'eyJ.abc-123_x.sig',
  });

  it('goes to the new address', () => {
    expect(mail.to).toBe('rosa.new@example.com');
    expect(mail.subject).toBe('Confirm your new Ping email');
  });

  it('links to the confirm page with the token in the fragment, never the path', () => {
    const link = 'https://staging.ping.bypatrick.app/confirm-email#token=eyJ.abc-123_x.sig';
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(`href="${link}"`);
  });

  it('escapes the person’s name in the HTML', () => {
    expect(mail.html).toContain('Rosa &lt;b&gt;Ferrer&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Ferrer</b>');
  });

  it('says the link lasts 1 hour and works once', () => {
    expect(EMAIL_CHANGE_LIFETIME_SECONDS).toBe(3600);
    expect(mail.text).toContain('works once and lasts 1 hour');
  });
});
