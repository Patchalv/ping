import {
  type EditThreadBody,
  editThreadBody,
  THREAD_TITLE_MAX,
  type ThreadView,
  withCurrentMentionNames,
} from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useState } from 'react';
import { STILL_ATTACHING, useAttachingCount } from '#/components/attachments/AttachmentPicker';
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
import { FormError } from '../../components/FormError';
import { ApiError } from '../../lib/api-client';
import { useAddAttachment, useEditThread, useMentionCandidates } from './api';

/** Edit a Thread's title and description. Only the latest text is kept. */
export function EditThreadDialog({ thread, onClose }: { thread: ThreadView; onClose(): void }) {
  const edit = useEditThread(thread.channelId, thread.id);
  const mentionCandidates = useMentionCandidates(thread.channelId).data ?? [];
  const addAttachment = useAddAttachment(thread.channelId);
  const attaching = useAttachingCount();
  // A failure no field explains: the network, or a refusal.
  const [formError, setFormError] = useState<string | null>(null);
  // Start from each Mentioned person's current name, so saving writes it into the preview.
  // An edit adds Attachments to those already there.
  const [defaultValues] = useState<EditThreadBody>(() => ({
    title: thread.title,
    body: withCurrentMentionNames(thread.body, thread.mentionNames),
    attachmentIds: [],
  }));
  const form = useAppForm({
    formId: 'edit-thread',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: editThreadBody },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      if (attaching.isAttaching()) {
        setFormError(STILL_ATTACHING);
        return;
      }
      try {
        await edit.mutateAsync(editThreadBody.parse(value));
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
      <DialogContent className="sm:max-w-2xl">
        <form.AppForm>
          <form.Form className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Edit Thread</DialogTitle>
            </DialogHeader>
            <form.AppField name="title">
              {(field) => (
                <field.TextField label="Title" maxLength={THREAD_TITLE_MAX} autoComplete="off" />
              )}
            </form.AppField>
            <form.AppField name="body">
              {(field) => (
                <field.RichTextField label="Description" mentionCandidates={mentionCandidates} />
              )}
            </form.AppField>
            <form.AppField name="attachmentIds">
              {(field) => (
                <field.AttachmentsField
                  add={addAttachment}
                  onAddingChange={attaching.onAddingChange}
                  alreadyAttached={thread.attachments.length}
                />
              )}
            </form.AppField>
            {formError ? <FormError>{formError}</FormError> : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <form.SubmitButton pending="Saving…">Save</form.SubmitButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
