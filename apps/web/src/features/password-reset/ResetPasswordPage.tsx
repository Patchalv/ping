import { type NewPasswordBody, newPasswordBody, PASSWORD_MIN } from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useState } from 'react';
import { showServerIssues, useAppForm } from '#/components/form';
import { buttonVariants } from '#/components/ui/button';
import { FormError } from '../../components/FormError';
import { OFFLINE_MESSAGE } from '../../lib/api-client';
import { authClient } from '../../lib/auth-client';
import { FORGOT_PASSWORD_PATH } from './ForgotPasswordPage';
import { resetPasswordRefusal } from './reset-error';

/** The path a reset link opens: the set-password page. */
export const RESET_PASSWORD_PATH = '/reset-password';

const defaultValues: NewPasswordBody = { password: '' };

type Outcome = 'form' | 'reset' | 'dead-link';

/**
 * The set-password page a reset link opens (screens.md › Other flows). A completed reset
 * signs the person out everywhere, so it ends on a link to sign in. The links are plain:
 * leaving reloads the app, which then reads the session afresh.
 */
export function ResetPasswordPage({ token }: { token: string }) {
  const [outcome, setOutcome] = useState<Outcome>(token ? 'form' : 'dead-link');
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    formId: 'reset-password',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: newPasswordBody },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      try {
        const { error: refused } = await authClient.resetPassword({
          token,
          newPassword: newPasswordBody.parse(value).password,
        });
        if (!refused) {
          setOutcome('reset');
          return;
        }
        const refusal = resetPasswordRefusal(refused);
        if (refusal.kind === 'dead-link') setOutcome('dead-link');
        else if (refusal.kind === 'password') {
          showServerIssues(formApi, [{ path: 'password', message: refusal.message }]);
        } else setError(refusal.message);
      } catch {
        // Better Auth's client throws when the request never reaches Ping.
        setError(OFFLINE_MESSAGE);
      }
    },
  });

  return (
    <main className="grid min-h-dvh place-items-center bg-chrome px-4 py-6">
      <div className="grid w-full max-w-sm gap-6">
        <p className="text-center text-2xl font-bold tracking-tight text-chrome-foreground">Ping</p>
        <div className="grid gap-4 rounded-xl bg-background p-6 shadow-lg">
          {outcome === 'reset' ? (
            <>
              <h1 className="text-xl font-bold">Your password is changed</h1>
              <p role="status">
                You’ve been signed out everywhere. Sign in with your new password.
              </p>
              <a className={buttonVariants({ size: 'lg' })} href="/">
                Sign in
              </a>
            </>
          ) : outcome === 'dead-link' ? (
            <>
              <h1 className="text-xl font-bold">This reset link can’t be used</h1>
              <p role="alert">It has expired or has already been used. Ask for a new one.</p>
              <a className={buttonVariants({ size: 'lg' })} href={FORGOT_PASSWORD_PATH}>
                Send a new link
              </a>
            </>
          ) : (
            <form.AppForm>
              <form.Form className="grid gap-4">
                <h1 className="text-xl font-bold">Choose a new password</h1>
                <form.AppField name="password">
                  {(field) => (
                    <field.TextField
                      label="New password"
                      type="password"
                      autoComplete="new-password"
                      description={`At least ${PASSWORD_MIN} characters, and not one that has appeared in a known data breach.`}
                    />
                  )}
                </form.AppField>
                {error ? <FormError>{error}</FormError> : null}
                <form.SubmitButton size="lg" pending="Saving…">
                  Set new password
                </form.SubmitButton>
              </form.Form>
            </form.AppForm>
          )}
        </div>
      </div>
    </main>
  );
}
