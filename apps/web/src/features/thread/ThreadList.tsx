import {
  type ThreadListView,
  type ThreadRow as ThreadRowData,
  threadResponseCount,
} from '@ping/shared';
import { Link } from '@tanstack/react-router';
import { CheckIcon, CircleCheckIcon, HashIcon } from 'lucide-react';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { cn } from '#/lib/utils';
import { useMarkRead, useThreads } from './api';
import { Byline } from './Byline';
import { Reactions } from './Reactions';
import { SaveButton } from './SaveButton';

/**
 * The Channel's feed: Thread rows as the Thread list controls choose, 50 at a time
 * (screens.md › Channel view). `openThreadId` marks the row whose Thread is open in the
 * panel.
 */
export function ThreadList({
  channelId,
  view,
  openThreadId,
}: {
  channelId: string;
  view: ThreadListView;
  openThreadId?: string;
}) {
  const threads = useThreads(channelId, view);
  if (threads.isPending) {
    return <p className="px-6 py-10 text-center text-muted-foreground">Loading…</p>;
  }
  if (threads.isError) {
    return (
      <p className="px-6 py-10 text-center text-destructive" role="alert">
        {threads.error.message}
      </p>
    );
  }
  const rows = threads.data.pages.flatMap((page) => page.threads);
  if (rows.length === 0) {
    const empty = emptyList(view, threads.data.pages[0]?.resolvedHidden ?? 0);
    return (
      <div className="mx-auto my-12 max-w-md text-center">
        <p className="font-semibold">{empty.title}</p>
        <p className="text-muted-foreground">{empty.note}</p>
      </div>
    );
  }
  return (
    <>
      <ul className="grid gap-2">
        {rows.map((thread) => (
          <li key={thread.id}>
            <ThreadRow thread={thread} open={thread.id === openThreadId} />
          </li>
        ))}
      </ul>
      {threads.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            disabled={threads.isFetchingNextPage}
            onClick={() => void threads.fetchNextPage()}
          >
            {threads.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** What an empty view says, so a filter that hides everything doesn't read as "no Threads". */
function emptyList(view: ThreadListView, resolvedHidden: number) {
  const withPings = view.pings === 'with';
  if (view.status === 'resolved') {
    return {
      title: withPings ? 'No Resolved threads with Pings' : 'No Resolved threads',
      note: 'Threads show up here once they’re resolved.',
    };
  }
  if (withPings) {
    return {
      title: 'No Threads with Pings',
      note: 'Threads where you have a Ping show up here.',
    };
  }
  if (view.status === 'open' && resolvedHidden > 0) {
    return {
      title: 'No Open threads',
      note: `${resolvedHidden} Resolved hidden. Choose Status: All to see them.`,
    };
  }
  return { title: 'No Threads yet', note: 'Threads started in this Channel show up here.' };
}

/**
 * A Thread row: a white card with the author, time, title and a preview. The whole card
 * opens the Thread (the title's link stretches over it); its reactions sit above that
 * link, because a button can't live inside one.
 */
export function ThreadRow({
  thread,
  open,
  channelName,
}: {
  thread: ThreadRowData;
  open: boolean;
  /** Shown above the author in the Pings and Saved views, where rows come from many Channels. */
  channelName?: string;
}) {
  const markRead = useMarkRead();
  return (
    <div
      className={cn(
        'relative rounded-lg border border-transparent bg-card px-4 py-3 text-card-foreground transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:border-border',
        open && 'border-primary/60 hover:border-primary/60',
      )}
    >
      {channelName ? (
        <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <HashIcon aria-hidden="true" className="size-3" />
          {channelName}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Byline author={thread.author} at={thread.createdAt} />
        {thread.resolvedAt ? <ResolvedBadge /> : null}
      </div>
      <h2 className="mt-1.5 font-semibold [overflow-wrap:anywhere]">
        <Link
          to="/channels/$channelId/threads/$threadId"
          params={{ channelId: thread.channelId, threadId: thread.id }}
          aria-current={open ? 'true' : undefined}
          className="outline-none after:absolute after:inset-0 after:rounded-lg"
        >
          {thread.title}
        </Link>
      </h2>
      {thread.preview ? (
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {thread.preview}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {threadResponseCount(thread.responseCount)}
          {thread.pingCount > 0 ? (
            <>
              {' · '}
              <span className="font-semibold text-foreground">{thread.pingCount} new</span>
            </>
          ) : null}
        </p>
        <Reactions
          channelId={thread.channelId}
          threadId={thread.id}
          reactions={thread.reactions}
          canReact={thread.canReact}
          className="relative z-10 mt-0"
        />
        <div className="relative z-10 flex items-center gap-2 max-md:w-full md:ml-auto">
          <SaveButton thread={thread} className="max-md:-ml-2 md:[&>span]:sr-only" />
          {thread.pingCount > 0 ? (
            // Acknowledge: on a phone the button sits under the row, full width.
            <Button
              variant="outline"
              size="sm"
              className="max-md:flex-1"
              aria-label={`Mark ${thread.title} read`}
              disabled={markRead.isPending}
              onClick={() => markRead.mutate({ channelId: thread.channelId, threadId: thread.id })}
            >
              <CheckIcon aria-hidden="true" />
              <span className="md:sr-only">Mark read</span>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Marks a Resolved thread, on its row and in its Thread view. */
export function ResolvedBadge() {
  return (
    <Badge variant="tag">
      <CircleCheckIcon aria-hidden="true" />
      Resolved
    </Badge>
  );
}
