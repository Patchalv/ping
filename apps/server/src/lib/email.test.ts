import { describe, expect, it, vi } from 'vitest';
import { createMailer, type OutgoingMail } from './email';

function recordingTransport() {
  const sent: OutgoingMail[] = [];
  return { sent, transport: { send: async (mail: OutgoingMail) => void sent.push(mail) } };
}

const message = {
  to: 'Rosa.Ferrer@example.com',
  subject: 'You’re invited to Ping',
  text: 'Open the link.',
  html: '<p>Open the link.</p>',
};

describe('createMailer', () => {
  it('sends from Ping’s no-reply address, with no Reply-To', async () => {
    const { sent, transport } = recordingTransport();
    await createMailer({ transport, environment: 'production', allowlist: [] }).send(message);
    expect(sent).toEqual([{ ...message, from: 'Ping <no-reply@ping.bypatrick.app>' }]);
    expect(sent[0]).not.toHaveProperty('replyTo');
  });

  it('sends to anyone in production, whatever the allowlist', async () => {
    const { sent, transport } = recordingTransport();
    await createMailer({
      transport,
      environment: 'production',
      allowlist: ['someone.else@example.com'],
    }).send(message);
    expect(sent).toHaveLength(1);
  });

  it('starts subjects with [Staging] on staging and sends to allowlisted addresses, ignoring case', async () => {
    const { sent, transport } = recordingTransport();
    await createMailer({
      transport,
      environment: 'staging',
      allowlist: ['rosa.ferrer@example.com'],
    }).send(message);
    expect(sent.map((mail) => mail.subject)).toEqual(['[Staging] You’re invited to Ping']);
  });

  it('says an email was sent when it went out', async () => {
    const { transport } = recordingTransport();
    const mailer = createMailer({ transport, environment: 'production', allowlist: [] });
    expect(await mailer.send(message)).toBe('sent');
  });

  it.each([
    ['everyone, with *', ['*'], 'rosa.ferrer@example.com', true],
    ['a whole domain, with @domain', ['@example.com'], 'Rosa.Ferrer@Example.com', true],
    ['not a look-alike domain', ['@example.com'], 'rosa@evil-example.com', false],
    [
      'not a domain that only starts the same',
      ['@example.com'],
      'rosa@example.com.evil.net',
      false,
    ],
    [
      'an exact address among others',
      ['@spark.test', 'rosa.ferrer@example.com'],
      'rosa.ferrer@example.com',
      true,
    ],
    ['nobody, with an empty list', [], 'rosa.ferrer@example.com', false],
  ])('on staging, lets the allowlist allow %s', async (_name, allowlist, to, delivered) => {
    const { sent, transport } = recordingTransport();
    const result = await createMailer({
      transport,
      environment: 'staging',
      allowlist,
      log: vi.fn(),
    }).send({
      ...message,
      to,
    });
    expect(result).toBe(delivered ? 'sent' : 'held');
    expect(sent).toHaveLength(delivered ? 1 : 0);
  });

  it('logs, without the address, and sends nothing to an address off the staging allowlist', async () => {
    const { sent, transport } = recordingTransport();
    const log = vi.fn();
    const result = await createMailer({
      transport,
      environment: 'staging',
      allowlist: [],
      log,
    }).send(message);
    expect(result).toBe('held');
    expect(sent).toEqual([]);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).not.toMatch(/rosa/i);
  });

  it('lets a transport failure reach the caller, without the address in the error', async () => {
    const failing = {
      send: async () => {
        throw new Error('550 rejected Rosa.Ferrer@example.com');
      },
    };
    const send = createMailer({
      transport: failing,
      environment: 'production',
      allowlist: [],
    }).send(message);
    await expect(send).rejects.toThrow('The email could not be sent');
    await expect(send).rejects.not.toThrow(/rosa/i);
  });
});
