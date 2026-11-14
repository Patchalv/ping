import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createAuth } from './auth';
import { createDatabase } from './db';

// Never connects: these routes don't touch the database.
const auth = createAuth(createDatabase('postgres://nobody@localhost:1/none'), {
  secret: 'unit-test-secret-not-used-for-anything',
  baseUrl: 'http://localhost:3000',
  trustedOrigins: ['http://localhost:3000'],
});

describe('GET /healthz', () => {
  it('answers ok', async () => {
    const res = await createApp({ auth }).request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

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
    const res = await createApp({ auth, webDistDir: builtSpa() }).request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Ping</title>');
  });

  it('serves built assets', async () => {
    const res = await createApp({ auth, webDistDir: builtSpa() }).request('/assets/main.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1);');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await createApp({ auth, webDistDir: builtSpa() }).request('/channels/123');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Ping</title>');
  });

  it('does not answer unknown API paths with the SPA', async () => {
    const res = await createApp({ auth, webDistDir: builtSpa() }).request('/api/nothing-here');
    expect(res.status).toBe(404);
  });

  it('still answers /healthz', async () => {
    const res = await createApp({ auth, webDistDir: builtSpa() }).request('/healthz');
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('security headers', () => {
  const sentry = { dsn: 'https://abc123@o42.ingest.de.sentry.io/7', environment: 'staging' };

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
    const res = await createApp({ auth }).request('/healthz');
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
    const res = await createApp({ auth, sentry }).request('/healthz');
    expect(csp(res).get('connect-src')).toBe("'self' https://o42.ingest.de.sentry.io");
    expect(csp(res).get('script-src')).toBe("'self'");
  });

  it('sends the same CSP with the SPA', async () => {
    const res = await createApp({ auth, sentry, webDistDir: builtSpa() }).request('/channels/123');
    expect(csp(res).get('default-src')).toBe("'self'");
    expect(csp(res).get('connect-src')).toBe("'self' https://o42.ingest.de.sentry.io");
  });
});

describe('Sentry settings for the SPA', () => {
  const sentry = { dsn: 'https://abc123@o42.ingest.de.sentry.io/7', environment: 'staging' };

  it.each(['/', '/index.html', '/channels/123'])(
    'puts the DSN and environment in %s',
    async (path) => {
      const res = await createApp({ auth, sentry, webDistDir: builtSpa() }).request(path);
      const html = await res.text();
      expect(html).toContain(
        '<meta name="sentry-dsn" content="https://abc123@o42.ingest.de.sentry.io/7">',
      );
      expect(html).toContain('<meta name="sentry-environment" content="staging">');
      expect(html).toContain('<title>Ping</title>');
    },
  );

  it('leaves them out when Sentry is off', async () => {
    const res = await createApp({ auth, webDistDir: builtSpa() }).request('/');
    expect(await res.text()).not.toContain('sentry-dsn');
  });

  it('escapes the values', async () => {
    const res = await createApp({
      auth,
      sentry: { dsn: 'https://a@o1.ingest.de.sentry.io/1', environment: '"><script>' },
      webDistDir: builtSpa(),
    }).request('/');
    expect(await res.text()).toContain('content="&quot;&gt;&lt;script&gt;"');
  });
});
