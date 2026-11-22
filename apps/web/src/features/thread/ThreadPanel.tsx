import { Link } from '@tanstack/react-router';
import { ChevronLeftIcon, XIcon } from 'lucide-react';
import { RichTextView } from '#/components/rich-text/RichTextView';
import { SidePanel } from '#/components/SidePanel';
import { buttonVariants } from '#/components/ui/button';
import { cn } from '#/lib/utils';
import { NotFound } from '../../components/NotFound';
import { ApiError } from '../../lib/api-client';
import { useThread } from './api';
import { Byline } from './ThreadList';

/**
 * The Thread view: a side panel on the right of the Channel view on a laptop, full
 * screen on a phone (screens.md › Thread view). Thread Responses and the composer arrive
 * with #39; the Acknowledge buttons with Pings (#46).
 */
export function ThreadPanel({ channelId, threadId }: { channelId: string; threadId: string }) {
  const thread = useThread(channelId, threadId);
  const title = thread.data?.title ?? 'Thread';
  return (
    <SidePanel label={title}>
      <header className="flex items-center gap-2 border-b px-4 py-2 md:px-5">
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
        <Link
          to="/channels/$channelId"
          params={{ channelId }}
          aria-label="Close Thread"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
            'ml-auto max-md:hidden',
          )}
        >
          <XIcon aria-hidden="true" />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-5">
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
          <article>
            <Byline author={thread.data.author} at={thread.data.createdAt} />
            <h2 className="mt-2 text-lg font-bold [overflow-wrap:anywhere]">{thread.data.title}</h2>
            <RichTextView doc={thread.data.body} className="mt-2" />
          </article>
        )}
      </div>
    </SidePanel>
  );
}
