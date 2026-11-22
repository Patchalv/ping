import type { ThreadView } from '@ping/shared';
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
import { useDeleteThread, useDeleteThreadResponse } from './api';

/** A confirmation before something is deleted for good. */
function ConfirmDelete({
  title,
  children,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  pending: boolean;
  error: string | null;
  onConfirm(): void;
  onClose(): void;
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
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? 'Deleting…' : 'Delete'}
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
  /** Live Thread Responses by anyone but the viewer. */
  othersResponseCount: number;
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
      error={remove.isError ? remove.error.message : null}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    >
      {othersResponseCount > 0
        ? `This also deletes ${othersResponseCount} ${
            othersResponseCount === 1 ? 'Thread Response' : 'Thread Responses'
          } by other people. It can’t be undone.`
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
