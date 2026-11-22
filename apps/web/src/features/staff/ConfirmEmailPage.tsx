import { Button, buttonVariants } from '#/components/ui/button';
import { AuthPage } from '../../components/AuthPage';
import { FormError } from '../../components/FormError';
import { ApiError } from '../../lib/api-client';
import { useConfirmEmailChange } from './api';

/** The path an email-change link opens. */
export const CONFIRM_EMAIL_PATH = '/confirm-email';

/**
 * The page an email-change link opens, signed in or not (screens.md › Other flows). Opening
 * the link is the confirmation, so the page asks for one click rather than acting on load:
 * a mail scanner fetching the link changes nothing. The link out is plain, so leaving
 * reloads the app, which reads the session (and the new email) afresh.
 */
export function ConfirmEmailPage({ token }: { token: string }) {
  const confirm = useConfirmEmailChange();
  // Used, expired, replaced, or the address taken since: trying again can't help. A
  // network failure still offers the button.
  const deadLink =
    confirm.error instanceof ApiError && [404, 409].includes(confirm.error.status)
      ? confirm.error.message
      : null;

  return (
    <AuthPage>
      {confirm.isSuccess ? (
        <>
          <h1 className="text-xl font-bold">Your email is changed</h1>
          <p role="status" className="[overflow-wrap:anywhere]">
            From now on, sign in to Ping with <strong>{confirm.data.email}</strong>.
          </p>
          <a className={buttonVariants({ size: 'lg' })} href="/">
            Open Ping
          </a>
        </>
      ) : !token || deadLink ? (
        <>
          <h1 className="text-xl font-bold">This link can’t be used</h1>
          <p role="alert">
            {deadLink ??
              'It isn’t complete. Open it again from the email, or change your email again from your profile.'}
          </p>
          <a className={buttonVariants({ size: 'lg' })} href="/">
            Open Ping
          </a>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold">Use your new email</h1>
          <p>Confirm to start signing in to Ping with the address this link was sent to.</p>
          {confirm.isError ? <FormError>{confirm.error.message}</FormError> : null}
          <Button size="lg" disabled={confirm.isPending} onClick={() => confirm.mutate(token)}>
            {confirm.isPending ? 'Confirming…' : 'Confirm new email'}
          </Button>
        </>
      )}
    </AuthPage>
  );
}
