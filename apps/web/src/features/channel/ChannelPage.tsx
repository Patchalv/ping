import type { ChannelView } from '@ping/shared';
import { Link } from '@tanstack/react-router';
import { ChevronLeftIcon, LockIcon } from 'lucide-react';
import { Badge } from '#/components/ui/badge';
import { NotFound } from '../../components/NotFound';
import { ApiError } from '../../lib/api-client';
import { useChannel } from './api';

/** The Channel view: its Channel bar above the Thread feed. */
export function ChannelPage({ channelId }: { channelId: string }) {
  const channel = useChannel(channelId);
  if (channel.isPending) {
    return <p className="px-6 py-10 text-center text-muted-foreground">Loading…</p>;
  }
  if (channel.isError) {
    return channel.error instanceof ApiError && channel.error.status === 404 ? (
      <ChannelNotFound />
    ) : (
      <p className="px-6 py-10 text-center text-destructive" role="alert">
        {channel.error.message}
      </p>
    );
  }
  return (
    <>
      <ChannelBar channel={channel.data} />
      <section className="px-4 pt-3 pb-20 md:px-5" aria-label="Threads">
        <div className="mx-auto my-12 max-w-md text-center">
          <p className="font-semibold">No Threads yet</p>
          <p className="text-muted-foreground">Threads started in this Channel show up here.</p>
        </div>
      </section>
    </>
  );
}

function ChannelBar({ channel }: { channel: ChannelView }) {
  const isPrivate = channel.visibility === 'private';
  return (
    <section
      className="sticky top-0 z-10 border-b bg-background px-4 pt-2.5 md:px-5 md:pt-3"
      aria-label="Channel"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {/* Phone only: the sidebar is the home screen, so the Channel view needs a way back. */}
        <Link
          className="-ml-1 inline-flex shrink-0 items-center text-sm font-semibold text-primary md:hidden"
          to="/"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          Channels
        </Link>
        <h1 className="min-w-0 truncate text-lg font-bold">{channel.name}</h1>
        {isPrivate ? (
          <Badge variant="outline" className="text-muted-foreground">
            <LockIcon aria-hidden="true" />
            Private
          </Badge>
        ) : null}
        <span className="ml-auto shrink-0 text-small text-muted-foreground">
          {channel.memberCount} {channel.memberCount === 1 ? 'member' : 'members'}
        </span>
      </div>
      {channel.description ? (
        <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {channel.description}
        </p>
      ) : null}
      <div className="mt-2 flex gap-4">
        <span
          className="border-b-2 border-primary pb-1.5 text-small font-semibold"
          aria-current="page"
        >
          Threads
        </span>
      </div>
    </section>
  );
}

/** A missing Channel and a Private one the Staff member isn't in look the same. */
function ChannelNotFound() {
  return (
    <NotFound
      title="Channel not found"
      note="Check the link. If it’s a Private channel, ask one of its Channel admins to add you."
    />
  );
}
