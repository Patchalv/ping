// A fixed-window rate limiter for Ping's own routes, keyed by the client's IP. Better
// Auth's limiter covers only /api/auth/*. Counts live in memory: Ping runs exactly one
// Machine (fly.prod.toml), like Better Auth's own limiter.
import { createMiddleware } from 'hono/factory';
import { clientIp } from '../auth/client-ip';
import { TooManyRequestsError } from './errors';

type Window = { start: number; count: number };

export function rateLimit(options: {
  /** Separates one route's counts from another's. */
  name: string;
  max: number;
  windowMs: number;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();

  return createMiddleware(async (c, next) => {
    const time = now();
    // Without a trusted IP header (local development), everyone shares one bucket.
    const key = `${options.name}:${clientIp(c.req.raw.headers) ?? 'unknown'}`;
    const current = windows.get(key);
    if (!current || time - current.start >= options.windowMs) {
      // Forget finished windows so the map can't grow without bound.
      for (const [other, window] of windows) {
        if (time - window.start >= options.windowMs) windows.delete(other);
      }
      windows.set(key, { start: time, count: 1 });
    } else if (current.count >= options.max) {
      throw new TooManyRequestsError();
    } else {
      current.count += 1;
    }
    await next();
  });
}
