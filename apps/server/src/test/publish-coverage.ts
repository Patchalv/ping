// The publish-coverage check: every mutating route (POST, PUT, PATCH, DELETE) must call
// publish() (lib/sse/publish.ts), so open screens hear about the change. The check runs
// each route's permission-matrix allow rows and fails on a route none of them published
// from (publish-coverage.int.test.ts).
//
// Changing the exemptions weakens the check: list it under **Permission changes** in the PR.

/** Mutating routes that publish nothing, or that the matrix can't run, and why. */
export const PUBLISH_EXEMPT: readonly string[] = [
  // Better Auth's routes: signing in and out and password reset change nothing other
  // Staff members see.
  'POST /api/auth/*',
  // Reads an invite token; changes nothing.
  'POST /api/invites/lookup',
  // Outside the matrix (route-coverage.ts says why). Their own tests assert they publish:
  // features/staff/accept-routes.int.test.ts and profile-routes.int.test.ts.
  'POST /api/invites/accept',
  'POST /api/email-change/confirm',
  // Only emails a link: the email changes, and publishes, when the link is opened
  // (POST /api/email-change/confirm).
  'POST /api/staff/:staffId/email',
  // Adds a pending Attachment, which only its uploader can see, so no other screen has
  // anything to hear. Saving the post attaches it, and that route publishes.
  'POST /api/channels/:channelId/attachments',
];

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The mutating routes that neither published nor are exempt. */
export function unpublishedRoutes(
  routes: readonly { method: string; path: string }[],
  { published, exempt }: { published: ReadonlySet<string>; exempt: readonly string[] },
): string[] {
  const keys = routes
    .filter((route) => MUTATING.has(route.method))
    .map((route) => `${route.method} ${route.path}`);
  return [...new Set(keys)].filter((key) => !published.has(key) && !exempt.includes(key));
}
