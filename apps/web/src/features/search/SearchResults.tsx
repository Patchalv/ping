// Search results: a Channel or a Thread that matched, as a card whose title link stretches
// over it. A Thread result shows the matched words in its snippet; when the match was in a
// Thread Response, the snippet is from it and opening the result scrolls to it.
import type { ChannelSearchResult, SnippetPart, ThreadSearchResult } from '@ping/shared';
import { Link } from '@tanstack/react-router';
import { ArchiveIcon, CircleCheckIcon, HashIcon, LockIcon } from 'lucide-react';
import { Badge } from '#/components/ui/badge';
import { formatPostedAt } from '#/lib/format-time';
import { cn } from '#/lib/utils';

const CARD_CLASS =
  'relative rounded-lg border border-transparent bg-card px-4 py-3 text-card-foreground transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:border-border';

const STRETCHED_LINK = 'outline-none after:absolute after:inset-0 after:rounded-lg';

export function ArchivedBadge() {
  return (
    <Badge variant="tag">
      <ArchiveIcon aria-hidden="true" />
      Archived
    </Badge>
  );
}

export function ChannelResult({ channel }: { channel: ChannelSearchResult }) {
  return (
    <div className={CARD_CLASS}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex min-w-0 items-center gap-1 font-semibold">
          <HashIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <Link
            to="/channels/$channelId"
            params={{ channelId: channel.id }}
            className={cn(STRETCHED_LINK, 'truncate')}
          >
            {channel.name}
          </Link>
        </h3>
        {channel.visibility === 'private' ? (
          <Badge variant="tag">
            <LockIcon aria-hidden="true" />
            Private
          </Badge>
        ) : null}
        {channel.isArchived ? <ArchivedBadge /> : null}
        {channel.isMember ? null : (
          <span className="text-xs text-muted-foreground">You’re not a member</span>
        )}
      </div>
      {channel.description ? (
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {channel.description}
        </p>
      ) : null}
    </div>
  );
}

export function ThreadResult({ thread }: { thread: ThreadSearchResult }) {
  const by = thread.response?.author ?? thread.author;
  const at = thread.response?.createdAt ?? thread.createdAt;
  return (
    <div className={CARD_CLASS}>
      <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
        <span className="flex items-center gap-1">
          <HashIcon aria-hidden="true" className="size-3" />
          {thread.channelName}
        </span>
        {thread.channelIsArchived ? <ArchivedBadge /> : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold [overflow-wrap:anywhere]">
          <Link
            to="/channels/$channelId/threads/$threadId"
            params={{ channelId: thread.channelId, threadId: thread.id }}
            search={thread.response ? { response: thread.response.id } : {}}
            className={STRETCHED_LINK}
          >
            {thread.title}
          </Link>
        </h3>
        {thread.resolvedAt ? (
          <Badge variant="tag">
            <CircleCheckIcon aria-hidden="true" />
            Resolved
          </Badge>
        ) : null}
      </div>
      {thread.snippet.length > 0 ? (
        <p className="mt-0.5 line-clamp-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          <Snippet parts={thread.snippet} />
        </p>
      ) : null}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {thread.response ? 'Thread Response by ' : 'Started by '}
        <span className="font-semibold">{by ? by.name : 'Ping'}</span>
        {by?.isDeactivated ? ' (Deactivated)' : null}
        {' · '}
        <time dateTime={at}>{formatPostedAt(at)}</time>
      </p>
    </div>
  );
}

/** A snippet's or title's text, with matched words marked. Never HTML: every part is a text node. */
export function Snippet({ parts }: { parts: SnippetPart[] }) {
  return parts.map((part, index) =>
    part.match ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: -- the parts are fixed for this result
      <mark key={index} className="rounded-sm bg-primary/10 px-0.5 font-semibold text-foreground">
        {part.text}
      </mark>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: -- the parts are fixed for this result
      <span key={index}>{part.text}</span>
    ),
  );
}
