// Changing your email (product.md › Profiles): the email that goes to the new address.
// Better Auth makes the token (a signed JWT, good for EMAIL_CHANGE_LIFETIME_SECONDS); Ping
// builds its own link, with the token in the fragment, which browsers never send to a
// server. The confirm page posts it in a body instead.
import { createHash } from 'node:crypto';
import { escapeHtml, type MailMessage } from './email';

export const EMAIL_CHANGE_LIFETIME_SECONDS = 60 * 60;

/** What Ping stores for a link: a hash, so the database never holds a usable token. */
export function hashEmailChangeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The confirm page for an email-change token. */
function confirmLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/confirm-email#token=${token}`;
}

/** The email to the new address. `appUrl` is the host people open: staging links to staging. */
export function emailChangeEmail(input: {
  to: string;
  name: string;
  appUrl: string;
  token: string;
}): MailMessage {
  const link = confirmLink(input.appUrl, input.token);
  const footer =
    'The link works once and lasts 1 hour. Until you open it, Ping keeps using your old email. If you didn’t ask for this, you can ignore it.';
  return {
    to: input.to,
    subject: 'Confirm your new Ping email',
    text: [
      `Hi ${input.name},`,
      '',
      'You asked to use this address for Ping. Confirm it here:',
      '',
      link,
      '',
      footer,
    ].join('\n'),
    html: [
      `<p>Hi ${escapeHtml(input.name)},</p>`,
      '<p>You asked to use this address for Ping. Confirm it here:</p>',
      `<p><a href="${escapeHtml(link)}">Use this email for Ping</a></p>`,
      `<p>${escapeHtml(footer)}</p>`,
    ].join('\n'),
  };
}
