import type { ThreadView } from '@ping/shared';
import { Link } from '@tanstack/react-router';
import {
  BellIcon,
  BellOffIcon,
  CheckIcon,
  ChevronLeftIcon,
  CircleCheckIcon,
  RotateCcwIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { RichTextView } from '#/components/rich-text/RichTextView';
import { SidePanel } from '#/components/SidePanel';
import { Button, buttonVariants } from '#/components/ui/button';
import { cn } from '#/lib/utils';
import { FormError } from '../../components/FormError';
import { NotFound } from '../../components/NotFound';
import { ApiError } from '../../lib/api-client';
import { authClient } from '../../lib/auth-client';
import { useMarkRead, useMuteThread, useSetResolved, useThread, useThreadResponses } from './api';
import { Byline } from './Byline';
import { ContentMenu, ContentMenuDelete, ContentMenuEdit, EditedMark } from './ContentMenu';
import { DeleteThreadDialog } from './DeleteDialogs';
import { EditThreadDialog } from './EditThreadDialog';
import { Reactions } from './Reactions';
import { SaveButton } from './SaveButton';
import { ResolvedBadge } from './ThreadList';
import { ThreadResponseComposer, ThreadResponseList } from './ThreadResponses';

/**
 * The Thread view: a side panel on the right of the Channel view on a laptop, full
 * screen on a phone (screens.md › Thread view). The Thread, its Thread Responses, and the
 * composer at the bottom for members. Its "N new" divider marks what's new since the viewer's Ping began.
 */
export function ThreadPanel({ channelId, threadId }: { channelId: string; threadId: string }) {
  const thread = useThread(channelId, threadId);
  const markRead = useMarkRead();
  const setResolved = useSetResolved(channelId, threadId);
  const title = thread.data?.title ?? 'Thread';
  return (
    <SidePanel label={title}>
      {/* Wraps on a phone: the Thread's controls drop under the way back when they don't fit. */}
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2 md:px-5">
        {/* Phone: the panel covers the Channel, so the way back says where it goes. */}
        <Link
          to="/channels/$channelId"
          params={{ channelId }}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2 md:hidden')}
        >
          <ChevronLeftIcon aria-hidden="true" />
          Back to Channel
        </Link>
        <span className="text-small font-semibold text-muted-foreground max-md:hidden">Thread</span>
        {thread.data?.resolvedAt ? <ResolvedBadge /> : null}
        <div className="ml-auto flex items-center gap-2">
          {thread.data ? <ThreadAttention thread={thread.data} /> : null}
          {/* Acknowledge: opening the Thread never clears its Ping, so this does. */}
          {thread.data?.ping ? (
            <Button
              variant="outline"
              size="sm"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate({ channelId, threadId })}
            >
              <CheckIcon aria-hidden="true" />
              Mark read
            </Button>
          ) : null}
          {thread.data?.canResolve ? (
            <Button
              variant="outline"
              size="sm"
              disabled={setResolved.isPending}
              onClick={() => setResolved.mutate(!thread.data.resolvedAt)}
            >
              {thread.data.resolvedAt ? (
                <RotateCcwIcon aria-hidden="true" />
              ) : (
                <CircleCheckIcon aria-hidden="true" />
              )}
              {thread.data.resolvedAt ? 'Reopen' : 'Resolve'}
            </Button>
          ) : null}
          <Link
            to="/channels/$channelId"
            params={{ channelId }}
            aria-label="Close Thread"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'max-md:hidden')}
          >
            <XIcon aria-hidden="true" />
          </Link>
        </div>
      </header>
      {setResolved.isError ? (
        <FormError className="mx-4 mt-2 md:mx-5">{setResolved.error.message}</FormError>
      ) : null}
      {thread.isPending ? (
        <p className="py-10 text-center text-muted-foreground">Loading…</p>
      ) : thread.isError ? (
        thread.error instanceof ApiError && thread.error.status === 404 ? (
          <NotFound
            title="Thread not found"
            note="It may have been deleted, or the link is wrong."
          />
        ) : (
          <p className="py-10 text-center text-destructive" role="alert">
            {thread.error.message}
          </p>
        )
      ) : (
        <ThreadBody thread={thread.data} />
      )}
    </SidePanel>
  );
}

/**
 * Save and Mute for the open Thread. On a phone they show only their icons, so the
 * header fits.
 */
function ThreadAttention({ thread }: { thread: ThreadView }) {
  const mute = useMuteThread(thread.channelId, thread.id);
  return (
    <>
      <SaveButton thread={thread} className="max-md:[&>span]:sr-only" />
      <Button
        variant="ghost"
        size="sm"
        className="max-md:[&>span]:sr-only"
        aria-pressed={thread.isMuted}
        title={
          thread.isMuted
            ? 'Muted: new Thread Responses here don’t Ping you'
            : 'Stop new Thread Responses here Pinging you'
        }
        disabled={mute.isPending}
        onClick={() => mute.mutate(!thread.isMuted)}
      >
        {thread.isMuted ? <BellOffIcon aria-hidden="true" /> : <BellIcon aria-hidden="true" />}
        <span>{thread.isMuted ? 'Muted' : 'Mute'}</span>
      </Button>
    </>
  );
}

type OpenDialog = 'none' | 'edit' | 'delete';

function ThreadBody({ thread }: { thread: ThreadView }) {
  const responses = useThreadResponses(thread.channelId, thread.id);
  const staffMemberId = authClient.useSession().data?.user.id;
  const [dialog, setDialog] = useState<OpenDialog>('none');
  const list = responses.data?.responses ?? [];
  // What a Thread delete takes with it: other people's text, not placeholders. Unknown
  // until the Thread Responses load.
  const othersResponseCount = responses.isSuccess
    ? list.filter((r) => !r.isDeleted && r.author.staffId !== staffMemberId).length
    : undefined;
  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-5">
        <article>
          <div className="flex items-center gap-2">
            <Byline author={thread.author} at={thread.createdAt} />
            <EditedMark edited={thread.edited} />
            {thread.canEdit || thread.canDelete ? (
              <div className="ml-auto">
                <ContentMenu label="Thread actions">
                  {thread.canEdit ? <ContentMenuEdit onClick={() => setDialog('edit')} /> : null}
                  {thread.canDelete ? (
                    <ContentMenuDelete onClick={() => setDialog('delete')} />
                  ) : null}
                </ContentMenu>
              </div>
            ) : null}
          </div>
          <h2 className="mt-2 text-lg font-bold [overflow-wrap:anywhere]">{thread.title}</h2>
          <RichTextView doc={thread.body} mentionNames={thread.mentionNames} className="mt-2" />
          <Reactions
            channelId={thread.channelId}
            threadId={thread.id}
            reactions={thread.reactions}
            canReact={thread.canReact}
          />
        </article>
        {responses.isError ? (
          <p className="mt-5 text-destructive" role="alert">
            {responses.error.message}
          </p>
        ) : (
          <ThreadResponseList
            channelId={thread.channelId}
            responses={list}
            newSince={thread.ping ?? undefined}
          />
        )}
      </div>
      {thread.canRespond && staffMemberId ? (
        <div className="max-h-[50%] shrink-0 overflow-auto border-t px-4 py-3 md:px-5">
          <ThreadResponseComposer
            channelId={thread.channelId}
            threadId={thread.id}
            staffMemberId={staffMemberId}
          />
        </div>
      ) : null}
      {dialog === 'edit' ? (
        <EditThreadDialog thread={thread} onClose={() => setDialog('none')} />
      ) : dialog === 'delete' ? (
        <DeleteThreadDialog
          thread={thread}
          othersResponseCount={othersResponseCount}
          onClose={() => setDialog('none')}
        />
      ) : null}
    </>
  );
}
