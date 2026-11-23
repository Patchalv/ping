import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { useLiveUpdates } from './components/use-live-updates';
import {
  FORGOT_PASSWORD_PATH,
  ForgotPasswordPage,
} from './features/password-reset/ForgotPasswordPage';
import {
  RESET_PASSWORD_PATH,
  ResetPasswordPage,
} from './features/password-reset/ResetPasswordPage';
import { AcceptInvitePage } from './features/staff/AcceptInvitePage';
import { CONFIRM_EMAIL_PATH, ConfirmEmailPage } from './features/staff/ConfirmEmailPage';
import { ACCEPT_INVITE_PATH } from './features/staff/invite-token';
import { api } from './lib/api';
import { call } from './lib/api-client';
import { authClient } from './lib/auth-client';
import { tokenFromHash } from './lib/link-token';
import { createQueryClient } from './lib/query-client';
import { createAppRouter } from './router';
import { SignIn } from './SignIn';

const router = createAppRouter();

/**
 * The page a reset or email-change link, or the sign-in page's "Forgot password?" link,
 * opens, signed in or not. Like the invite page, they sit outside the router, which lives
 * inside the signed-in app. Their links out are plain, so leaving reloads the app.
 */
function linkPage():
  | { page: 'forgot' }
  | { page: 'reset'; token: string }
  | { page: 'confirm-email'; token: string }
  | null {
  if (window.location.pathname === FORGOT_PASSWORD_PATH) return { page: 'forgot' };
  if (window.location.pathname === RESET_PASSWORD_PATH) {
    return { page: 'reset', token: tokenFromHash(window.location.hash) };
  }
  // An email-change link works signed out too, as when opened on another device.
  if (window.location.pathname === CONFIRM_EMAIL_PATH) {
    return { page: 'confirm-email', token: tokenFromHash(window.location.hash) };
  }
  return null;
}

// The client for what anyone may ask before signing in: only whether the server answers.
const publicQueryClient = createQueryClient(() => undefined);

export function App() {
  const { data: session, isPending, refetch } = authClient.useSession();
  // An invite link opens the set-password page, signed in or not. It sits outside the
  // router on purpose: the router lives inside the signed-in app (one per Staff member),
  // and this page comes before anyone is signed in, like SignIn. Accepting signs the new
  // Staff member in and lands them on Browse channels (screens.md › Other flows).
  const [inviteToken, setInviteToken] = useState(() =>
    window.location.pathname === ACCEPT_INVITE_PATH ? tokenFromHash(window.location.hash) : null,
  );
  const [linkedPage] = useState(linkPage);
  return (
    <QueryClientProvider client={publicQueryClient}>
      <ServerUnreachableBanner />
      {linkedPage?.page === 'forgot' ? (
        <ForgotPasswordPage />
      ) : linkedPage?.page === 'reset' ? (
        <ResetPasswordPage token={linkedPage.token} />
      ) : linkedPage?.page === 'confirm-email' ? (
        <ConfirmEmailPage token={linkedPage.token} />
      ) : inviteToken !== null ? (
        <AcceptInvitePage
          token={inviteToken}
          onAccepted={() => {
            // Through the router, whose history would miss a bare replaceState.
            void router.navigate({ to: '/browse', replace: true });
            setInviteToken(null);
            void refetch();
          }}
        />
      ) : isPending ? null : session ? (
        // Keyed by Staff member: a new person gets a new, empty cache.
        <SignedIn key={session.user.id} onUnauthenticated={() => void refetch()} />
      ) : (
        <SignIn />
      )}
    </QueryClientProvider>
  );
}

/**
 * The signed-in app, with its own QueryClient (ADR 0006) and live-update stream. A 401
 * from any call refetches the session, which then finds none, so App falls back to sign-in.
 */
function SignedIn({ onUnauthenticated }: { onUnauthenticated(): void }) {
  // Both keep the first callback, so a re-render never reopens the stream.
  const [queryClient] = useState(() => createQueryClient(onUnauthenticated));
  const [onStreamRefused] = useState(() => onUnauthenticated);
  useLiveUpdates(queryClient, onStreamRefused);
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
