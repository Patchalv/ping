import {
  EMPTY_RICH_TEXT,
  type StartThreadBody,
  startThreadBody,
  THREAD_TITLE_MAX,
  type ThreadView,
} from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
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
import { FormError } from '../../components/FormError';
import { ApiError } from '../../lib/api-client';
import { useStartThread } from './api';

/**
 * + New Thread in the Channel bar. Only shown to Channel members, outside Archived
 * channels; the server decides either way.
 */
export function StartThreadButton({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <Button className="shrink-0" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden="true" />
        New Thread
      </Button>
      {open ? (
        <StartThreadDialog
          channelId={channelId}
          onClose={() => setOpen(false)}
          onStarted={(thread) => {
            setOpen(false);
            void navigate({
              to: '/channels/$channelId/threads/$threadId',
              params: { channelId, threadId: thread.id },
            });
          }}
        />
      ) : null}
    </>
  );
}

const defaultValues: StartThreadBody = { title: '', body: EMPTY_RICH_TEXT };

/** The composer for a new Thread: a title and a rich-text description (screens.md › Composer). */
function StartThreadDialog({
  channelId,
  onClose,
  onStarted,
}: {
  channelId: string;
  onClose(): void;
  onStarted(thread: ThreadView): void;
}) {
  const start = useStartThread(channelId);
  // A failure no field explains: the network, or a refusal.
  const [formError, setFormError] = useState<string | null>(null);

  const form = useAppForm({
    formId: 'start-thread',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: startThreadBody },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        onStarted(await start.mutateAsync(startThreadBody.parse(value)));
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
              <DialogTitle>New Thread</DialogTitle>
            </DialogHeader>
            <form.AppField name="title">
              {(field) => (
                <field.TextField label="Title" maxLength={THREAD_TITLE_MAX} autoComplete="off" />
              )}
            </form.AppField>
            <form.AppField name="body">
              {(field) => <field.RichTextField label="Description" />}
            </form.AppField>
            {formError ? <FormError>{formError}</FormError> : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <form.SubmitButton pending="Starting…">Start Thread</form.SubmitButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
