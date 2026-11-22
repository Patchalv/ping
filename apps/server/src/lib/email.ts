// Sending email (platform.md › Email): inline over SMTP, with no queue. One mailer applies
// Ping's rules to every message; the transport underneath is any SMTP provider (Brevo in
// staging and prod), a local log, or a fake in tests. Nothing in tests sends real mail.
//
// - Every message goes from Ping's no-reply address, with no Reply-To.
// - On staging, subjects start with [Staging], and only addresses on EMAIL_ALLOWLIST are
//   sent to; any other is logged, without the address, and held back. The caller hears
//   `held`, so an invite shows "Email not sent" rather than looking sent.
// - A failure reaches the caller as an error that never holds the address, so the caller
//   can mark the invite and report to Sentry.
import nodemailer from 'nodemailer';
import type { EmailSettings, PingEnvironment } from '../config';

const FROM_ADDRESS = 'Ping <no-reply@ping.bypatrick.app>';

/** Escapes text for an email's HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** What a caller asks to send. */
export type MailMessage = { to: string; subject: string; text: string; html: string };

/** What reaches the transport. */
export type OutgoingMail = MailMessage & { from: string };

export type MailTransport = { send(mail: OutgoingMail): Promise<void> };

/**
 * `sent`: handed to the transport. `held`: staging kept it back because the recipient is
 * not on EMAIL_ALLOWLIST. Callers treat `held` like a failed send (the invite shows
 * "Email not sent"), without reporting it, since it's working as configured.
 */
export type SendResult = 'sent' | 'held';

export type Mailer = { send(message: MailMessage): Promise<SendResult> };

/**
 * Whether staging may email `address`. Each allowlist entry is `*` (everyone), `@domain`
 * (any address at exactly that domain) or an exact address. Case is ignored.
 */
function isAllowlisted(allowlist: readonly string[], address: string): boolean {
  const to = address.trim().toLowerCase();
  const domain = to.slice(to.lastIndexOf('@'));
  return allowlist.some((raw) => {
    const entry = raw.trim().toLowerCase();
    return entry === '*' || entry === to || (entry.startsWith('@') && entry === domain);
  });
}

export function createMailer(options: {
  transport: MailTransport;
  environment: PingEnvironment;
  /** Staging only: who it may send to (see isAllowlisted). */
  allowlist: readonly string[];
  log?: (line: string) => void;
}): Mailer {
  const log = options.log ?? ((line: string) => console.log(line));
  const staging = options.environment === 'staging';

  return {
    async send(message) {
      if (staging && !isAllowlisted(options.allowlist, message.to)) {
        log('Email not sent: the recipient is not on EMAIL_ALLOWLIST.');
        return 'held';
      }
      const subject = staging ? `[Staging] ${message.subject}` : message.subject;
      try {
        await options.transport.send({ ...message, subject, from: FROM_ADDRESS });
        return 'sent';
      } catch (error) {
        // SMTP errors often quote the address; the cause stays out of logs and Sentry.
        throw new Error(
          `The email could not be sent (${error instanceof Error ? error.name : 'unknown error'})`,
        );
      }
    },
  };
}

export type SmtpSettings = { host: string; port: number; user: string; password: string };

const SMTP_TIMEOUT_MS = 10_000;

/** Any SMTP provider. Port 465 uses TLS from the start; others upgrade with STARTTLS. */
function smtpTransport(settings: SmtpSettings): MailTransport {
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.password },
    // The send is inline in the Admin's request: a stalled relay fails within seconds and
    // the invite shows "Email not sent, Resend", rather than hanging for nodemailer's
    // default minutes past the proxy's timeout.
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
  return {
    async send(mail) {
      await transporter.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    },
  };
}

/**
 * Local development without SMTP: prints the subject and text (which holds any link), but
 * never the address, so a developer can follow an invite link from the terminal.
 */
function logTransport(log: (line: string) => void = console.log): MailTransport {
  return {
    async send(mail) {
      log(`Email (not sent, local): ${mail.subject}\n${mail.text}`);
    },
  };
}

/** Production or staging before the SMTP secrets are set: every send fails, and is reported. */
function unconfiguredTransport(): MailTransport {
  return {
    async send() {
      throw new Error('SMTP is not configured');
    },
  };
}

/** The server's mailer, from its config: SMTP when set, else a local log or a failure. */
export function createMailerFromConfig(settings: EmailSettings): Mailer {
  const transport = settings.smtp
    ? smtpTransport(settings.smtp)
    : settings.environment === 'local'
      ? logTransport()
      : unconfiguredTransport();
  return createMailer({
    transport,
    environment: settings.environment,
    allowlist: settings.allowlist,
  });
}
