// Sending email (platform.md › Email): inline over SMTP, with no queue. One mailer applies
// Ping's rules to every message; the transport underneath is any SMTP provider (Brevo in
// staging and prod), a local log, or a fake in tests. Nothing in tests sends real mail.
//
// - Every message goes from Ping's no-reply address, with no Reply-To.
// - On staging, subjects start with [Staging], and only addresses on EMAIL_ALLOWLIST are
//   sent to; any other is logged, without the address, and dropped.
// - A failure reaches the caller as an error that never holds the address, so the caller
//   can mark the invite and report to Sentry.
import nodemailer from 'nodemailer';
import type { EmailSettings } from '../config';

export const FROM_ADDRESS = 'Ping <no-reply@ping.bypatrick.app>';

/** What a caller asks to send. */
export type MailMessage = { to: string; subject: string; text: string; html: string };

/** What reaches the transport. */
export type OutgoingMail = MailMessage & { from: string };

export type MailTransport = { send(mail: OutgoingMail): Promise<void> };

export type Mailer = { send(message: MailMessage): Promise<void> };

export type MailEnvironment = 'production' | 'staging' | 'local';

export function createMailer(options: {
  transport: MailTransport;
  environment: MailEnvironment;
  /** Staging only: the addresses it may send to. */
  allowlist: readonly string[];
  log?: (line: string) => void;
}): Mailer {
  const allowed = new Set(options.allowlist.map((address) => address.trim().toLowerCase()));
  const log = options.log ?? ((line: string) => console.log(line));
  const staging = options.environment === 'staging';

  return {
    async send(message) {
      if (staging && !allowed.has(message.to.trim().toLowerCase())) {
        log('Email not sent: the recipient is not on EMAIL_ALLOWLIST.');
        return;
      }
      const subject = staging ? `[Staging] ${message.subject}` : message.subject;
      try {
        await options.transport.send({ ...message, subject, from: FROM_ADDRESS });
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

/** Any SMTP provider. Port 465 uses TLS from the start; others upgrade with STARTTLS. */
export function smtpTransport(settings: SmtpSettings): MailTransport {
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.password },
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
export function logTransport(log: (line: string) => void = console.log): MailTransport {
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
