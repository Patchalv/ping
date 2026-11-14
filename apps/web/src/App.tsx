import { useEffect, useState } from 'react';
import { AppShell } from './components/AppShell';
import { api } from './lib/api';
import { authClient } from './lib/auth-client';
import { SignIn } from './SignIn';

function useServerReachable(): boolean {
  const [reachable, setReachable] = useState(true);
  useEffect(() => {
    api.healthz
      .$get()
      .then((res) => setReachable(res.ok))
      .catch(() => setReachable(false));
  }, []);
  return reachable;
}

export function App() {
  const reachable = useServerReachable();
  const { data: session, isPending } = authClient.useSession();

  return (
    <>
      {!reachable && (
        <p className="banner" role="alert">
          Can’t reach the Ping server. Check your connection, then reload.
        </p>
      )}
      {isPending ? null : session ? <AppShell user={session.user} /> : <SignIn />}
    </>
  );
}
