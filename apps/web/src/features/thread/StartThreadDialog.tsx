import {
  EMPTY_RICH_TEXT,
  extractBodyText,
  type RichTextDoc,
  type StartThreadBody,
  startThreadBody,
  THREAD_TITLE_MAX,
  type ThreadView,
} from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useRef, useState } from 'react';
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
import { authClient } from '../../lib/auth-client';
import { draftKey, readDraft, saveDraft } from '../../lib/drafts';
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

type Draft = { title: string; body: RichTextDoc };

const EMPTY: Draft = { title: '', body: EMPTY_RICH_TEXT };

const isEmpty = (draft: StartThreadBody) =>
  draft.title.trim() === '' && extractBodyText(draft.body as RichTextDoc) === '';

/**
 * The composer for a new Thread: a title and a rich-text description (screens.md ›
 * Composer). It keeps one unsent draft per Channel in this browser until it's sent or
 * emptied.
 */
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
  const staffMemberId = authClient.useSession().data?.user.id;
  const key = staffMemberId ? draftKey(staffMemberId, 'new-thread', channelId) : null;
  // Restored once, when the composer opens.
  const [defaultValues] = useState<StartThreadBody>(() =>
    key ? (readDraft<Draft>(key) ?? EMPTY) : EMPTY,
  );
  // Once sent, a late debounced save mustn't bring the draft back.
  const sent = useRef(false);

  const form = useAppForm({
    formId: 'start-thread',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: startThreadBody },
    listeners: {
      onChangeDebounceMs: 400,
      onChange: ({ formApi }) => {
        if (!key || sent.current) return;
        const value = formApi.state.values;
        saveDraft(key, isEmpty(value) ? null : value);
      },
    },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        const thread = await start.mutateAsync(startThreadBody.parse(value));
        sent.current = true;
        if (key) saveDraft(key, null);
        onStarted(thread);
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
