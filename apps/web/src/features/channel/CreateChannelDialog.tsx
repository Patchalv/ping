import {
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  type ChannelView,
  type CreateChannelBody,
  createChannelBody,
} from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useState } from 'react';
import { showServerIssues, useAppForm } from '#/components/form';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
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
import { useCreateChannel } from './api';

type Props = { onClose(): void; onCreated(channel: ChannelView): void };

const defaultValues: CreateChannelBody = {
  name: '',
  description: '',
  visibility: 'public',
};

/** Create channel: name, description and visibility (screens.md › Other flows). */
export function CreateChannelDialog({ onClose, onCreated }: Props) {
  const create = useCreateChannel();
  // A failure no field explains: the network, or a refusal.
  const [formError, setFormError] = useState<string | null>(null);

  const form = useAppForm({
    formId: 'create-channel',
    defaultValues,
    // Checked on submit, then again as the Staff member fixes each mistake. The server
    // checks again; this saves a round trip for the obvious mistakes.
    validationLogic: revalidateLogic(),
    validators: { onDynamic: createChannelBody },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        onCreated(await create.mutateAsync(value));
      } catch (error) {
        const failure = error instanceof ApiError ? error : new ApiError(0, String(error));
        if (!showServerIssues(formApi, failure.issues)) setFormError(failure.message);
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
              <DialogTitle>Create a Channel</DialogTitle>
            </DialogHeader>
            <form.AppField name="name">
              {(field) => (
                <field.TextField label="Name" maxLength={CHANNEL_NAME_MAX} autoComplete="off" />
              )}
            </form.AppField>
            <form.AppField name="description">
              {(field) => (
                <field.TextareaField
                  label="Description"
                  maxLength={CHANNEL_DESCRIPTION_MAX}
                  rows={3}
                />
              )}
            </form.AppField>
            <form.AppField name="visibility">
              {(field) => (
                <field.RadioGroupField legend="Who can find it?">
                  <VisibilityChoice
                    value="public"
                    title="Public"
                    hint="Any Staff member can find, read and join it."
                  />
                  <VisibilityChoice
                    value="private"
                    title="Private"
                    hint="Only its members can find and read it. It can’t be made Public later."
                  />
                </field.RadioGroupField>
              )}
            </form.AppField>
            {formError ? <FormError>{formError}</FormError> : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <form.SubmitButton pending="Creating…">Create channel</form.SubmitButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}

/** One visibility option as a card: the radio, its name and what it means. */
function VisibilityChoice({
  value,
  title,
  hint,
}: {
  value: ChannelView['visibility'];
  title: string;
  hint: string;
}) {
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
