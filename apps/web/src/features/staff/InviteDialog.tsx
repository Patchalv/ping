import {
  type InviteStaffBody,
  inviteStaffBody,
  STAFF_NAME_MAX,
  type StaffMemberView,
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
import { useInviteStaffMember, useReactivateStaffMember, useStaffMembers } from './api';

const defaultValues: InviteStaffBody = { name: '', email: '', role: 'member' };

/**
 * Invite someone by name, email and role (product.md › Invites). When the server refuses
 * an email in use, and the freshly read list shows it belongs to a Deactivated Staff
 * member, the dialog offers Reactivate instead.
 */
export function InviteDialog({ onClose }: { onClose(): void }) {
  const invite = useInviteStaffMember();
  const staff = useStaffMembers();
  // A failure no field explains: the email is in use, a refusal, or the network.
  const [formError, setFormError] = useState<string | null>(null);
  const [reactivateOffer, setReactivateOffer] = useState<StaffMemberView | null>(null);

  const form = useAppForm({
    formId: 'invite-staff-member',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: inviteStaffBody },
    listeners: { onChange: () => setReactivateOffer(null) },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      const body = inviteStaffBody.parse(value);
      try {
        await invite.mutateAsync(body);
        onClose();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (showServerIssues(formApi, error.issues)) return;
        // Refetched, not cached: they may have been Deactivated since the list loaded.
        const owner =
          error.status === 409
            ? (await staff.refetch()).data?.find(
                (person) => person.state === 'deactivated' && person.email === body.email,
              )
            : undefined;
        if (owner) setReactivateOffer(owner);
        else setFormError(error.message);
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
            {reactivateOffer ? (
              <ReactivateOffer person={reactivateOffer} onReactivated={onClose} />
            ) : null}
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

/** In place of a second invite: the person already exists, Deactivated. */
function ReactivateOffer({
  person,
  onReactivated,
}: {
  person: StaffMemberView;
  onReactivated(): void;
}) {
  const reactivate = useReactivateStaffMember();
  return (
    <div className="grid gap-2 rounded-lg border bg-muted p-3" role="status">
      <p className="text-sm">
        <span className="font-semibold">{person.name}</span> already has this email and is
        Deactivated. Reactivate them instead: their Channel memberships come back as they were.
      </p>
      {reactivate.isError ? <FormError>{reactivate.error.message}</FormError> : null}
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        disabled={reactivate.isPending}
        onClick={() => reactivate.mutate(person.id, { onSuccess: onReactivated })}
      >
        {reactivate.isPending ? 'Reactivating…' : `Reactivate ${person.name}`}
      </Button>
    </div>
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
