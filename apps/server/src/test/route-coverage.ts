// The route-coverage guard: every registered Hono route needs a permission-matrix entry,
// except the short allowlist below (docs/spec/testing.md).
//
// Changing the allowlist weakens the guard: list it under **Permission changes** in the PR.

/** Routes with no matrix entry, by design. */
const ROUTE_ALLOWLIST: readonly string[] = [
  // Uptime checks. Never touches the database.
  'GET /healthz',
  // Better Auth's routes, including sign-in, sign-out, get-session and password reset
  // (POST /api/auth/request-password-reset and POST /api/auth/reset-password, tested
  // directly in auth/password-reset.int.test.ts with expired, used and unknown tokens).
  'GET /api/auth/*',
  'POST /api/auth/*',
  // Middleware on every path: the security headers, and (production only) the built SPA's
  // index.html and static files. Then index.html for client-side routes. None of it
  // answers /api/* or serves data.
  'ALL /*',
  'GET /*',
  // Invite accept (#32): nobody is signed in yet, so there's no actor to put in the
  // matrix. They run as ping_system, and features/staff/accept-routes.int.test.ts tests
  // them directly, with expired, used and unknown tokens.
  'POST /api/invites/lookup',
  'POST /api/invites/accept',
];

type RegisteredRoute = { method: string; path: string };

/**
 * Registered routes that are neither covered by the matrix nor allowlisted. Hono records
 * `app.use` middleware and `app.all` handlers alike, with method ALL, so neither can tell
 * them apart: every ALL entry must be allowlisted, and a real handler belongs on a
 * specific method with matrix rows.
 */
export function uncoveredRoutes(
  routes: readonly RegisteredRoute[],
  covered: ReadonlySet<string>,
  allowlist: readonly string[] = ROUTE_ALLOWLIST,
): string[] {
  const keys = routes.map((route) => `${route.method} ${route.path}`);
  return [...new Set(keys)].filter((key) => !covered.has(key) && !allowlist.includes(key));
}
