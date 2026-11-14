// Route middleware: the signed-in, active Staff member the request acts for. Put it first
// on every route that needs one, before validation, so a request with no session gets a
// 401 rather than a 400. Register it per route, never with app.use (the route-coverage
// guard refuses unlisted ALL routes).
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { type Database, schema } from '../db';
import { UnauthenticatedError } from '../lib/errors';
import type { Actor } from '../permissions/actor';
import type { Auth } from './index';

export type ActorEnv = { Variables: { actor: Actor } };

export function signedIn(auth: Auth, database: Database) {
  return createMiddleware<ActorEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new UnauthenticatedError();
    const staffId = session.user.id;
    // Read through the staff_member policy, which shows a Deactivated Staff member
    // nothing: a session that outlived a Deactivation acts for nobody.
    const rows = await database.withStaffTx(staffId, (tx) =>
      tx
        .select({ role: schema.staffMember.role })
        .from(schema.staffMember)
        .where(eq(schema.staffMember.id, staffId)),
    );
    const staff = rows[0];
    if (!staff) throw new UnauthenticatedError();
    c.set('actor', { staffId, role: staff.role });
    await next();
  });
}
