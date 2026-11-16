import { acceptInviteBody, type InviteView, PASSWORD_MIN } from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useState } from 'react';
import { showServerIssues, useAppForm } from '#/components/form';
import { buttonVariants } from '#/components/ui/button';
import { Field, FieldLabel } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { FormError } from '../../components/FormError';
import { ApiError } from '../../lib/api-client';
import { useAcceptInvite, useInvite } from './api';

const passwordForm = acceptInviteBody.pick({ password: true });

/**
 * The set-password page an invite link opens (screens.md › Other flows): the name, the
 * email read-only, and a password. Submitting signs the person in; `onAccepted` then
 * takes them into the app.
 */
export function AcceptInvitePage({ token, onAccepted }: { token: string; onAccepted(): void }) {
  const invite = useInvite(token);
  return (
    <main className="grid min-h-dvh place-items-center bg-chrome px-4 py-6">
      <div className="grid w-full max-w-sm gap-6">
        <p className="text-center text-2xl font-bold tracking-tight text-chrome-foreground">Ping</p>
        <div className="grid gap-4 rounded-xl bg-background p-6 shadow-lg">
          {invite.isPending ? (
            <p className="text-muted-foreground">Checking your invite…</p>
          ) : invite.isError ? (
            <>
              <h1 className="text-xl font-bold">This invite can’t be used</h1>
              <p role="alert">{invite.error.message}</p>
              {/* A plain link: leaving reloads the app at its home, signed in or not. */}
              <a className={buttonVariants({ variant: 'outline' })} href="/">
                Go to Ping
              </a>
            </>
          ) : (
            <SetPasswordForm token={token} invite={invite.data} onAccepted={onAccepted} />
          )}
        </div>
      </div>
    </main>
  );
}

function SetPasswordForm({
  token,
  invite,
  onAccepted,
}: {
  token: string;
  invite: InviteView;
  onAccepted(): void;
}) {
  const accept = useAcceptInvite();
  // A refusal no field explains: a dead link, or the network.
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    formId: 'accept-invite',
    defaultValues: { password: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: passwordForm },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      try {
        await accept.mutateAsync({ token, password: value.password });
        onAccepted();
      } catch (failure) {
        if (!(failure instanceof ApiError)) throw failure;
        // A breached password comes back as an issue on the password field.
        if (!showServerIssues(formApi, failure.issues)) setError(failure.message);
      }
    },
  });

  return (
    <form.AppForm>
      <form.Form className="grid gap-4">
        <div className="grid gap-1">
          <h1 className="text-xl font-bold">Welcome to Ping, {invite.name}</h1>
          <p className="text-muted-foreground">Choose a password to finish joining.</p>
        </div>
        <Field>
          <FieldLabel htmlFor="accept-invite-email">Email</FieldLabel>
          <Input
            id="accept-invite-email"
            type="email"
            value={invite.email}
            autoComplete="username"
            className="bg-muted text-muted-foreground"
            readOnly
          />
        </Field>
        <form.AppField name="password">
          {(field) => (
            <field.TextField
              label="Password"
              type="password"
              autoComplete="new-password"
              description={`At least ${PASSWORD_MIN} characters, and not one that has appeared in a known data breach.`}
            />
          )}
        </form.AppField>
        {error ? <FormError>{error}</FormError> : null}
        <form.SubmitButton size="lg" pending="Joining…">
          Set password and join
        </form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
