import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createAuth } from './auth';
import { createDatabase } from './db';
import { ForbiddenError, NotFoundError, ValidationError } from './lib/errors';
import { createStorage } from './lib/storage/storage';
import { offlineAuthEmailServices, offlineInviteServices } from './test/test-app';

// Never connects: these routes don't touch the database.
const database = createDatabase('postgres://nobody@localhost:1/none');
const trustedOrigins = ['http://localhost:3000'];
const invites = offlineInviteServices();
const auth = createAuth(
  database,
  {
    secret: 'unit-test-secret-not-used-for-anything',
    baseUrl: 'http://localhost:3000',
    trustedOrigins,
  },
  offlineAuthEmailServices(),
);

describe('GET /healthz', () => {
  it('answers ok', async () => {
    const res = await createApp({ auth, database, trustedOrigins, invites }).request('/healthz');
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
    const res = await createApp({
      auth,
      database,
      trustedOrigins,
      invites,
      webDistDir: builtSpa(),
    }).request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Ping</title>');
  });

  it('serves built assets', async () => {
    const res = await createApp({
      auth,
      database,
      trustedOrigins,
      invites,
      webDistDir: builtSpa(),
    }).request('/assets/main.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1);');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await createApp({
      auth,
      database,
      trustedOrigins,
      invites,
      webDistDir: builtSpa(),
    }).request('/channels/123');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Ping</title>');
  });

  it('does not answer unknown API paths with the SPA', async () => {
    const res = await createApp({
      auth,
      database,
      trustedOrigins,
      invites,
      webDistDir: builtSpa(),
    }).request('/api/nothing-here');
    expect(res.status).toBe(404);
  });

  it('still answers /healthz', async () => {
    const res = await createApp({
      auth,
      database,
      trustedOrigins,
      invites,
      webDistDir: builtSpa(),
    }).request('/healthz');
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
    const res = await createApp({ auth, database, trustedOrigins, invites }).request('/healthz');
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
    const res = await createApp({ auth, database, trustedOrigins, invites, sentry }).request(
      '/healthz',
    );
    expect(csp(res).get('connect-src')).toBe("'self' https://o42.ingest.de.sentry.io");
    expect(csp(res).get('script-src')).toBe("'self'");
  });

  it('lets images come only from Ping, data: and blob: URLs, and object storage', async () => {
    const without = await createApp({ auth, database, trustedOrigins, invites }).request(
      '/healthz',
    );
    expect(csp(without).get('img-src')).toBe("'self' data: blob:");

    const storage = createStorage({
      endpoint: 'https://account.eu.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'ping-prod',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
    const res = await createApp({ auth, database, trustedOrigins, invites, storage }).request(
      '/healthz',
    );
    expect(csp(res).get('img-src')).toBe(
      "'self' data: blob: https://account.eu.r2.cloudflarestorage.com",
    );
    // Scripts and connections stay same-origin: storage only serves images.
    expect(csp(res).get('script-src')).toBe("'self'");
    expect(csp(res).get('connect-src')).toBe("'self'");
  });

  it('sends the same CSP with the SPA', async () => {
    const res = await createApp({
      auth,
      database,
      trustedOrigins,
      invites,
      sentry,
      webDistDir: builtSpa(),
    }).request('/channels/123');
    expect(csp(res).get('default-src')).toBe("'self'");
    expect(csp(res).get('connect-src')).toBe("'self' https://o42.ingest.de.sentry.io");
  });
});

describe('Sentry settings for the SPA', () => {
  it.each(['/', '/index.html', '/channels/123'])(
    'puts the DSN and environment in %s',
    async (path) => {
      const res = await createApp({
        auth,
        database,
        trustedOrigins,
        invites,
        sentry,
        webDistDir: builtSpa(),
      }).request(path);
      const html = await res.text();
      expect(html).toContain(
        '<meta name="sentry-dsn" content="https://abc123@o42.ingest.de.sentry.io/7">',
      );
      expect(html).toContain('<meta name="sentry-environment" content="staging">');
      expect(html).toContain('<title>Ping</title>');
    },
  );

  it('leaves them out when Sentry is off', async () => {
    const res = await createApp({
      auth,
      database,
      trustedOrigins,
      invites,
      webDistDir: builtSpa(),
    }).request('/');
    expect(await res.text()).not.toContain('sentry-dsn');
  });

  it('escapes the values', async () => {
    const res = await createApp({
      auth,
      database,
      trustedOrigins,
      invites,
      sentry: { dsn: 'https://a@o1.ingest.de.sentry.io/1?"><script>', environment: 'staging' },
      webDistDir: builtSpa(),
    }).request('/');
    expect(await res.text()).toContain(
      'content="https://a@o1.ingest.de.sentry.io/1?&quot;&gt;&lt;script&gt;"',
    );
  });
});

describe('the environment in the SPA', () => {
  it.each(['/', '/index.html', '/channels/123'])(
    'marks %s as staging, in the title and a meta tag',
    async (path) => {
      const res = await createApp({
        auth,
        database,
        trustedOrigins,
        invites,
        environment: 'staging',
        webDistDir: builtSpa(),
      }).request(path);
      const html = await res.text();
      expect(html).toContain('<title>Ping (Staging)</title>');
      expect(html).not.toContain('<title>Ping</title>');
      expect(html).toContain('<meta name="ping-environment" content="staging">');
    },
  );

  it("marks the web app's real index.html", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ping-web-dist-'));
    copyFileSync(
      fileURLToPath(new URL('../../web/index.html', import.meta.url)),
      join(dir, 'index.html'),
    );
    const res = await createApp({
      auth,
      database,
      trustedOrigins,
      invites,
      environment: 'staging',
      webDistDir: dir,
    }).request('/');
    expect(await res.text()).toContain('<title>Ping (Staging)</title>');
  });

  it.each(['production', 'local'] as const)(
    'leaves index.html as it is in %s',
    async (environment) => {
      const res = await createApp({
        auth,
        database,
        trustedOrigins,
        invites,
        environment,
        webDistDir: builtSpa(),
      }).request('/');
      const html = await res.text();
      expect(html).toContain('<title>Ping</title>');
      expect(html).not.toContain('ping-environment');
      expect(html).not.toContain('Staging');
    },
  );
});

describe('errors', () => {
  function appThatThrows(error: unknown) {
    const reported: unknown[] = [];
    const app = createApp({
      auth,
      database,
      trustedOrigins,
      invites,
      captureError: (e) => reported.push(e),
    });
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
    const res = await createApp({ auth, database, trustedOrigins, invites }).request(
      '/api/channels',
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'unauthenticated', message: 'Sign in to continue.' },
    });
  });

  it('lists each failing field of a validation error', async () => {
    const { app } = appThatThrows(
      new ValidationError('Give the Channel a name.', [
        { path: 'name', message: 'Give the Channel a name.' },
      ]),
    );
    const res = await app.request('/api/test-only/throw');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'validation',
        message: 'Give the Channel a name.',
        issues: [{ path: 'name', message: 'Give the Channel a name.' }],
      },
    });
  });

  it("puts Hono's own errors in the same envelope, and does not report them", async () => {
    const { app, reported } = appThatThrows(
      new HTTPException(400, { message: 'Malformed JSON in request body' }),
    );
    const res = await app.request('/api/test-only/throw');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'validation', message: 'Malformed JSON in request body' },
    });
    expect(reported).toEqual([]);
  });

  it('answers an unknown API path in the same envelope', async () => {
    const res = await createApp({ auth, database, trustedOrigins, invites }).request(
      '/api/nothing-here',
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });
});

describe('the Origin check', () => {
  const app = () => {
    const app = createApp({ auth, database, trustedOrigins, invites });
    app.post('/api/test-only/echo', (c) => c.json({ ok: true }));
    return app;
  };
  const formPost = (origin: string) =>
    app().request('/api/test-only/echo', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1',
    });

  it('refuses a form post from another origin, in the error envelope', async () => {
    const res = await formPost('https://evil.example');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('lets a form post from a trusted origin through', async () => {
    expect((await formPost('http://localhost:3000')).status).toBe(200);
  });
});

describe('Cache-Control on the API', () => {
  const noStore = (res: Response) => res.headers.get('cache-control');

  it('sends no-store on a successful API response', async () => {
    const app = createApp({ auth, database, trustedOrigins, invites });
    app.get('/api/test-only/ok', (c) => c.json({ ok: true }));
    expect(noStore(await app.request('/api/test-only/ok'))).toBe('no-store');
  });

  it.each([
    ['a typed 404', new NotFoundError()],
    ['a validation 400', new ValidationError('Give the Channel a name.')],
    ["one of Hono's own errors", new HTTPException(400, { message: 'Malformed JSON' })],
    ['an unknown error', new Error('boom')],
  ])('sends no-store on %s', async (_name, error) => {
    const app = createApp({ auth, database, trustedOrigins, invites });
    app.get('/api/test-only/throw', () => {
      throw error;
    });
    expect(noStore(await app.request('/api/test-only/throw'))).toBe('no-store');
  });

  it('sends no-store on a 401 and an unknown API path', async () => {
    const app = createApp({ auth, database, trustedOrigins, invites });
    expect(noStore(await app.request('/api/channels'))).toBe('no-store');
    expect(noStore(await app.request('/api/nothing-here'))).toBe('no-store');
  });

  it('leaves non-API responses alone', async () => {
    const res = await createApp({ auth, database, trustedOrigins, invites }).request('/healthz');
    expect(noStore(res)).toBeNull();
  });
});
