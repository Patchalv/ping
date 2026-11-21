import { type SignInBody, signInBody } from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useState } from 'react';
import { useAppForm } from '#/components/form';
import { buttonVariants } from '#/components/ui/button';
import { AuthPage } from './components/AuthPage';
import { FormError } from './components/FormError';
import { FORGOT_PASSWORD_PATH } from './features/password-reset/ForgotPasswordPage';
import { OFFLINE_MESSAGE } from './lib/api-client';
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
      try {
        const { error: refused } = await authClient.signIn.email(signInBody.parse(value));
        if (refused) setError(signInErrorMessage(refused));
      } catch {
        // Better Auth's client throws when the request never reaches Ping.
        setError(OFFLINE_MESSAGE);
      }
    },
  });

  return (
    <AuthPage>
      <form.AppForm>
        <form.Form className="grid gap-4">
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
          <a className={buttonVariants({ variant: 'link' })} href={FORGOT_PASSWORD_PATH}>
            Forgot password?
          </a>
        </form.Form>
      </form.AppForm>
    </AuthPage>
  );
}
