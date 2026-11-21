// Invite tokens and the invite email (product.md › Invites). Used by the Admin's invite
// routes and by bootstrap-admin, which send the same email.
//
// A token is 32 random bytes, base64url. Only its SHA-256 is stored. The link carries it
// in the fragment, which browsers never send to a server, so it can't reach a log.
import { createHash, randomBytes } from 'node:crypto';
import type { MailMessage } from './email';

export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_LIFETIME_MS);
}

/** Escapes text for an email's HTML body. Also used by the reset email. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The set-password page for a token. */
export function inviteLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/accept-invite#token=${token}`;
}

/** The invite email. `appUrl` is the host people open: staging links to staging. */
export function inviteEmail(input: {
  to: string;
  name: string;
  appUrl: string;
  token: string;
}): MailMessage {
  const link = inviteLink(input.appUrl, input.token);
  return {
    to: input.to,
    subject: 'You’re invited to Ping',
    text: [
      `Hi ${input.name},`,
      '',
      'You’ve been invited to Ping, Spark’s staff tool. Set your password to join:',
      '',
      link,
      '',
      'The link works once and lasts 7 days. If you weren’t expecting this, you can ignore it.',
    ].join('\n'),
    html: [
      `<p>Hi ${escapeHtml(input.name)},</p>`,
      '<p>You’ve been invited to Ping, Spark’s staff tool. Set your password to join:</p>',
      `<p><a href="${escapeHtml(link)}">Set your password</a></p>`,
      '<p>The link works once and lasts 7 days. If you weren’t expecting this, you can ignore it.</p>',
    ].join('\n'),
  };
}
