// The publish-coverage check (publish-coverage.ts): runs every mutating route's
// permission-matrix allow rows through the real app and fails on a route that never
// called publish().
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveHub } from '../lib/sse/publish';
import { MATRIX } from './permission-matrix/matrix';
import { runRow } from './permission-matrix/run-row';
import { PUBLISH_EXEMPT, unpublishedRoutes } from './publish-coverage';
import { createTestApp, type TestApp } from './test-app';

describe('publish-coverage check', () => {
  let testApp: TestApp;
  beforeAll(() => {
    testApp = createTestApp();
  });
  afterAll(async () => {
    await testApp.close();
  });

  it('finds a publish() for every mutating route', async () => {
    const published = new Set<string>();
    const allowRows = MATRIX.filter((row) => row.expect.allow && !row.route.startsWith('GET '));
    for (const row of allowRows) {
      if (published.has(row.route)) continue;
      let heard = false;
      const stop = liveHub.watch(() => {
        heard = true;
      });
      try {
        await runRow(testApp, row);
      } finally {
        stop();
      }
      if (heard) published.add(row.route);
    }
    expect(unpublishedRoutes(testApp.app.routes, { published, exempt: PUBLISH_EXEMPT })).toEqual(
      [],
    );
  });
});
