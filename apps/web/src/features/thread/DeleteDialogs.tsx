import { type ThreadView, threadResponseCount } from '@ping/shared';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
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
import { useDeleteThread, useDeleteThreadResponse, useRemoveAttachment } from './api';

/** A confirmation before something is deleted for good. */
function ConfirmDelete({
  title,
  children,
  pending,
  waiting = false,
  error,
  onConfirm,
  onClose,
  confirmLabel = 'Delete',
  pendingLabel = 'Deleting…',
}: {
  title: string;
  children: ReactNode;
  pending: boolean;
  /** Still finding out what would go, so Delete waits. */
  waiting?: boolean;
  error: string | null;
  onConfirm(): void;
  onClose(): void;
  /** The confirming button, and what it says while that runs. */
  confirmLabel?: string;
  pendingLabel?: string;
}) {
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{children}</DialogDescription>
        </DialogHeader>
        {error ? <FormError>{error}</FormError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={pending || waiting} onClick={onConfirm}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Delete a Thread, after asking. It goes completely, with its Thread Responses, so the
 * confirmation says how many of other people's go with it.
 */
export function DeleteThreadDialog({
  thread,
  othersResponseCount,
  onClose,
}: {
  thread: ThreadView;
  /**
   * Thread Responses by anyone but the viewer that still have text. Undefined until the
   * Thread Responses have loaded, so the count is never a guess.
   */
  othersResponseCount: number | undefined;
  onClose(): void;
}) {
  const navigate = useNavigate();
  const remove = useDeleteThread(thread.channelId, thread.id, {
    onDeleted: () =>
      void navigate({ to: '/channels/$channelId', params: { channelId: thread.channelId } }),
  });
  return (
    <ConfirmDelete
      title="Delete this Thread?"
      pending={remove.isPending}
      waiting={othersResponseCount === undefined}
      error={remove.isError ? remove.error.message : null}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    >
      {othersResponseCount === undefined
        ? 'Checking its Thread Responses…'
        : othersResponseCount > 0
          ? `This also deletes ${threadResponseCount(othersResponseCount)} by other people. It can’t be undone.`
          : 'It goes for everyone, with its Thread Responses. It can’t be undone.'}
    </ConfirmDelete>
  );
}

/** Delete a Thread Response, after asking. A placeholder stays in its place. */
export function DeleteThreadResponseDialog({
  channelId,
  threadId,
  threadResponseId,
  onClose,
}: {
  channelId: string;
  threadId: string;
  threadResponseId: string;
  onClose(): void;
}) {
  const remove = useDeleteThreadResponse(channelId, threadId, threadResponseId);
  return (
    <ConfirmDelete
      title="Delete this Thread Response?"
      pending={remove.isPending}
      error={remove.isError ? remove.error.message : null}
      onConfirm={() => remove.mutate(undefined, { onSuccess: onClose })}
      onClose={onClose}
    >
      Its text goes for everyone, and “Thread Response deleted” shows in its place. It can’t be
      undone.
    </ConfirmDelete>
  );
}

/**
 * Remove an Attachment, after asking. Its file is deleted for real, and “Attachment removed
 * by <name>” shows in its place.
 */
export function RemoveAttachmentDialog({
  channelId,
  threadId,
  attachment,
  onClose,
}: {
  channelId: string;
  threadId: string;
  attachment: { id: string; filename: string };
  onClose(): void;
}) {
  const remove = useRemoveAttachment(channelId, threadId);
  return (
    <ConfirmDelete
      title={`Remove ${attachment.filename}?`}
      confirmLabel="Remove"
      pendingLabel="Removing…"
      pending={remove.isPending}
      error={remove.isError ? remove.error.message : null}
      onConfirm={() => remove.mutate(attachment.id, { onSuccess: onClose })}
      onClose={onClose}
    >
      The file is deleted for everyone, and a note that you removed it shows in its place. It can’t
      be undone.
    </ConfirmDelete>
  );
}
