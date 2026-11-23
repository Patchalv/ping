// The Section dialogs: + New section, Rename and Delete.
import { createSectionBody, SECTION_NAME_MAX, type SectionView } from '@ping/shared';
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
import { FormError } from '../../components/FormError';
import { ApiError } from '../../lib/api-client';
import { useCreateSection, useDeleteSection, useRenameSection } from './api';

/** + New section: a name, then it goes below the other Sections. */
export function NewSectionDialog({ onClose }: { onClose(): void }) {
  const create = useCreateSection();
  return (
    <SectionNameDialog
      formId="new-section"
      title="New section"
      submitLabel="Create section"
      pendingLabel="Creating…"
      initialName=""
      onSave={async (name) => {
        await create.mutateAsync({ name });
        onClose();
      }}
      onClose={onClose}
    />
  );
}

export function RenameSectionDialog({
  section,
  onClose,
}: {
  section: SectionView;
  onClose(): void;
}) {
  const rename = useRenameSection(section.id);
  return (
    <SectionNameDialog
      formId="rename-section"
      title={`Rename ${section.name}`}
      submitLabel="Rename"
      pendingLabel="Renaming…"
      initialName={section.name}
      onSave={async (name) => {
        await rename.mutateAsync(name);
        onClose();
      }}
      onClose={onClose}
    />
  );
}

/** A Section's name, checked by the shared schema here and again by the server. */
function SectionNameDialog({
  formId,
  title,
  submitLabel,
  pendingLabel,
  initialName,
  onSave,
  onClose,
}: {
  formId: string;
  title: string;
  submitLabel: string;
  pendingLabel: string;
  initialName: string;
  onSave(name: string): Promise<void>;
  onClose(): void;
}) {
  // A failure no field explains: the network, or a refusal.
  const [formError, setFormError] = useState<string | null>(null);
  const form = useAppForm({
    formId,
    defaultValues: { name: initialName },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: createSectionBody },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        await onSave(createSectionBody.parse(value).name);
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
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>Only you see your Sections.</DialogDescription>
            </DialogHeader>
            <form.AppField name="name">
              {(field) => (
                <field.TextField label="Name" maxLength={SECTION_NAME_MAX} autoComplete="off" />
              )}
            </form.AppField>
            {formError ? <FormError>{formError}</FormError> : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <form.SubmitButton pending={pendingLabel}>{submitLabel}</form.SubmitButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}

/** Delete, after asking. Its Channels go back to the default Channels section. */
export function DeleteSectionDialog({
  section,
  onClose,
}: {
  section: SectionView;
  onClose(): void;
}) {
  const remove = useDeleteSection();
  const count = section.channelIds.length;
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {section.name}?</DialogTitle>
          <DialogDescription>
            {count === 0
              ? 'It has no Channels in it.'
              : `Its ${count === 1 ? 'Channel moves' : `${count} Channels move`} back to Channels. You stay in ${count === 1 ? 'it' : 'them'}.`}
          </DialogDescription>
        </DialogHeader>
        {remove.isError ? <FormError>{remove.error.message}</FormError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate(section.id, { onSuccess: onClose })}
          >
            {remove.isPending ? 'Deleting…' : 'Delete section'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
