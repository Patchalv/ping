import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from './lib/api';
import { call } from './lib/api-client';
import { authClient } from './lib/auth-client';
import { createQueryClient } from './lib/query-client';
import { createAppRouter } from './router';
import { SignIn } from './SignIn';

const router = createAppRouter();

// The client for what anyone may ask before signing in: only whether the server answers.
const publicQueryClient = createQueryClient(() => undefined);

export function App() {
  const { data: session, isPending, refetch } = authClient.useSession();
  return (
    <QueryClientProvider client={publicQueryClient}>
      <ServerUnreachableBanner />
      {isPending ? null : session ? (
        // Keyed by Staff member: a new person gets a new, empty cache.
        <SignedIn key={session.user.id} onUnauthenticated={() => void refetch()} />
      ) : (
        <SignIn />
      )}
    </QueryClientProvider>
  );
}

/**
 * The signed-in app, with its own QueryClient (ADR 0006). A 401 from any call refetches
 * the session, which then finds none, so App falls back to sign-in.
 */
function SignedIn({ onUnauthenticated }: { onUnauthenticated(): void }) {
  const [queryClient] = useState(() => createQueryClient(onUnauthenticated));
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function ServerUnreachableBanner() {
  const healthz = useQuery({
    queryKey: ['healthz'],
    queryFn: () => call(() => api.healthz.$get()),
  });
  return healthz.isError ? (
    <p className="bg-destructive-surface px-4 py-3 text-center text-destructive" role="alert">
      Can’t reach the Ping server. Check your connection, then reload.
    </p>
  ) : null;
}
