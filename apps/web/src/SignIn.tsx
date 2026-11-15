import { type SignInBody, signInBody } from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useState } from 'react';
import { useAppForm } from '#/components/form';
import { FormError } from './components/FormError';
import { authClient } from './lib/auth-client';
import { signInErrorMessage } from './lib/sign-in-error';

const defaultValues: SignInBody = { email: '', password: '' };

export function SignIn() {
  // Better Auth's refusal: one message for the whole form, never which field was wrong.
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    formId: 'sign-in',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: signInBody },
    onSubmit: async ({ value }) => {
      setError(null);
      const { error: refused } = await authClient.signIn.email(signInBody.parse(value));
      if (refused) setError(signInErrorMessage(refused));
    },
  });

  return (
    <main className="grid min-h-dvh place-items-center bg-chrome px-4 py-6">
      <div className="grid w-full max-w-sm gap-6">
        <p className="text-center text-2xl font-bold tracking-tight text-chrome-foreground">Ping</p>
        <form.AppForm>
          <form.Form className="grid gap-4 rounded-xl bg-background p-6 shadow-lg">
            <h1 className="text-xl font-bold">Sign in to Ping</h1>
            <form.AppField name="email">
              {(field) => <field.TextField label="Email" type="email" autoComplete="username" />}
            </form.AppField>
            <form.AppField name="password">
              {(field) => (
                <field.TextField label="Password" type="password" autoComplete="current-password" />
              )}
            </form.AppField>
            {error ? <FormError>{error}</FormError> : null}
            <form.SubmitButton size="lg" pending="Signing in…">
              Sign in
            </form.SubmitButton>
          </form.Form>
        </form.AppForm>
      </div>
    </main>
  );
}
