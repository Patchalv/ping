import {
  type InviteStaffBody,
  inviteStaffBody,
  STAFF_NAME_MAX,
  type StaffRole,
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '#/components/ui/field';
import { RadioGroupItem } from '#/components/ui/radio-group';
import { FormError } from '../../components/FormError';
import { ApiError } from '../../lib/api-client';
import { useInviteStaffMember } from './api';

const defaultValues: InviteStaffBody = { name: '', email: '', role: 'member' };

/** Invite someone by name, email and role (product.md › Invites). */
export function InviteDialog({ onClose }: { onClose(): void }) {
  const invite = useInviteStaffMember();
  // A failure no field explains: the email is in use, a refusal, or the network.
  const [formError, setFormError] = useState<string | null>(null);

  const form = useAppForm({
    formId: 'invite-staff-member',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: inviteStaffBody },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        await invite.mutateAsync(inviteStaffBody.parse(value));
        onClose();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (!showServerIssues(formApi, error.issues)) setFormError(error.message);
      }
    },
  });

  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form.AppForm>
          <form.Form className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Invite a Staff member</DialogTitle>
              <DialogDescription>
                They get an email with a link to set their password. It lasts 7 days.
              </DialogDescription>
            </DialogHeader>
            <form.AppField name="name">
              {(field) => (
                <field.TextField label="Name" maxLength={STAFF_NAME_MAX} autoComplete="off" />
              )}
            </form.AppField>
            <form.AppField name="email">
              {(field) => <field.TextField label="Email" type="email" autoComplete="off" />}
            </form.AppField>
            <form.AppField name="role">
              {(field) => (
                <field.RadioGroupField legend="Role">
                  <RoleChoice value="member" title="Member" hint="Uses Ping day to day." />
                  <RoleChoice
                    value="admin"
                    title="Admin"
                    hint="Also invites, Deactivates and sets the role of Staff members."
                  />
                </field.RadioGroupField>
              )}
            </form.AppField>
            {formError ? <FormError>{formError}</FormError> : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <form.SubmitButton pending="Inviting…">Send invite</form.SubmitButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}

function RoleChoice({ value, title, hint }: { value: StaffRole; title: string; hint: string }) {
  return (
    <FieldLabel>
      <Field orientation="horizontal">
        <RadioGroupItem value={value} />
        <FieldContent>
          <FieldTitle>{title}</FieldTitle>
          <FieldDescription>{hint}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}
