import {
  type ChangeEmailBody,
  type ChangeNameBody,
  changeEmailBody,
  changeNameBody,
  STAFF_NAME_MAX,
} from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useState } from 'react';
import { showServerIssues, useAppForm } from '#/components/form';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';
import { Separator } from '#/components/ui/separator';
import { FormError } from '../../components/FormError';
import { StaffAvatar } from '../../components/StaffAvatar';
import { ApiError } from '../../lib/api-client';
import { useChangeName, useRequestEmailChange } from './api';

type Me = { id: string; name: string; email: string };

type Props = {
  me: Me;
  /** Called after the name changes: the session holds the name too. */
  onNameChanged(): void;
  onClose(): void;
};

/**
 * Your profile, from the avatar menu (screens.md › Top bar): your display name and your
 * email. A new email takes effect only when you open the link sent to it.
 */
export function ProfileDialog({ me, onNameChanged, onClose }: Props) {
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <StaffAvatar staff={me} size="lg" />
            <div className="grid min-w-0">
              <DialogTitle className="truncate">Your profile</DialogTitle>
              <DialogDescription className="truncate">{me.email}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <NameForm me={me} onNameChanged={onNameChanged} />
        <Separator />
        <EmailForm me={me} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NameForm({ me, onNameChanged }: { me: Me; onNameChanged(): void }) {
  const change = useChangeName(me.id);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [defaultValues] = useState<ChangeNameBody>(() => ({ name: me.name }));

  const form = useAppForm({
    formId: 'change-name',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: changeNameBody },
    listeners: { onChange: () => setSaved(false) },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        await change.mutateAsync(changeNameBody.parse(value));
        setSaved(true);
        onNameChanged();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (!showServerIssues(formApi, error.issues)) setFormError(error.message);
      }
    },
  });

  return (
    <form.AppForm>
      <form.Form className="grid gap-3">
        <form.AppField name="name">
          {(field) => (
            <field.TextField
              label="Display name"
              maxLength={STAFF_NAME_MAX}
              autoComplete="name"
              description="How everyone in Ping sees you."
            />
          )}
        </form.AppField>
        {formError ? <FormError>{formError}</FormError> : null}
        <div className="flex items-center gap-3">
          <form.SubmitButton pending="Saving…">Save name</form.SubmitButton>
          {saved ? (
            <p className="text-small text-muted-foreground" role="status">
              Saved.
            </p>
          ) : null}
        </div>
      </form.Form>
    </form.AppForm>
  );
}

const emailDefaults: ChangeEmailBody = { email: '' };

function EmailForm({ me }: { me: Me }) {
  const request = useRequestEmailChange(me.id);
  const [formError, setFormError] = useState<string | null>(null);
  // The address a link went to, once one has.
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useAppForm({
    formId: 'change-email',
    defaultValues: emailDefaults,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: changeEmailBody },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        const body = changeEmailBody.parse(value);
        await request.mutateAsync(body);
        setSentTo(body.email);
        formApi.reset();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (!showServerIssues(formApi, error.issues)) setFormError(error.message);
      }
    },
  });

  return (
    <form.AppForm>
      <form.Form className="grid gap-3">
        <form.AppField name="email">
          {(field) => (
            <field.TextField
              label="New email"
              type="email"
              autoComplete="email"
              description="We’ll send a link to the new address. Your email changes when you open it."
            />
          )}
        </form.AppField>
        {formError ? <FormError>{formError}</FormError> : null}
        {sentTo ? (
          <p className="text-small [overflow-wrap:anywhere]" role="status">
            Check <strong>{sentTo}</strong> for the link. It works once and lasts 1 hour. Until you
            open it, you sign in with {me.email}.
          </p>
        ) : null}
        <div>
          <form.SubmitButton variant="outline" pending="Sending…">
            Send link
          </form.SubmitButton>
        </div>
      </form.Form>
    </form.AppForm>
  );
}
