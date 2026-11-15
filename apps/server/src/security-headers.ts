// Baseline security headers (platform.md › Baseline security): Hono's secureHeaders with a
// strict same-origin CSP. Sentry's ingest origin is the only third-party origin allowed,
// and only when Sentry is on.
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';

export function securityHeaders(sentryDsn: string | undefined) {
  const self = "'self'";
  const connectSrc = sentryDsn ? [self, new URL(sentryDsn).origin] : [self];
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: [self],
      scriptSrc: [self],
      styleSrc: [self],
      imgSrc: [self, 'data:'],
      fontSrc: [self],
      connectSrc,
      objectSrc: ["'none'"],
      baseUri: [self],
      formAction: [self],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  });
}

/**
 * `Cache-Control: no-store` on every /api response, errors included: no browser or proxy
 * keeps a copy of a Staff member's data, such as a Private channel's.
 */
export const noStoreOnApi = createMiddleware(async (c, next) => {
  await next();
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
});
