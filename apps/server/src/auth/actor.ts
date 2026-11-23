// Who a request acts for, in two steps:
//
// 1. `signedIn(auth)`: route middleware that checks the session and answers 401 without
//    one. It runs first on the route, so a request with no session never reaches
//    validation. It touches no Ping table.
// 2. `withActorTx(c, ({ tx, actor }) => …)`: the route's one transaction. It sets
//    app.staff_id, reads the Staff member's role in that same transaction (401 when
//    they've been Deactivated) and hands the work one context, so the actor and
//    app.staff_id can never disagree.
//
// withActorTx accepts only a Context that has been through signedIn, so a route that
// forgets the middleware fails to compile.
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Database, Tx } from '../db';
import { UnauthenticatedError } from '../lib/errors';
import type { Actor } from '../permissions/actor';
import type { Auth } from './index';
import { findActiveStaffRole } from './queries';

type SessionEnv = { Variables: { session: { staffId: string } } };

export function signedIn(auth: Auth) {
  return createMiddleware<SessionEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new UnauthenticatedError();
    c.set('session', { staffId: session.user.id });
    await next();
  });
}

/** What every query in a request takes: its transaction and the Staff member it acts for. */
export type ActorTx = { tx: Tx; actor: Actor };

/**
 * The Staff member `staffId` as an Actor, read in `tx` (whose app.staff_id is theirs), or
 * undefined when they act for nobody: Deactivated or unknown.
 */
export async function findActor(tx: Tx, staffId: string): Promise<Actor | undefined> {
  const role = await findActiveStaffRole(tx, staffId);
  return role && { staffId, role };
}

export function createWithActorTx(database: Database) {
  return <T>(c: Context<SessionEnv>, fn: (ctx: ActorTx) => Promise<T>): Promise<T> => {
    const { staffId } = c.var.session;
    return database.withStaffTx(staffId, async (tx) => {
      const actor = await findActor(tx, staffId);
      if (!actor) throw new UnauthenticatedError();
      return fn({ tx, actor });
    });
  };
}
