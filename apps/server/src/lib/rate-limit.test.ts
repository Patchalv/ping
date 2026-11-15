import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { errorResponse } from './errors';
import { rateLimit } from './rate-limit';

function appWith(limit: { max: number; windowMs: number }, now: () => number) {
  const app = new Hono().post('/try', rateLimit({ name: 'try', ...limit, now }), (c) =>
    c.json({ ok: true }),
  );
  app.onError((error, c) => {
    const known = errorResponse(error);
    return known ? c.json(known.body, known.status) : c.text('boom', 500);
  });
  return app;
}

const from = (ip: string) => ({ method: 'POST', headers: { 'fly-client-ip': ip } });

describe('rateLimit', () => {
  it('allows `max` requests per client IP in a window, then answers 429', async () => {
    const app = appWith({ max: 2, windowMs: 60_000 }, () => 0);
    expect((await app.request('/try', from('10.0.0.1'))).status).toBe(200);
    expect((await app.request('/try', from('10.0.0.1'))).status).toBe(200);
    const refused = await app.request('/try', from('10.0.0.1'));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({
      error: { code: 'rate_limited', message: 'Too many attempts. Wait a minute, then try again.' },
    });
  });

  it('counts each client IP apart', async () => {
    const app = appWith({ max: 1, windowMs: 60_000 }, () => 0);
    expect((await app.request('/try', from('10.0.0.1'))).status).toBe(200);
    expect((await app.request('/try', from('10.0.0.2'))).status).toBe(200);
  });

  it('starts again once the window has passed', async () => {
    let time = 0;
    const app = appWith({ max: 1, windowMs: 60_000 }, () => time);
    expect((await app.request('/try', from('10.0.0.1'))).status).toBe(200);
    expect((await app.request('/try', from('10.0.0.1'))).status).toBe(429);
    time = 60_000;
    expect((await app.request('/try', from('10.0.0.1'))).status).toBe(200);
  });
});
