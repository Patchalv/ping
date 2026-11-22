import {
  EMPTY_RICH_TEXT,
  extractBodyText,
  type RichTextDoc,
  type ThreadResponseBody,
  type ThreadResponseView,
  threadResponseBody,
  threadResponseCount,
} from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useRef, useState } from 'react';
import { showServerIssues, useAppForm } from '#/components/form';
import { RichTextView } from '#/components/rich-text/RichTextView';
import { Button } from '#/components/ui/button';
import { FormError } from '../../components/FormError';
import { ApiError } from '../../lib/api-client';
import { draftKey, readDraft, saveDraft } from '../../lib/drafts';
import { useEditThreadResponse, useSendThreadResponse } from './api';
import { Byline } from './Byline';
import { ContentMenu, ContentMenuDelete, ContentMenuEdit, EditedMark } from './ContentMenu';
import { DeleteThreadResponseDialog } from './DeleteDialogs';

/** A Thread's Thread Responses, oldest first, with deleted ones as placeholders. */
export function ThreadResponseList({
  channelId,
  responses,
}: {
  channelId: string;
  responses: ThreadResponseView[];
}) {
  if (responses.length === 0) return null;
  return (
    <section aria-label="Thread Responses" className="mt-5 border-t pt-4">
      <h3 className="text-small font-semibold text-muted-foreground">
        {threadResponseCount(responses.length)}
      </h3>
      <ol className="mt-3 grid gap-4">
        {responses.map((response) => (
          <li key={response.id}>
            <ThreadResponseItem channelId={channelId} response={response} />
          </li>
        ))}
      </ol>
    </section>
  );
}

type Mode = 'reading' | 'editing' | 'deleting';

function ThreadResponseItem({
  channelId,
  response,
}: {
  channelId: string;
  response: ThreadResponseView;
}) {
  const [mode, setMode] = useState<Mode>('reading');
  if (response.isDeleted || !response.body) {
    return <p className="text-sm text-muted-foreground italic">Thread Response deleted</p>;
  }
  const hasActions = response.canEdit || response.canDelete;
  return (
    <article>
      <div className="flex items-center gap-2">
        <Byline author={response.author} at={response.createdAt} />
        <EditedMark edited={response.edited} />
        {hasActions && mode === 'reading' ? (
          <div className="ml-auto">
            <ContentMenu label="Thread Response actions">
              {response.canEdit ? <ContentMenuEdit onClick={() => setMode('editing')} /> : null}
              {response.canDelete ? (
                <ContentMenuDelete onClick={() => setMode('deleting')} />
              ) : null}
            </ContentMenu>
          </div>
        ) : null}
      </div>
      {mode === 'editing' ? (
        <EditThreadResponseForm
          channelId={channelId}
          response={response}
          body={response.body}
          onDone={() => setMode('reading')}
        />
      ) : (
        <RichTextView doc={response.body} className="mt-1" />
      )}
      {mode === 'deleting' ? (
        <DeleteThreadResponseDialog
          channelId={channelId}
          threadId={response.threadId}
          threadResponseId={response.id}
          onClose={() => setMode('reading')}
        />
      ) : null}
    </article>
  );
}

/** Edit a Thread Response in place. Only the latest text is kept. */
function EditThreadResponseForm({
  channelId,
  response,
  body,
  onDone,
}: {
  channelId: string;
  response: ThreadResponseView;
  body: RichTextDoc;
  onDone(): void;
}) {
  const edit = useEditThreadResponse(channelId, response.threadId, response.id);
  const [formError, setFormError] = useState<string | null>(null);
  const defaultValues: ThreadResponseBody = { body };
  const form = useAppForm({
    formId: `edit-thread-response-${response.id}`,
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: threadResponseBody },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        await edit.mutateAsync(threadResponseBody.parse(value));
        onDone();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (!showServerIssues(formApi, error.issues)) setFormError(error.message);
      }
    },
  });
  return (
    <form.AppForm>
      <form.Form className="mt-2 grid gap-3">
        <form.AppField name="body">
          {(field) => <field.RichTextField label="Edit Thread Response" />}
        </form.AppField>
        {formError ? <FormError>{formError}</FormError> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <form.SubmitButton pending="Saving…">Save</form.SubmitButton>
        </div>
      </form.Form>
    </form.AppForm>
  );
}

/**
 * The composer at the bottom of a Thread (screens.md › Composer). It keeps one unsent
 * draft per Thread in this browser until it's sent or emptied. After sending, it starts
 * again empty.
 */
export function ThreadResponseComposer({
  channelId,
  threadId,
  staffMemberId,
}: {
  channelId: string;
  threadId: string;
  staffMemberId: string;
}) {
  // The editor takes its document once, so a fresh one follows each send.
  const [round, setRound] = useState(0);
  return (
    <ComposerForm
      key={round}
      channelId={channelId}
      threadId={threadId}
      draft={draftKey(staffMemberId, 'thread-response', threadId)}
      onSent={() => setRound((n) => n + 1)}
    />
  );
}

/** A saved draft, if it still passes the allowlist; a damaged one is dropped. */
function restoreDraft(key: string): RichTextDoc {
  const saved = readDraft<{ body?: unknown }>(key);
  const body = threadResponseBody.shape.body.safeParse(saved?.body);
  return body.success ? body.data : EMPTY_RICH_TEXT;
}

function ComposerForm({
  channelId,
  threadId,
  draft,
  onSent,
}: {
  channelId: string;
  threadId: string;
  draft: string;
  onSent(): void;
}) {
  const send = useSendThreadResponse(channelId, threadId);
  const [formError, setFormError] = useState<string | null>(null);
  // Restored once, when the composer opens.
  const [defaultValues] = useState<ThreadResponseBody>(() => ({ body: restoreDraft(draft) }));
  // Once sent, a late debounced save mustn't bring the draft back.
  const sent = useRef(false);
  const form = useAppForm({
    formId: 'send-thread-response',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: threadResponseBody },
    listeners: {
      onChangeDebounceMs: 400,
      onChange: ({ formApi }) => {
        if (sent.current) return;
        const { body } = formApi.state.values;
        const empty = extractBodyText(body as RichTextDoc).trim() === '';
        saveDraft(draft, empty ? null : { body });
      },
    },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        await send.mutateAsync(threadResponseBody.parse(value));
        sent.current = true;
        saveDraft(draft, null);
        onSent();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (!showServerIssues(formApi, error.issues)) setFormError(error.message);
      }
    },
  });
  return (
    <form.AppForm>
      <form.Form className="grid gap-2">
        <form.AppField name="body">
          {(field) => <field.RichTextField label="Thread Response" />}
        </form.AppField>
        {formError ? <FormError>{formError}</FormError> : null}
        <div className="flex justify-end">
          <form.SubmitButton pending="Sending…">Send</form.SubmitButton>
        </div>
      </form.Form>
    </form.AppForm>
  );
}
