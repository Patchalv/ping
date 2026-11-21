import type { ReactNode } from 'react';

/**
 * The page around everything before signing in: sign-in, accepting an invite, and
 * password reset. The Ping wordmark over one card on the chrome background.
 */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-chrome px-4 py-6">
      <div className="grid w-full max-w-sm gap-6">
        <p className="text-center text-2xl font-bold tracking-tight text-chrome-foreground">Ping</p>
        <div className="grid gap-4 rounded-xl bg-background p-6 shadow-lg">{children}</div>
      </div>
    </main>
  );
}
