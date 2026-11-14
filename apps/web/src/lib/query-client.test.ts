import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client';
import { createQueryClient, shouldRetry } from './query-client';

describe('shouldRetry', () => {
  it.each([400, 401, 403, 404, 409])('never retries a %i: the answer will not change', (status) => {
    expect(shouldRetry(0, new ApiError(status, 'no'))).toBe(false);
  });

  it('retries a failed network call or a 5xx twice', () => {
    expect(shouldRetry(0, new ApiError(0, 'offline'))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'down'))).toBe(true);
    expect(shouldRetry(2, new ApiError(503, 'down'))).toBe(false);
  });
});

describe('createQueryClient', () => {
  it('sends the Staff member back to sign-in when a query answers 401', async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient(onUnauthenticated);
    await client
      .fetchQuery({
        queryKey: ['test'],
        queryFn: () => Promise.reject(new ApiError(401, 'Sign in to continue.')),
      })
      .catch(() => undefined);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('sends the Staff member back to sign-in when a mutation answers 401', async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient(onUnauthenticated);
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(new ApiError(401, 'Sign in.')) })
      .execute(undefined)
      .catch(() => undefined);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('leaves other errors to the screen that made the call', async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient(onUnauthenticated);
    await client
      .fetchQuery({
        queryKey: ['test'],
        queryFn: () => Promise.reject(new ApiError(404, 'Not found.')),
      })
      .catch(() => undefined);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});
