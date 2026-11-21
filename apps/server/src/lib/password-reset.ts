// Password reset (product.md › Password reset): the reset email and the per-email limit.
// Better Auth owns the token: 24 random characters in its `verification` table, good for
// one use within RESET_LIFETIME_SECONDS. Ping builds its own link rather than using
// Better Auth's, which carries the token in a path that reaches server logs. Ping's link
// carries it in the fragment, which browsers never send to a server.
import { createHash } from 'node:crypto';
import type { MailMessage } from './email';
import { escapeHtml } from './invite';

export const RESET_LIFETIME_SECONDS = 60 * 60;

/** The set-password page for a reset token. */
function resetLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/reset-password#token=${token}`;
}

/** The reset email. `appUrl` is the host people open: staging links to staging. */
export function resetEmail(input: {
  to: string;
  name: string;
  appUrl: string;
  token: string;
}): MailMessage {
  const link = resetLink(input.appUrl, input.token);
  const footer =
    'The link works once and lasts 1 hour. If you didn’t ask for this, you can ignore it: your password stays the same.';
  return {
    to: input.to,
    subject: 'Reset your Ping password',
    text: [
      `Hi ${input.name},`,
      '',
      'Someone asked to reset your Ping password. Choose a new one here:',
      '',
      link,
      '',
      footer,
    ].join('\n'),
    html: [
      `<p>Hi ${escapeHtml(input.name)},</p>`,
      '<p>Someone asked to reset your Ping password. Choose a new one here:</p>',
      `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>`,
      `<p>${escapeHtml(footer)}</p>`,
    ].join('\n'),
  };
}

type Window = { start: number; count: number };

/**
 * A fixed-window count per email address, in memory (Ping runs one Machine). Keys are a
 * hash of the lowercased address, so the map never holds an email.
 */
export function perEmailLimit(options: { max: number; windowMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();
  return {
    /** Counts a request; false when the address is over its limit. */
    take(email: string): boolean {
      const time = now();
      const key = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
      const current = windows.get(key);
      if (!current || time - current.start >= options.windowMs) {
        // Forget finished windows so the map can't grow without bound.
        for (const [other, window] of windows) {
          if (time - window.start >= options.windowMs) windows.delete(other);
        }
        windows.set(key, { start: time, count: 1 });
        return true;
      }
      if (current.count >= options.max) return false;
      current.count += 1;
      return true;
    },
  };
}
