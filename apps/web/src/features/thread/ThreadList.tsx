import type { ThreadAuthor, ThreadRow as ThreadRowData } from '@ping/shared';
import { Link } from '@tanstack/react-router';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { formatPostedAt } from '#/lib/format-time';
import { cn } from '#/lib/utils';
import { StaffAvatar } from '../../components/StaffAvatar';
import { useThreads } from './api';

/**
 * The Channel's feed: Thread rows by Latest activity, 50 at a time (screens.md › Channel
 * view). `openThreadId` marks the row whose Thread is open in the panel.
 */
export function ThreadList({
  channelId,
  openThreadId,
}: {
  channelId: string;
  openThreadId?: string;
}) {
  const threads = useThreads(channelId);
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
    return (
      <div className="mx-auto my-12 max-w-md text-center">
        <p className="font-semibold">No Threads yet</p>
        <p className="text-muted-foreground">Threads started in this Channel show up here.</p>
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

/** A Thread row: a white card with the author, time, title and a preview. */
function ThreadRow({ thread, open }: { thread: ThreadRowData; open: boolean }) {
  return (
    <Link
      to="/channels/$channelId/threads/$threadId"
      params={{ channelId: thread.channelId, threadId: thread.id }}
      aria-current={open ? 'true' : undefined}
      className={cn(
        'block rounded-lg border border-transparent bg-card px-4 py-3 text-card-foreground outline-none transition-colors hover:border-border focus-visible:ring-3 focus-visible:ring-ring/50',
        open && 'border-primary/60 hover:border-primary/60',
      )}
    >
      <Byline author={thread.author} at={thread.createdAt} />
      <h2 className="mt-1.5 font-semibold [overflow-wrap:anywhere]">{thread.title}</h2>
      {thread.preview ? (
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {thread.preview}
        </p>
      ) : null}
    </Link>
  );
}

/**
 * Who started a Thread, and when. A System thread comes from Ping; a Deactivated author
 * shows greyed with a label.
 */
export function Byline({ author, at }: { author: ThreadAuthor | null; at: string }) {
  const time = (
    <time dateTime={at} className="text-xs text-muted-foreground">
      {formatPostedAt(at)}
    </time>
  );
  if (!author) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-small font-semibold">Ping</span>
        {time}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <StaffAvatar
        staff={{ id: author.staffId, name: author.name }}
        size="sm"
        tone={author.isDeactivated ? 'deactivated' : 'active'}
      />
      <span
        className={cn(
          'truncate text-small font-semibold',
          author.isDeactivated && 'text-muted-foreground',
        )}
      >
        {author.name}
      </span>
      {author.isDeactivated ? <Badge variant="tag">Deactivated</Badge> : null}
      {time}
    </div>
  );
}
