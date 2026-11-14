import { describe, expect, it } from 'vitest';
import { scrubSentryBreadcrumb, scrubSentryEvent } from './sentry-scrub';

describe('scrubSentryEvent', () => {
  it('drops request bodies, cookies, query strings and credential headers', () => {
    const scrubbed = scrubSentryEvent({
      message: 'boom',
      request: {
        url: 'https://ping.bypatrick.app/api/auth/sign-in/email',
        method: 'POST',
        data: '{"email":"jordi.puig@example.com","password":"hunter2hunter2"}',
        cookies: { 'better-auth.session_token': 'abc' },
        query_string: 'email=jordi.puig%40example.com',
        headers: {
          cookie: 'better-auth.session_token=abc',
          Authorization: 'Bearer abc',
          'content-type': 'application/json',
        },
      },
    });

    expect(scrubbed.request).toEqual({
      url: 'https://ping.bypatrick.app/api/auth/sign-in/email',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(scrubbed.message).toBe('boom');
  });

  it('keeps only the user id', () => {
    const scrubbed = scrubSentryEvent({
      user: {
        id: 'staff-1',
        email: 'jordi.puig@example.com',
        ip_address: '10.0.0.1',
        username: 'Jordi',
      },
    });
    expect(scrubbed.user).toEqual({ id: 'staff-1' });
  });

  it('removes email addresses from the message, exception values and breadcrumbs', () => {
    const scrubbed = scrubSentryEvent({
      message: 'No Staff member for Jordi.Puig@example.com',
      exception: { values: [{ type: 'Error', value: 'duplicate key: anna@example.org' }] },
      breadcrumbs: [{ message: 'signing in anna@example.org', category: 'console' }],
    });
    expect(scrubbed.message).toBe('No Staff member for [email]');
    expect(scrubbed.exception?.values?.[0]?.value).toBe('duplicate key: [email]');
    expect(scrubbed.breadcrumbs?.[0]?.message).toBe('signing in [email]');
  });

  it('drops query parameters from failed-query errors, which carry message bodies', () => {
    const scrubbed = scrubSentryEvent({
      exception: {
        values: [
          {
            type: 'DrizzleQueryError',
            value:
              'Failed query: insert into "thread" ("body") values ($1)\nparams: Secret body text',
          },
        ],
      },
    });
    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      'Failed query: insert into "thread" ("body") values ($1)\nparams: [redacted]',
    );
  });

  it('drops breadcrumb data, where console arguments and fetch URLs live', () => {
    const crumb = scrubSentryBreadcrumb({
      category: 'console',
      message: 'saving anna@example.org',
      data: { arguments: ['saving', 'anna@example.org', { body: 'Secret body text' }] },
    });
    expect(crumb).toEqual({ category: 'console', message: 'saving [email]' });
  });

  it('drops extra data, which can carry anything', () => {
    const scrubbed = scrubSentryEvent({ message: 'boom', extra: { body: 'Secret body text' } });
    expect(scrubbed).toEqual({ message: 'boom' });
  });

  it('leaves an event with nothing to scrub alone', () => {
    expect(scrubSentryEvent({ message: 'plain' })).toEqual({ message: 'plain' });
  });
});
