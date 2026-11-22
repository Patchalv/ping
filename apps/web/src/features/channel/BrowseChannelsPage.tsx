import type { BrowseChannel } from '@ping/shared';
import { Link } from '@tanstack/react-router';
import { CheckIcon, ChevronLeftIcon, HashIcon } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { FormError } from '../../components/FormError';
import { useBrowseChannels, useJoinChannel } from './api';

/**
 * Browse channels (screens.md › Sidebar): every Public channel, with its member count and
 * a Join button, or "Joined". The sidebar lists only Channels you're in, so this is how
 * the rest are found. Accepting an invite lands here.
 */
export function BrowseChannelsPage() {
  const channels = useBrowseChannels();
  return (
    <>
      <section
        className="sticky top-0 z-10 border-b bg-background px-4 py-2.5 md:px-5 md:py-3"
        aria-label="Browse channels"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Phone only: the sidebar is the home screen, so this page needs a way back. */}
          <Link
            className="-ml-1 inline-flex shrink-0 items-center text-sm font-semibold text-primary md:hidden"
            to="/"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
            Channels
          </Link>
          <h1 className="min-w-0 truncate text-lg font-bold">Browse channels</h1>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every Public channel. Join one to see it in your sidebar.
        </p>
      </section>
      <section className="px-4 pt-3 pb-20 md:px-5">
        {channels.isPending ? (
          <p className="py-10 text-center text-muted-foreground">Loading…</p>
        ) : channels.isError ? (
          <p className="py-10 text-center text-destructive" role="alert">
            {channels.error.message}
          </p>
        ) : channels.data.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            No Public channels yet. Create one from the sidebar.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-background">
            {channels.data.map((channel) => (
              <BrowseRow key={channel.id} channel={channel} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function BrowseRow({ channel }: { channel: BrowseChannel }) {
  const join = useJoinChannel();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="grid min-w-0 flex-1">
        <Link
          className="inline-flex min-w-0 items-center gap-1.5 font-semibold hover:underline"
          to="/channels/$channelId"
          params={{ channelId: channel.id }}
        >
          <HashIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{channel.name}</span>
        </Link>
        <span className="truncate text-small text-muted-foreground">
          {channel.memberCount} {channel.memberCount === 1 ? 'member' : 'members'}
          {channel.description ? ` · ${channel.description}` : null}
        </span>
      </div>
      {channel.isMember ? (
        <span className="inline-flex h-8 w-20 shrink-0 items-center justify-center gap-1 text-sm font-medium text-muted-foreground max-md:h-10">
          <CheckIcon aria-hidden="true" className="size-4" />
          Joined
        </span>
      ) : (
        <Button
          variant="outline"
          className="w-20 shrink-0"
          disabled={join.isPending}
          onClick={() => join.mutate(channel.id)}
          aria-label={`Join ${channel.name}`}
        >
          {join.isPending ? 'Joining…' : 'Join'}
        </Button>
      )}
      {join.isError ? <FormError className="w-full">{join.error.message}</FormError> : null}
    </li>
  );
}
