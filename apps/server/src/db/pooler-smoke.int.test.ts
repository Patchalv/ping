// The pooler smoke check, run here against the local stack. After each staging deploy the
// same check runs through Neon's real pooler (db/cli/pooler-smoke.ts).
import { describe, expect, it } from 'vitest';
import { checkPoolerIsolation } from './pooler-smoke';
import { testUrls } from './test-support';

describe('checkPoolerIsolation', () => {
  it('passes through PgBouncer in transaction mode, where connections share backends', async () => {
    const result = await checkPoolerIsolation(testUrls().appViaPgBouncer, { rounds: 5 });
    expect(result.leaks).toEqual([]);
    expect(result.sharedBackend).toBe(true);
    expect(result.outcome).toBe('passed');
    // 4 connections × 5 rounds × 2 (sequential, then concurrent).
    expect(result.transactions).toBe(40);
  });

  it('is inconclusive on direct connections, where no backend is ever shared', async () => {
    const result = await checkPoolerIsolation(testUrls().app, { rounds: 2 });
    expect(result.leaks).toEqual([]);
    expect(result.sharedBackend).toBe(false);
    expect(result.outcome).toBe('inconclusive');
  });
});
