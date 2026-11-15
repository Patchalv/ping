// Server data lives in TanStack Query (ADR 0006). One QueryClient per signed-in Staff
// member: App creates it under a key of their ID, so signing out, or another person
// signing in on the same browser, throws the whole cache away. A cached Private channel
// can never reach the next person.
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

/** A 4xx won't change on a retry. A failed network call or a 5xx gets two more tries. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * `onUnauthenticated` runs on a 401 from any query or mutation. App passes Better Auth's
 * session refetch, which finds no session and falls back to sign-in.
 */
export function createQueryClient(onUnauthenticated: () => void): QueryClient {
  const on401 = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) onUnauthenticated();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: on401 }),
    mutationCache: new MutationCache({ onError: on401 }),
    defaultOptions: { queries: { retry: shouldRetry } },
  });
}
