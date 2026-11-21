import { type ForgotPasswordBody, forgotPasswordBody } from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useState } from 'react';
import { useAppForm } from '#/components/form';
import { buttonVariants } from '#/components/ui/button';
import { AuthPage } from '../../components/AuthPage';
import { FormError } from '../../components/FormError';
import { OFFLINE_MESSAGE } from '../../lib/api-client';
import { authClient } from '../../lib/auth-client';
import { forgotPasswordErrorMessage } from './reset-error';

/** The path the sign-in page's "Forgot password?" link opens. */
export const FORGOT_PASSWORD_PATH = '/forgot-password';

const defaultValues: ForgotPasswordBody = { email: '' };

/**
 * The forgot-password page (screens.md › Other flows). Every email gets the same answer,
 * whether or not it belongs to an active Staff member, so the page never says which.
 */
export function ForgotPasswordPage() {
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    formId: 'forgot-password',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: forgotPasswordBody },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const { error: refused } = await authClient.requestPasswordReset(
          forgotPasswordBody.parse(value),
        );
        if (refused) setError(forgotPasswordErrorMessage(refused));
        else setRequested(true);
      } catch {
        // Better Auth's client throws when the request never reaches Ping.
        setError(OFFLINE_MESSAGE);
      }
    },
  });

  return (
    <AuthPage>
      {requested ? (
        <>
          <h1 className="text-xl font-bold">Check your email</h1>
          <p role="status">
            If that account exists, we’ve sent a link to reset your password. It works once and
            lasts 1 hour.
          </p>
          <a className={buttonVariants({ variant: 'outline', size: 'lg' })} href="/">
            Back to sign in
          </a>
        </>
      ) : (
        <form.AppForm>
          <form.Form className="grid gap-4">
            <div className="grid gap-1">
              <h1 className="text-xl font-bold">Reset your password</h1>
              <p className="text-muted-foreground">
                Enter your work email and we’ll send you a link to choose a new password.
              </p>
            </div>
            <form.AppField name="email">
              {(field) => <field.TextField label="Email" type="email" autoComplete="username" />}
            </form.AppField>
            {error ? <FormError>{error}</FormError> : null}
            <form.SubmitButton size="lg" pending="Sending…">
              Send reset link
            </form.SubmitButton>
            <a className={buttonVariants({ variant: 'link' })} href="/">
              Back to sign in
            </a>
          </form.Form>
        </form.AppForm>
      )}
    </AuthPage>
  );
}
