import { type FormEvent, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Field, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { FormError } from './components/FormError';
import { authClient } from './lib/auth-client';
import { signInErrorMessage } from './lib/sign-in-error';

export function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    const { error: refused } = await authClient.signIn.email({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    });
    setSubmitting(false);
    if (refused) setError(signInErrorMessage(refused));
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-chrome px-4 py-6">
      <div className="grid w-full max-w-sm gap-6">
        <p className="text-center text-2xl font-bold tracking-tight text-chrome-foreground">Ping</p>
        <form
          className="grid gap-4 rounded-xl bg-background p-6 shadow-lg"
          onSubmit={(e) => void onSubmit(e)}
        >
          <h1 className="text-xl font-bold">Sign in to Ping</h1>
          <Field>
            <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
            <Input id="sign-in-email" name="email" type="email" autoComplete="username" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
            <Input
              id="sign-in-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {error ? <FormError>{error}</FormError> : null}
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
