import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createAuth } from '../auth';
import { createDatabase } from '../db';
import { coveredRoutes } from './permission-matrix/matrix';
import { uncoveredRoutes } from './route-coverage';

// The real app, as production builds it: serving a built SPA. Building it never connects
// to the database.
function realApp() {
  const webDistDir = mkdtempSync(join(tmpdir(), 'ping-route-coverage-'));
  writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><title>Ping</title>');
  const database = createDatabase('postgres://nobody@localhost:1/none');
  const auth = createAuth(database, {
    secret: 'route-coverage-test-secret-not-used',
    baseUrl: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:3000'],
  });
  return createApp({ auth, database, trustedOrigins: ['http://localhost:3000'], webDistDir });
}

describe('route-coverage guard', () => {
  it('finds a permission-matrix entry or an allowlist entry for every registered route', () => {
    expect(uncoveredRoutes(realApp().routes, coveredRoutes())).toEqual([]);
  });

  it('fails on a route with no matrix entry', () => {
    const app = realApp();
    app.post('/api/test-only/example', (c) => c.json({}));
    expect(uncoveredRoutes(app.routes, coveredRoutes())).toEqual(['POST /api/test-only/example']);
  });

  it('passes a route once the matrix covers it', () => {
    const app = realApp();
    app.post('/api/test-only/example', (c) => c.json({}));
    expect(
      uncoveredRoutes(app.routes, new Set([...coveredRoutes(), 'POST /api/test-only/example'])),
    ).toEqual([]);
  });

  it('checks each method of a path apart', () => {
    const app = realApp();
    app.get('/api/test-only/example', (c) => c.json({}));
    app.post('/api/test-only/example', (c) => c.json({}));
    expect(
      uncoveredRoutes(app.routes, new Set([...coveredRoutes(), 'GET /api/test-only/example'])),
    ).toEqual(['POST /api/test-only/example']);
  });

  it('fails on a handler registered for every method', () => {
    const app = realApp();
    app.all('/api/x', (c) => c.json({}));
    expect(uncoveredRoutes(app.routes, coveredRoutes())).toEqual(['ALL /api/x']);
  });

  it('fails on middleware that is not allowlisted, since Hono records it like app.all', () => {
    const app = realApp();
    app.use('/api/*', async (_c, next) => next());
    expect(uncoveredRoutes(app.routes, coveredRoutes())).toEqual(['ALL /api/*']);
  });
});
