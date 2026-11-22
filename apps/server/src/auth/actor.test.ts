import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db';
import { offlineAuthEmailServices } from '../test/test-app';
import { createWithActorTx, signedIn } from './actor';
import { createAuth } from './index';

// Never connects: nothing here runs a query.
const database = createDatabase('postgres://nobody@localhost:1/none');
const auth = createAuth(
  database,
  {
    secret: 'unit-test-secret-not-used-for-anything',
    baseUrl: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:3000'],
  },
  offlineAuthEmailServices(),
);
const withActorTx = createWithActorTx(database);

describe('withActorTx', () => {
  it('compiles only on a route that runs signedIn first', () => {
    // Checked by tsc, not at run time: the handlers are never called.
    new Hono().get('/with', signedIn(auth), (c) => withActorTx(c, async () => c.json({})));
    new Hono().get('/without', (c) =>
      // @ts-expect-error -- no signedIn middleware, so there is no session to act for
      withActorTx(c, async () => c.json({})),
    );
    expect(withActorTx).toBeTypeOf('function');
  });
});
