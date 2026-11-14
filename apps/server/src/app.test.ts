import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createAuth } from './auth';
import { createDatabase } from './db';
import { ForbiddenError, NotFoundError } from './lib/errors';

// Never connects: these routes don't touch the database.
const database = createDatabase('postgres://nobody@localhost:1/none');
const auth = createAuth(database, {
  secret: 'unit-test-secret-not-used-for-anything',
  baseUrl: 'http://localhost:3000',
  trustedOrigins: ['http://localhost:3000'],
});

describe('GET /healthz', () => {
  it('answers ok', async () => {
    const res = await createApp({ auth, database }).request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

const sentry = { dsn: 'https://abc123@o42.ingest.de.sentry.io/7', environment: 'staging' } as const;

function builtSpa(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ping-web-dist-'));
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><head><title>Ping</title></head><body></body></html>',
  );
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'main.js'), 'console.log(1);');
  return dir;
}

describe('serving the built SPA', () => {
  it('serves index.html at the root', async () => {
    const res = await createApp({ auth, database, webDistDir: builtSpa() }).request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Ping</title>');
  });

  it('serves built assets', async () => {
    const res = await createApp({ auth, database, webDistDir: builtSpa() }).request(
      '/assets/main.js',
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1);');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await createApp({ auth, database, webDistDir: builtSpa() }).request(
      '/channels/123',
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Ping</title>');
  });

  it('does not answer unknown API paths with the SPA', async () => {
    const res = await createApp({ auth, database, webDistDir: builtSpa() }).request(
      '/api/nothing-here',
    );
    expect(res.status).toBe(404);
  });

  it('still answers /healthz', async () => {
    const res = await createApp({ auth, database, webDistDir: builtSpa() }).request('/healthz');
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('security headers', () => {
  function csp(res: Response): Map<string, string> {
    const header = res.headers.get('content-security-policy') ?? '';
    return new Map(
      header
        .split(';')
        .map((directive) => directive.trim())
        .filter(Boolean)
        .map((directive) => {
          const [name = '', ...values] = directive.split(/\s+/);
          return [name, values.join(' ')];
        }),
    );
  }

  it('sends a strict same-origin CSP on API responses', async () => {
    const res = await createApp({ auth, database }).request('/healthz');
    const policy = csp(res);
    expect(policy.get('default-src')).toBe("'self'");
    expect(policy.get('script-src')).toBe("'self'");
    expect(policy.get('connect-src')).toBe("'self'");
    expect(policy.get('object-src')).toBe("'none'");
    expect(policy.get('base-uri')).toBe("'self'");
    expect(policy.get('form-action')).toBe("'self'");
    expect(policy.get('frame-ancestors')).toBe("'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('allows Sentry as the only third-party origin', async () => {
    const res = await createApp({ auth, database, sentry }).request('/healthz');
    expect(csp(res).get('connect-src')).toBe("'self' https://o42.ingest.de.sentry.io");
    expect(csp(res).get('script-src')).toBe("'self'");
  });

  it('sends the same CSP with the SPA', async () => {
    const res = await createApp({ auth, database, sentry, webDistDir: builtSpa() }).request(
      '/channels/123',
    );
    expect(csp(res).get('default-src')).toBe("'self'");
    expect(csp(res).get('connect-src')).toBe("'self' https://o42.ingest.de.sentry.io");
  });
});

describe('Sentry settings for the SPA', () => {
  it.each(['/', '/index.html', '/channels/123'])(
    'puts the DSN and environment in %s',
    async (path) => {
      const res = await createApp({ auth, database, sentry, webDistDir: builtSpa() }).request(path);
      const html = await res.text();
      expect(html).toContain(
        '<meta name="sentry-dsn" content="https://abc123@o42.ingest.de.sentry.io/7">',
      );
      expect(html).toContain('<meta name="sentry-environment" content="staging">');
      expect(html).toContain('<title>Ping</title>');
    },
  );

  it('leaves them out when Sentry is off', async () => {
    const res = await createApp({ auth, database, webDistDir: builtSpa() }).request('/');
    expect(await res.text()).not.toContain('sentry-dsn');
  });

  it('escapes the values', async () => {
    const res = await createApp({
      auth,
      database,
      sentry: { dsn: 'https://a@o1.ingest.de.sentry.io/1?"><script>', environment: 'staging' },
      webDistDir: builtSpa(),
    }).request('/');
    expect(await res.text()).toContain(
      'content="https://a@o1.ingest.de.sentry.io/1?&quot;&gt;&lt;script&gt;"',
    );
  });
});

describe('errors', () => {
  function appThatThrows(error: unknown) {
    const reported: unknown[] = [];
    const app = createApp({ auth, database, captureError: (e) => reported.push(e) });
    app.get('/api/test-only/throw', () => {
      throw error;
    });
    return { app, reported };
  }

  it('maps a typed error to its status and message, and does not report it', async () => {
    const { app, reported } = appThatThrows(new ForbiddenError('Only Channel admins can do that.'));
    const res = await app.request('/api/test-only/throw');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Only Channel admins can do that.' },
    });
    expect(reported).toEqual([]);
  });

  it('answers a hidden Channel with a plain 404', async () => {
    const { app } = appThatThrows(new NotFoundError());
    const res = await app.request('/api/test-only/throw');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });

  it('answers an unknown error with a bare 500 and reports it', async () => {
    const boom = new Error('duplicate key value violates unique constraint (email)=(a@b.c)');
    const { app, reported } = appThatThrows(boom);
    const res = await app.request('/api/test-only/throw');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Internal Server Error');
    expect(reported).toEqual([boom]);
  });

  it('answers 401 to a Channel route with no session, without touching the database', async () => {
    const res = await createApp({ auth, database }).request('/api/channels');
    expect(res.status).toBe(401);
  });
});
